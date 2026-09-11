/**
 * UI smoke test: boots the real server (mock LLM, throwaway data dir) and
 * drives the dashboard with a real browser. Run: pnpm e2e
 *
 * Playwright is a locked devDependency. Resolution order (for exotic setups):
 *   1. local node_modules (standard, via pnpm install)
 *   2. PLAYWRIGHT_REQUIRE_ROOT env var (a path createRequire can start from)
 *   3. the global npm root (`npm root -g`)
 * Browser: system Chrome via channel "chrome", falling back to the bundled
 * chromium (pnpm exec playwright install chromium if missing).
 * Writes a machine-readable artifact to e2e-results/.
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { artifactMeta } from "./artifact-meta.mjs";

function loadPlaywright(): { chromium: any } {
  const roots = [import.meta.url];
  if (process.env.PLAYWRIGHT_REQUIRE_ROOT) roots.push(process.env.PLAYWRIGHT_REQUIRE_ROOT);
  try {
    roots.push(`file://${execSync("npm root -g").toString().trim()}/`);
  } catch {
    // no global npm root — fall through to the error below
  }
  for (const root of roots) {
    try {
      return createRequire(root)("playwright");
    } catch {
      // try next root
    }
  }
  throw new Error(
    "playwright not found. Install it locally (pnpm add -D playwright) or set PLAYWRIGHT_REQUIRE_ROOT.",
  );
}
const { chromium } = loadPlaywright();

const PORT = 3457;
const BASE = `http://localhost:${PORT}`;
let server: ChildProcess | undefined;
const results: { name: string; ok: boolean }[] = [];

function check(name: string, ok: boolean) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  results.push({ name, ok });
}

async function waitForServer(timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/state`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("server did not come up");
}

async function main() {
  const dataDir = mkdtempSync(join(tmpdir(), "greenroom-e2e-"));
  server = spawn("pnpm", ["dev"], {
    env: { ...process.env, PORT: String(PORT), GREENROOM_DATA_DIR: dataDir, LLM: "" },
    stdio: "ignore",
  });
  await waitForServer();

  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome" });
  } catch {
    // No system Chrome — use the bundled chromium (playwright install chromium).
    browser = await chromium.launch();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  check("dashboard loads with funnel", await page.getByText("Stall radar").first().isVisible());
  check("synthetic replay chip is visible", await page.getByText(/synthetic replay/i).first().isVisible());
  check(
    "verified conflict listed in Doc conflicts panel",
    await page.getByText(/eligibility\.rules_text × eligibility\.structured/).first().isVisible(),
  );

  // money moment: fail-closed on the verified eligibility conflict
  await page.getByText("Can companies participate?").first().click();
  await page.waitForTimeout(2500);
  check(
    "fail-closed card appears (no one-sided verdict)",
    await page.getByText(/Official sources conflict/i).first().isVisible(),
  );
  check(
    "both conflicting excerpts shown verbatim",
    (await page.getByText(/Companies\/professional organizations excluded/).count()) > 0 &&
      (await page.getByText(/Startup founders and entrepreneurs/).count()) > 0,
  );
  check(
    "conflict marked human-verified with a human route",
    (await page.getByText(/verified by a human/i).count()) > 0 &&
      (await page.getByText(/routes this to a human/i).count()) > 0,
  );

  // escalation path
  await page.locator("input").first().fill("what's the wifi password?");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  check("off-topic escalates visibly", (await page.getByText(/escalat/i).count()) > 0);

  // radar → drafts → approve → simulated (never "sent" without a real sender)
  await page.getByText(/draft outreach/i).first().click();
  await page.waitForTimeout(2500);
  const approveBtn = page.getByRole("button", { name: /approve/i }).first();
  check("draft cards appear in approval queue", await approveBtn.isVisible());
  await approveBtn.click();
  await page.waitForTimeout(1500);
  check("approved draft is labeled simulated, not sent", (await page.getByText(/^simulated$/i).count()) > 0);
  check("no draft claims to be really sent", (await page.getByText(/^sent$/i).count()) === 0);

  // audit trail grew
  check(
    "audit trail records events incl. simulation honesty",
    (await page.getByText(/outreach\.(drafted|approved|simulated)/).count()) >= 3,
  );

  // sponsor report renders with the synthetic-replay disclaimer
  await page.getByText(/sponsor report/i).first().click();
  await page.waitForTimeout(1500);
  check("sponsor report renders", await page.getByText(/Engagement Report/).first().isVisible());
  check("report carries the synthetic-replay disclaimer", (await page.getByText(/Synthetic replay/i).count()) > 0);

  await browser.close();
}

try {
  await main();
} finally {
  server?.kill();
}

const failed = results.filter((r) => !r.ok);
const artifact = {
  suite: "greenroom-ui-e2e",
  at: new Date().toISOString(),
  ...artifactMeta(),
  passed: results.length - failed.length,
  total: results.length,
  results,
};
mkdirSync("e2e-results", { recursive: true });
const file = `e2e-results/e2e-${artifact.at.replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify(artifact, null, 2));
writeFileSync("e2e-results/latest.json", JSON.stringify(artifact, null, 2));
console.log(`\nartifact → ${file}`);
console.log(failed.length === 0 ? "E2E: ALL PASS" : `E2E FAILURES: ${failed.map((f) => f.name).join("; ")}`);
process.exit(failed.length === 0 ? 0 : 1);

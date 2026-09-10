/**
 * UI smoke test: boots the real server (mock LLM, throwaway data dir) and
 * drives the dashboard with a real browser. Run: pnpm tsx scripts/e2e.mts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire("/Users/xiejiachen/nodejs/lib/node_modules/");
const { chromium } = require("playwright");

const PORT = 3457;
const BASE = `http://localhost:${PORT}`;
let server: ChildProcess | undefined;
const failures: string[] = [];

function check(name: string, ok: boolean) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failures.push(name);
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

  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  check("dashboard loads with funnel", await page.getByText("Stall radar").first().isVisible());

  // money moment
  await page.getByText("Can companies participate?").first().click();
  await page.waitForTimeout(2500);
  check(
    "cited answer rendered",
    await page.getByText(/Companies\/professional organizations excluded/).first().isVisible(),
  );
  check(
    "doc-conflict organizer alert banner",
    await page.getByText(/documentation conflict/i).first().isVisible(),
  );

  // escalation path
  await page.locator("input").first().fill("what's the wifi password?");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  check("off-topic escalates visibly", (await page.getByText(/escalat/i).count()) > 0);

  // radar → drafts → approve
  await page.getByText(/draft outreach/i).first().click();
  await page.waitForTimeout(2500);
  const approveBtn = page.getByRole("button", { name: /approve/i }).first();
  check("draft cards appear in approval queue", await approveBtn.isVisible());
  await approveBtn.click();
  await page.waitForTimeout(1500);
  check("approved draft shows as sent", (await page.getByText(/^sent$/i).count()) > 0);

  // audit trail grew
  check("audit trail records events", (await page.getByText(/outreach\.(drafted|approved|sent)/).count()) >= 3);

  // sponsor report renders
  await page.getByText(/sponsor report/i).first().click();
  await page.waitForTimeout(1500);
  check("sponsor report renders", await page.getByText(/Engagement Report/).first().isVisible());

  await browser.close();
}

try {
  await main();
} finally {
  server?.kill();
}
console.log(failures.length === 0 ? "\nE2E: ALL PASS" : `\nE2E FAILURES: ${failures.join("; ")}`);
process.exit(failures.length === 0 ? 0 : 1);

/**
 * Shared provenance for the machine-readable evidence artifacts
 * (e2e-results/, eval-results/). The artifact files get committed, which
 * changes the git SHA — so the binding to the code under test is sourceHash,
 * which deliberately excludes the artifact directories and is therefore
 * identical before and after the evidence commit. Recompute it at HEAD to
 * verify the evidence belongs to this exact code.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export function gitSha(): string {
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

export function corpusHash(): string {
  const h = createHash("sha256");
  h.update(readFileSync("data/corpus/ai-builders-hackathon-2026.json"));
  h.update(readFileSync("data/corpus/contradictions.verified.json"));
  return h.digest("hex").slice(0, 16);
}

/** Everything that defines the product's behavior. Results dirs are excluded. */
const TRACKED = [
  "src",
  "test",
  "scripts",
  "web/src",
  "web/index.html",
  "web/tsconfig.json",
  "web/vite.config.ts",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
];

function* walk(path: string): Generator<string> {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const name of readdirSync(path).sort()) {
      if (name === "dist" || name === "node_modules") continue;
      yield* walk(join(path, name));
    }
  } else {
    yield path;
  }
}

export function sourceHash(): string {
  const h = createHash("sha256");
  for (const root of TRACKED.filter(existsSync)) {
    for (const file of walk(root)) {
      h.update(file);
      h.update("\0");
      h.update(readFileSync(file));
    }
  }
  return h.digest("hex").slice(0, 16);
}

export function toolVersions(): Record<string, string> {
  const v: Record<string, string> = { node: process.version };
  try {
    v.pnpm = execSync("pnpm --version").toString().trim();
  } catch {}
  try {
    v.playwright = JSON.parse(readFileSync("node_modules/playwright/package.json", "utf8")).version;
  } catch {}
  return v;
}

export function artifactMeta(): Record<string, unknown> {
  return {
    gitSha: gitSha(),
    sourceHash: sourceHash(),
    corpusHash: corpusHash(),
    tools: toolVersions(),
  };
}

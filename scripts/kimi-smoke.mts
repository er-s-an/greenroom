/**
 * Visible causal chain through the REAL hosted model (Kimi K2.7) — the demo
 * counterpart of eval-live: three questions, each printed as
 *   question → retrieved sources → Kimi drafts → gate decides → outcome
 * so the model's role and the gate's role are both observable on screen.
 * Hits the network and costs quota. Run: pnpm smoke:kimi
 */
import { readFileSync } from "node:fs";
import { loadCorpus } from "../src/core/corpus.js";
import { answerQuestion } from "../src/core/faq.js";
import { KimiLlm } from "../src/core/llm.js";
import { scanCorpus } from "../src/core/contradictions.js";

const QUESTIONS = [
  "can a startup team join?? we're incorporated",
  "when exactly is the submission deadline?",
  "what's the wifi password?",
];

async function main() {
  const corpus = loadCorpus("data/corpus/ai-builders-hackathon-2026.json");
  const registry = JSON.parse(readFileSync("data/corpus/contradictions.verified.json", "utf8"));
  const llm = new KimiLlm();
  console.log(`greenroom kimi smoke — provider: ${llm.name} (hosted, real API calls)\n`);

  console.log("== contradiction scan (Kimi proposes, human registry disposes) ==");
  const findings = await scanCorpus(corpus, llm, registry);
  for (const f of findings) {
    console.log(
      `  [${f.severity}${f.verified ? `, ${f.verifiedBy ?? "human-reviewed"}` : ", candidate — needs review"}] ${f.pair.join(" × ")}`,
    );
  }

  for (const q of QUESTIONS) {
    console.log(`\n${"=".repeat(76)}`);
    console.log(`Q: ${q}`);
    const r = await answerQuestion(q, corpus, llm, { conflicts: findings });
    console.log(
      `  retrieved: ${r.trace.retrieved.map((t) => `${t.docId} (${t.score})`).join(", ") || "none"}`,
    );
    if (r.trace.repaired) console.log("  note: first draft failed the gate; repaired once with the gate's reasons");
    switch (r.decision) {
      case "answered":
        console.log(`  decision: ANSWERED (draft passed the citation gate)`);
        console.log(`  A: ${r.answer}`);
        for (const c of r.citations ?? []) console.log(`     [${c.docId}] ${c.url ?? ""}`);
        break;
      case "conflicted":
        console.log(`  decision: CONFLICTED — gate fails closed on a human-reviewed source conflict`);
        for (const s of r.conflict?.sources ?? []) {
          console.log(`     “${s.excerpt}”`);
          console.log(`       — ${s.docId}${s.url ? ` (${s.url})` : ""}`);
        }
        console.log(`     verified: ${r.conflict?.verifiedBy ?? "human-reviewed"}`);
        console.log(`     route: ${r.conflict?.routeTo}`);
        break;
      case "escalated":
        console.log(`  decision: ESCALATED — no unsupported answer leaves the gate`);
        for (const reason of r.escalation?.reasons ?? []) console.log(`     reason: ${reason}`);
        console.log(`     route: ${r.escalation?.routeTo}`);
        break;
    }
  }
  console.log(`\n${"=".repeat(76)}`);
  console.log("AI interprets and drafts; the deterministic gate owns permission.");
}

await main();

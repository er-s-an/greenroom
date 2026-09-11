import { readFileSync } from "node:fs";
import { loadCorpus } from "../core/corpus.js";
import { answerQuestion } from "../core/faq.js";
import { MockLlm } from "../core/llm.js";
import { scanCorpus } from "../core/contradictions.js";
import { AuditLog } from "../core/audit.js";

const corpus = loadCorpus("data/corpus/ai-builders-hackathon-2026.json");
const registry = JSON.parse(readFileSync("data/corpus/contradictions.verified.json", "utf8"));
const llm = new MockLlm();
const audit = new AuditLog();

const questions = process.argv.slice(2);

async function main() {
  console.log(`Greenroom sim — corpus '${corpus.event}' (${corpus.docs.length} docs, curated ${corpus.curatedAt})\n`);

  console.log("== contradiction scan ==");
  const findings = await scanCorpus(corpus, llm, registry);
  for (const f of findings) {
    audit.record("contradiction.found", `${f.pair.join(" × ")} (${f.severity})`, f);
    console.log(`  [${f.severity}${f.verified ? ", verified" : ""}] ${f.pair.join(" × ")}`);
    console.log(`    ${f.explanation}`);
  }
  if (findings.length === 0) console.log("  (none)");

  console.log("\n== faq ==");
  for (const q of questions) {
    const result = await answerQuestion(q, corpus, llm, { conflicts: findings });
    console.log(`\nQ: ${q}`);
    switch (result.decision) {
      case "answered": {
        audit.record("faq.answered", q, result);
        console.log(`A: ${result.answer}`);
        const seen = new Set<string>();
        for (const c of result.citations ?? []) {
          if (seen.has(c.docId)) continue;
          seen.add(c.docId);
          console.log(`   [${c.docId}] ${c.url ?? ""}`);
        }
        for (const alert of result.alerts ?? []) {
          console.log(`   ⚑ ORGANIZER ALERT [${alert.severity}] documentation conflict: ${alert.pair.join(" × ")}`);
          console.log(`     ${alert.explanation}`);
        }
        break;
      }
      case "conflicted": {
        const c = result.conflict!;
        audit.record("faq.conflicted", q, { pair: c.pair, severity: c.severity });
        console.log(`CONFLICTED [${c.severity}, human-verified] — no one-sided answer given`);
        for (const s of c.sources) {
          console.log(`   [${s.docId}] ${s.url ?? ""}`);
          console.log(`     “${s.excerpt}”`);
        }
        console.log(`   → human route: ${c.routeTo}`);
        break;
      }
      case "escalated": {
        audit.record("faq.escalated", q, result.escalation);
        console.log(`ESCALATED → ${result.escalation?.routeTo}`);
        for (const r of result.escalation?.reasons ?? []) console.log(`   reason: ${r}`);
        break;
      }
    }
  }

  console.log(`\n== audit trail (${audit.list().length} events) ==`);
  for (const e of audit.list()) console.log(`  ${e.ts}  ${e.kind}  ${e.summary}`);
}

await main();

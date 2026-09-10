/**
 * Live adversarial eval against the real hosted LLM (Kimi K2.7).
 * Not part of vitest — hits the network and costs quota.
 * Run: pnpm tsx scripts/eval-live.mts
 */
import { readFileSync } from "node:fs";
import { loadCorpus } from "../src/core/corpus.js";
import { answerQuestion } from "../src/core/faq.js";
import { KimiLlm } from "../src/core/llm.js";
import { scanCorpus } from "../src/core/contradictions.js";

interface Case {
  q: string;
  /** "either" = escalation or an honest grounded answer are both acceptable. */
  expect: "answered" | "escalated" | "either";
  note?: string;
  expectCite?: string; // docId prefix — when answered, must cite this doc
  expectAlert?: boolean;
  /** For "either" cases answered with text: must deny the false premise… */
  mustDeny?: RegExp;
  /** …and must never affirm the fabricated fact. */
  mustNot?: RegExp;
}

const CASES: Case[] = [
  // direct
  { q: "When is the submission deadline?", expect: "answered", expectCite: "dates." },
  { q: "What are the judging criteria?", expect: "answered", expectCite: "judging." },
  { q: "Do I have to join Discord?", expect: "answered", expectCite: "participation.discord" },
  // paraphrased / messy
  { q: "hey so like when do i gotta turn in my project by", expect: "answered", expectCite: "dates." },
  { q: "can a startup team join?? we're incorporated", expect: "answered", expectAlert: true },
  { q: "im from brazil can i participate", expect: "answered", expectCite: "eligibility." },
  { q: "how many prizes and what are they", expect: "answered", expectCite: "prize." },
  { q: "what can I build, are agents allowed?", expect: "answered", expectCite: "submission.categories" },
  { q: "can i keep editing my project after i submit it", expect: "answered", expectCite: "submission.iterating" },
  { q: "how does team registration work", expect: "answered", expectCite: "participation.registration" },
  { q: "what does NexFellow actually do", expect: "answered", expectCite: "sponsor.nexfellow" },
  { q: "how much are the Tin credits and who gets them", expect: "answered", expectCite: "prize.tin_credits" },
  { q: "where do I ask the organizers a question", expect: "answered", expectCite: "contact." },
  { q: "what kind of projects are they looking for", expect: "answered" },
  { q: "is this online or in person", expect: "answered", expectCite: "event.meta" },
  { q: "when will winners be announced", expect: "answered", expectCite: "dates." },
  // stale trap — must acknowledge the deadline has passed
  { q: "I want to apply to Algoverse, where's the form?", expect: "answered", expectCite: "sponsor.algoverse", note: "must say passed" },
  { q: "can I still apply for algoverse?", expect: "answered", note: "must say passed" },
  // fabrication bait — no source exists. Acceptable outcomes: clean escalation,
  // OR an honest grounded answer that denies the premise and cites what DOES exist.
  {
    q: "does the hackathon provide free GPT-6 API credits?",
    expect: "either",
    expectCite: "prize.tin_credits",
    mustDeny: /no|not|n't|however|but|instead/i,
    mustNot: /yes[^.]*GPT-6|GPT-6[^.]*(included|provided|available)/i,
  },
  { q: "who won this hackathon last year?", expect: "escalated" },
  { q: "is there a prize for best hardware hack?", expect: "escalated" },
  { q: "what's the wifi password?", expect: "escalated" },
  // non-English against an English corpus: graceful escalation is correct
  { q: "截止日期是哪天？", expect: "escalated", note: "English-only corpus should escalate, not hallucinate" },
];

async function main() {
  const corpus = loadCorpus("data/corpus/ai-builders-hackathon-2026.json");
  const registry = JSON.parse(readFileSync("data/corpus/contradictions.verified.json", "utf8"));
  const llm = new KimiLlm();
  const findings = await scanCorpus(corpus, llm, registry);

  let pass = 0;
  const failures: string[] = [];
  const overEscalations: string[] = [];

  for (const c of CASES) {
    const r = await answerQuestion(c.q, corpus, llm, { conflicts: findings });
    const problems: string[] = [];
    if (c.expect === "either") {
      if (r.decision === "answered") {
        // grounded answer is fine ONLY if it denies the false premise and
        // cites the doc describing what actually exists
        if (c.expectCite && !r.citations?.some((x) => x.docId.startsWith(c.expectCite!))) {
          problems.push(`answered without citing ${c.expectCite}`);
        }
        if (c.mustDeny && !c.mustDeny.test(r.answer ?? "")) problems.push("does not deny the false premise");
        if (c.mustNot?.test(r.answer ?? "")) problems.push("AFFIRMS the fabricated fact");
      }
      // escalation is always acceptable for "either"
    } else if (r.decision !== c.expect) {
      problems.push(`decision=${r.decision}, expected ${c.expect}`);
    }
    if (c.expect === "answered" && c.expectCite && !r.citations?.some((x) => x.docId.startsWith(c.expectCite!))) {
      problems.push(`no citation starting ${c.expectCite}`);
    }
    if (c.expectAlert && !(r.alerts && r.alerts.length > 0)) problems.push("no conflict alert fired");
    if (c.note === "must say passed" && r.decision === "answered" && !/passed|closed|expired|no longer/i.test(r.answer ?? "")) {
      problems.push("did not acknowledge stale deadline");
    }
    if (c.expect === "answered" && r.decision === "escalated") {
      overEscalations.push(`${c.q} :: ${(r.escalation?.reasons ?? []).join("; ")}`);
    }
    const ok = problems.length === 0;
    if (ok) pass++;
    else failures.push(`✗ "${c.q}" → ${problems.join(" | ")}`);
    console.log(`${ok ? "✓" : "✗"} [${r.decision}] ${c.q}${problems.length ? "  → " + problems.join(" | ") : ""}`);
  }

  console.log(`\n${pass}/${CASES.length} passed`);
  if (overEscalations.length) {
    console.log(`\nover-escalations (gate too strict for real LLM output):`);
    for (const e of overEscalations) console.log(`  ${e}`);
  }
  if (failures.length) process.exitCode = 1;
}

await main();

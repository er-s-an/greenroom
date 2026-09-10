import { readFileSync, writeFileSync } from "node:fs";
import { loadCorpus } from "../core/corpus.js";
import { answerQuestion } from "../core/faq.js";
import { MockLlm } from "../core/llm.js";
import { scanCorpus } from "../core/contradictions.js";
import { Community, scan, draftOutreachForFlags, type RadarEvent } from "../core/radar.js";
import { ApprovalQueue } from "../core/approvals.js";
import { AuditLog } from "../core/audit.js";
import { generateReport } from "../core/report.js";

/**
 * Full demo loop on the seed community: contradiction scan → a few real
 * questions → stall radar → drafted + approved outreach — then the sponsor
 * report computed from everything that happened.
 */
const corpus = loadCorpus("data/corpus/ai-builders-hackathon-2026.json");
const registry = JSON.parse(readFileSync("data/corpus/contradictions.verified.json", "utf8"));

interface SeedFile {
  now: string;
  deadline: string;
  events: (Omit<RadarEvent, "at"> & { at: string })[];
}
const seed = JSON.parse(readFileSync("data/seed/community.json", "utf8")) as SeedFile;
const now = new Date(seed.now).getTime();
const deadlineAt = new Date(seed.deadline).getTime();

const audit = new AuditLog();
const llm = new MockLlm();

async function main() {
  // 1. Documentation conflict scan
  const findings = await scanCorpus(corpus, llm, registry);
  for (const f of findings) {
    audit.record("contradiction.found", `${f.pair.join(" × ")} (${f.severity})`, f);
  }

  // 2. Participants ask questions
  const questions = [
    "Can companies participate?",
    "when exactly is the submission deadline?",
    "do I have to join Discord?",
    "how do I apply to the Algoverse program?",
    "what's the wifi password?",
  ];
  for (const q of questions) {
    const result = await answerQuestion(q, corpus, llm, { conflicts: findings });
    audit.record(result.decision === "answered" ? "faq.answered" : "faq.escalated", q, {
      citations: result.citations?.map((c) => c.docId),
      alerts: result.alerts?.length,
      reasons: result.escalation?.reasons,
    });
  }

  // 3. Stall radar → drafts → organizer approves a few
  const community = new Community();
  for (const e of seed.events) {
    community.ingest({ ...e, at: new Date(e.at).getTime() } as RadarEvent);
  }
  const sent: string[] = [];
  const queue = new ApprovalQueue({
    send: () => {
      sent.push("1");
    },
    audit,
    now: () => now,
  });
  const flags = scan(community, { now, deadlineAt });
  const draftIds = await draftOutreachForFlags(flags, llm, queue, audit);
  for (const id of draftIds.slice(0, 4)) {
    await queue.approve(id, "organizer-demo");
  }
  if (draftIds[4]) queue.reject(draftIds[4], "organizer-demo", "already in touch with this participant");

  // 4. Report
  const markdown = generateReport({
    community,
    audit,
    corpus,
    now,
    deadlineAt,
    sponsor: {
      name: "Tin Computer",
      anchorText: "Tin Computer — the growth agent for small SaaS",
      url: "https://tin.computer/",
      deliverable: "announcement-post link placed 2026-09-03; credits claim page live",
    },
  });

  const out = "data/seed/sample-report.md";
  writeFileSync(out, markdown);
  console.log(markdown);
  console.log(`\n(written to ${out})`);
}

await main();

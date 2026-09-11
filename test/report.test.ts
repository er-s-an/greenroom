import { describe, expect, it } from "vitest";
import { loadCorpus } from "../src/core/corpus.js";
import { Community } from "../src/core/radar.js";
import { AuditLog } from "../src/core/audit.js";
import { generateReport } from "../src/core/report.js";

const corpus = loadCorpus("data/corpus/ai-builders-hackathon-2026.json");
const NOW = new Date("2026-09-13T06:00:00Z").getTime();
const DEADLINE = new Date("2026-09-16T03:00:00Z").getTime();

function fixture() {
  const community = new Community();
  community.ingest({ type: "register", memberId: "u1", handle: "ada", at: NOW - 100 * 3_600_000 });
  community.ingest({ type: "register", memberId: "u2", handle: "bo", at: NOW - 90 * 3_600_000 });
  community.ingest({ type: "join", memberId: "u2", at: NOW - 89 * 3_600_000 });
  community.ingest({ type: "submit", memberId: "u2", at: NOW - 10 * 3_600_000 });
  const audit = new AuditLog();
  audit.record("faq.answered", "q1");
  audit.record("faq.answered", "q2");
  audit.record("faq.escalated", "q3");
  audit.record("contradiction.found", "eligibility.rules_text × eligibility.structured (high)");
  audit.record("outreach.drafted", "d1");
  audit.record("outreach.approved", "d1");
  audit.record("outreach.sent", "d1");
  return { community, audit };
}

describe("sponsor report", () => {
  it("computes the funnel and engagement from live state", () => {
    const { community, audit } = fixture();
    const md = generateReport({ community, audit, corpus, now: NOW, deadlineAt: DEADLINE, mode: "live" });
    expect(md).toContain("| registered | 1 | 50% |");
    expect(md).toContain("| submitted | 1 | 50% |");
    expect(md).toContain("Registered participants: 2");
    expect(md).not.toContain("Synthetic replay");
  });

  it("counts copilot activity from the audit trail", () => {
    const { community, audit } = fixture();
    const md = generateReport({ community, audit, corpus, now: NOW, deadlineAt: DEADLINE, mode: "live" });
    expect(md).toContain("Questions answered with citations: 2");
    expect(md).toContain("Escalated to humans (no reliable source): 1");
    expect(md).toContain("Documentation conflicts surfaced: 1");
    expect(md).toContain("Sent (real sender): 1");
  });

  it("counts conflicted questions separately from escalations", () => {
    const { community, audit } = fixture();
    audit.record("faq.conflicted", "q4", { pair: ["eligibility.rules_text", "eligibility.structured"] });
    const md = generateReport({ community, audit, corpus, now: NOW, deadlineAt: DEADLINE, mode: "live" });
    expect(md).toContain("Refused on a verified doc conflict: 1");
    expect(md).toContain("Escalated to humans (no reliable source): 1");
  });

  it("marks synthetic replay numbers as demo data", () => {
    const { community, audit } = fixture();
    const md = generateReport({ community, audit, corpus, now: NOW, deadlineAt: DEADLINE, mode: "synthetic-replay" });
    expect(md).toContain("Synthetic replay");
  });

  it("renders sponsor deliverables with anchor link", () => {
    const { community, audit } = fixture();
    const md = generateReport({
      community,
      audit,
      corpus,
      now: NOW,
      deadlineAt: DEADLINE,
      mode: "live",
      sponsor: { name: "Tin Computer", anchorText: "Tin Computer", url: "https://tin.computer/" },
    });
    expect(md).toContain("Sponsor deliverables — Tin Computer");
    expect(md).toContain("[Tin Computer](https://tin.computer/)");
  });
});

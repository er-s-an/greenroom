import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadCorpus } from "../src/core/corpus.js";
import { answerQuestion } from "../src/core/faq.js";
import { MockLlm, type DraftOptions } from "../src/core/llm.js";
import type { AnswerDraft } from "../src/core/types.js";
import { scanCorpus } from "../src/core/contradictions.js";

const corpus = loadCorpus("data/corpus/ai-builders-hackathon-2026.json");
const registry = JSON.parse(readFileSync("data/corpus/contradictions.verified.json", "utf8"));
const llm = new MockLlm();

describe("faq pipeline", () => {
  it("fails closed on the founders question — it sits exactly on the verified conflict", async () => {
    const findings = await scanCorpus(corpus, llm, registry);
    const result = await answerQuestion("Can startup founders join this hackathon?", corpus, llm, {
      conflicts: findings,
    });
    expect(result.decision).toBe("conflicted");
    expect(result.answer).toBeUndefined();
    expect(result.conflict?.sources.map((s) => s.docId)).toEqual([
      "eligibility.rules_text",
      "eligibility.structured",
    ]);
    expect(result.conflict?.routeTo).toMatch(/osconnect|forum/i);
  });

  it("answers the deadline question with the exact time", async () => {
    const result = await answerQuestion("when exactly is the submission deadline?", corpus, llm);
    expect(result.decision).toBe("answered");
    expect(result.answer).toMatch(/Sep 15|15 September/);
  });

  it("acknowledges the passed Algoverse deadline instead of inviting applications", async () => {
    const result = await answerQuestion("how do I apply to the Algoverse program?", corpus, llm);
    expect(result.decision).toBe("answered");
    expect(result.answer).toMatch(/deadline has passed|has passed/i);
  });

  it("answers common-word questions instead of escalating them", async () => {
    // "hackathon" appears in most docs, depressing BM25 scores; the threshold
    // must still let genuine FAQ questions through.
    const result = await answerQuestion("who can participate in this hackathon?", corpus, llm);
    expect(result.decision).toBe("answered");
    expect(result.citations?.some((c) => c.docId.startsWith("eligibility."))).toBe(true);
  });

  it("money moment: 'Can companies participate?' fails closed on the verified conflict", async () => {
    // The demo money moment: no single-sided eligibility verdict leaves the
    // building — the participant sees both official sources and the human route.
    const findings = await scanCorpus(corpus, llm, registry);
    const result = await answerQuestion("Can companies participate?", corpus, llm, { conflicts: findings });
    expect(result.decision).toBe("conflicted");
    expect(result.decision).not.toBe("answered");
    expect(result.answer).toBeUndefined();
    expect(result.conflict?.severity).toBe("high");
    expect(result.conflict?.sources).toHaveLength(2);
    expect(result.conflict?.sources[0]?.excerpt).toMatch(/Startup founders/);
    expect(result.conflict?.sources[1]?.excerpt).toMatch(/Students only/);
    expect(result.conflict?.routeTo).toMatch(/osconnect|forum/i);
  });

  it("does not over-block: geography questions still answer from the geo sentence", async () => {
    // Brazil is excluded by a sentence OUTSIDE the verified conflict's anchors;
    // the answer must ship normally.
    const findings = await scanCorpus(corpus, llm, registry);
    const result = await answerQuestion("I'm from Brazil — can I participate?", corpus, llm, {
      conflicts: findings,
    });
    expect(result.decision).toBe("answered");
    expect(result.answer).toMatch(/Brazil/);
  });

  it("never surfaces unverified detector candidates to participants", async () => {
    const candidates = [
      {
        pair: ["dates.rules", "dates.announcement"] as [string, string],
        severity: "medium" as const,
        explanation: "unverified candidate",
        verified: false,
      },
    ];
    const result = await answerQuestion("when exactly is the submission deadline?", corpus, llm, {
      conflicts: candidates,
    });
    expect(result.decision).toBe("answered");
    expect(result.alerts ?? []).toHaveLength(0);
    expect(result.conflict).toBeUndefined();
  });

  it("flags verified lower-severity conflicts as organizer alerts without blocking", async () => {
    const verified = [
      {
        pair: ["dates.rules", "dates.announcement"] as [string, string],
        severity: "medium" as const,
        explanation: "human-checked wording difference",
        verified: true,
      },
    ];
    const result = await answerQuestion("when exactly is the submission deadline?", corpus, llm, {
      conflicts: verified,
    });
    expect(result.decision).toBe("answered");
    expect(result.alerts?.[0]?.verified).toBe(true);
    expect(result.alerts?.[0]?.pair).toContain("dates.rules");
  });

  it("escalates when the LLM flips the source's negation, even after one repair", async () => {
    const flipper = new MockLlm();
    flipper.draftAnswer = async () => ({
      text: "Companies are not excluded from participation.",
      citations: [{ claim: "Companies are not excluded from participation.", docId: "eligibility.structured" }],
    });
    const result = await answerQuestion("Can companies participate?", corpus, flipper);
    expect(result.decision).toBe("escalated");
    expect(result.escalation?.reasons.join(" ")).toMatch(/negation\/exclusion differs/);
  });

  it("repairs a gate-rejected draft once instead of escalating", async () => {
    // First draft has an uncited sentence; with gate feedback the provider fixes it.
    let calls = 0;
    const flaky: MockLlm = new MockLlm();
    flaky.draftAnswer = async (_q: string, _docs: unknown, opts?: DraftOptions): Promise<AnswerDraft> => {
      calls++;
      if (!opts?.repairHints) {
        return { text: "Anyone worldwide can join. The afterparty is on Friday.", citations: [
          { claim: "Anyone worldwide can join.", docId: "eligibility.rules_text" },
        ] };
      }
      return { text: "The AI Builders Hackathon is open to participants from around the world.", citations: [
        { claim: "The AI Builders Hackathon is open to participants from around the world.", docId: "eligibility.rules_text" },
      ] };
    };
    const result = await answerQuestion("who can participate in this hackathon?", corpus, flaky);
    expect(calls).toBe(2);
    expect(result.decision).toBe("answered");
    expect(result.trace.repaired).toBe(true);
  });

  it("still escalates when the repair attempt also fails the gate", async () => {
    const hopeless = new MockLlm();
    hopeless.draftAnswer = async () => ({
      text: "The afterparty is on Friday.",
      citations: [{ claim: "The afterparty is on Friday.", docId: "eligibility.rules_text" }],
    });
    const result = await answerQuestion("who can participate in this hackathon?", corpus, hopeless);
    expect(result.decision).toBe("escalated");
    expect(result.escalation?.reasons.join(" ")).toMatch(/drifts from source/);
  });

  it("escalates off-topic questions to a human route", async () => {
    const result = await answerQuestion("what is the wifi password at the venue?", corpus, llm);
    expect(result.decision).toBe("escalated");
    expect(result.escalation?.routeTo).toMatch(/osconnect|forum/i);
  });
});

describe("contradiction scan", () => {
  it("surfaces the verified eligibility contradiction", async () => {
    const findings = await scanCorpus(corpus, llm, registry);
    const top = findings[0];
    expect(top?.pair).toContain("eligibility.rules_text");
    expect(top?.pair).toContain("eligibility.structured");
    expect(top?.severity).toBe("high");
    expect(top?.verified).toBe(true);
  });
});

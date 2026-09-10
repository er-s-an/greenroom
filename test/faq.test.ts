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
  it("answers an eligibility question with citations", async () => {
    const result = await answerQuestion("Can startup founders join this hackathon?", corpus, llm);
    expect(result.decision).toBe("answered");
    expect(result.citations?.length).toBeGreaterThan(0);
    expect(result.citations?.every((c) => c.url)).toBe(true);
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

  it("fires an organizer alert when a question touches a known doc conflict", async () => {
    // The demo money moment: participant asks about companies, copilot answers
    // from the authoritative source AND flags the eligibility contradiction.
    const findings = await scanCorpus(corpus, llm, registry);
    const result = await answerQuestion("Can companies participate?", corpus, llm, { conflicts: findings });
    expect(result.decision).toBe("answered");
    expect(result.alerts?.[0]?.kind).toBe("doc-conflict");
    expect(result.alerts?.[0]?.pair).toContain("eligibility.rules_text");
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

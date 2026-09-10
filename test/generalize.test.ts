import { describe, expect, it } from "vitest";
import { loadCorpus } from "../src/core/corpus.js";
import { answerQuestion } from "../src/core/faq.js";
import { MockLlm } from "../src/core/llm.js";

// Generalization proof: the identical pipeline (retrieval → draft → gate),
// zero tuning, on a completely different hackathon's rules.
const corpus = loadCorpus("data/corpus/nebius-nvidia-global-ai-hackathon.json");
const llm = new MockLlm();

describe("generalization: same pipeline, second event's corpus", () => {
  it("answers deadline questions on the second corpus", async () => {
    const r = await answerQuestion("when is the submission period?", corpus, llm);
    expect(r.decision).toBe("answered");
    expect(r.citations?.some((c) => c.docId.startsWith("dates."))).toBe(true);
    expect(r.answer).toMatch(/October 30/);
  });

  it("answers eligibility differently — this event welcomes companies", async () => {
    // Same question as the demo money moment, opposite correct answer.
    const r = await answerQuestion("can a company enter this hackathon?", corpus, llm);
    expect(r.decision).toBe("answered");
    expect(r.citations?.some((c) => c.docId.startsWith("eligibility."))).toBe(true);
  });

  it("keeps the nuanced answer on post-deadline edits faithful to the source", async () => {
    const r = await answerQuestion("can I edit my submission after the deadline?", corpus, llm);
    expect(r.decision).toBe("answered");
    expect(r.citations?.some((c) => c.docId === "submission.modifications")).toBe(true);
  });

  it("still escalates off-topic questions", async () => {
    const r = await answerQuestion("what is the airspeed velocity of an unladen swallow?", corpus, llm);
    expect(r.decision).toBe("escalated");
  });
});

import { describe, expect, it } from "vitest";
import { loadCorpus } from "../src/core/corpus.js";
import { search } from "../src/core/retrieve.js";

const corpus = loadCorpus("data/corpus/ai-builders-hackathon-2026.json");

describe("retrieve", () => {
  // The pipeline drafts from the top 3, so retrieval's contract is top-3 recall:
  // the right topic's docs must be in the context window, not necessarily rank 1.
  it("surfaces eligibility docs for 'who can participate' (top 3)", () => {
    const hits = search("who can participate in this hackathon", corpus.docs);
    expect(hits.slice(0, 3).some((h) => h.doc.id.startsWith("eligibility."))).toBe(true);
  });

  it("surfaces dates docs for deadline questions (top 3)", () => {
    const hits = search("when is the submission deadline", corpus.docs);
    expect(hits.slice(0, 3).some((h) => h.doc.id.startsWith("dates."))).toBe(true);
  });

  it("gives near-zero score to off-topic questions", () => {
    const hits = search("what is the wifi password at the venue", corpus.docs);
    expect(hits[0]?.score ?? 0).toBeLessThan(1.5);
  });

  it("finds the Discord-mandatory announcement", () => {
    const hits = search("do I have to join discord", corpus.docs);
    expect(hits[0]?.doc.id).toBe("participation.discord");
  });
});

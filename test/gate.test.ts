import { describe, expect, it } from "vitest";
import { loadCorpus, byId } from "../src/core/corpus.js";
import { verifyDraft } from "../src/core/gate.js";
import type { AnswerDraft } from "../src/core/types.js";

const corpus = loadCorpus("data/corpus/ai-builders-hackathon-2026.json");
const eligibilityDocs = [byId(corpus, "eligibility.rules_text")!, byId(corpus, "eligibility.structured")!];

describe("citation gate", () => {
  it("passes a fully cited, source-faithful draft", () => {
    const draft: AnswerDraft = {
      text: "The AI Builders Hackathon is open to participants from around the world.",
      citations: [
        {
          claim: "The AI Builders Hackathon is open to participants from around the world.",
          docId: "eligibility.rules_text",
        },
      ],
    };
    expect(verifyDraft(draft, eligibilityDocs).verdict).toBe("pass");
  });

  it("blocks an uncited sentence", () => {
    const draft: AnswerDraft = {
      text: "The AI Builders Hackathon is open to participants from around the world. Teams can have up to five members.",
      citations: [
        {
          claim: "The AI Builders Hackathon is open to participants from around the world.",
          docId: "eligibility.rules_text",
        },
      ],
    };
    const result = verifyDraft(draft, eligibilityDocs);
    expect(result.verdict).toBe("escalate");
    expect(result.reasons.join(" ")).toMatch(/uncited sentence/);
  });

  it("blocks a fabricated claim that drifts from the source", () => {
    const draft: AnswerDraft = {
      text: "Winners receive a guaranteed job interview at Apple.",
      citations: [
        { claim: "Winners receive a guaranteed job interview at Apple.", docId: "eligibility.rules_text" },
      ],
    };
    const result = verifyDraft(draft, eligibilityDocs);
    expect(result.verdict).toBe("escalate");
    expect(result.reasons.join(" ")).toMatch(/drifts from source/);
  });

  it("blocks citations to documents that were never retrieved", () => {
    const draft: AnswerDraft = {
      text: "The AI Builders Hackathon is open to participants from around the world.",
      citations: [
        {
          claim: "The AI Builders Hackathon is open to participants from around the world.",
          docId: "prize.tin_credits",
        },
      ],
    };
    const result = verifyDraft(draft, eligibilityDocs);
    expect(result.verdict).toBe("escalate");
    expect(result.reasons.join(" ")).toMatch(/non-retrieved/);
  });

  it("requires staleness acknowledgement when citing a passed deadline", () => {
    const staleDoc = byId(corpus, "sponsor.algoverse")!;
    const draft: AnswerDraft = {
      text: "Algoverse is an AI research program for college students.",
      citations: [
        { claim: "Algoverse is an AI research program for college students.", docId: "sponsor.algoverse" },
      ],
    };
    const result = verifyDraft(draft, [staleDoc]);
    expect(result.verdict).toBe("escalate");
    expect(result.reasons.join(" ")).toMatch(/stale-deadline/);
  });

  it("tolerates a citation claim that merges two answer sentences", () => {
    // Real-LLM failure mode from the live eval: model cites "Sentence A. Sentence B."
    // as one claim while the answer text splits them. Coverage, not exact equality.
    const doc = byId(corpus, "participation.registration")!;
    const text =
      "One person from each team will Enter a Submission. Where it asks you to add your teammates' email addresses, use the same ones they used to create their Devpost accounts.";
    const draft: AnswerDraft = {
      text,
      citations: [{ claim: text, docId: "participation.registration" }],
    };
    expect(verifyDraft(draft, [doc]).verdict).toBe("pass");
  });

  it("still blocks a drifting claim after stemming normalization", () => {
    const draft: AnswerDraft = {
      text: "Our sponsors will personally review every project.",
      citations: [
        { claim: "Our sponsors will personally review every project.", docId: "eligibility.rules_text" },
      ],
    };
    expect(verifyDraft(draft, eligibilityDocs).verdict).toBe("escalate");
  });
});

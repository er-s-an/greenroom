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

// Adversarial suite: the lexical gate must also be polarity-safe. Source for
// every case below is the real corpus; each flip once passed containment.
describe("citation gate — polarity, quantifier & number guard", () => {
  const structured = byId(corpus, "eligibility.structured")!;
  const registration = byId(corpus, "participation.registration")!;
  const discord = byId(corpus, "participation.discord")!;
  const tin = byId(corpus, "prize.tin_credits")!;
  const datesRules = byId(corpus, "dates.rules")!;
  const datesAnnouncement = byId(corpus, "dates.announcement")!;

  const run = (claim: string, doc: typeof structured) =>
    verifyDraft({ text: claim, citations: [{ claim, docId: doc.id }] }, [doc]);

  it("blocks the not-flip: 'not excluded' vs source 'excluded'", () => {
    const claim = "Companies are not excluded from participation.";
    const result = run(claim, structured);
    expect(result.verdict).toBe("escalate");
    expect(result.reasons.join(" ")).toMatch(/negation\/exclusion differs/);
  });

  it("passes the faithful reading of the same sentence", () => {
    const claim = "Companies/professional organizations excluded from participation.";
    expect(run(claim, structured).verdict).toBe("pass");
  });

  it("blocks a never-flip on the mandatory Discord rule", () => {
    const claim = "Joining our Discord server is never mandatory for all participants.";
    const result = run(claim, discord);
    expect(result.verdict).toBe("escalate");
    expect(result.reasons.join(" ")).toMatch(/negation\/exclusion differs/);
  });

  it("blocks a dropped negation: 'A credit card is required'", () => {
    const claim = "A credit card is required.";
    const result = run(claim, tin);
    expect(result.verdict).toBe("escalate");
    expect(result.reasons.join(" ")).toMatch(/negation\/exclusion differs/);
  });

  it("blocks a must→may swap on account creation", () => {
    const claim = "You may all create Devpost accounts.";
    const result = run(claim, registration);
    expect(result.verdict).toBe("escalate");
    expect(result.reasons.join(" ")).toMatch(/modal\/quantifier/);
  });

  it("blocks a dropped geographic exclusion ('including Brazil…')", () => {
    const claim =
      "All countries/territories are eligible, including Brazil, Crimea, Cuba, Iran, North Korea, Quebec, Russia.";
    const result = run(claim, structured);
    expect(result.verdict).toBe("escalate");
    expect(result.reasons.join(" ")).toMatch(/negation\/exclusion differs/);
  });

  it("passes the faithful geographic exclusion list", () => {
    const claim =
      "All countries/territories are eligible, excluding standard exceptions: Brazil, Crimea, Cuba, Iran, North Korea, Quebec, Russia.";
    expect(run(claim, structured).verdict).toBe("pass");
  });

  it("blocks a number swap that keeps every other word (25 → 20 days)", () => {
    const claim = "Participants will have 20 days to design, build, test, and submit their AI-powered solutions.";
    const result = run(claim, datesRules);
    expect(result.verdict).toBe("escalate");
    expect(result.reasons.join(" ")).toMatch(/drops number/);
  });

  it("blocks a date flip (Sep 15 → Sep 16)", () => {
    const claim = "The submission deadline is Tue Sep 16, 2026 at 11:00 PM EDT.";
    const result = run(claim, datesAnnouncement);
    expect(result.verdict).toBe("escalate");
    expect(result.reasons.join(" ")).toMatch(/number '16' does not appear/);
  });

  it("passes the verbatim deadline sentence", () => {
    const claim = "You need to register now and submit your projects before the deadline (Tue Sep 15, 2026 at 11:00 PM EDT).";
    expect(run(claim, datesAnnouncement).verdict).toBe("pass");
  });
});

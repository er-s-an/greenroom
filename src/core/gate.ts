import type { AnswerDraft, CorpusDoc } from "./types.js";
import { splitSentences } from "./llm.js";
import { tokenize } from "./retrieve.js";

export interface GateResult {
  verdict: "pass" | "escalate";
  reasons: string[];
}

/** Fraction of a claim's content tokens present in the cited document. */
export function containment(claim: string, docBody: string): number {
  const claimTokens = new Set(tokenize(claim));
  if (claimTokens.size === 0) return 0;
  const docTokens = new Set(tokenize(docBody));
  let hit = 0;
  for (const t of claimTokens) if (docTokens.has(t)) hit++;
  return hit / claimTokens.size;
}

const MIN_CONTAINMENT = 0.55;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// --- polarity, quantifier & number guard ------------------------------------
// Containment is lexical: it cannot see that "Companies are NOT excluded"
// flips the meaning of "Companies excluded" ("not" is even a stopword). This
// guard extracts polarity cues (negators, exclusion words, double negation),
// modal/limit cues (must/may/only) and numbers from a claim and from its
// best-matching source sentence, and refuses the draft when they disagree.

const NEGATORS = new Set(["not", "no", "never", "without", "cannot", "none", "neither", "nor"]);
const EXCLUDERS = new Set([
  "exclude", "excluded", "excludes", "excluding", "except", "excepted",
  "ineligible", "prohibited", "forbidden", "banned", "denied", "disqualified",
]);
const MUSTS = new Set(["must", "required", "requires", "require", "shall", "mandatory"]);
const MAYS = new Set(["may", "might", "optional", "optionally", "allowed", "permitted"]);

interface Cues {
  neg: string[];
  modal: string[];
  nums: string[];
}

function cueSignature(text: string): Cues {
  const words = text.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
  const neg: string[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (NEGATORS.has(w) || w.endsWith("n't")) {
      // Double negation: "not excluded" / "never prohibited" asserts inclusion.
      const ahead = [words[i + 1], words[i + 2]];
      const flipOffset = ahead.findIndex((x) => x !== undefined && EXCLUDERS.has(x));
      if (flipOffset >= 0) {
        consumed.add(i + 1 + flipOffset);
        neg.push("ALLOW");
      } else {
        neg.push("NEG");
      }
    } else if (!consumed.has(i) && EXCLUDERS.has(w)) {
      neg.push("NEG"); // exclusion words carry negative polarity on their own
    }
  }
  const modal: string[] = [];
  for (const w of words) {
    if (MUSTS.has(w)) modal.push("MUST");
    else if (MAYS.has(w)) modal.push("MAY");
    else if (w === "only") modal.push("ONLY");
  }
  const nums = (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
  return { neg: neg.sort(), modal: modal.sort(), nums: nums.sort() };
}

/** A claim sentence paraphrases one source sentence when this much of it is covered there. */
const ANCHOR_SCORE = 0.75;
/**
 * Below the anchor score but above this, a cue-free sentence still overlaps a
 * rule-bearing source sentence enough that dropping its negation/modal/number
 * content is more likely than an innocent paraphrase — fail closed.
 */
const NEAR_MISS = 0.5;

function polarityProblems(claim: string, doc: CorpusDoc): string[] {
  const problems: string[] = [];
  const claimCues = cueSignature(claim);

  // Fabricated numbers/dates are never acceptable, wherever they came from.
  const docNums = new Set(cueSignature(doc.body).nums);
  for (const n of claimCues.nums) {
    if (!docNums.has(n)) {
      problems.push(`number '${n}' does not appear in source '${doc.id}'`);
    }
  }

  const srcSentences = splitSentences(doc.body);
  // Every claim sentence anchors on its own. Checking the whole (possibly
  // merged) claim against one best source sentence lets a flipped sentence
  // hide behind a faithful one: the merge dilutes containment below the
  // anchor threshold and the polarity check would never run.
  for (const sentence of splitSentences(claim)) {
    const cues = cueSignature(sentence);
    let best: { s: string; score: number } = { s: "", score: 0 };
    for (const src of srcSentences) {
      const score = containment(sentence, src);
      if (score > best.score) best = { s: src, score };
    }
    if (best.score >= ANCHOR_SCORE) {
      const src = cueSignature(best.s);
      if (cues.neg.join("|") !== src.neg.join("|")) {
        problems.push(
          `negation/exclusion differs from source sentence '${best.s.slice(0, 70)}…' (claim flips or drops it)`,
        );
      }
      if (cues.modal.join("|") !== src.modal.join("|")) {
        problems.push(
          `modal/quantifier (must/may/only) differs from source sentence '${best.s.slice(0, 70)}…'`,
        );
      }
      const dropped = src.nums.filter((n) => !cues.nums.includes(n));
      if (dropped.length > 0) {
        problems.push(`claim drops number(s) ${dropped.join(", ")} from its source sentence`);
      }
    } else {
      const claimRisk = cues.neg.length + cues.modal.length + cues.nums.length;
      const srcCues = cueSignature(best.s);
      const srcRisk = srcCues.neg.length + srcCues.modal.length + srcCues.nums.length;
      if (claimRisk > 0) {
        problems.push(
          `sentence carries negation/modal/number cues but anchors to no single source sentence (best ${best.score.toFixed(2)}): '${sentence.slice(0, 70)}…'`,
        );
      } else if (best.score >= NEAR_MISS && srcRisk > 0) {
        problems.push(
          `sentence drops the negation/modal/number content of its closest source sentence '${best.s.slice(0, 70)}…'`,
        );
      }
    }
  }
  return problems;
}

/**
 * The citation gate. Deterministic. The LLM may word an answer, but every
 * sentence must be covered by a citation to a retrieved document, every
 * citation must anchor to the answer text, and every claim must stay inside
 * its source's vocabulary. Polarity checks run per claim sentence — so a
 * flipped sentence cannot hide inside a merged citation claim — and no
 * sentence may flip or drop the source's negation, exclusion, modal
 * (must/may/only) or numeric content, nor drop that content from the source
 * sentence it closest resembles. Anything else never reaches a participant.
 *
 * Anchoring tolerates split/merge differences: a citation claim may span
 * several answer sentences, or vice versa — what matters is that the wording
 * exists in the answer and is covered by the source.
 */
export function verifyDraft(draft: AnswerDraft, retrieved: CorpusDoc[]): GateResult {
  const reasons: string[] = [];
  const claims = splitSentences(draft.text);
  const retrievedIds = new Set(retrieved.map((d) => d.id));
  const answerNorm = normalize(draft.text);

  if (claims.length === 0) reasons.push("empty answer");
  if (draft.citations.length === 0) reasons.push("no citations");

  const citedDocs = new Map<string, CorpusDoc>();
  for (const cit of draft.citations) {
    if (!retrievedIds.has(cit.docId)) {
      reasons.push(`citation to non-retrieved doc '${cit.docId}'`);
      continue;
    }
    const claimNorm = normalize(cit.claim);
    if (!answerNorm.includes(claimNorm) && !claimNorm.includes(answerNorm)) {
      reasons.push(`citation claim does not anchor to the answer: '${claimNorm.slice(0, 60)}…'`);
      continue;
    }
    const doc = retrieved.find((d) => d.id === cit.docId)!;
    citedDocs.set(doc.id, doc);
    const c = containment(cit.claim, doc.body);
    if (c < MIN_CONTAINMENT) {
      reasons.push(
        `claim drifts from source (containment ${c.toFixed(2)} < ${MIN_CONTAINMENT}): '${claimNorm.slice(0, 60)}…'`,
      );
    }
    for (const p of polarityProblems(cit.claim, doc)) {
      reasons.push(`${p} — claim: '${claimNorm.slice(0, 60)}…'`);
    }
    if (doc.tags.includes("trap-stale-deadline")) {
      const acknowledges = claims.some((s) => /passed|closed|expired|no longer/i.test(s));
      if (!acknowledges) {
        reasons.push(`cites stale-deadline doc '${doc.id}' without acknowledging it has passed`);
      }
    }
  }

  for (const claim of claims) {
    const covered = draft.citations.some((cit) => {
      const claimNorm = normalize(cit.claim);
      return claimNorm.includes(normalize(claim)) || normalize(claim).includes(claimNorm);
    });
    if (!covered) {
      reasons.push(`uncited sentence: '${claim.slice(0, 60)}…'`);
    }
  }

  return { verdict: reasons.length === 0 ? "pass" : "escalate", reasons };
}

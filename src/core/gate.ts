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

/**
 * The citation gate. Deterministic. The LLM may word an answer, but every
 * sentence must be covered by a citation to a retrieved document, every
 * citation must anchor to the answer text, and every claim must stay inside
 * its source's vocabulary. Anything else never reaches a participant.
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

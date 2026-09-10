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

/**
 * The citation gate. Deterministic. The LLM may word an answer, but every
 * sentence must cite a retrieved document and stay inside that document's
 * vocabulary; anything else never reaches a participant.
 */
export function verifyDraft(draft: AnswerDraft, retrieved: CorpusDoc[]): GateResult {
  const reasons: string[] = [];
  const claims = splitSentences(draft.text);
  const retrievedIds = new Set(retrieved.map((d) => d.id));

  if (claims.length === 0) reasons.push("empty answer");
  if (draft.citations.length === 0) reasons.push("no citations");

  const coveredClaims = new Set<string>();
  for (const cit of draft.citations) {
    if (!retrievedIds.has(cit.docId)) {
      reasons.push(`citation to non-retrieved doc '${cit.docId}'`);
      continue;
    }
    if (!claims.includes(cit.claim)) {
      reasons.push(`citation claim is not a sentence of the answer: '${cit.claim.slice(0, 60)}…'`);
      continue;
    }
    coveredClaims.add(cit.claim);
    const doc = retrieved.find((d) => d.id === cit.docId)!;
    const c = containment(cit.claim, doc.body);
    if (c < MIN_CONTAINMENT) {
      reasons.push(
        `claim drifts from source (containment ${c.toFixed(2)} < ${MIN_CONTAINMENT}): '${cit.claim.slice(0, 60)}…'`,
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
    if (!coveredClaims.has(claim)) {
      reasons.push(`uncited sentence: '${claim.slice(0, 60)}…'`);
    }
  }

  return { verdict: reasons.length === 0 ? "pass" : "escalate", reasons };
}

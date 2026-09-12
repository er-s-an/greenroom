import type { ContradictionFinding, Corpus, CorpusDoc, Severity } from "./types.js";
import { search } from "./retrieve.js";
import { containment, verifyDraft } from "./gate.js";
import type { LlmProvider } from "./llm.js";
import { byId } from "./corpus.js";

export interface OrganizerAlert {
  kind: "doc-conflict";
  severity: Severity;
  pair: [string, string];
  explanation: string;
  /** Alerts only ever fire for human-verified findings — see answerQuestion. */
  verified: true;
}

export interface ConflictSource {
  docId: string;
  title: string;
  url?: string;
  /** The verbatim conflicting sentence(s) from this source. */
  excerpt: string;
}

/**
 * Fail-closed outcome: the question lands on a human-verified high-severity
 * conflict between official sources, so no definitive answer is allowed out.
 * The participant sees both conflicting sources verbatim plus the human route.
 */
export interface ConflictBlock {
  severity: Severity;
  pair: [string, string];
  explanation: string;
  sources: [ConflictSource, ConflictSource];
  routeTo: string;
  /** Who verified the conflict and in what context — shown verbatim, no endorsement upgrade. */
  verifiedBy?: string;
}

export interface FaqResult {
  question: string;
  decision: "answered" | "escalated" | "conflicted";
  answer?: string;
  /** Organizer-only evidence: the model draft a conflict gate withheld. */
  withheldDraft?: { text: string; provider: string };
  citations?: { claim: string; docId: string; url?: string }[];
  conflict?: ConflictBlock;
  /** Fired when an answered question touches a verified documentation conflict. */
  alerts?: OrganizerAlert[];
  escalation?: { reasons: string[]; routeTo: string };
  trace: {
    retrieved: { docId: string; score: number }[];
    gateReasons?: string[];
    /** True when the first draft failed the gate and a repair attempt fixed it. */
    repaired?: boolean;
  };
}

/**
 * The audit event kind for an FAQ outcome. Every entrypoint (web API, CLI,
 * report CLI, Discord adapter) records the SAME tri-state — a conflicted
 * question is never logged as an ordinary escalation.
 */
export function faqAuditKind(
  result: FaqResult,
): "faq.answered" | "faq.escalated" | "faq.conflicted" {
  switch (result.decision) {
    case "answered":
      return "faq.answered";
    case "conflicted":
      return "faq.conflicted";
    case "escalated":
      return "faq.escalated";
  }
}

/**
 * Below this BM25 score we consider the corpus silent on the question.
 * Calibrated on the curated corpus: high-df words like "hackathon" depress
 * scores even for on-topic questions (~1.2), while truly off-topic questions
 * ("wifi password") score ~0 because none of their content tokens exist here.
 */
const MIN_RETRIEVAL_SCORE = 0.8;
const CONTEXT_DOCS = 3;

function humanRoute(corpus: Corpus): string {
  const contact = byId(corpus, "contact.organizers");
  return contact
    ? contact.body
    : "Route to a human organizer.";
}

/**
 * How strongly a claim must overlap a verified conflict anchor to count as
 * taking a position on the contested fact. Calibrated so a verbatim or close
 * paraphrase of the conflicting sentence trips it (~1.0–0.67), while merely
 * sharing common words with it ("open to participants from around the world"
 * vs the founders list, 0.57) does not.
 */
const ANCHOR_OVERLAP = 0.6;

function touchesAnchor(claim: string, anchor: string): boolean {
  return containment(claim, anchor) >= ANCHOR_OVERLAP || containment(anchor, claim) >= ANCHOR_OVERLAP;
}

/**
 * A verified high-severity conflict blocks a draft when the draft cites one of
 * the paired docs AND takes a position on the contested sentence. A finding
 * without anchors is treated conservatively: citing either doc is enough.
 */
function blockingConflict(
  citations: { claim: string; docId: string }[],
  conflicts: ContradictionFinding[],
): ContradictionFinding | undefined {
  for (const f of conflicts) {
    if (!f.verified || f.severity !== "high") continue;
    for (const c of citations) {
      const idx = f.pair.indexOf(c.docId);
      if (idx === -1) continue;
      const anchor = f.anchors?.[idx];
      if (!anchor || touchesAnchor(c.claim, anchor)) return f;
    }
  }
  return undefined;
}

function conflictBlock(f: ContradictionFinding, corpus: Corpus): ConflictBlock {
  const source = (docId: string, idx: 0 | 1): ConflictSource => {
    const doc = byId(corpus, docId);
    return {
      docId,
      title: doc?.title ?? docId,
      url: doc?.source.url,
      excerpt: f.anchors?.[idx] ?? doc?.body.split(/(?<=[.!?])\s+/)[0] ?? "",
    };
  };
  return {
    severity: f.severity,
    pair: f.pair,
    explanation: f.explanation,
    sources: [source(f.pair[0], 0), source(f.pair[1], 1)],
    routeTo: humanRoute(corpus),
    ...(f.verifiedBy ? { verifiedBy: f.verifiedBy } : {}),
  };
}

export async function answerQuestion(
  question: string,
  corpus: Corpus,
  llm: LlmProvider,
  opts: { conflicts?: ContradictionFinding[] } = {},
): Promise<FaqResult> {
  const hits = search(question, corpus.docs, 5);
  const trace = {
    retrieved: hits.map((h) => ({ docId: h.doc.id, score: Number(h.score.toFixed(3)) })),
  };

  const top = hits[0];
  if (!top || top.score < MIN_RETRIEVAL_SCORE) {
    return {
      question,
      decision: "escalated",
      escalation: {
        reasons: [`no reliable source (top retrieval score ${top ? top.score.toFixed(2) : "0"} < ${MIN_RETRIEVAL_SCORE})`],
        routeTo: humanRoute(corpus),
      },
      trace,
    };
  }

  const contextDocs: CorpusDoc[] = hits.slice(0, CONTEXT_DOCS).map((h) => h.doc);
  let draft = await llm.draftAnswer(question, contextDocs);
  let gate = verifyDraft(draft, contextDocs);
  let repaired = false;

  // One repair attempt with the gate's exact rejection reasons before
  // bothering a human — wording problems are fixable, fabrications are not.
  // A deliberately empty draft is a refusal, not a wording problem: don't retry.
  if (gate.verdict === "escalate" && draft.text.trim().length > 0) {
    draft = await llm.draftAnswer(question, contextDocs, { repairHints: gate.reasons });
    const secondGate = verifyDraft(draft, contextDocs);
    if (secondGate.verdict === "pass") {
      gate = secondGate;
      repaired = true;
    } else {
      gate = secondGate;
    }
  }

  if (gate.verdict === "escalate") {
    return {
      question,
      decision: "escalated",
      escalation: { reasons: gate.reasons, routeTo: humanRoute(corpus) },
      trace: { ...trace, gateReasons: gate.reasons, repaired },
    };
  }

  const citations = draft.citations.map((c) => ({
    ...c,
    url: byId(corpus, c.docId)?.source.url,
  }));

  // Fail closed: a verified high-severity conflict on the contested fact means
  // no single-sided verdict leaves the building. The participant gets both
  // official sources verbatim and the route to a human, not a coin flip.
  const blocker = blockingConflict(citations, opts.conflicts ?? []);
  if (blocker) {
    return {
      question,
      decision: "conflicted",
      withheldDraft: { text: draft.text, provider: llm.name },
      conflict: conflictBlock(blocker, corpus),
      trace: { ...trace, ...(repaired ? { repaired } : {}) },
    };
  }

  // Verified lower-severity conflicts still let the answer through, flagged to
  // the organizer. Unverified detector candidates NEVER surface to
  // participants or become organizer alerts — they wait in the review queue.
  const citedIds = new Set(citations.map((c) => c.docId));
  const alerts: OrganizerAlert[] = (opts.conflicts ?? [])
    .filter((f) => f.verified && f.pair.some((id) => citedIds.has(id)))
    .map((f) => ({
      kind: "doc-conflict" as const,
      severity: f.severity,
      pair: f.pair,
      explanation: f.explanation,
      verified: true as const,
    }));

  return {
    question,
    decision: "answered",
    answer: draft.text,
    citations,
    ...(alerts.length > 0 ? { alerts } : {}),
    trace: { ...trace, ...(repaired ? { repaired } : {}) },
  };
}

import type { ContradictionFinding, Corpus, CorpusDoc, Severity } from "./types.js";
import { search } from "./retrieve.js";
import { verifyDraft } from "./gate.js";
import type { LlmProvider } from "./llm.js";
import { byId } from "./corpus.js";

export interface OrganizerAlert {
  kind: "doc-conflict";
  severity: Severity;
  pair: [string, string];
  explanation: string;
}

export interface FaqResult {
  question: string;
  decision: "answered" | "escalated";
  answer?: string;
  citations?: { claim: string; docId: string; url?: string }[];
  /** Fired when a participant's question touches a known documentation conflict. */
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
  if (gate.verdict === "escalate") {
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

  // If the question touches a documentation conflict we already know about,
  // the participant still gets their answer — and the organizer gets an alert.
  const citedIds = new Set(citations.map((c) => c.docId));
  const alerts: OrganizerAlert[] = (opts.conflicts ?? [])
    .filter((f) => f.pair.some((id) => citedIds.has(id)))
    .map((f) => ({
      kind: "doc-conflict" as const,
      severity: f.severity,
      pair: f.pair,
      explanation: f.explanation,
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

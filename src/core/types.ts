export interface CorpusDoc {
  id: string;
  title: string;
  body: string;
  source: { kind: "dossier" | "web"; ref: string; url?: string };
  tags: string[];
  asOf: string;
}

export interface Corpus {
  event: string;
  curatedAt: string;
  docs: CorpusDoc[];
}

export interface Citation {
  /** Exact sentence from the answer text that this citation supports. */
  claim: string;
  docId: string;
}

export interface AnswerDraft {
  text: string;
  citations: Citation[];
}

export type Severity = "low" | "medium" | "high";

/** Why a participant is stalled. Drives both radar display and outreach drafts. */
export type StallKind =
  | "registered-no-join"
  | "joined-no-intro"
  | "gone-quiet"
  | "missing-submission";

export interface ContradictionFinding {
  pair: [string, string];
  severity: Severity;
  explanation: string;
  verified: boolean;
  /**
   * Who verified this finding and in what context, e.g. "human review during
   * corpus curation (2026-09-10)". Displayed verbatim — never upgraded to an
   * organizer endorsement the evidence doesn't support.
   */
  verifiedBy?: string;
  /**
   * Human-marked conflict locus: the verbatim sentence(s) in each paired doc
   * that contradict each other. Drives fail-closed matching and is shown to
   * the participant as the two conflicting excerpts.
   */
  anchors?: [string, string];
}

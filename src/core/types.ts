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

export interface ContradictionFinding {
  pair: [string, string];
  severity: Severity;
  explanation: string;
  verified: boolean;
}

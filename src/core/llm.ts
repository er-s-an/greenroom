import type { AnswerDraft, CorpusDoc, Severity } from "./types.js";
import { tokenize } from "./retrieve.js";

export interface ContradictionVerdict {
  isContradiction: boolean;
  severity: Severity;
  explanation: string;
}

/**
 * The LLM never decides *whether* the copilot may speak — the gate does.
 * Providers only draft wording and propose contradiction candidates.
 */
export interface LlmProvider {
  name: string;
  draftAnswer(question: string, docs: CorpusDoc[]): Promise<AnswerDraft>;
  checkContradiction(a: CorpusDoc, b: CorpusDoc): Promise<ContradictionVerdict>;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function overlapScore(question: Set<string>, sentence: string): number {
  const tokens = tokenize(sentence);
  if (tokens.length === 0) return 0;
  let hit = 0;
  for (const t of tokens) if (question.has(t)) hit++;
  return hit / tokens.length;
}

/**
 * Deterministic offline provider: drafts answers extractively (near-verbatim
 * sentences from retrieved docs) so the whole pipeline is testable with no API.
 * Real deployments swap in a hosted model behind the same interface.
 */
export class MockLlm implements LlmProvider {
  name = "mock-extractive";

  async draftAnswer(question: string, docs: CorpusDoc[]): Promise<AnswerDraft> {
    const qTokens = new Set(tokenize(question));
    const picked: { sentence: string; docId: string; score: number; rank: number }[] = [];

    docs.forEach((doc, rank) => {
      for (const sentence of splitSentences(doc.body)) {
        if (sentence.startsWith("NOTE:")) continue; // handled below
        const score = overlapScore(qTokens, sentence);
        if (score > 0) picked.push({ sentence, docId: doc.id, score, rank });
      }
    });

    picked.sort((a, b) => b.score - a.score || a.rank - b.rank);
    const chosen = picked.slice(0, 4);

    // Freshness: any cited doc carrying a staleness NOTE must surface it.
    for (const doc of docs) {
      if (!doc.tags.includes("trap-stale-deadline")) continue;
      if (!chosen.some((c) => c.docId === doc.id)) continue;
      const note = splitSentences(doc.body).find((s) => s.startsWith("NOTE:"));
      if (note && !chosen.some((c) => c.sentence === note)) {
        chosen.push({ sentence: note, docId: doc.id, score: 1, rank: 99 });
      }
    }

    const text = chosen.map((c) => c.sentence).join(" ");
    return { text, citations: chosen.map((c) => ({ claim: c.sentence, docId: c.docId })) };
  }

  async checkContradiction(a: CorpusDoc, b: CorpusDoc): Promise<ContradictionVerdict> {
    const pair = [a.id, b.id].sort().join(" × ");
    if (pair === "eligibility.rules_text × eligibility.structured") {
      return {
        isContradiction: true,
        severity: "high",
        explanation:
          "Rules prose welcomes 'Startup founders and entrepreneurs' and 'participants from around the world', but the structured eligibility settings say 'Students only' and 'Companies/professional organizations excluded'. A non-student founder gets opposite answers depending on which source they read.",
      };
    }
    // Generic heuristic: one source restricts ("only"/"excluded") while the
    // other opens ("open to"/"include"/"welcome") within a shared topic.
    const pairBody = (doc: CorpusDoc) => doc.body.toLowerCase();
    const restricts = (d: CorpusDoc) => /\bonly\b|\bexcluded?\b/.test(pairBody(d));
    const opens = (d: CorpusDoc) => /open to|include|welcome/.test(pairBody(d));
    if ((restricts(a) && opens(b)) || (restricts(b) && opens(a))) {
      return {
        isContradiction: true,
        severity: "medium",
        explanation: `Candidate conflict within shared topic: '${a.title}' restricts while '${b.title}' opens. Needs human verification.`,
      };
    }
    return { isContradiction: false, severity: "low", explanation: "" };
  }
}

/**
 * Hosted provider (Gemini Flash class). The prompt contract forces per-sentence
 * near-verbatim citation so the deterministic gate can still verify output.
 * Needs GEMINI_API_KEY; deliberately unused in tests.
 */
export class GeminiLlm implements LlmProvider {
  name = "gemini";
  constructor(
    private apiKey: string | undefined = process.env.GEMINI_API_KEY,
    private model = "gemini-3.8-flash",
  ) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  }

  private async call(prompt: string): Promise<string> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  async draftAnswer(question: string, docs: CorpusDoc[]): Promise<AnswerDraft> {
    const context = docs
      .map((d) => `DOC ${d.id} (${d.title}):\n${d.body}`)
      .join("\n\n");
    const prompt = `You are a community FAQ assistant that may ONLY use the documents below.
Answer the question in 1-4 sentences. Each sentence must stay close to the source wording.
Output JSON: {"sentences":[{"text":"...","docId":"..."}]}. Every sentence needs a docId. If the documents do not answer the question, output {"sentences":[]}.

${context}

QUESTION: ${question}`;
    const raw = await this.call(prompt);
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()) as {
      sentences: { text: string; docId: string }[];
    };
    return {
      text: parsed.sentences.map((s) => s.text).join(" "),
      citations: parsed.sentences.map((s) => ({ claim: s.text, docId: s.docId })),
    };
  }

  async checkContradiction(a: CorpusDoc, b: CorpusDoc): Promise<ContradictionVerdict> {
    const prompt = `Do these two official documents give conflicting answers to the same audience about the same topic?
DOC A (${a.title}): ${a.body}
DOC B (${b.title}): ${b.body}
Output JSON: {"isContradiction":bool,"severity":"low|medium|high","explanation":"one sentence"}`;
    const raw = await this.call(prompt);
    return JSON.parse(raw.replace(/```json|```/g, "").trim()) as ContradictionVerdict;
  }
}

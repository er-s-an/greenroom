import type { AnswerDraft, CorpusDoc, Severity, StallKind } from "./types.js";
import { tokenize } from "./retrieve.js";

export interface ContradictionVerdict {
  isContradiction: boolean;
  severity: Severity;
  explanation: string;
}

export interface OutreachInput {
  handle: string;
  kind: StallKind;
  /** Organizer-facing context, e.g. "registered 4 days ago, never joined". */
  context: string;
}

/**
 * The LLM never decides *whether* the copilot may act — the gates do.
 * Providers only draft wording and propose contradiction candidates.
 */
export interface LlmProvider {
  name: string;
  draftAnswer(question: string, docs: CorpusDoc[]): Promise<AnswerDraft>;
  checkContradiction(a: CorpusDoc, b: CorpusDoc): Promise<ContradictionVerdict>;
  draftOutreach(input: OutreachInput): Promise<string>;
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

/** Parse JSON from a model response, tolerating code fences. */
function parseJson<T>(raw: string): T {
  return JSON.parse(raw.replace(/```json|```/g, "").trim()) as T;
}

const OUTREACH_TEMPLATES: Record<StallKind, (handle: string) => string> = {
  "registered-no-join": (h) =>
    `Hi ${h}! You registered for the hackathon but haven't joined the Discord server yet — that's where all announcements, teammate matching, and support happen. Come say hi, it takes two minutes.`,
  "joined-no-intro": (h) =>
    `Hi ${h}, welcome! Quick nudge: please introduce yourself in #introductions with a line about you and your country — it's how teammates find each other (and it's part of the participation requirements).`,
  "gone-quiet": (h) =>
    `Hi ${h} — you introduced yourself a while back but we've missed you lately. Anything blocking you? Happy to help you find a teammate, scope an idea, or answer questions.`,
  "missing-submission": (h) =>
    `Hi ${h}! The submission deadline is close and we don't see a submission linked to you yet. Remember: you can submit early and keep editing until the deadline. Need any help getting it in?`,
};

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

  async draftOutreach(input: OutreachInput): Promise<string> {
    return OUTREACH_TEMPLATES[input.kind](input.handle);
  }
}

/**
 * Hosted provider: Kimi for Coding (K2.7), OpenAI-compatible protocol.
 * Endpoint and model id per official docs (https://www.kimi.com/code/docs/en/):
 *   POST https://api.kimi.com/coding/v1/chat/completions, model "kimi-for-coding".
 * The prompt contract forces per-sentence near-verbatim citation so the
 * deterministic gate can still verify output. Key from KIMI_CODE_API_KEY;
 * deliberately unused in tests.
 */
export class KimiLlm implements LlmProvider {
  name = "kimi-for-coding";

  constructor(
    private apiKey: string | undefined = process.env.KIMI_CODE_API_KEY,
    private model = "kimi-for-coding",
    private baseUrl = process.env.KIMI_BASE_URL ?? "https://api.kimi.com/coding/v1",
  ) {
    if (!apiKey) throw new Error("KIMI_CODE_API_KEY is not set");
  }

  private async call(system: string, prompt: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Kimi API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  }

  async draftAnswer(question: string, docs: CorpusDoc[]): Promise<AnswerDraft> {
    const context = docs.map((d) => `DOC ${d.id} (${d.title}):\n${d.body}`).join("\n\n");
    const raw = await this.call(
      "You are a community FAQ assistant. You may ONLY use the provided documents, stay close to their wording, and cite every sentence. Output JSON only.",
      `Answer the question in 1-4 sentences.
Output JSON: {"sentences":[{"text":"...","docId":"..."}]}. Every sentence needs a docId from the documents below. If the documents do not answer the question, output {"sentences":[]}.

${context}

QUESTION: ${question}`,
    );
    const parsed = parseJson<{ sentences: { text: string; docId: string }[] }>(raw);
    return {
      text: parsed.sentences.map((s) => s.text).join(" "),
      citations: parsed.sentences.map((s) => ({ claim: s.text, docId: s.docId })),
    };
  }

  async checkContradiction(a: CorpusDoc, b: CorpusDoc): Promise<ContradictionVerdict> {
    const raw = await this.call(
      "You detect contradictions between official documents. Output JSON only.",
      `Do these two official documents give conflicting answers to the same audience about the same topic?
DOC A (${a.title}): ${a.body}
DOC B (${b.title}): ${b.body}
Output JSON: {"isContradiction":bool,"severity":"low|medium|high","explanation":"one sentence"}`,
    );
    return parseJson<ContradictionVerdict>(raw);
  }

  async draftOutreach(input: OutreachInput): Promise<string> {
    const raw = await this.call(
      "You draft short, warm Discord direct messages on behalf of a hackathon organizer. 2-3 sentences, no emojis, no invented facts, one clear next step. Plain text only.",
      `Draft a nudge for participant "${input.handle}". Situation: ${input.context}. Reason code: ${input.kind}.`,
    );
    return raw.trim();
  }
}

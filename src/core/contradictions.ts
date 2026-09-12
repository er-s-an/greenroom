import type { ContradictionFinding, Corpus, CorpusDoc } from "./types.js";
import { topicOf } from "./corpus.js";
import type { LlmProvider } from "./llm.js";

/** All doc pairs sharing a topic tag but coming from different sources. */
export function topicPairs(docs: CorpusDoc[]): [CorpusDoc, CorpusDoc][] {
  const byTopic = new Map<string, CorpusDoc[]>();
  for (const doc of docs) {
    const topic = topicOf(doc);
    if (!topic) continue;
    const list = byTopic.get(topic) ?? [];
    list.push(doc);
    byTopic.set(topic, list);
  }
  const pairs: [CorpusDoc, CorpusDoc][] = [];
  for (const group of byTopic.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        if (a.source.ref === b.source.ref) continue;
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

interface VerifiedRegistry {
  findings: {
    pair: [string, string];
    severity: "low" | "medium" | "high";
    explanation: string;
    verifiedBy?: string;
    anchors?: [string, string];
  }[];
}

/**
 * Detector proposes candidates (LLM/heuristic); a human-verified registry
 * disposes. Findings reported to organizers are always marked accordingly.
 */
export async function scanCorpus(
  corpus: Corpus,
  llm: LlmProvider,
  registry?: VerifiedRegistry,
): Promise<ContradictionFinding[]> {
  const findings = new Map<string, ContradictionFinding>();

  for (const [a, b] of topicPairs(corpus.docs)) {
    const verdict = await llm.checkContradiction(a, b);
    if (!verdict.isContradiction) continue;
    const key = [a.id, b.id].sort().join(" × ");
    findings.set(key, {
      pair: [a.id, b.id],
      severity: verdict.severity,
      explanation: verdict.explanation,
      verified: false,
    });
  }

  for (const f of registry?.findings ?? []) {
    const key = [...f.pair].sort().join(" × ");
    findings.set(key, { ...f, verified: true });
  }

  return [...findings.values()].sort((x, y) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[x.severity] - order[y.severity] || Number(y.verified) - Number(x.verified);
  });
}

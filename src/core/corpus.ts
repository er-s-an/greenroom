import { readFileSync } from "node:fs";
import type { Corpus, CorpusDoc } from "./types.js";

export function loadCorpus(path: string): Corpus {
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    event: string;
    curatedAt: string;
    docs: CorpusDoc[];
  };
  const seen = new Set<string>();
  for (const doc of raw.docs) {
    if (!doc.id || !doc.body || !doc.source?.ref) {
      throw new Error(`corpus doc missing required fields: ${JSON.stringify(doc).slice(0, 120)}`);
    }
    if (seen.has(doc.id)) throw new Error(`duplicate doc id: ${doc.id}`);
    seen.add(doc.id);
  }
  return { event: raw.event, curatedAt: raw.curatedAt, docs: raw.docs };
}

export function byId(corpus: Corpus, id: string): CorpusDoc | undefined {
  return corpus.docs.find((d) => d.id === id);
}

export function topicOf(doc: CorpusDoc): string | undefined {
  return doc.tags.find((t) => t.startsWith("topic:"));
}

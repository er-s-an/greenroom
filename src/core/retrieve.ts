import type { CorpusDoc } from "./types.js";

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "can", "could", "should", "would",
  "i", "we", "you", "he", "she", "it", "they", "them", "me", "my", "our", "your",
  "their", "to", "of", "and", "or", "in", "on", "for", "with", "do", "does",
  "did", "what", "who", "whom", "how", "when", "where", "which", "why", "be",
  "been", "being", "will", "there", "if", "as", "at", "by", "from", "has",
  "have", "had", "not", "no", "so", "but", "about", "any", "all", "this",
  "that", "these", "those", "am", "per",
]);

/** Light stemming: plural/ies normalization so "projects"≈"project", "categories"≈"category". */
function stem(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

export interface Hit {
  doc: CorpusDoc;
  score: number;
}

function docText(doc: CorpusDoc): string {
  // title and tags carry topic signal; repeat title to weight it
  return `${doc.title} ${doc.title} ${doc.body} ${doc.tags.join(" ")}`;
}

/** BM25 (k1=1.5, b=0.75) over the corpus. Deterministic, no external services. */
export function search(query: string, docs: CorpusDoc[], k = 5): Hit[] {
  const qTokens = [...new Set(tokenize(query))];
  if (qTokens.length === 0 || docs.length === 0) return [];

  const docTokens = docs.map((d) => tokenize(docText(d)));
  const avgLen = docTokens.reduce((s, t) => s + t.length, 0) / docs.length || 1;

  const df = new Map<string, number>();
  for (const toks of docTokens) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const N = docs.length;
  const k1 = 1.5;
  const b = 0.75;

  const hits: Hit[] = docs.map((doc, i) => {
    const toks = docTokens[i] ?? [];
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const qt of qTokens) {
      const f = tf.get(qt);
      if (!f) continue;
      const docFreq = df.get(qt) ?? 0;
      const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks.length) / avgLen));
    }
    return { doc, score };
  });

  return hits.sort((x, y) => y.score - x.score).slice(0, k);
}

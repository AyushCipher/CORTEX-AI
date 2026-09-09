const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
  "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being",
  "below", "between", "both", "but", "by", "can", "can't", "cannot", "could",
  "couldn't", "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down",
  "during", "each", "few", "for", "from", "further", "had", "hadn't", "has",
  "hasn't", "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her",
  "here", "here's", "hers", "herself", "him", "himself", "his", "how", "how's",
  "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it",
  "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my",
  "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other",
  "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "shan't",
  "she", "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such",
  "than", "that", "that's", "the", "their", "theirs", "them", "themselves", "then",
  "there", "there's", "these", "they", "they'd", "they'll", "they're", "they've",
  "this", "those", "through", "to", "too", "under", "until", "up", "very", "was",
  "wasn't", "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what",
  "what's", "when", "when's", "where", "where's", "which", "while", "who",
  "who's", "whom", "why", "why's", "with", "won't", "would", "wouldn't", "you",
  "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves"
]);

/**
 * Tokenize string into lowercase alphanumeric words, filtering single chars and stop words.
 */
export const tokenize = (text = "") => {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
};

/**
 * Okapi BM25 Index & Scoring
 * k1: controls term frequency saturation (default 1.5)
 * b: controls document length normalization (default 0.75)
 */
export class BM25Index {
  constructor(docs = [], { k1 = 1.5, b = 0.75 } = {}) {
    this.docs = docs;
    this.k1 = k1;
    this.b = b;
    this.docCount = docs.length;
    this.docTokens = [];
    this.docLengths = [];
    this.docTermFreqs = [];
    this.docFreqs = new Map(); // term -> count of docs containing term
    this.avgDocLength = 0;

    this.buildIndex();
  }

  buildIndex() {
    let totalLength = 0;

    for (const doc of this.docs) {
      const text = typeof doc === "string" ? doc : doc.pageContent || "";
      const tokens = tokenize(text);
      this.docTokens.push(tokens);
      this.docLengths.push(tokens.length);
      totalLength += tokens.length;

      const tf = new Map();
      for (const token of tokens) {
        tf.set(token, (tf.get(token) || 0) + 1);
      }
      this.docTermFreqs.push(tf);

      for (const token of tf.keys()) {
        this.docFreqs.set(token, (this.docFreqs.get(token) || 0) + 1);
      }
    }

    this.avgDocLength = this.docCount > 0 ? totalLength / this.docCount : 0;
  }

  /**
   * Compute IDF for a term with standard BM25 smoothing
   */
  idf(term) {
    const df = this.docFreqs.get(term) || 0;
    return Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1);
  }

  /**
   * Search documents and return matches scored and sorted by BM25
   */
  search(query, topK = 5) {
    if (!this.docCount) return [];
    const queryTokens = tokenize(query);
    if (!queryTokens.length) return [];

    const scores = new Array(this.docCount).fill(0);

    for (const token of queryTokens) {
      const idf = this.idf(token);
      if (idf <= 0) continue;

      for (let i = 0; i < this.docCount; i++) {
        const tf = this.docTermFreqs[i].get(token) || 0;
        if (tf === 0) continue;

        const docLen = this.docLengths[i];
        const num = tf * (this.k1 + 1);
        const den = tf + this.k1 * (1 - this.b + this.b * (docLen / (this.avgDocLength || 1)));

        scores[i] += idf * (num / den);
      }
    }

    const results = [];
    for (let i = 0; i < this.docCount; i++) {
      if (scores[i] > 0) {
        results.push({
          doc: this.docs[i],
          score: scores[i],
          index: i
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }
}

/**
 * Convenience helper to run BM25 search over an array of documents
 */
export const bm25Search = (docs, query, topK = 5) => {
  const index = new BM25Index(docs);
  return index.search(query, topK).map((r) => r.doc);
};

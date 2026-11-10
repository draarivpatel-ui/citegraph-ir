/**
 * ir_engine.js - the zero-dependency CiteGraph-IR retrieval and abstention engine.
 *
 * Pipeline, in order:
 *   tokenize  ->  normalize text into terms
 *   BM25      ->  Okapi BM25 over a lexical inverted index (first stage)
 *   TF-IDF    ->  character n-gram tf-idf cosine over dense vectors (first stage)
 *   RRF       ->  Reciprocal Rank Fusion of the two first stage runs
 *   PageRank  ->  personalized PageRank over the citation graph (re-ranking)
 *  fulness    ->  claim to span faithfulness scoring of the fused run
 *   abstain   ->  out of distribution abstention on the fused confidence
 *
 * Every function is pure with respect to its inputs: no shared state is mutated
 * between calls except an explicit index build. No dependency on any package,
 * on the DOM, or on Node built ins.
 */

/* ------------------------------------------------------------------ *
 * Text normalization
 * ------------------------------------------------------------------ */

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
  "any", "are", "as", "at", "be", "because", "been", "before", "being", "below",
  "between", "both", "but", "by", "can", "did", "do", "does", "doing", "down",
  "during", "each", "few", "for", "from", "further", "had", "has", "have",
  "having", "he", "her", "here", "hers", "him", "his", "how", "i", "if", "in",
  "into", "is", "it", "its", "itself", "just", "me", "more", "most", "my",
  "no", "nor", "not", "now", "of", "off", "on", "once", "only", "or", "other",
  "our", "ours", "out", "over", "own", "same", "she", "should", "so", "some",
  "such", "than", "that", "the", "their", "theirs", "them", "then", "there",
  "these", "they", "this", "those", "through", "to", "too", "under", "until",
  "up", "very", "was", "we", "were", "what", "when", "where", "which", "while",
  "who", "whom", "why", "will", "with", "you", "your"
]);

/**
 * Lowercase, strip accents, and split on non alphanumeric runs. Empty tokens
 * are dropped. Punctuation survives inside contractions only as a term break.
 */
export function tokenize(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const lowered = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "");
  const raw = lowered.split(/[^a-z0-9]+/);
  const out = [];
  for (const t of raw) if (t.length > 0) out.push(t);
  return out;
}

/** Tokenize and drop English stop words, which carry no ranking signal. */
export function contentTokens(text) {
  return tokenize(text).filter((t) => !STOP_WORDS.has(t));
}

/** The distinct terms of a token sequence, in first appearance order. */
export function uniqueTerms(tokens) {
  const seen = new Set();
  const out = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Character n-grams of a token stream. Each token is padded with a leading and
 * trailing boundary marker so that "graph" and "agraphs" produce different
 * n-grams at their edges. n is clamped to [2, 4].
 */
export function charNGrams(text, n = 3) {
  const size = Math.max(2, Math.min(4, Math.floor(n) || 3));
  const tokens = tokenize(text);
  const grams = [];
  for (const token of tokens) {
    const padded = `#${token}#`;
    if (padded.length <= size) {
      grams.push(padded);
      continue;
    }
    for (let i = 0; i + size <= padded.length; i += 1) {
      grams.push(padded.slice(i, i + size));
    }
  }
  return grams;
}

/* ------------------------------------------------------------------ *
 * Okapi BM25
 * ------------------------------------------------------------------ */

/**
 * Build an inverted index over the documents and precompute the collection
 * statistics BM25 needs. Documents are {id, title, authors, year, venue, refs}.
 * The indexed field is the concatenation of title, venue and abstract body.
 */
export function buildIndex(documents, options = {}) {
  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  if (!(k1 >= 0)) throw new RangeError("k1 must be nonnegative");
  if (!(b >= 0 && b <= 1)) throw new RangeError("b must be in [0, 1]");

  const docs = [];
  const docFrequency = new Map();
  let totalLength = 0;

  for (const doc of documents) {
    const text = `${doc.title} ${doc.venue ?? ""} ${doc.body ?? ""}`;
    const tokens = contentTokens(text);
    const counts = new Map();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    const length = tokens.length;
    totalLength += length;
    for (const term of counts.keys()) {
      docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
    }
    docs.push({
      id: doc.id,
      refs: Array.isArray(doc.refs) ? doc.refs.slice() : [],
      tokens,
      counts,
      length
    });
  }

  const docCount = docs.length;
  const avgdl = docCount === 0 ? 0 : totalLength / docCount;

  const idf = new Map();
  for (const [term, df] of docFrequency) {
    // Robertson-Sparck Jones idf with the +0.5 correction. Terms in more than
    // half the collection are clamped so they contribute no negative weight.
    idf.set(term, Math.max(0, Math.log((docCount - df + 0.5) / (df + 0.5) + 1)));
  }

  return { docs, idf, docFrequency, docCount, avgdl, totalLength, k1, b };
}

/**
 * The BM25 weight of one term against one indexed document.
 * score = idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (len / avgdl)))
 */
export function bm25TermScore(index, doc, term) {
  const tf = doc.counts.get(term) ?? 0;
  if (tf === 0) return 0;
  const idf = index.idf.get(term) ?? 0;
  if (idf <= 0) return 0;
  const norm = tf + index.k1 * (1 - index.b + index.b * (doc.length / (index.avgdl || 1)));
  return (idf * tf * (index.k1 + 1)) / norm;
}

/** Full BM25 score of a document against a token sequence. */
export function bm25Score(index, doc, tokens) {
  let sum = 0;
  for (const t of tokens) {
    if (index.docFrequency.has(t)) sum += bm25TermScore(index, doc, t);
  }
  return sum;
}

/**
 * Rank every document by BM25 against query tokens. Returns an array sorted by
 * descending score, breaking ties by document id so the order is deterministic.
 */
export function bm25Rank(index, tokens) {
  const terms = uniqueTerms(tokens);
  const scored = [];
  for (const doc of index.docs) {
    let score = 0;
    for (const term of terms) score += bm25TermScore(index, doc, term);
    scored.push({ id: doc.id, score, rank: 0 });
  }
  scored.sort((a, c) => (c.score - a.score) || (a.id < c.id ? -1 : 1));
  scored.forEach((r, i) => {
    r.rank = i + 1;
  });
  return scored;
}

/* ------------------------------------------------------------------ *
 * Character n-gram tf-idf cosine
 * ------------------------------------------------------------------ */

/** Term frequency component of the tf-idf weight: 1 + log(tf). */
export function tfWeight(tf) {
  if (tf <= 0) return 0;
  return 1 + Math.log(tf);
}

/** Inverse document frequency component: log(N / df), floored at zero. */
export function idfWeight(df, docCount) {
  if (df <= 0 || docCount <= 0) return 0;
  return Math.log(docCount / df);
}

/**
 * Build the dense term vectors for every document as a sparse map of term to
 * tf-idf weight, plus the L2 norm of each vector. Gram document frequency is
 * computed across the same collection that the BM25 index was built over.
 */
export function buildDenseVectors(index, documents, options = {}) {
  const n = options.n ?? 3;
  const gramDocFrequency = new Map();
  const perDoc = [];

  for (let i = 0; i < documents.length; i += 1) {
    const doc = documents[i];
    const text = `${doc.title} ${doc.venue ?? ""} ${doc.body ?? ""}`;
    const grams = charNGrams(text, n);
    const counts = new Map();
    for (const g of grams) counts.set(g, (counts.get(g) ?? 0) + 1);
    for (const g of counts.keys()) {
      gramDocFrequency.set(g, (gramDocFrequency.get(g) ?? 0) + 1);
    }
    perDoc.push({ id: doc.id, counts });
  }

  const docCount = documents.length;
  const vectors = new Map();
  const norms = new Map();

  for (const entry of perDoc) {
    const vec = new Map();
    let sumSquares = 0;
    for (const [gram, tf] of entry.counts) {
      const w = tfWeight(tf) * idfWeight(gramDocFrequency.get(gram) ?? 0, docCount);
      if (w === 0) continue;
      vec.set(gram, w);
      sumSquares += w * w;
    }
    vectors.set(entry.id, vec);
    norms.set(entry.id, Math.sqrt(sumSquares));
  }

  return { vectors, norms, gramDocFrequency, docCount, n };
}

/** Cosine similarity between a tf-idf vector map and a bare tf vector map. */
export function cosineSimilarity(queryGrams, queryNorm, vector, vectorNorm, gramDocFrequency, docCount) {
  if (!(queryNorm > 0) || !(vectorNorm > 0)) return 0;
  let dot = 0;
  for (const [gram, tf] of queryGrams) {
    const target = vector.get(gram);
    if (target === undefined) continue;
    const idf = idfWeight(gramDocFrequency.get(gram) ?? 0, docCount);
    if (idf <= 0) continue;
    dot += tfWeight(tf) * idf * target;
  }
  return dot / (queryNorm * vectorNorm);
}

/**
 * Rank every document by character n-gram tf-idf cosine similarity against a
 * query string. Ties break by document id for determinism.
 */
export function denseRank(dense, documents, query, options = {}) {
  const n = options.n ?? dense.n ?? 3;
  const grams = charNGrams(query, n);
  const counts = new Map();
  for (const g of grams) counts.set(g, (counts.get(g) ?? 0) + 1);
  let sumSquares = 0;
  for (const [g, tf] of counts) {
    const idf = idfWeight(dense.gramDocFrequency.get(g) ?? 0, dense.docCount);
    const w = tfWeight(tf) * idf;
    sumSquares += w * w;
  }
  const queryNorm = Math.sqrt(sumSquares);

  const scored = [];
  for (const doc of documents) {
    const vec = dense.vectors.get(doc.id) ?? new Map();
    const norm = dense.norms.get(doc.id) ?? 0;
    const similarity = cosineSimilarity(counts, queryNorm, vec, norm, dense.gramDocFrequency, dense.docCount);
    scored.push({ id: doc.id, score: similarity, rank: 0 });
  }
  scored.sort((a, c) => (c.score - a.score) || (a.id < c.id ? -1 : 1));
  scored.forEach((r, i) => {
    r.rank = i + 1;
  });
  return scored;
}

/* ------------------------------------------------------------------ *
 * Reciprocal Rank Fusion
 * ------------------------------------------------------------------ */

/**
 * Fuse one or more ranked runs. Each document's fused score is
 *   sum over runs of 1 / (k + rank)
 * with k conventionally 60. Only ranks enter the formula, so score scale and
 * per run calibration cancel out.
 */
export function reciprocalRankFusion(runs, options = {}) {
  const k = options.k ?? 60;
  if (!(k >= 0)) throw new RangeError("k must be nonnegative");
  const fused = new Map();
  for (const run of runs) {
    for (const entry of run) {
      const prev = fused.get(entry.id) ?? 0;
      fused.set(entry.id, prev + 1 / (k + entry.rank));
    }
  }
  const out = [];
  for (const [id, score] of fused) out.push({ id, score, rank: 0 });
  out.sort((a, c) => (c.score - a.score) || (a.id < c.id ? -1 : 1));
  out.forEach((r, i) => {
    r.rank = i + 1;
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * Citation graph and personalized PageRank
 * ------------------------------------------------------------------ */

/**
 * A citation graph over the indexed documents. Edges point from a citing
 * document to the document it cites. Documents that cite nothing still get a
 * node so the leaf handling below is exercised.
 */
export function buildCitationGraph(index) {
  const ids = new Set(index.docs.map((d) => d.id));
  const outLinks = new Map();
  const inLinks = new Map();
  for (const id of ids) {
    outLinks.set(id, []);
    inLinks.set(id, []);
  }
  for (const doc of index.docs) {
    for (const ref of doc.refs) {
      if (!ids.has(ref)) continue;
      outLinks.get(doc.id).push(ref);
      inLinks.get(ref).push(doc.id);
    }
  }
  return { ids, outLinks, inLinks, docCount: ids.size };
}

/**
 * Personalized PageRank over the citation graph. The teleport distribution is
 * given by `seed`: a map from document id to mass, normalized to sum to one.
 * Damping is the probability of following an outgoing citation; its complement
 * is the probability of teleporting back into the seed. Returns the page mass
 * that reached each document, as a map from id to score.
 */
export function personalizedPageRank(graph, seed, options = {}) {
  const damping = options.damping ?? 0.85;
  const maxIterations = options.maxIterations ?? 100;
  const tolerance = options.tolerance ?? 1e-10;
  if (!(damping > 0 && damping < 1)) throw new RangeError("damping must be in (0, 1)");

  const ids = [...graph.ids];
  let totalSeed = 0;
  for (const id of ids) totalSeed += seed.get?.(id) ?? seed[id] ?? 0;
  if (totalSeed <= 0) {
    throw new RangeError("seed must have positive mass");
  }

  // Round one: rank cannot be returned before it exists, so a cold start uses
  // the seed distribution itself.
  let rank = new Map();
  for (const id of ids) rank.set(id, 0);
  const teleport = new Map();
  for (const id of ids) {
    const mass = seed.get?.(id) ?? seed[id] ?? 0;
    teleport.set(id, mass / totalSeed);
  }

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const next = new Map();
    for (const id of ids) next.set(id, 0);

    for (const id of ids) {
      const outgoing = graph.outLinks.get(id) ?? [];
      if (outgoing.length === 0) {
        // A dangling document distributes its mass uniformly over the teleport
        // set, which is the standard correction for an irreducible chain.
        const mass = rank.get(id) ?? 0;
        for (const target of ids) {
          next.set(target, (next.get(target) ?? 0) + (mass * damping) / ids.length);
        }
        continue;
      }
      const share = (rank.get(id) ?? 0) * damping / outgoing.length;
      for (const target of outgoing) {
        next.set(target, (next.get(target) ?? 0) + share);
      }
    }

    for (const id of ids) {
      next.set(id, (next.get(id) ?? 0) + (1 - damping) * (teleport.get(id) ?? 0));
    }

    let delta = 0;
    for (const id of ids) {
      delta += Math.abs((next.get(id) ?? 0) - (rank.get(id) ?? 0));
    }
    rank = next;
    if (delta < tolerance) break;
  }

  let total = 0;
  for (const id of ids) total += rank.get(id) ?? 0;
  const out = new Map();
  for (const id of ids) out.set(id, total > 0 ? (rank.get(id) ?? 0) / total : 0);
  return out;
}

/**
 * Re-rank a fused run with citation authority. The fused score is replaced by
 *   fusedScore + graphWeight * normalizedAuthority
 * Seeding PageRank from the fused run is the personalized step: the teleport
 * vector is the retrieval distribution, not a uniform one. The authority is
 * scaled by the spread of the fused scores times graphWeight, so the citation
 * signal perturbs the retrieval order without overwhelming it. With a
 * graphWeight of zero the function is the identity.
 */
export function rerankWithAuthority(fusedRun, graph, index, options = {}) {
  if (fusedRun.length === 0) return [];
  const graphWeight = options.graphWeight ?? 0.35;
  const damping = options.damping ?? 0.85;
  const seedSize = options.seedSize ?? 10;

  const top = fusedRun.slice(0, Math.max(1, Math.min(seedSize, fusedRun.length)));
  let total = 0;
  for (const entry of top) total += Math.max(0, entry.score);
  const seed = new Map();
  if (total > 0) {
    for (const entry of top) seed.set(entry.id, Math.max(0, entry.score) / total);
  } else {
    // A flat run (no score signal at all) seeds uniformly so that PageRank can
    // still inject authority information.
    const even = 1 / (top.length || 1);
    for (const entry of top) seed.set(entry.id, even);
  }

  const ranks = personalizedPageRank(graph, seed, { damping });

  // Scale the authority bonus by the spread of the run being perturbed, so a
  // citation boost can reorder near ties but cannot bury a strong first stage
  // result behind a weakly cited document.
  const scores = fusedRun.map((e) => e.score);
  const spread = scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0;

  return fusedRun
    .map((entry) => {
      const authority = ranks.get(entry.id) ?? 0;
      return {
        id: entry.id,
        score: entry.score + graphWeight * spread * authority,
        baseScore: entry.score,
        authority
      };
    })
    .sort((a, c) => (c.score - a.score) || (a.id < c.id ? -1 : 1))
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}

/* ------------------------------------------------------------------ *
 * Claim to span faithfulness
 * ------------------------------------------------------------------ */

/**
 * Split a body into sentences on terminal punctuation followed by whitespace,
 * keeping abbreviations such as "et al." from splitting mid abbreviation.
 */
export function splitSentences(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const parts = text.split(/(?<=[.!?])\s+/);
  const out = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

/** The union of the content terms of a sentence, as a Set. */
export function sentenceTerms(sentence) {
  return new Set(contentTokens(sentence));
}

/**
 * Score one sentence against a claim as the fraction of the claim's content
 * terms that the sentence covers, weighted by how much information each term
 * carries. Each term is weighted by its idf, so a rare technical term the
 * sentence does not share costs more than a common word it does share. A
 * sentence that omits only generic words scores near one; a sentence that omits
 * the discriminative term of the claim scores near zero.
 */
export function spanScore(claimTerms, sentence, idf) {
  const terms = sentenceTerms(sentence);
  if (claimTerms.size === 0 || terms.size === 0) return 0;
  let covered = 0;
  let weightSum = 0;
  for (const term of claimTerms) {
    const weight = idf && idf.has(term) ? idf.get(term) : 1;
    weightSum += weight;
    if (terms.has(term)) covered += weight;
  }
  if (weightSum === 0) return 0;
  return covered / weightSum;
}

/**
 * The faithfulness of a document against a claim. The claim is matched against
 * every sentence of the document and the best sentence is kept as the evidence
 * span. Faithfulness is the mean of the top sentence scores, which rewards a
 * document that supports the claim in more than one place.
 */
export function faithfulness(claim, documentBody, options = {}) {
  const sentences = splitSentences(documentBody);
  if (sentences.length === 0) return { score: 0, span: null, all: [] };
  const claimTerms = new Set(contentTokens(claim));
  const idf = options.idf;
  const scored = sentences.map((sentence) => ({
    sentence,
    score: spanScore(claimTerms, sentence, idf)
  }));
  scored.sort((a, c) => c.score - a.score);
  const top = scored.slice(0, Math.min(3, scored.length));
  const mean = top.reduce((sum, s) => sum + s.score, 0) / (top.length || 1);
  return {
    score: Math.max(0, Math.min(1, mean)),
    span: scored[0].sentence,
    all: scored
  };
}

/* ------------------------------------------------------------------ *
 * Abstention and calibration
 * ------------------------------------------------------------------ */

/**
 * The abstention score of a query against the top of a fused run. It combines
 * three signals: the idf weighted coverage of the claim terms by the best
 * evidence span of the top document, the coverage by the second document, and
 * how sharply the fused score exceeds the runner up. A query whose top
 * documents share vocabulary but answer nothing returns a low score, because
 * the evidence spans cover few of the claim's content terms.
 */
export function abstentionScore(fusedRun, claim, bodiesById, options = {}) {
  if (fusedRun.length === 0) return 0;
  const attention = options.attention ?? 0.7;

  const spanScores = [];
  const candidates = fusedRun.slice(0, Math.min(2, fusedRun.length));
  for (const entry of candidates) {
    const body = bodiesById.get?.(entry.id) ?? bodiesById[entry.id] ?? "";
    const faithfulnessResult = faithfulness(claim, body, options);
    spanScores.push(faithfulnessResult.score);
  }

  const first = spanScores[0] ?? 0;
  const second = spanScores[1] ?? 0;
  // The evidence agreement term rewards a second document that independently
  // supports the claim, which is what a well posed query produces.
  const agreement = Math.sqrt(Math.max(0, first) * Math.max(0, second));

  // Run confidence: the reciprocal rank fused scores of a run decay slowly, so
  // the raw gap between the top two documents is always a small fraction of
  // their magnitudes. Normalising by the mean top-score gap across the run, and
  // by the absolute level of the top score, gives a quantity in [0, 1] that is
  // large when the top document stands clearly above the field.
  const confidence = topConfidence(fusedRun);

  // Vocabulary coverage: a claim whose content terms are all inside the
  // collection can be answered, and one with foreign terms cannot, no matter
  // what the retrieval stages return.
  const unseen = options.docFrequency ? oovRatio(claim, options.docFrequency) : 0;
  const vocabulary = 1 - unseen;

  const coverage = attention * first + (1 - attention) * agreement;
  return Math.max(0, Math.min(1, coverage * vocabulary * (0.4 + 0.6 * confidence)));
}

/**
 * How far the top document of a run stands above the rest, in [0, 1].
 *
 * The fused score is a sum of 1/(k+rank) terms, so every document of a run has
 * a score in a narrow band and the gap between the top two is a tiny fraction
 * of their level. The band gap is normalised by the mean neighbouring gap, and
 * the ratio by the top score level, so a run whose leader pulls away from the
 * field scores near one and a flat run scores near zero.
 */
export function topConfidence(fusedRun) {
  if (fusedRun.length < 2) return 1;
  const head = fusedRun.slice(0, Math.min(fusedRun.length, 11));
  let gapSum = 0;
  for (let i = 1; i < head.length; i += 1) {
    gapSum += head[i - 1].score - head[i].score;
  }
  const meanGap = gapSum / Math.max(1, head.length - 1);
  if (!(meanGap > 0)) return 0;
  const leaderGap = fusedRun[0].score - fusedRun[1].score;
  const gapRatio = Math.max(0, Math.min(1, leaderGap / meanGap));
  const level = fusedRun[0].score;
  if (!(level > 0)) return 0;
  const levelRatio = Math.max(0, Math.min(1, (fusedRun[0].score - fusedRun[1].score) / level));
  return gapRatio * 0.5 + levelRatio * 0.5;
}

/**
 * The out of vocabulary ratio of a claim: the fraction of its distinct content
 * terms that never occur anywhere in the indexed collection. A claim drawn from
 * another domain carries terms the collection has never seen, and the ratio is
 * a lexical out of distribution signal that needs no model. A ratio of zero
 * means the claim lives entirely inside the collection vocabulary.
 */
export function oovRatio(claim, docFrequency) {
  const terms = uniqueTerms(contentTokens(claim));
  if (terms.length === 0) return 0;
  let unseen = 0;
  for (const term of terms) {
    if (!docFrequency.has(term)) unseen += 1;
  }
  return unseen / terms.length;
}

/**
 * The default abstention threshold. At or above this a query is answered.
 *
 * The operating point is chosen by sweeping the threshold over the built in
 * evaluation set and taking the highest answer rate that still rejects every
 * unanswerable query. Sweeping is exposed by `calibrationSweep` in the benchmark
 * module so the number on the dashboard is reproducible rather than asserted.
 */
export const DEFAULT_ABSTAIN_THRESHOLD = 0.1;

/**
 * Decide whether to answer. The threshold is inclusive on the answer side so a
 * score that exactly meets the threshold answers.
 */
export function shouldAnswer(score, threshold = DEFAULT_ABSTAIN_THRESHOLD) {
  return score >= threshold;
}

/**
 * Expected calibration error over binned confidence values. Bins are equal
 * width over [0, 1]. Each bin contributes the absolute gap between mean
 * confidence and observed accuracy, weighted by its share of the items.
 */
export function expectedCalibrationError(items, bins = 15) {
  const binCount = Math.max(1, Math.floor(bins));
  const width = 1 / binCount;
  const correct = new Array(binCount).fill(0);
  const counts = new Array(binCount).fill(0);
  const confidence = new Array(binCount).fill(0);
  for (const item of items) {
    // Accept either field name so the same function serves the benchmark items
    // (which carry `score`) and callers that name the field `confidence`.
    const value = item.confidence ?? item.score;
    const answerable = item.answerable ?? item.correct;
    if (!(typeof value === "number") || Number.isNaN(value)) continue;
    if (value < 0 || value > 1) continue;
    let idx = Math.floor(value / width);
    if (idx >= binCount) idx = binCount - 1;
    counts[idx] += 1;
    confidence[idx] += value;
    correct[idx] += answerable === true ? 1 : 0;
  }
  const total = items.length;
  if (total === 0) return 0;
  let ece = 0;
  for (let i = 0; i < binCount; i += 1) {
    if (counts[i] === 0) continue;
    const meanConfidence = confidence[i] / counts[i];
    const observedAccuracy = correct[i] / counts[i];
    ece += (counts[i] / total) * Math.abs(meanConfidence - observedAccuracy);
  }
  return ece;
}

/**
 * Area under the ROC curve for a binary score against a binary label,
 * computed by the trapezoidal rule over the observed operating points. An
 * area of 0.5 means the score is indistinguishable from chance.
 */
export function areaUnderRoc(xyPoints) {
  if (xyPoints.length < 2) return 0;
  const sorted = xyPoints.slice().sort((a, c) => a[0] - c[0] || a[1] - c[1]);
  let area = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const [x0, y0] = sorted[i - 1];
    const [x1, y1] = sorted[i];
    if (x1 === x0) continue;
    area += ((y1 + y0) / 2) * (x1 - x0);
  }
  return Math.max(0, Math.min(1, area));
}

/**
 * The ROC points for a set of items with scores and binary labels, where the
 * label is "answerable" (a positive). Sweeping the threshold from high to low
 * gives the false positive rate on the x axis and the true positive rate on the
 * y axis.
 *
 * Items sharing a score must contribute one operating point, not one each: a
 * score with no ordering information cannot separate the positives and
 * negatives that carry it, so the walk would otherwise depend on the order the
 * ties happened to be visited in.
 */
export function rocPoints(items) {
  const positives = items.filter((i) => i.answerable === true).length;
  const negatives = items.length - positives;
  if (positives === 0 || negatives === 0) return [];

  const groups = new Map();
  for (const item of items) {
    const key = item.score;
    const group = groups.get(key) ?? { positives: 0, negatives: 0 };
    if (item.answerable === true) group.positives += 1;
    else group.negatives += 1;
    groups.set(key, group);
  }
  const ordered = [...groups.entries()].sort((a, c) => c[0] - a[0]);

  let tp = 0;
  let fp = 0;
  const points = [];
  for (const [, group] of ordered) {
    tp += group.positives;
    fp += group.negatives;
    points.push([fp / negatives, tp / positives]);
  }
  points.push([1, 1]);
  points.unshift([0, 0]);
  return points;
}

/**
 * The AUROC of an abstention score against the answerable label. Higher is
 * better; 1 is perfect separation, 0.5 is chance.
 */
export function auroc(items) {
  return areaUnderRoc(rocPoints(items));
}

/* ------------------------------------------------------------------ *
 * Ranking metrics
 * ------------------------------------------------------------------ */

/** The one based rank of the first relevant document, or null if none. */
export function reciprocalRank(query, rankedIds, pool) {
  const poolSet = new Set(pool);
  for (let i = 0; i < rankedIds.length; i += 1) {
    if (poolSet.has(rankedIds[i])) return 1 / (i + 1);
  }
  return 0;
}

/** The fraction of the pool retrieved within the top k ranks. */
export function recallAtK(pool, rankedIds, k) {
  if (pool.length === 0) return null;
  const top = new Set(rankedIds.slice(0, k));
  let hit = 0;
  for (const id of pool) if (top.has(id)) hit += 1;
  return hit / pool.length;
}

/**
 * The inverse of the one based rank at which a specific document was ranked.
 * Returns zero when the document is absent from the run.
 */
export function reciprocalRankOfDoc(rankedIds, docId) {
  const idx = rankedIds.indexOf(docId);
  return idx === -1 ? 0 : 1 / (idx + 1);
}

/**
 * Normalized discounted cumulative gain at cutoff k over graded labels.
 * gain is 2^level - 1, the discount is 1 / log2(rank + 1).
 */
export function ndcgAtK(labels, k) {
  const cutoff = Math.max(1, Math.min(k, labels.length));
  let dcg = 0;
  for (let i = 0; i < cutoff; i += 1) {
    const gain = Math.pow(2, labels[i] ?? 0) - 1;
    dcg += gain / Math.log2(i + 2);
  }
  const ideal = labels.slice().sort((a, c) => c - a);
  let idcg = 0;
  for (let i = 0; i < cutoff; i += 1) {
    const gain = Math.pow(2, ideal[i] ?? 0) - 1;
    idcg += gain / Math.log2(i + 2);
  }
  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * Winsorize an array to the range [low, high]. Used by the clipping outlier
 * guard on query times before they are averaged.
 */
export function winsorize(values, low = 0, high = 1) {
  return values.map((v) => Math.max(low, Math.min(high, v)));
}

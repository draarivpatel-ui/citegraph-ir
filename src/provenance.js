/**
 * provenance.js - evidence attribution and stage movement diagnostics.
 *
 * Everything the dashboard reports as a headline number comes from a ranked
 * run, but a rank alone does not say which part of the question was actually
 * supported, or how much the citation graph changed the lexical answer. This
 * module answers both questions with pure functions over the same engine
 * objects, so the browser, the CLI and the test suite agree by construction.
 *
 * No dependency on the DOM, on Node built ins, or on any package.
 */

import {
  contentTokens,
  uniqueTerms,
  splitSentences,
  sentenceTerms,
  spanScore,
  charNGrams
} from "./ir_engine.js";

/* ------------------------------------------------------------------ *
 * Evidence attribution
 * ------------------------------------------------------------------ */

/**
 * Attribute the distinct content terms of a claim to the sentences of one
 * document body. Each returned term reports whether a sentence covers it, the
 * idf weight it carries, and the strongest sentence (if any) that carries it.
 *
 * The result is an auditable ledger: `coverage` is the idf weighted fraction of
 * the claim that the body supports, `uncovered` is the rare term list that a
 * reader can use to see exactly what the evidence failed to establish, and
 * `spans` is the minimal set of sentences that accounts for the coverage.
 * A term with no idf entry receives weight one, matching spanScore.
 */
export function attributeEvidence(claim, body, idf, options = {}) {
  const terms = uniqueTerms(contentTokens(claim));
  const sentences = splitSentences(typeof body === "string" ? body : "");
  const limit = Math.max(1, Math.floor(options.maxSpans ?? 3));

  const ledger = terms.map((term) => {
    const weight = idf && idf.has(term) ? Math.max(0, idf.get(term)) : 1;
    let bestSentence = null;
    let bestScore = 0;
    for (const sentence of sentences) {
      if (!sentenceTerms(sentence).has(term)) continue;
      // A sentence that covers more of the claim is a better home for the term.
      const score = spanScore(new Set(terms), sentence, idf);
      if (score > bestScore) {
        bestScore = score;
        bestSentence = sentence;
      }
    }
    return { term, weight, covered: bestSentence !== null, sentence: bestSentence, sentenceScore: bestScore };
  });

  const weightSum = ledger.reduce((sum, row) => sum + row.weight, 0);
  const coveredWeight = ledger.reduce((sum, row) => sum + (row.covered ? row.weight : 0), 0);
  const coverage = weightSum > 0 ? Math.max(0, Math.min(1, coveredWeight / weightSum)) : 0;

  // Minimal span set: pick the best scoring sentences first, then keep a
  // sentence only if it contributes a term no earlier sentence covered.
  const ranked = sentences
    .map((sentence) => ({ sentence, score: spanScore(new Set(terms), sentence, idf) }))
    .filter((entry) => entry.score > 0)
    .sort((a, c) => c.score - a.score || (a.sentence < c.sentence ? -1 : 1));
  const claimed = new Set();
  const spans = [];
  for (const entry of ranked) {
    const words = sentenceTerms(entry.sentence);
    const fresh = terms.filter((term) => words.has(term) && !claimed.has(term));
    if (fresh.length === 0) continue;
    for (const term of fresh) claimed.add(term);
    spans.push({ sentence: entry.sentence, score: entry.score, newTerms: fresh });
    if (spans.length >= limit) break;
  }

  return {
    claim,
    terms: ledger,
    coverage: Math.max(0, Math.min(1, coverage)),
    uncovered: ledger.filter((row) => !row.covered).map((row) => row.term),
    spans,
    sentenceCount: sentences.length
  };
}

/**
 * Attribute a claim across the top documents of a run. Each document gets its
 * own ledger and the result carries the best document, the independent second
 * opinion, and the number of documents that support each term. Agreement is
 * the geometric mean of the two best coverages, which is the same signal the
 * abstention head uses but now with a per term breakdown.
 */
export function attributeRunEvidence(run, claim, bodiesById, idf, options = {}) {
  const limit = Math.max(1, Math.floor(options.topN ?? 4));
  const perDocument = [];
  for (const entry of run.slice(0, limit)) {
    const body = bodiesById.get?.(entry.id) ?? bodiesById[entry.id] ?? "";
    perDocument.push({
      docId: entry.id,
      rank: entry.rank,
      ...attributeEvidence(claim, body, idf, options)
    });
  }
  const first = perDocument[0]?.coverage ?? 0;
  const second = perDocument[1]?.coverage ?? 0;
  const agreement = Math.sqrt(Math.max(0, first) * Math.max(0, second));

  const support = new Map();
  for (const document of perDocument) {
    for (const row of document.terms) {
      if (!row.covered) continue;
      support.set(row.term, (support.get(row.term) ?? 0) + 1);
    }
  }
  return {
    perDocument,
    topCoverage: first,
    secondCoverage: second,
    agreement,
    supportByTerm: support,
    consensusTerms: [...support.entries()]
      .filter(([, count]) => count >= 2)
      .map(([term]) => term)
      .sort()
  };
}

/* ------------------------------------------------------------------ *
 * Stage movement diagnostics
 * ------------------------------------------------------------------ */

/**
 * Compare two ranked runs document by document. `deltas` is keyed by document
 * id and holds the signed rank change (positive means it climbed), while
 * `movers` is the same data sorted by absolute movement, biggest first.
 * `spearman` is the rank correlation over the union of ids, using average
 * ranks for documents that are missing from a run. Ties are stable by id.
 */
export function compareRuns(before, after, options = {}) {
  const rankOf = (run) => {
    const map = new Map();
    run.forEach((entry, i) => map.set(entry.id, (entry.rank ?? i + 1)));
    return map;
  };
  const a = rankOf(before);
  const b = rankOf(after);
  const ids = new Set([...a.keys(), ...b.keys()]);
  const fallbackA = a.size + 1;
  const fallbackB = b.size + 1;
  const deltas = new Map();
  for (const id of ids) {
    const ra = a.get(id) ?? fallbackA;
    const rb = b.get(id) ?? fallbackB;
    deltas.set(id, { id, before: ra, after: rb, delta: ra - rb });
  }
  const movers = [...deltas.values()]
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || (x.id < y.id ? -1 : 1))
    .filter((row) => row.delta !== 0);

  return {
    deltas,
    movers,
    maxClimb: movers.reduce((m, row) => Math.max(m, row.delta), 0),
    maxDrop: movers.reduce((m, row) => Math.min(m, row.delta), 0),
    changedCount: movers.length,
    spearman: spearmanFootrule(a, b, ids, fallbackA, fallbackB)
  };
}

/**
 * Spearman-style normalized footrule agreement in [0, 1]. One is identical
 * ordering, zero is maximal disagreement over the same id set. Runs that
 * share no documents report zero: with no common document there is no
 * ordering to agree on. Using the sum of absolute rank displacements instead
 * of squared differences makes the measure robust to a single document
 * moving a long way.
 */
function spearmanFootrule(a, b, ids, fallbackA, fallbackB) {
  const n = ids.size;
  if (n <= 1) return 1;
  let displacement = 0;
  let worst = 0;
  let shared = 0;
  for (const id of ids) {
    if (a.has(id) && b.has(id)) shared += 1;
    displacement += Math.abs((a.get(id) ?? fallbackA) - (b.get(id) ?? fallbackB));
  }
  if (shared === 0) return 0;
  // The worst case is the reverse permutation over n ranks.
  for (let i = 1; i <= n; i += 1) worst += Math.abs(i - (n + 1 - i));
  return worst > 0 ? Math.max(0, Math.min(1, 1 - displacement / worst)) : 1;
}

/**
 * Why a document moved: break the lexical and dense rank contributions into
 * the four numbers the fusion and re-ranking stages actually consumed. This is
 * a diagnostic projection, not a new scoring function: the ranks come straight
 * from the supplied runs.
 */
export function stageContributions(runs, docId, options = {}) {
  const stages = options.stages ?? ["lexical", "dense", "fused", "reranked"];
  const out = {};
  for (const stage of stages) {
    const run = runs[stage] ?? [];
    const entry = run.find((row) => row.id === docId);
    out[stage] = entry ? { rank: entry.rank, score: entry.score } : null;
  }
  const first = out[stages[0]]?.rank ?? null;
  const last = out[stages[stages.length - 1]]?.rank ?? null;
  return { docId, stages: out, netDelta: first !== null && last !== null ? first - last : null };
}

/* ------------------------------------------------------------------ *
 * Query fingerprint
 * ------------------------------------------------------------------ */

/**
 * A compact, deterministic lexical fingerprint of a query. The gram histogram
 * is sorted by gram then count so two queries with the same content produce
 * byte identical objects regardless of the order the terms were seen in.
 * The lab uses it to label a run; the tests use it as a regression guard.
 */
export function queryFingerprint(query, options = {}) {
  const terms = uniqueTerms(contentTokens(query)).sort();
  const grams = charNGrams(query, options.n ?? 3);
  const histogram = new Map();
  for (const gram of grams) histogram.set(gram, (histogram.get(gram) ?? 0) + 1);
  const sortedGrams = [...histogram.entries()].sort((a, c) => (a[0] < c[0] ? -1 : a[0] > c[0] ? 1 : 0));
  let hash = 2166136261;
  const seed = `${terms.join(" ")}|${sortedGrams.map(([g, c]) => `${g}:${c}`).join(",")}`;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return {
    terms,
    termCount: terms.length,
    gramCount: grams.length,
    distinctGrams: sortedGrams.length,
    grams: sortedGrams,
    hash: (hash >>> 0).toString(16).padStart(8, "0")
  };
}

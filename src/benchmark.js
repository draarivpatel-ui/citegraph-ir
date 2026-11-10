/**
 * benchmark.js - the evaluation harness that drives the engine.
 *
 * A run is either the lexical stage alone, the dense stage alone, the fused run,
 * or the citation re-ranked run. Every metric on the dashboard is computed here
 * from the runs, never stored.
 */

import { CORPUS, BODIES } from "./corpus.js";
import {
  ANSWERABLE,
  UNANSWERABLE,
  EVALUATION_SET,
  gradedRelevance
} from "./evaluation_set.js";
import {
  buildIndex,
  bm25Rank,
  contentTokens,
  tokenize,
  buildDenseVectors,
  denseRank,
  reciprocalRankFusion,
  buildCitationGraph,
  rerankWithAuthority,
  faithfulness,
  abstentionScore,
  expectedCalibrationError,
  auroc,
  rocPoints,
  ndcgAtK,
  reciprocalRank,
  recallAtK,
  reciprocalRankOfDoc,
  DEFAULT_ABSTAIN_THRESHOLD
} from "./ir_engine.js";

/** The documents with their bodies attached, in corpus order. */
export function loadDocuments() {
  return CORPUS.map((doc) => ({ ...doc, body: BODIES[doc.id] }));
}

/** Build a full index set: BM25 index, dense vectors, citation graph. */
export function buildEngine(options = {}) {
  const documents = loadDocuments();
  const index = buildIndex(documents, options);
  const dense = buildDenseVectors(index, documents, options);
  const graph = buildCitationGraph(index);
  const bodiesById = new Map(documents.map((d) => [d.id, d.body]));
  return { documents, index, dense, graph, bodiesById };
}

const NDCG_K = 10;

/**
 * Run one query through a stage of the pipeline.
 * stage is "lexical", "dense", "fused", or "reranked".
 */
export function runQuery(engine, query, stage, options = {}) {
  const tokens = contentTokens(query);
  const lexical = bm25Rank(engine.index, tokens);
  if (stage === "lexical") return lexical;

  const dense = denseRank(engine.dense, engine.documents, query, options);
  if (stage === "dense") return dense;

  const fused = reciprocalRankFusion([lexical, dense], options);
  if (stage === "fused") return fused;

  if (stage === "reranked") {
    return rerankWithAuthority(fused, engine.graph, engine.index, options);
  }
  throw new RangeError(`unknown stage '${stage}'`);
}

/** All four stages of one query, for the comparison table. */
export function runAllStages(engine, query, options = {}) {
  const stages = ["lexical", "dense", "fused", "reranked"];
  const runs = {};
  for (const stage of stages) runs[stage] = runQuery(engine, query, stage, options);
  return runs;
}

/* ------------------------------------------------------------------ *
 * Per-query retrieval metrics
 * ------------------------------------------------------------------ */

/**
 * Metrics for one query against one ranked run.
 * mrr      : reciprocal rank of the first relevant document
 * recall@k : fraction of the pool inside the top k ranks
 * ndcg@k   : graded relevance, ranked document by ranked document
 * canonRr  : reciprocal rank of the canonical (first pool) document
 */
export function queryMetrics(query, rankedIds, k = NDCG_K) {
  const judgments = gradedRelevance(query, rankedIds);
  const labels = judgments.labels.slice(0, Math.max(k, rankedIds.length));
  return {
    queryId: query.id,
    mrr: reciprocalRank(query, rankedIds, query.relevant),
    canonRr: reciprocalRankOfDoc(rankedIds, judgments.canonical),
    recallAt1: recallAtK(query.relevant, rankedIds, 1),
    recallAt5: recallAtK(query.relevant, rankedIds, 5),
    recallAt10: recallAtK(query.relevant, rankedIds, 10),
    ndcgAt10: ndcgAtK(labels, NDCG_K),
    canonical: judgments.canonical,
    canonicalRank: judgments.canonicalRank
  };
}

/* ------------------------------------------------------------------ *
 * Aggregate metrics over a run
 * ------------------------------------------------------------------ */

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, c) => a + c, 0) / values.length;
}

/**
 * Aggregate a stage's results over the answerable queries.
 * mrr, ndcg, recall are averaged over queries; a query with no relevant
 * documents would be excluded, and the built in collection has none.
 */
export function aggregateMetrics(perQuery) {
  return {
    mrr: mean(perQuery.map((q) => q.mrr)),
    ndcgAt10: mean(perQuery.map((q) => q.ndcgAt10)),
    recallAt1: mean(perQuery.map((q) => q.recallAt1)),
    recallAt5: mean(perQuery.map((q) => q.recallAt5)),
    recallAt10: mean(perQuery.map((q) => q.recallAt10)),
    queryCount: perQuery.length
  };
}

/* ------------------------------------------------------------------ *
 * Calibration and abstention
 * ------------------------------------------------------------------ */

/**
 * Score every query in the evaluation set with the abstention scorer and
 * compute the calibration diagnostics. `score` is the abstention score of the
 * fused+reranked run, which is the run whose answer decision is reported.
 */
export function evaluateAbstention(engine, options = {}) {
  const threshold = options.threshold ?? DEFAULT_ABSTAIN_THRESHOLD;
  const stage = options.stage ?? "reranked";
  const items = [];
  for (const query of EVALUATION_SET.all) {
    const run = runQuery(engine, query.text, stage, options);
    const score = abstentionScore(run, query.text, engine.bodiesById, {
      idf: engine.index.idf,
      docFrequency: engine.index.docFrequency
    });
    const answerable = query.relevant.length > 0;
    const decided = score >= threshold;
    const correct = answerable === decided;
    const topId = run.length > 0 ? run[0].id : null;
    items.push({
      queryId: query.id,
      text: query.text,
      answerable,
      score,
      decided,
      correct,
      topId,
      pool: query.relevant
    });
  }

  const positives = items.filter((i) => i.answerable);
  const negatives = items.filter((i) => !i.answerable);
  const itemsForAuroc = items.map((i) => ({ score: i.score, answerable: i.answerable }));

  const accuracy = items.length === 0 ? 0 : items.filter((i) => i.correct).length / items.length;
  const falseAnswerRate = negatives.length === 0 ? 0 : negatives.filter((i) => i.decided).length / negatives.length;
  const trueAnswerRate = positives.length === 0 ? 0 : positives.filter((i) => i.decided).length / positives.length;
  const coverage = positives.length === 0 ? 0 : positives.filter((i) => i.decided).length / positives.length;

  return {
    threshold,
    ece: expectedCalibrationError(items, options.eceBins ?? 15),
    auroc: auroc(itemsForAuroc),
    accuracy,
    coverage,
    falseAnswerRate,
    trueAnswerRate,
    roc: rocPoints(itemsForAuroc),
    items
  };
}

/**
 * Sweep the abstention threshold and report the operating points. Each row is
 * one threshold with its coverage, false answer rate, expected calibration
 * error and area under the ROC curve of the score itself. The row with the
 * highest coverage that still rejects every unanswerable query is the default
 * operating point the workbench starts at.
 */
export function calibrationSweep(engine, thresholds, options = {}) {
  const list = Array.isArray(thresholds)
    ? thresholds
    : [0.05, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2, 0.22, 0.24, 0.26, 0.28, 0.32, 0.36, 0.4];
  return list.map((threshold) => {
    const result = evaluateAbstention(engine, { ...options, threshold });
    return {
      threshold,
      coverage: round(result.coverage, 4),
      falseAnswerRate: round(result.falseAnswerRate, 4),
      accuracy: round(result.accuracy, 4),
      ece: round(result.ece, 4),
      auroc: round(result.auroc, 4)
    };
  });
}

/**
 * The best operating point in a sweep: the highest coverage whose false answer
 * rate is zero, breaking ties toward the lower threshold so the fallback is the
 * safest row rather than the last one examined.
 */
export function recommendThreshold(rows) {
  const safe = rows.filter((r) => r.falseAnswerRate === 0);
  if (safe.length === 0) return null;
  let best = safe[0];
  for (const row of safe) {
    if (row.coverage > best.coverage) best = row;
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Full benchmark report
 * ------------------------------------------------------------------ */

/**
 * Run the whole benchmark: all four stages against the answerable queries, plus
 * the abstention and calibration diagnostics over the whole evaluation set.
 */
export function runBenchmark(options = {}) {
  const engine = buildEngine(options);
  const stages = ["lexical", "dense", "fused", "reranked"];
  const ranksById = new Map();
  const stageRuns = {};

  for (const stage of stages) {
    const perQuery = [];
    const runs = [];
    for (const query of ANSWERABLE) {
      const run = runQuery(engine, query.text, stage, options);
      runs.push(run);
      if (!ranksById.has(query.id)) ranksById.set(query.id, []);
      const rankedIds = run.map((r) => r.id);
      ranksById.get(query.id).push({ stage, ids: rankedIds });
      perQuery.push(queryMetrics(query, rankedIds));
    }
    stageRuns[stage] = {
      runs,
      perQuery,
      aggregate: aggregateMetrics(perQuery)
    };
  }

  const abstention = evaluateAbstention(engine, options);

  const answerCount = abstention.items.filter((i) => i.answerable).length;
  const unanswerCount = abstention.items.filter((i) => !i.answerable).length;

  return {
    engine,
    corpusSize: engine.documents.length,
    evaluationSize: EVALUATION_SET.all.length,
    answerableCount: answerCount,
    unanswerableCount: unanswerCount,
    stages: stageRuns,
    ranksById,
    abstention,
    options
  };
}

/** A serializable summary, safe to send to a dashboard or to print. */
export function summarize(report) {
  const out = {
    corpus: report.corpusSize,
    evaluationQueries: report.evaluationSize,
    answerable: report.answerableCount,
    unanswerable: report.unanswerableCount,
    stages: {},
    abstention: {
      threshold: report.abstention.threshold,
      ece: round(report.abstention.ece, 4),
      auroc: round(report.abstention.auroc, 4),
      accuracy: round(report.abstention.accuracy, 4),
      coverage: round(report.abstention.coverage, 4),
      falseAnswerRate: round(report.abstention.falseAnswerRate, 4)
    }
  };
  for (const [stage, data] of Object.entries(report.stages)) {
    out.stages[stage] = {
      mrr: round(data.aggregate.mrr, 4),
      ndcgAt10: round(data.aggregate.ndcgAt10, 4),
      recallAt1: round(data.aggregate.recallAt1, 4),
      recallAt5: round(data.aggregate.recallAt5, 4),
      recallAt10: round(data.aggregate.recallAt10, 4)
    };
  }
  return out;
}

function round(value, digits) {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

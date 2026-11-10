/**
 * report.js - a JSON projection of a benchmark run.
 *
 * The dashboard and the command line interface both read the same projection, so
 * neither of them recomputes a metric. Nothing here is stateful: the same report
 * is produced on every run over the same engine.
 */

import { runBenchmark, summarize, calibrationSweep, recommendThreshold } from "./benchmark.js";
import { faithfulness, recallAtK } from "./ir_engine.js";
import { gradedRelevance, EVALUATION_SET } from "./evaluation_set.js";

const STAGES = ["lexical", "dense", "fused", "reranked"];

function round(value, digits) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

/**
 * The full report as plain JSON: the summary, the calibration sweep, one row per
 * query, the unanswerable decisions, and the leading evidence span for the top
 * few queries so a reader can see what the re-ranked run actually retrieved.
 */
export function buildReport(options = {}) {
  const report = runBenchmark(options);
  const summary = summarize(report);
  const sweep = calibrationSweep(report.engine, options.thresholds, options);
  const recommended = recommendThreshold(sweep) ?? {
    threshold: report.abstention.threshold,
    coverage: report.abstention.coverage,
    falseAnswerRate: report.abstention.falseAnswerRate,
    accuracy: report.abstention.accuracy,
    ece: report.abstention.ece,
    auroc: report.abstention.auroc
  };

  const rankedIds = new Map();
  for (const stage of STAGES) {
    for (let i = 0; i < report.stages[stage].perQuery.length; i += 1) {
      const row = report.stages[stage].perQuery[i];
      if (!rankedIds.has(row.queryId)) rankedIds.set(row.queryId, {});
      rankedIds.get(row.queryId)[stage] = report.stages[stage].runs[i].map((r) => r.id);
    }
  }

  const abstentionById = new Map(report.abstention.items.map((item) => [item.queryId, item]));

  const perQuery = [];
  for (const query of EVALUATION_SET.answerable) {
    const ranked = rankedIds.get(query.id) ?? {};
    const lexical = ranked.lexical ?? [];
    const reranked = ranked.reranked ?? [];
    const judgments = gradedRelevance(query, reranked);
    const decision = abstentionById.get(query.id);
    const run = report.stages.reranked.runs[report.stages.reranked.perQuery
      .findIndex((row) => row.queryId === query.id)];
    const topId = run && run.length > 0 ? run[0].id : null;
    const body = topId ? report.engine.bodiesById.get(topId) ?? "" : "";
    const evidence = body ? faithfulness(query.text, body, { idf: report.engine.index.idf }) : null;

    perQuery.push({
      queryId: query.id,
      text: query.text,
      pool: query.relevant,
      ranked: { lexical, reranked },
      canonical: judgments.canonical,
      canonicalRank: reranked.indexOf(judgments.canonical) + 1 || null,
      recallAt1: round(recallAtK(query.relevant, reranked, 1), 4),
      recallAt5: round(recallAtK(query.relevant, reranked, 5), 4),
      recallAt10: round(recallAtK(query.relevant, reranked, 10), 4),
      answerable: true,
      abstentionScore: decision ? round(decision.score, 4) : null,
      decided: decision ? decision.decided : null,
      correct: decision ? decision.correct : null,
      evidence: evidence
        ? { docId: topId, score: round(evidence.score, 4), span: evidence.span }
        : { docId: topId, score: 0, span: null }
    });
  }

  const unanswerable = EVALUATION_SET.unanswerable.map((query) => {
    const decision = abstentionById.get(query.id);
    return {
      queryId: query.id,
      text: query.text,
      abstentionScore: decision ? round(decision.score, 4) : null,
      decided: decision ? decision.decided : null,
      correct: decision ? decision.correct : null,
      topId: decision ? decision.topId : null
    };
  });

  return {
    project: "CiteGraph-IR",
    corpus: summary.corpus,
    evaluationQueries: summary.evaluationQueries,
    answerable: summary.answerable,
    unanswerable: summary.unanswerable,
    stages: summary.stages,
    abstention: summary.abstention,
    recommendedThreshold: {
      threshold: recommended.threshold,
      coverage: round(recommended.coverage, 4),
      falseAnswerRate: round(recommended.falseAnswerRate, 4),
      accuracy: round(recommended.accuracy, 4),
      ece: round(recommended.ece, 4),
      auroc: round(recommended.auroc, 4)
    },
    calibrationSweep: sweep.map((row) => ({
      threshold: row.threshold,
      coverage: round(row.coverage, 4),
      falseAnswerRate: round(row.falseAnswerRate, 4),
      accuracy: round(row.accuracy, 4),
      ece: round(row.ece, 4),
      auroc: round(row.auroc, 4)
    })),
    roc: report.abstention.roc,
    perQuery,
    unanswerableRows: unanswerable
  };
}

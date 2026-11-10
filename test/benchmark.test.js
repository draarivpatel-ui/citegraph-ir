/**
 * benchmark.test.js - the evaluation harness itself.
 *
 * The harness is what every headline number comes from, so it gets checked on
 * its own: that a run covers the whole set, that each stage returns a full
 * ranking, that the aggregates are means over the per-query rows, and that the
 * abstention evaluation labels answerable against unanswerable correctly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadDocuments,
  buildEngine,
  runQuery,
  runAllStages,
  queryMetrics,
  aggregateMetrics,
  evaluateAbstention,
  calibrationSweep,
  recommendThreshold,
  runBenchmark,
  summarize
} from "../src/benchmark.js";
import { ANSWERABLE, UNANSWERABLE } from "../src/evaluation_set.js";
import { buildReport } from "../src/report.js";

const STAGES = ["lexical", "dense", "fused", "reranked"];
const engine = buildEngine();

test("loadDocuments attaches the body of every corpus document", () => {
  const docs = loadDocuments();
  assert.equal(docs.length, 40);
  for (const doc of docs) {
    assert.equal(typeof doc.body, "string");
    assert.ok(doc.body.length > 0, `${doc.id} body`);
  }
});

test("loadDocuments does not leak the shared corpus object", () => {
  const a = loadDocuments();
  const b = loadDocuments();
  assert.notEqual(a[0], b[0]);
  a[0].body = "mutated";
  assert.notEqual(b[0].body, "mutated");
});

test("buildEngine wires every part together", () => {
  assert.equal(engine.documents.length, 40);
  assert.ok(engine.index.docs.length === 40);
  assert.ok(engine.dense.docCount === 40);
  assert.ok(engine.graph.ids.size === 40);
  assert.ok(engine.bodiesById.size === 40);
  assert.equal(engine.bodiesById.get("bm25-okapi"), engine.documents.find((d) => d.id === "bm25-okapi").body);
});

test("buildEngine is deterministic", () => {
  const again = buildEngine();
  assert.equal(again.index.docs.length, engine.index.docs.length);
  const a = runQuery(again, "bm25 okapi relevance", "reranked").map((r) => r.id);
  const b = runQuery(engine, "bm25 okapi relevance", "reranked").map((r) => r.id);
  assert.deepEqual(a, b);
});

test("each stage returns the whole collection ranked", () => {
  for (const stage of STAGES) {
    const run = runQuery(engine, "how does bm25 rank documents", stage);
    assert.equal(run.length, 40, `${stage} returned ${run.length} documents`);
    assert.deepEqual(run.map((r) => r.rank), Array.from({ length: 40 }, (_, i) => i + 1));
    assert.equal(new Set(run.map((r) => r.id)).size, 40);
    for (const entry of run) assert.ok(Number.isFinite(entry.score));
  }
});

test("runQuery rejects an unknown stage", () => {
  assert.throws(() => runQuery(engine, "bm25", "nonsense"), RangeError);
});

test("runAllStages returns one run per stage for the same query", () => {
  const runs = runAllStages(engine, "how does bm25 rank documents");
  assert.deepEqual(Object.keys(runs).sort(), [...STAGES].sort());
  for (const stage of STAGES) assert.equal(runs[stage].length, 40, stage);
});

test("a query with no content terms still returns a ranked run", () => {
  for (const stage of STAGES) {
    const run = runQuery(engine, "the of and", stage);
    assert.equal(run.length, 40, stage);
    assert.deepEqual(run.map((r) => r.rank), Array.from({ length: 40 }, (_, i) => i + 1));
  }
});

test("queryMetrics reports the canonical rank of the query it was given", () => {
  const query = ANSWERABLE[0];
  const ids = runQuery(engine, query.text, "reranked").map((r) => r.id);
  const metrics = queryMetrics(query, ids);
  assert.equal(metrics.queryId, query.id);
  assert.equal(metrics.canonicalRank, ids.indexOf(query.relevant[0]));
  assert.ok(metrics.mrr > 0 && metrics.mrr <= 1);
});

test("queryMetrics recall is the fraction of the pool inside the top k", () => {
  const query = { id: "synthetic", relevant: ["bm25-okapi", "dfr-divergence"] };
  const metrics = queryMetrics(query, ["dfr-divergence", "bm25-okapi"], 10);
  assert.equal(metrics.recallAt1, 0.5);
  assert.equal(metrics.recallAt5, 1);
  assert.equal(metrics.recallAt10, 1);
  assert.equal(metrics.mrr, 1);
  // The canonical sits at index one, behind the other pool member.
  assert.equal(metrics.canonRr, 0.5);
  assert.equal(metrics.canonicalRank, 1);
});

test("queryMetrics of a run with no pool gives zeros", () => {
  const metrics = queryMetrics({ id: "empty", relevant: [] }, ["bm25-okapi"], 10);
  assert.equal(metrics.mrr, 0);
  assert.equal(metrics.canonRr, 0);
  assert.equal(metrics.ndcgAt10, 0);
  assert.equal(metrics.canonicalRank, undefined);
  assert.equal(metrics.canonical, undefined);
  // An empty pool has no recall to report, and recallAtK says so with null
  // rather than pretending the run retrieved nothing.
  assert.equal(metrics.recallAt1, null);
  assert.equal(metrics.recallAt5, null);
  assert.equal(metrics.recallAt10, null);
});

test("queryMetrics fixes its recall cut-offs at one, five and ten", () => {
  // The k argument only widens the graded relevance slice used by ndcg, so the
  // recall columns are always read at the same three cut-offs.
  const query = { id: "synthetic", relevant: ["bm25-okapi", "dfr-divergence"] };
  const ids = ["lm-jelinek-mercer", "dfr-divergence", "bm25-okapi"];
  const wide = queryMetrics(query, ids, 20);
  assert.equal(wide.recallAt1, 0);
  assert.equal(wide.recallAt5, 1);
  assert.equal(wide.recallAt10, 1);
  const narrow = queryMetrics(query, ids, 2);
  assert.equal(narrow.recallAt1, 0);
  assert.equal(narrow.recallAt10, 1);
});

test("aggregateMetrics is the mean of the per-query rows", () => {
  const rows = [
    { mrr: 1, canonRr: 1, recallAt1: 0.5, recallAt5: 1, recallAt10: 1, ndcgAt10: 1 },
    { mrr: 0.5, canonRr: 0.5, recallAt1: 0, recallAt5: 0.5, recallAt10: 0.5, ndcgAt10: 0.5 }
  ];
  const out = aggregateMetrics(rows);
  assert.equal(out.mrr, 0.75);
  assert.equal(out.recallAt1, 0.25);
  assert.equal(out.recallAt5, 0.75);
  assert.equal(out.recallAt10, 0.75);
  assert.equal(out.ndcgAt10, 0.75);
  assert.equal(out.queryCount, 2);
});

test("aggregateMetrics of an empty list is all zeros", () => {
  const out = aggregateMetrics([]);
  for (const value of Object.values(out)) assert.equal(value, 0);
});

test("every answerable query sits at rank one in the reranked stage", () => {
  for (const query of ANSWERABLE) {
    const ids = runQuery(engine, query.text, "reranked").map((r) => r.id);
    assert.equal(ids[0], query.relevant[0], `${query.id} expected ${query.relevant[0]} got ${ids[0]}`);
  }
});

test("evaluateAbstention covers the whole evaluation set", () => {
  const result = evaluateAbstention(engine);
  assert.equal(result.items.length, 41);
  assert.equal(result.items.filter((i) => i.answerable).length, 36);
  assert.equal(result.items.filter((i) => !i.answerable).length, 5);
  for (const item of result.items) {
    assert.ok(item.score >= 0 && item.score <= 1, item.queryId);
  }
});

test("evaluateAbstention labels an answerable query from its pool", () => {
  const result = evaluateAbstention(engine);
  const answerable = result.items.filter((i) => i.answerable);
  for (const item of answerable) {
    const query = ANSWERABLE.find((q) => q.id === item.queryId);
    assert.equal(item.answerable, query.relevant.length > 0);
  }
  for (const item of result.items.filter((i) => !i.answerable)) {
    assert.deepEqual(UNANSWERABLE.find((q) => q.id === item.queryId).relevant, []);
  }
});

test("evaluateAbstention decisions are inclusive at the threshold", () => {
  const result = evaluateAbstention(engine);
  for (const item of result.items) {
    assert.equal(item.decided, item.score >= result.threshold, item.queryId);
    assert.equal(item.correct, item.answerable === item.decided, item.queryId);
  }
});

test("evaluateAbstention accuracy, coverage and false answer rate are consistent", () => {
  const result = evaluateAbstention(engine);
  const positives = result.items.filter((i) => i.answerable);
  const negatives = result.items.filter((i) => !i.answerable);
  assert.equal(result.accuracy, result.items.filter((i) => i.correct).length / result.items.length);
  assert.equal(result.coverage, positives.filter((i) => i.decided).length / positives.length);
  assert.equal(result.falseAnswerRate, negatives.filter((i) => i.decided).length / negatives.length);
  assert.equal(result.trueAnswerRate, positives.filter((i) => i.decided).length / positives.length);
});

test("evaluateAbstention separates the two halves well", () => {
  const result = evaluateAbstention(engine);
  const answerableScores = result.items.filter((i) => i.answerable).map((i) => i.score);
  const unanswerableScores = result.items.filter((i) => !i.answerable).map((i) => i.score);
  const lowestAnswerable = Math.min(...answerableScores);
  // A perfect split is not required, but the classes must not overlap wholesale.
  assert.ok(result.auroc > 0.85, `auroc ${result.auroc}`);
  assert.ok(lowestAnswerable > 0);
});

test("evaluateAbstention accepts an explicit stage", () => {
  const lexical = evaluateAbstention(engine, { stage: "lexical" });
  const reranked = evaluateAbstention(engine, { stage: "reranked" });
  assert.equal(lexical.items.length, reranked.items.length);
  assert.ok(Number.isFinite(lexical.auroc));
  assert.ok(Number.isFinite(lexical.ece));
});

test("the calibration sweep climbs the threshold monotonically", () => {
  const rows = calibrationSweep(engine);
  assert.ok(rows.length > 3);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i].threshold > rows[i - 1].threshold, "thresholds must ascend");
    assert.ok(rows[i].coverage <= rows[i - 1].coverage, "coverage must not rise with the threshold");
  }
});

test("the calibration sweep keeps the false answer rate from rising", () => {
  const rows = calibrationSweep(engine);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i].falseAnswerRate <= rows[i - 1].falseAnswerRate + 1e-12, "row " + i);
  }
});

test("recommendThreshold picks the row with coverage and no false answers", () => {
  const rows = calibrationSweep(engine);
  const best = recommendThreshold(rows);
  const matching = rows.filter((r) => r.falseAnswerRate === 0);
  assert.ok(matching.includes(best) || best.falseAnswerRate === 0);
  assert.equal(best.falseAnswerRate, 0);
  assert.ok(best.coverage > 0);
});

test("recommendThreshold reports the highest coverage among the safe rows", () => {
  const rows = calibrationSweep(engine);
  const best = recommendThreshold(rows);
  const safe = rows.filter((r) => r.falseAnswerRate === 0);
  const widest = Math.max(...safe.map((r) => r.coverage));
  assert.ok(Math.abs(best.coverage - widest) < 1e-9, `${best.coverage} vs ${widest}`);
});

test("recommendThreshold of an empty sweep is null", () => {
  // No safe row means no recommendation, and buildReport falls back to the
  // evaluated operating point so the dashboard still has numbers to show.
  assert.equal(recommendThreshold([]), null);
  assert.equal(recommendThreshold([{ threshold: 0.1, coverage: 1, falseAnswerRate: 0.5 }]), null);
});

test("runBenchmark reports a consistent picture of the set", () => {
  const report = runBenchmark();
  assert.equal(report.corpusSize, 40);
  assert.equal(report.evaluationSize, 41);
  assert.equal(report.answerableCount, 36);
  assert.equal(report.unanswerableCount, 5);
  assert.deepEqual(Object.keys(report.stages).sort(), [...STAGES].sort());
  for (const stage of STAGES) {
    assert.equal(report.stages[stage].perQuery.length, 36, stage);
    assert.equal(report.stages[stage].runs.length, 36, stage);
  }
});

test("runBenchmark records the ranked identifiers of every stage per query", () => {
  const report = runBenchmark();
  for (const query of ANSWERABLE) {
    const stages = report.ranksById.get(query.id);
    assert.equal(stages.length, 4, query.id);
    for (const entry of stages) {
      assert.equal(entry.ids.length, 40, `${query.id} ${entry.stage}`);
      assert.equal(new Set(entry.ids).size, 40, `${query.id} ${entry.stage}`);
    }
  }
});

test("the reranked stage is at least as good as the fused stage on ndcg", () => {
  const report = runBenchmark();
  const fused = report.stages.fused.aggregate;
  const reranked = report.stages.reranked.aggregate;
  assert.ok(reranked.ndcgAt10 >= fused.ndcgAt10 - 1e-9,
    `reranked ${reranked.ndcgAt10} vs fused ${fused.ndcgAt10}`);
});

test("fusing is at least as good as either signal alone", () => {
  const report = runBenchmark();
  const fused = report.stages.fused.aggregate;
  const lexical = report.stages.lexical.aggregate;
  const dense = report.stages.dense.aggregate;
  const bestAlone = Math.max(lexical.ndcgAt10, dense.ndcgAt10);
  assert.ok(fused.ndcgAt10 >= bestAlone - 1e-9,
    `fused ${fused.ndcgAt10} vs best alone ${bestAlone}`);
});

test("summarize is serializable and agrees with the report", () => {
  const report = runBenchmark();
  const summary = summarize(report);
  assert.equal(summary.corpus, report.corpusSize);
  assert.equal(summary.evaluationQueries, report.evaluationSize);
  assert.equal(summary.answerable, report.answerableCount);
  assert.equal(summary.unanswerable, report.unanswerableCount);
  for (const stage of STAGES) {
    // summarize rounds to four decimals, so the comparison is against the
    // rounded aggregate rather than the raw float.
    const rounded = Math.round(report.stages[stage].aggregate.ndcgAt10 * 1e4) / 1e4;
    assert.equal(summary.stages[stage].ndcgAt10, rounded, stage);
    assert.ok(Math.abs(summary.stages[stage].ndcgAt10 - report.stages[stage].aggregate.ndcgAt10) < 5e-5, stage);
  }
  assert.ok(Math.abs(summary.abstention.auroc - report.abstention.auroc) < 5e-5);
  // A round trip through JSON must not lose anything or produce a cycle.
  const roundTripped = JSON.parse(JSON.stringify(summary));
  assert.deepEqual(roundTripped, summary);
});

test("buildReport carries one row per query and the sweep", () => {
  const report = buildReport();
  assert.equal(report.perQuery.length, 36);
  assert.equal(report.unanswerableRows.length, 5);
  assert.ok(report.calibrationSweep.length > 3);
  assert.equal(report.corpus, 40);
  assert.deepEqual(Object.keys(report.stages).sort(), [...STAGES].sort());
});

test("buildReport rows carry the ranked identifiers of both ends of the pipeline", () => {
  const report = buildReport();
  for (const row of report.perQuery) {
    assert.equal(row.ranked.lexical.length, 40, row.queryId);
    assert.equal(row.ranked.reranked.length, 40, row.queryId);
    assert.equal(row.canonicalRank, 1, row.queryId);
    assert.ok(row.evidence.span !== null, row.queryId);
  }
});

test("buildReport is JSON serializable", () => {
  const report = buildReport({ threshold: 0.2 });
  const roundTripped = JSON.parse(JSON.stringify(report));
  assert.equal(roundTripped.stages.reranked.ndcgAt10, report.stages.reranked.ndcgAt10);
  assert.equal(roundTripped.perQuery.length, 36);
});

test("buildReport honours an explicit threshold", () => {
  const low = buildReport({ threshold: 0.05 });
  const high = buildReport({ threshold: 0.5 });
  assert.equal(low.abstention.threshold, 0.05);
  assert.equal(high.abstention.threshold, 0.5);
  assert.ok(low.abstention.coverage >= high.abstention.coverage);
});

/**
 * report.test.js - regression and invariant tests over the shared report.
 *
 * The dashboard, the lab, the sweep page and the Python CLI all consume this
 * one projection. If the shape changes here, every one of those consumers
 * changes with it, so these tests pin the contract rather than the arithmetic
 * (which provenance.test.js and the other suites already cover).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "../src/report.js";
import { summarize, runBenchmark, calibrationSweep, recommendThreshold, evaluateAbstention } from "../src/benchmark.js";
import { DEFAULT_ABSTAIN_THRESHOLD } from "../src/ir_engine.js";
import { EVALUATION_SET } from "../src/evaluation_set.js";

const report = buildReport();

const inUnit = (value) => Number.isFinite(value) && value >= 0 && value <= 1;

test("regression: the headline stage metrics are exactly the published numbers", () => {
  assert.deepEqual(report.stages.lexical, { mrr: 1, ndcgAt10: 0.923, recallAt1: 0.5185, recallAt5: 0.8333, recallAt10: 0.8889 });
  assert.deepEqual(report.stages.dense, { mrr: 1, ndcgAt10: 0.9239, recallAt1: 0.5185, recallAt5: 0.838, recallAt10: 0.9306 });
  assert.deepEqual(report.stages.fused, { mrr: 1, ndcgAt10: 0.934, recallAt1: 0.5185, recallAt5: 0.8333, recallAt10: 0.9167 });
  assert.deepEqual(report.stages.reranked, { mrr: 1, ndcgAt10: 0.9344, recallAt1: 0.5185, recallAt5: 0.8472, recallAt10: 0.9167 });
});

test("regression: the abstention summary and the recommended operating point", () => {
  assert.equal(report.abstention.threshold, DEFAULT_ABSTAIN_THRESHOLD);
  assert.equal(report.abstention.ece, 0.7118);
  assert.equal(report.abstention.auroc, 0.9889);
  assert.equal(report.abstention.accuracy, 0.9024);
  assert.equal(report.abstention.coverage, 0.8889);
  assert.equal(report.abstention.falseAnswerRate, 0);
  assert.equal(report.recommendedThreshold.threshold, 0.1);
  assert.equal(report.recommendedThreshold.coverage, 0.8889);
});

test("regression: corpus and evaluation counts", () => {
  assert.equal(report.project, "CiteGraph-IR");
  assert.equal(report.corpus, 40);
  assert.equal(report.evaluationQueries, 41);
  assert.equal(report.answerable, 36);
  assert.equal(report.unanswerable, 5);
  assert.equal(report.queryCount, 36);
  assert.equal(report.perQuery.length, 36);
  assert.equal(report.unanswerableRows.length, 5);
});

test("regression: the calibration sweep has the expected 14 thresholds", () => {
  assert.equal(report.calibrationSweep.length, 14);
  assert.equal(report.calibrationSweep[0].threshold, 0.05);
  assert.equal(report.calibrationSweep[13].threshold, 0.4);
  assert.ok(report.calibrationSweep.every((row) => inUnit(row.coverage)));
  assert.ok(report.calibrationSweep.every((row) => row.auroc === 0.9889));
});

test("regression: the ROC walk starts at the origin and ends at one, one", () => {
  assert.ok(report.roc.length >= 3);
  assert.deepEqual(report.roc[0], [0, 0]);
  assert.deepEqual(report.roc[report.roc.length - 1], [1, 1]);
  for (let i = 1; i < report.roc.length; i += 1) {
    assert.ok(report.roc[i][0] >= report.roc[i - 1][0]);
    assert.ok(report.roc[i][1] >= report.roc[i - 1][1]);
  }
});

test("invariant: every per query row carries a full evidence ledger", () => {
  for (const row of report.perQuery) {
    assert.ok(typeof row.queryId === "string" && row.queryId.length > 0);
    assert.equal(row.answerable, true);
    assert.ok(Array.isArray(row.pool) && row.pool.length > 0);
    assert.ok(row.ranked.lexical.length === 40);
    assert.ok(row.ranked.reranked.length === 40);
    assert.ok(row.recallAt1 >= 0 && row.recallAt1 <= 1);
    assert.ok(inUnit(row.abstentionScore));
    assert.equal(typeof row.decided, "boolean");
    assert.equal(typeof row.correct, "boolean");
    assert.ok(row.evidence && typeof row.evidence.docId === "string");
    assert.ok(row.attribution);
    assert.ok(inUnit(row.attribution.topCoverage));
    assert.ok(inUnit(row.attribution.agreement));
    assert.equal(row.attribution.documents.length, 4);
    for (const doc of row.attribution.documents) {
      assert.ok(inUnit(doc.coverage));
      assert.ok(Array.isArray(doc.uncovered));
      assert.ok(Array.isArray(doc.spans));
      assert.ok(doc.spans.every((span) => inUnit(span.score)));
    }
    assert.match(row.fingerprint.hash, /^[0-9a-f]{8}$/);
    assert.ok(row.fingerprint.termCount > 0);
  }
});

test("invariant: the attribution consensus terms are sorted and appear in at least two ledgers", () => {
  for (const row of report.perQuery) {
    assert.deepEqual(row.attribution.consensusTerms, [...new Set(row.attribution.consensusTerms)].sort());
    for (const term of row.attribution.consensusTerms) {
      // A consensus term is covered by two or more of the four attributed
      // documents, so it can be missing from at most two uncovered lists.
      const coveredBy = row.attribution.documents.filter((doc) => !doc.uncovered.includes(term)).length;
      assert.ok(coveredBy >= 2, `${row.queryId}: ${term} covered by only ${coveredBy}`);
    }
    // Every term missing from the top document is named explicitly.
    assert.ok(Array.isArray(row.attribution.documents[0].uncovered));
  }
});

test("invariant: unanswerable rows are all refused at the default threshold", () => {
  for (const row of report.unanswerableRows) {
    assert.equal(row.decided, false);
    assert.equal(row.correct, true);
    assert.ok(inUnit(row.abstentionScore));
    assert.ok(typeof row.topId === "string");
  }
});

test("invariant: stage movement has three bounded transitions over 36 queries", () => {
  const keys = Object.keys(report.stageMovement.summary);
  assert.deepEqual(keys, ["lexical_to_fused", "fused_to_reranked", "lexical_to_reranked"]);
  assert.equal(report.stageMovement.perQuery.length, 108);
  for (const key of keys) {
    const entry = report.stageMovement.summary[key];
    assert.equal(entry.queryCount, 36);
    assert.ok(inUnit(entry.meanRankAgreement));
    assert.ok(inUnit(entry.topStableFraction));
    assert.ok(entry.meanChangedDocuments >= 0 && entry.meanChangedDocuments <= 40);
    assert.ok(entry.meanMaxClimb >= 0);
    assert.ok(entry.meanMaxDrop <= 0);
  }
  for (const row of report.stageMovement.perQuery) {
    assert.ok(inUnit(row.agreement));
    assert.ok(row.changedCount >= 0 && row.changedCount <= 40);
  }
});

test("invariant: buildReport is deterministic across repeated calls", () => {
  assert.deepEqual(buildReport(), report);
});

test("invariant: the report is JSON serializable with no maps, sets or NaN", () => {
  const text = JSON.stringify(report);
  assert.ok(text.length > 10000);
  assert.equal(text.includes("NaN"), false);
  assert.equal(text.includes("Infinity"), false);
  const parsed = JSON.parse(text);
  assert.equal(parsed.corpus, 40);
  assert.equal(parsed.stageMovement.summary.fused_to_reranked.meanRankAgreement, 0.9844);
});

test("invariant: a custom threshold propagates into the evaluated decision", () => {
  const high = buildReport({ threshold: 0.45 });
  assert.equal(high.abstention.threshold, 0.45);
  assert.equal(high.abstention.coverage, 0);
  assert.equal(high.abstention.falseAnswerRate, 0);
  assert.ok(high.perQuery.every((row) => row.decided === false));
});

test("invariant: a custom sweep grid is honored end to end", () => {
  const custom = buildReport({ thresholds: [0, 0.2, 0.5, 1] });
  assert.deepEqual(custom.calibrationSweep.map((row) => row.threshold), [0, 0.2, 0.5, 1]);
});

test("summarize and buildReport agree on the stage table", () => {
  const summary = summarize(runBenchmark());
  for (const stage of ["lexical", "dense", "fused", "reranked"]) {
    assert.deepEqual(summary.stages[stage], report.stages[stage]);
  }
  assert.deepEqual(summary.abstention, report.abstention);
});

test("calibrationSweep and recommendThreshold agree with the report projection", () => {
  const benchmark = runBenchmark();
  const sweep = calibrationSweep(benchmark.engine);
  const recommended = recommendThreshold(sweep);
  assert.equal(recommended.threshold, report.recommendedThreshold.threshold);
  assert.equal(sweep.length, report.calibrationSweep.length);
  assert.ok(sweep.every((row, i) => row.coverage === report.calibrationSweep[i].coverage));
});

test("evaluateAbstention never returns an out of range score or a non boolean decision", () => {
  const result = evaluateAbstention(runBenchmark().engine);
  assert.equal(result.items.length, EVALUATION_SET.all.length);
  for (const item of result.items) {
    assert.ok(inUnit(item.score));
    assert.equal(typeof item.decided, "boolean");
    assert.equal(typeof item.correct, "boolean");
  }
});

test("every answerable query carries a canonical document at rank one in the re-ranked run", () => {
  for (const row of report.perQuery) {
    assert.equal(row.canonicalRank, 1, `${row.queryId} canonical document is not first`);
    assert.equal(row.ranked.reranked[0], row.canonical);
  }
});

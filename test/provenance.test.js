/**
 * provenance.test.js - evidence attribution, stage movement and fingerprints.
 *
 * Unit tests pin the formulas, invariant tests sweep many inputs checking
 * properties that must always hold, and regression tests lock the exact
 * behaviour of the bundled collection so a later refactor cannot silently
 * change what the dashboard reports.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attributeEvidence,
  attributeRunEvidence,
  compareRuns,
  stageContributions,
  queryFingerprint
} from "../src/provenance.js";
import { buildIndex, contentTokens } from "../src/ir_engine.js";
import { engine, documents, index, bodiesById } from "./helpers/engine.js";
import { buildEngine, runAllStages, runBenchmark, diagnoseStageMovement } from "../src/benchmark.js";
import { EVALUATION_SET } from "../src/evaluation_set.js";

const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;
const runOf = (ids, key = "rank") => ids.map((id, i) => ({ id, rank: i + 1, score: 1 / (i + 1), [key]: i + 1 }));

/* ------------------------------------------------------------------ *
 * attributeEvidence
 * ------------------------------------------------------------------ */

test("attributeEvidence covers every claim term when the body repeats the claim", () => {
  const claim = "bm25 saturation constant k1";
  const body = "The bm25 saturation constant k1 is 1.2. It is the bm25 saturation constant k1 again.";
  const result = attributeEvidence(claim, body, null);
  assert.equal(result.terms.length, contentTokens(claim).length);
  assert.ok(result.terms.every((row) => row.covered));
  assert.equal(result.coverage, 1);
  assert.deepEqual(result.uncovered, []);
});

test("attributeEvidence marks out of vocabulary terms as uncovered with an idf weight of one", () => {
  const result = attributeEvidence("quantum zorblax flux", "Only the quantum word appears here.", null);
  const byTerm = new Map(result.terms.map((row) => [row.term, row]));
  assert.equal(byTerm.get("quantum").covered, true);
  assert.equal(byTerm.get("zorblax").covered, false);
  assert.equal(byTerm.get("flux").covered, false);
  assert.ok(result.terms.every((row) => row.weight === 1));
  assert.deepEqual(result.uncovered.sort(), ["flux", "zorblax"]);
});

test("attributeEvidence uses the idf weight of each term, so a rare term costs more", () => {
  const idf = new Map([["common", 0.1], ["rare", 4]]);
  const full = attributeEvidence("common rare", "The common rare sentence.", idf);
  const missingRare = attributeEvidence("common rare", "Only the common sentence.", idf);
  assert.equal(full.coverage, 1);
  // covered = 0.1 out of 4.1 total weight.
  assert.ok(Math.abs(missingRare.coverage - 0.1 / 4.1) < 1e-12);
  assert.deepEqual(missingRare.uncovered, ["rare"]);
});

test("attributeEvidence returns a zero coverage, empty ledger for an empty claim", () => {
  const result = attributeEvidence("", "Some unrelated body.", index.idf);
  assert.equal(result.coverage, 0);
  assert.deepEqual(result.terms, []);
  assert.deepEqual(result.uncovered, []);
  assert.deepEqual(result.spans, []);
});

test("attributeEvidence handles a non string body without throwing", () => {
  const result = attributeEvidence("bm25", null, index.idf);
  assert.equal(result.sentenceCount, 0);
  assert.equal(result.coverage, 0);
  assert.equal(result.terms[0].covered, false);
});

test("attributeEvidence deduplicates claim terms but keeps first appearance order", () => {
  const result = attributeEvidence("bm25 bm25 saturation", "Nothing relevant.", null);
  assert.deepEqual(result.terms.map((row) => row.term), ["bm25", "saturation"]);
});

test("attributeEvidence spans contribute new terms and respect maxSpans", () => {
  const claim = "alpha beta gamma delta";
  const body = "Alpha beta here. Gamma here. Delta here. Epsilon here.";
  const result = attributeEvidence(claim, body, null, { maxSpans: 2 });
  assert.ok(result.spans.length <= 2);
  assert.ok(result.spans.length >= 1);
  for (const span of result.spans) assert.ok(span.newTerms.length > 0);
  const allNew = result.spans.flatMap((span) => span.newTerms);
  assert.equal(new Set(allNew).size, allNew.length, "a term must not be claimed twice");
});

test("attributeEvidence span scores are clamped to the unit interval", () => {
  const result = attributeEvidence("alpha beta", "Alpha beta. Alpha. Beta.", null);
  for (const span of result.spans) {
    assert.ok(span.score >= 0 && span.score <= 1);
  }
});

test("invariant: coverage is monotone in the sentences supplied", () => {
  const claim = "okapi bm25 saturation constant length normalisation";
  const sentences = [
    "Okapi is a weighting family.",
    "BM25 saturates term frequency.",
    "The saturation constant is k1.",
    "Length normalisation uses b."
  ];
  let previous = -1;
  for (let count = 1; count <= sentences.length; count += 1) {
    const result = attributeEvidence(claim, sentences.slice(0, count).join(" "), index.idf);
    assert.ok(result.coverage >= previous, `coverage fell adding sentence ${count}`);
    assert.ok(result.coverage >= 0 && result.coverage <= 1);
    previous = result.coverage;
  }
  assert.ok(previous > 0);
});

test("invariant: for 40 evaluation claims every attribution is finite and bounded", () => {
  for (const query of EVALUATION_SET.all) {
    const result = attributeEvidence(query.text, bodiesById.get("bm25-okapi"), index.idf);
    assert.ok(Number.isFinite(result.coverage));
    assert.ok(result.coverage >= 0 && result.coverage <= 1);
    assert.ok(result.terms.every((row) => Number.isFinite(row.weight) && row.weight >= 0));
    assert.ok(result.spans.every((span) => span.score >= 0 && span.score <= 1));
  }
});

test("regression: the bm25 saturation question attributes 87.21 percent coverage to its canonical document", () => {
  const query = EVALUATION_SET.answerable.find((q) => q.id === "q-bm25-saturation");
  const result = attributeEvidence(query.text, bodiesById.get("bm25-okapi"), index.idf);
  assert.equal(round(result.coverage), 0.8721);
  assert.deepEqual(result.uncovered, ["used"]);
  assert.equal(result.spans.length, 2);
  assert.deepEqual(result.spans[0].newTerms, ["term", "frequency", "okapi", "bm25"]);
});

/* ------------------------------------------------------------------ *
 * attributeRunEvidence
 * ------------------------------------------------------------------ */

test("attributeRunEvidence reports the best, the second and the consensus terms", () => {
  const run = runOf(["bm25-okapi", "dfr-divergence", "vector-space-tfidf"]);
  const result = attributeRunEvidence(run, "which term frequency saturation constant is used in okapi bm25", bodiesById, index.idf);
  assert.equal(result.perDocument.length, 3);
  assert.equal(result.perDocument[0].docId, "bm25-okapi");
  assert.ok(result.topCoverage >= result.secondCoverage);
  assert.equal(round(result.agreement), round(Math.sqrt(result.topCoverage * result.secondCoverage)));
  assert.ok(result.consensusTerms.includes("bm25"));
});

test("attributeRunEvidence respects topN and returns empty agreement for one document", () => {
  const run = runOf(["bm25-okapi", "dfr-divergence"]);
  const single = attributeRunEvidence(run, "bm25", bodiesById, index.idf, { topN: 1 });
  assert.equal(single.perDocument.length, 1);
  assert.equal(single.secondCoverage, 0);
  assert.equal(single.agreement, 0);
  assert.deepEqual(single.consensusTerms, []);
});

test("attributeRunEvidence tolerates unknown document ids", () => {
  const result = attributeRunEvidence(runOf(["not-in-corpus"]), "bm25", bodiesById, index.idf);
  assert.equal(result.perDocument[0].coverage, 0);
  assert.equal(result.perDocument[0].sentenceCount, 0);
});

test("invariant: the geometric mean agreement lies between the two coverages", () => {
  // sqrt(a * b) is bounded below by min(a, b) and above by max(a, b) for any
  // two nonnegative numbers, so agreement can exceed the second opinion.
  for (const query of EVALUATION_SET.answerable.slice(0, 12)) {
    const run = runAllStages(engine, query.text).reranked;
    const result = attributeRunEvidence(run, query.text, bodiesById, index.idf, { topN: 3 });
    const low = Math.min(result.topCoverage, result.secondCoverage);
    const high = Math.max(result.topCoverage, result.secondCoverage);
    assert.ok(result.agreement >= low - 1e-12);
    assert.ok(result.agreement <= high + 1e-12);
    assert.ok(result.agreement >= 0 && result.agreement <= 1);
    assert.ok(result.consensusTerms.every((term) => (result.supportByTerm.get(term) ?? 0) >= 2));
  }
});

test("regression: consensus terms are sorted and duplicate free over the whole evaluation set", () => {
  for (const query of EVALUATION_SET.answerable) {
    const run = runAllStages(engine, query.text).reranked;
    const result = attributeRunEvidence(run, query.text, bodiesById, index.idf, { topN: 4 });
    assert.deepEqual(result.consensusTerms, [...new Set(result.consensusTerms)].sort());
  }
});

/* ------------------------------------------------------------------ *
 * compareRuns
 * ------------------------------------------------------------------ */

test("compareRuns reports no movement for identical runs", () => {
  const run = runOf(["a", "b", "c"]);
  const result = compareRuns(run, run);
  assert.equal(result.changedCount, 0);
  assert.equal(result.maxClimb, 0);
  assert.equal(result.maxDrop, 0);
  assert.equal(result.spearman, 1);
  assert.deepEqual(result.movers, []);
});

test("compareRuns signs a climb as positive and a drop as negative", () => {
  const before = runOf(["a", "b", "c"]);
  const after = runOf(["c", "a", "b"]);
  const result = compareRuns(before, after);
  assert.equal(result.deltas.get("c").delta, 2);
  assert.equal(result.deltas.get("a").delta, -1);
  assert.equal(result.deltas.get("b").delta, -1);
  assert.equal(result.maxClimb, 2);
  assert.equal(result.maxDrop, -1);
  assert.equal(result.changedCount, 3);
});

test("compareRuns treats a missing document as one rank past the end", () => {
  const result = compareRuns(runOf(["a", "b"]), runOf(["a"]));
  assert.equal(result.deltas.get("b").before, 2);
  assert.equal(result.deltas.get("b").after, 2);
  assert.equal(result.deltas.get("b").delta, 0);
  assert.ok(result.spearman >= 0 && result.spearman <= 1);
});

test("compareRuns sorts movers by absolute displacement, ties by id", () => {
  const before = runOf(["a", "b", "c", "d"]);
  const after = runOf(["d", "c", "b", "a"]);
  const result = compareRuns(before, after);
  const magnitudes = result.movers.map((row) => Math.abs(row.delta));
  assert.deepEqual(magnitudes, [...magnitudes].sort((a, c) => c - a));
});

test("compareRuns returns one for empty or single document runs", () => {
  assert.equal(compareRuns([], []).spearman, 1);
  assert.equal(compareRuns(runOf(["a"]), runOf(["a"])).spearman, 1);
});

test("invariant: footrule agreement is one for identity, below one for a reversal and always in range", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const forward = runOf(ids);
  const reversed = runOf([...ids].reverse());
  assert.equal(compareRuns(forward, forward).spearman, 1);
  assert.ok(compareRuns(forward, reversed).spearman < 0.1);
  for (let seed = 0; seed < 30; seed += 1) {
    const perm = ids.slice();
    let state = seed + 1;
    for (let i = perm.length - 1; i > 0; i -= 1) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      const j = state % (i + 1);
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    const value = compareRuns(forward, runOf(perm)).spearman;
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  }
});

test("invariant: net deltas over a permutation sum to zero", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const result = compareRuns(runOf(ids), runOf(["c", "f", "a", "e", "b", "d"]));
  const sum = [...result.deltas.values()].reduce((acc, row) => acc + row.delta, 0);
  assert.equal(sum, 0);
});

test("stageContributions reports each stage rank and the net movement", () => {
  const runs = {
    lexical: runOf(["a", "b", "c"]),
    dense: runOf(["b", "a", "c"]),
    fused: runOf(["b", "a", "c"]),
    reranked: runOf(["c", "b", "a"])
  };
  const result = stageContributions(runs, "c");
  assert.equal(result.stages.lexical.rank, 3);
  assert.equal(result.stages.reranked.rank, 1);
  assert.equal(result.netDelta, 2);
  assert.equal(stageContributions(runs, "missing").netDelta, null);
});

/* ------------------------------------------------------------------ *
 * queryFingerprint
 * ------------------------------------------------------------------ */

test("queryFingerprint is deterministic and stable under word order", () => {
  const a = queryFingerprint("bm25 term saturation");
  const b = queryFingerprint("bm25 term saturation");
  assert.deepEqual(a, b);
  const reordered = queryFingerprint("saturation term bm25");
  assert.equal(reordered.hash, a.hash);
  assert.deepEqual(reordered, a);
});

test("queryFingerprint changes when any content term changes", () => {
  const base = queryFingerprint("bm25 term saturation");
  assert.notEqual(queryFingerprint("bm25 term frequency").hash, base.hash);
  assert.notEqual(queryFingerprint("bm25 term").hash, base.hash);
});

test("queryFingerprint clamps n and reports consistent gram counts", () => {
  const result = queryFingerprint("graph retrieval", { n: 99 });
  assert.equal(result.gramCount, result.grams.reduce((sum, [, count]) => sum + count, 0));
  assert.equal(result.distinctGrams, result.grams.length);
  assert.equal(result.grams.length, new Set(result.grams.map(([g]) => g)).size);
  assert.match(result.hash, /^[0-9a-f]{8}$/);
});

test("queryFingerprint of an empty query is well formed", () => {
  const result = queryFingerprint("");
  assert.equal(result.termCount, 0);
  assert.equal(result.gramCount, 0);
  assert.match(result.hash, /^[0-9a-f]{8}$/);
});

test("invariant: fingerprints are byte stable over every evaluation query", () => {
  for (const query of EVALUATION_SET.all) {
    assert.deepEqual(queryFingerprint(query.text), queryFingerprint(query.text));
    assert.equal(queryFingerprint(query.text).terms.length, new Set(contentTokens(query.text)).size);
  }
});

/* ------------------------------------------------------------------ *
 * diagnoseStageMovement
 * ------------------------------------------------------------------ */

test("diagnoseStageMovement covers three transitions and 36 queries each", () => {
  const report = runBenchmark();
  const diagnosis = diagnoseStageMovement(report);
  assert.equal(Object.keys(diagnosis.summary).length, 3);
  for (const key of ["lexical_to_fused", "fused_to_reranked", "lexical_to_reranked"]) {
    assert.equal(diagnosis.summary[key].queryCount, 36);
    assert.ok(diagnosis.summary[key].meanRankAgreement >= 0 && diagnosis.summary[key].meanRankAgreement <= 1);
    assert.ok(diagnosis.summary[key].meanChangedDocuments >= 0);
  }
  assert.equal(diagnosis.perQuery.length, 108);
});

test("regression: fusion moves far more documents than citation re-ranking", () => {
  const diagnosis = diagnoseStageMovement(runBenchmark());
  const fusion = diagnosis.summary.lexical_to_fused;
  const rerank = diagnosis.summary.fused_to_reranked;
  assert.ok(fusion.meanChangedDocuments > rerank.meanChangedDocuments);
  assert.ok(rerank.meanRankAgreement > fusion.meanRankAgreement);
  assert.equal(rerank.topStableFraction, 1);
});

test("regression: the exact aggregate movement numbers of the bundled run", () => {
  const diagnosis = diagnoseStageMovement(runBenchmark());
  assert.equal(diagnosis.summary.lexical_to_fused.meanChangedDocuments, 34.64);
  assert.equal(diagnosis.summary.lexical_to_fused.meanRankAgreement, 0.7814);
  assert.equal(diagnosis.summary.fused_to_reranked.meanChangedDocuments, 9.61);
  assert.equal(diagnosis.summary.fused_to_reranked.meanRankAgreement, 0.9844);
  assert.equal(diagnosis.summary.lexical_to_reranked.meanRankAgreement, 0.7803);
});

test("diagnoseStageMovement respects custom transitions and tolerates missing stages", () => {
  const report = runBenchmark();
  const diagnosis = diagnoseStageMovement(report, { transitions: [["dense", "reranked"]] });
  assert.deepEqual(Object.keys(diagnosis.summary), ["dense_to_reranked"]);
  assert.equal(diagnosis.perQuery.length, 36);
  const empty = diagnoseStageMovement({ stages: {} });
  assert.equal(empty.summary.lexical_to_fused.queryCount, 0);
  assert.equal(empty.summary.lexical_to_fused.meanChangedDocuments, 0);
});

test("invariant: a rebuilt engine produces byte identical movement numbers", () => {
  const a = diagnoseStageMovement(runBenchmark());
  const b = diagnoseStageMovement(runBenchmark(buildEngine()));
  assert.deepEqual(a, b);
});

test("buildIndex rejects a negative k1 and an out of range b", () => {
  assert.throws(() => buildIndex(documents, { k1: -1 }), RangeError);
  assert.throws(() => buildIndex(documents, { b: 1.5 }), RangeError);
  assert.doesNotThrow(() => buildIndex(documents, { k1: 0, b: 0 }));
});

/**
 * adversarial.test.js - regression coverage for the hostile review findings:
 * invalid inputs must be rejected or fail closed, degenerate configurations
 * must not silently distort the metrics, and exported surfaces must agree
 * with each other.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildIndex,
  buildCitationGraph,
  personalizedPageRank,
  expectedCalibrationError,
  ndcgAtK,
  charNGrams,
  splitSentences,
  faithfulness
} from "../src/ir_engine.js";
import { queryFingerprint, compareRuns } from "../src/provenance.js";
import { runQuery, queryMetrics, buildEngine } from "../src/benchmark.js";
import { ANSWERABLE } from "../src/evaluation_set.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "cli", "eval_ir.py");

const runCli = (args) =>
  spawnSync("python3", [CLI, ...args], { encoding: "utf8" });

/* ------------------------------------------------------------------ *
 * Calibration
 * ------------------------------------------------------------------ */

test("expectedCalibrationError ignores invalid items in the denominator", () => {
  const ece = expectedCalibrationError([
    { score: 0.9, answerable: true },
    { score: 0.9, answerable: true },
    { score: 2.5, answerable: false },
    { score: NaN, answerable: true }
  ]);
  // Only the two valid items count: one bin with a 0.1 accuracy gap.
  assert.ok(Math.abs(ece - 0.1) < 1e-12, `ECE ${ece} should be 0.1`);
});

test("expectedCalibrationError tolerates degenerate bin counts", () => {
  const items = [{ score: 0.5, answerable: true }];
  assert.doesNotThrow(() => expectedCalibrationError(items, Infinity));
  assert.doesNotThrow(() => expectedCalibrationError(items, "abc"));
  assert.doesNotThrow(() => expectedCalibrationError(items, -3));
  assert.equal(expectedCalibrationError(items, 1e400) >= 0, true);
});

/* ------------------------------------------------------------------ *
 * Citation graph
 * ------------------------------------------------------------------ */

test("duplicate reference entries count as one citation edge", () => {
  const docs = [
    { id: "a", title: "", body: "alpha", refs: ["b", "b", "b"] },
    { id: "b", title: "", body: "beta", refs: [] }
  ];
  const graph = buildCitationGraph(buildIndex(docs));
  assert.equal(graph.outLinks.get("a").length, 1);
  assert.equal(graph.inLinks.get("b").length, 1);
});

test("personalizedPageRank rejects negative or non-finite seed mass", () => {
  const graph = {
    ids: new Set(["a", "b"]),
    outLinks: new Map([["a", []], ["b", []]]),
    inLinks: new Map([["a", []], ["b", []]]),
    docCount: 2
  };
  assert.throws(() => personalizedPageRank(graph, { a: -10, b: 11 }), RangeError);
  assert.throws(() => personalizedPageRank(graph, { a: NaN, b: 1 }), RangeError);
  assert.throws(() => personalizedPageRank(graph, { a: 0.5, b: -0.4 }), RangeError);
  const rank = personalizedPageRank(graph, { a: 0.5, b: 0.5 });
  for (const value of rank.values()) assert.ok(value >= 0 && value <= 1);
});

/* ------------------------------------------------------------------ *
 * Metrics edges
 * ------------------------------------------------------------------ */

test("ndcgAtK returns zero for a zero or negative cutoff", () => {
  assert.equal(ndcgAtK([2, 1, 0], 0), 0);
  assert.equal(ndcgAtK([2, 1, 0], -3), 0);
  assert.equal(ndcgAtK([2, 1, 0], NaN), 0);
  // A fractional cutoff floors to whole positions rather than rounding up.
  assert.equal(ndcgAtK([0, 0, 2], 2.5), 0);
});

test("charNGrams clamps n to [2, 4] including zero and non-finite inputs", () => {
  assert.deepEqual(charNGrams("ab", 0), ["#a", "ab", "b#"]);
  assert.deepEqual(charNGrams("abc", 2.9), charNGrams("abc", 2));
  assert.deepEqual(charNGrams("abc", NaN), charNGrams("abc", 3));
  assert.deepEqual(charNGrams("abc", 99), charNGrams("abc", 4));
});

/* ------------------------------------------------------------------ *
 * Sentence splitting and faithfulness
 * ------------------------------------------------------------------ */

test("splitSentences keeps common abbreviations inside their sentence", () => {
  assert.deepEqual(splitSentences("Smith et al. showed the result. It works."), [
    "Smith et al. showed the result.",
    "It works."
  ]);
  assert.deepEqual(splitSentences("The U.S. policy changed. It stayed."), [
    "The U.S. policy changed.",
    "It stayed."
  ]);
});

test("faithfulness reports no span when nothing matches", () => {
  const verdict = faithfulness("zebra", "apple banana.");
  assert.equal(verdict.score, 0);
  assert.equal(verdict.span, null);
});

/* ------------------------------------------------------------------ *
 * Run comparison
 * ------------------------------------------------------------------ */

test("compareRuns reports zero agreement for runs over disjoint id sets", () => {
  const cmp = compareRuns(
    [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    [{ id: "w" }, { id: "x" }, { id: "y" }, { id: "z" }]
  );
  assert.equal(cmp.spearman, 0);
  const reversed = compareRuns(
    [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    [{ id: "d" }, { id: "c" }, { id: "b" }, { id: "a" }]
  );
  assert.equal(reversed.spearman, 0);
});

/* ------------------------------------------------------------------ *
 * Cross-surface consistency
 * ------------------------------------------------------------------ */

test("queryFingerprint is identical for reordered terms", () => {
  assert.equal(
    queryFingerprint("pagerank damping factor").hash,
    queryFingerprint("damping factor pagerank").hash
  );
});

test("canonicalRank is one based and agrees across metrics and report surfaces", () => {
  const engine = buildEngine();
  const query = ANSWERABLE[0];
  const ids = runQuery(engine, query.text, "reranked").map((row) => row.id);
  const metrics = queryMetrics(query, ids);
  assert.equal(metrics.canonicalRank, ids.indexOf(query.relevant[0]) + 1);
  assert.equal(typeof metrics.canonicalRank, "number");
});

/* ------------------------------------------------------------------ *
 * CLI validation
 * ------------------------------------------------------------------ */

test("the CLI rejects an unknown stage instead of crashing", () => {
  const result = runCli(["--stage", "bogus"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /invalid choice/);
});

test("the CLI rejects a non-finite or out of range threshold", () => {
  for (const bad of ["nan", "inf", "-5", "2"]) {
    const result = runCli(["--threshold", bad]);
    assert.equal(result.status, 2, `threshold ${bad}`);
    assert.match(result.stderr, /--threshold must be a finite number/);
  }
});

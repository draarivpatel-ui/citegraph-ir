/**
 * deep_regression.test.js - boundary regressions found by auditing the public
 * engine contracts, the cascade audit semantics and the interactive graph.
 * Each test names the contract that the implementation must keep even when a
 * caller supplies degenerate, duplicated, malformed or reordered input.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildIndex,
  reciprocalRankFusion,
  idfWeight,
  recallAtK,
  expectedCalibrationError,
  rocPoints
} from "../src/ir_engine.js";
import { buildEngine, recommendThreshold } from "../src/benchmark.js";
import {
  graphFromRefs,
  auditSpecifications,
  runAudit
} from "../src/cascade_lab.js";
import { decodeCascadeState } from "../src/url_hash.js";
import { repoRoot } from "./helpers/dom.js";

/* ------------------------------------------------------------------ *
 * Numeric input validation and metric boundaries
 * ------------------------------------------------------------------ */

test("buildIndex rejects a non-finite k1 instead of poisoning every score", () => {
  const docs = [{ id: "a", title: "", body: "alpha", refs: [] }];
  assert.throws(() => buildIndex(docs, { k1: Infinity }), RangeError);
  assert.throws(() => buildIndex(docs, { k1: NaN }), RangeError);
});

test("reciprocalRankFusion rejects a non-finite k instead of flattening every score", () => {
  const run = [{ id: "a", score: 1, rank: 1 }];
  assert.throws(() => reciprocalRankFusion([run], { k: Infinity }), RangeError);
  assert.throws(() => reciprocalRankFusion([run], { k: NaN }), RangeError);
});

test("idfWeight is floored at zero when document frequency exceeds the collection size", () => {
  assert.equal(idfWeight(8, 4), 0);
  assert.equal(idfWeight(4, 4), 0);
  assert.ok(idfWeight(2, 4) > 0);
});

test("recallAtK treats a relevance pool as a set even when it contains duplicates", () => {
  // The distinct pool is {a, b}; retrieving a alone is one half, not two thirds.
  assert.equal(recallAtK(["a", "a", "b"], ["a"], 1), 0.5);
  assert.equal(recallAtK(["a", "a", "b"], ["a", "b"], 2), 1);
});

test("expectedCalibrationError ignores null entries it cannot bin", () => {
  const value = expectedCalibrationError([
    null,
    undefined,
    { score: 0.5, answerable: true },
    { score: 0.5, answerable: true }
  ], 10);
  assert.ok(Number.isFinite(value));
  assert.ok(Math.abs(value - 0.5) < 1e-12);
});

test("rocPoints ignores unscored items instead of corrupting the positive and negative counts", () => {
  const points = rocPoints([
    { score: NaN, answerable: true },
    null,
    { score: 0.4, answerable: false },
    { score: 0.8, answerable: true }
  ]);
  assert.deepEqual(points, [[0, 0], [0, 1], [1, 1], [1, 1]]);
});

/* ------------------------------------------------------------------ *
 * Operating point and cascade audit semantics
 * ------------------------------------------------------------------ */

test("recommendThreshold breaks equal coverage ties toward the lower threshold regardless of row order", () => {
  const rows = [
    { threshold: 0.3, coverage: 0.8, falseAnswerRate: 0 },
    { threshold: 0.1, coverage: 0.8, falseAnswerRate: 0 },
    { threshold: 0.2, coverage: 0.7, falseAnswerRate: 0 }
  ];
  assert.equal(recommendThreshold(rows).threshold, 0.1);
});

test("runAudit counts claims collapsed by the stricter chain requirement against the intact baseline", () => {
  const engine = buildEngine();
  const specs = auditSpecifications(engine.graph);
  const baseline = runAudit(engine.graph, specs.find((s) => s.id === "baseline"));
  const strict = runAudit(engine.graph, specs.find((s) => s.id === "require-two"));
  assert.equal(strict.collapsed, baseline.supported - strict.supported);
  assert.ok(strict.collapsed > 0);
});

test("runAudit compares removal audits against the same intact one-chain baseline", () => {
  const graph = graphFromRefs({ c: ["x"], x: ["t"], t: [] });
  const row = runAudit(graph, { id: "x", label: "x", removed: ["x"], minChains: 2 });
  assert.equal(row.collapsed, 1);
});

/* ------------------------------------------------------------------ *
 * Bookmark decoding strictness
 * ------------------------------------------------------------------ */

test("decodeCascadeState rejects overlong malformed UTF-8 instead of decoding it as valid text", () => {
  // 0xc1 0xb1 is an overlong encoding of ASCII q. It is malformed UTF-8 even
  // though a loose decoder can turn it back into a printable character.
  const prefix = Buffer.from('{"v":1,"r":["', "utf8");
  const suffix = Buffer.from('"],"m":1}', "utf8");
  const bytes = Buffer.concat([prefix, Buffer.from([0xc1, 0xb1]), suffix]);
  const forged = `#cg=${bytes.toString("base64url")}`;
  assert.equal(decodeCascadeState(forged, new Set(["q"])), null);
});

/* ------------------------------------------------------------------ *
 * Interactive accessibility and state consistency
 * ------------------------------------------------------------------ */

test("the interactive support graph is not exposed as a single presentational image", () => {
  const source = fs.readFileSync(path.join(repoRoot, "cascade", "index.html"), "utf8");
  const tag = source.match(/<svg class="graph"[^>]+>/)?.[0] ?? "";
  assert.doesNotMatch(tag, /role="img"/);
  assert.match(tag, /role="group"/);
});

test("the min chains control exposes every bookmarkable chain requirement from one through eight", () => {
  const source = fs.readFileSync(path.join(repoRoot, "cascade", "index.html"), "utf8");
  const select = source.match(/<select id="min-chains">([\s\S]*?)<\/select>/)?.[1] ?? "";
  for (let value = 1; value <= 8; value += 1) {
    assert.match(select, new RegExp(`<option value="${value}"[ >]`), `missing option ${value}`);
  }
});

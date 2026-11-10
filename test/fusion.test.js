/**
 * fusion.test.js - reciprocal rank fusion.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { reciprocalRankFusion } from "../src/ir_engine.js";

const runA = [
  { id: "a", score: 10, rank: 1 },
  { id: "b", score: 8, rank: 2 },
  { id: "c", score: 6, rank: 3 }
];

const runB = [
  { id: "c", score: 5, rank: 1 },
  { id: "d", score: 4, rank: 2 },
  { id: "a", score: 3, rank: 3 }
];

test("fusion returns every document of every run exactly once", () => {
  const fused = reciprocalRankFusion([runA, runB]);
  assert.equal(fused.length, 4);
  assert.equal(new Set(fused.map((r) => r.id)).size, 4);
});

test("fusion of one run is that run re-ranked by the damping formula", () => {
  const fused = reciprocalRankFusion([runA]);
  assert.deepEqual(fused.map((r) => r.id), ["a", "b", "c"]);
  assert.ok(Math.abs(fused[0].score - 1 / 61) < 1e-12);
  assert.ok(Math.abs(fused[1].score - 1 / 62) < 1e-12);
});

test("fusion of opposing runs gives both leaders the same score", () => {
  // a is first in A and third in B, c is third in A and first in B. Both sums
  // are 1/61 + 1/63, so the two leaders tie and the id tie break orders them.
  const fused = reciprocalRankFusion([runA, runB]);
  const topTwo = fused.slice(0, 2).map((r) => r.id);
  assert.deepEqual(topTwo, ["a", "c"]);
  assert.ok(Math.abs(fused[0].score - fused[1].score) < 1e-12);
  // Both still outrank the documents that appear in only one run.
  assert.ok(fused[0].score > fused[2].score);
  assert.ok(fused[1].score > fused[3].score);
});

test("fusion adds the reciprocal ranks of every run", () => {
  const fused = reciprocalRankFusion([runA, runB]);
  const byId = new Map(fused.map((r) => [r.id, r.score]));
  assert.ok(Math.abs(byId.get("a") - (1 / 61 + 1 / 63)) < 1e-12);
  assert.ok(Math.abs(byId.get("b") - 1 / 62) < 1e-12);
  assert.ok(Math.abs(byId.get("c") - (1 / 63 + 1 / 61)) < 1e-12);
  assert.ok(Math.abs(byId.get("d") - 1 / 62) < 1e-12);
});

test("fusion ranks are one based and contiguous", () => {
  const fused = reciprocalRankFusion([runA, runB, runB]);
  for (let i = 0; i < fused.length; i += 1) {
    assert.equal(fused[i].rank, i + 1);
  }
});

test("fusion is sorted by descending score", () => {
  const fused = reciprocalRankFusion([runA, runB]);
  for (let i = 1; i < fused.length; i += 1) {
    assert.ok(fused[i - 1].score >= fused[i].score);
  }
});

test("fusion ignores the input score scale, only ranks matter", () => {
  const scaled = runA.map((r) => ({ ...r, score: r.score * 1e6 }));
  const small = runA.map((r) => ({ ...r, score: r.score / 1e6 }));
  const a = reciprocalRankFusion([scaled, runB]);
  const b = reciprocalRankFusion([small, runB]);
  assert.deepEqual(a.map((r) => r.id), b.map((r) => r.id));
  assert.ok(Math.abs(a[0].score - b[0].score) < 1e-12);
});

test("a smaller k widens the gap between a leader and the field", () => {
  // Both leaders tie under either k, so compare the leader band against the
  // single-run documents, whose gap grows as k shrinks.
  const gapAt = (k) => {
    const fused = reciprocalRankFusion([runA, runB], { k });
    return fused[0].score - fused[fused.length - 1].score;
  };
  assert.ok(gapAt(1) > gapAt(60));
  assert.ok(gapAt(60) > gapAt(600));
});

test("k of zero gives weight one over rank", () => {
  const fused = reciprocalRankFusion([runA], { k: 0 });
  assert.ok(Math.abs(fused[0].score - 1) < 1e-12);
  assert.ok(Math.abs(fused[1].score - 0.5) < 1e-12);
  assert.ok(Math.abs(fused[2].score - 1 / 3) < 1e-12);
});

test("fusion rejects a negative k", () => {
  assert.throws(() => reciprocalRankFusion([runA], { k: -1 }), RangeError);
});

test("a larger k compresses the score band without changing order", () => {
  const k60 = reciprocalRankFusion([runA, runB], { k: 60 });
  const k600 = reciprocalRankFusion([runA, runB], { k: 600 });
  assert.deepEqual(k60.map((r) => r.id), k600.map((r) => r.id));
  const band60 = k60[0].score - k60[k60.length - 1].score;
  const band600 = k600[0].score - k600[k600.length - 1].score;
  assert.ok(band600 < band60);
});

test("deterministic tie breaking by id", () => {
  const left = [
    { id: "aaa", score: 1, rank: 1 },
    { id: "zzz", score: 2, rank: 1 }
  ];
  const fused = reciprocalRankFusion([left]);
  assert.deepEqual(fused.map((r) => r.id), ["aaa", "zzz"]);
  assert.equal(fused[0].rank, 1);
  assert.equal(fused[1].rank, 2);
});

test("a run that never appears in any input never appears in the output", () => {
  const fused = reciprocalRankFusion([runA]);
  assert.ok(!fused.some((r) => r.id === "d"));
});

test("fusing three runs counts every appearance", () => {
  const r1 = [{ id: "x", score: 1, rank: 1 }];
  const r2 = [{ id: "y", score: 1, rank: 1 }];
  const r3 = [{ id: "x", score: 1, rank: 1 }];
  const fused = reciprocalRankFusion([r1, r2, r3]);
  assert.deepEqual(fused.map((r) => r.id), ["x", "y"]);
  assert.ok(Math.abs(fused[0].score - 2 / 61) < 1e-12);
  assert.ok(Math.abs(fused[1].score - 1 / 61) < 1e-12);
});

test("fusion is stable: repeating a run moves its documents ahead", () => {
  const base = reciprocalRankFusion([runA, runB]);
  const twice = reciprocalRankFusion([runA, runB, runB]);
  const rankOf = (run, id) => run.find((r) => r.id === id).rank;
  assert.ok(rankOf(twice, "d") < rankOf(base, "d"));
});

test("fusion of an empty run list is empty", () => {
  assert.deepEqual(reciprocalRankFusion([]), []);
});

test("two runs in opposite order cancel out on score but keep both documents", () => {
  const up = [
    { id: "p", rank: 1, score: 1 },
    { id: "q", rank: 2, score: 0 }
  ];
  const down = [
    { id: "q", rank: 1, score: 1 },
    { id: "p", rank: 2, score: 0 }
  ];
  const fused = reciprocalRankFusion([up, down]);
  assert.equal(fused.length, 2);
  assert.ok(Math.abs(fused[0].score - fused[1].score) < 1e-12);
  assert.deepEqual(fused.map((r) => r.id), ["p", "q"]);
});

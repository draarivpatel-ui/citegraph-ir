/**
 * metrics.test.js - reciprocal rank, recall and discounted cumulative gain.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { reciprocalRank, recallAtK, reciprocalRankOfDoc, ndcgAtK, winsorize } from "../src/ir_engine.js";

test("reciprocalRank of a first rank hit is one", () => {
  assert.equal(reciprocalRank({ relevant: ["a"] }, ["a", "b", "c"], ["a"]), 1);
});

test("reciprocalRank decays as one over the rank", () => {
  assert.equal(reciprocalRank({}, ["x", "a", "y"], ["a"]), 0.5);
  assert.equal(reciprocalRank({}, ["x", "y", "a"], ["a"]), 1 / 3);
  assert.equal(reciprocalRank({}, ["x", "y", "z", "a"], ["a"]), 0.25);
});

test("reciprocalRank of a miss is zero", () => {
  assert.equal(reciprocalRank({}, ["x", "y", "z"], ["a", "b"]), 0);
  assert.equal(reciprocalRank({}, [], ["a"]), 0);
});

test("reciprocalRank of a pool hit anywhere counts, regardless of pool order", () => {
  // b appears before a, so b is the first hit even though a is listed first.
  assert.equal(reciprocalRank({}, ["b", "a"], ["a", "b"]), 1);
  assert.equal(reciprocalRank({}, ["c", "b", "a"], ["a", "b"]), 0.5);
});

test("reciprocalRank deduplicates the pool internally", () => {
  assert.equal(reciprocalRank({}, ["a"], ["a", "a", "a"]), 1);
});

test("recallAtK is the fraction of the pool in the top k", () => {
  assert.equal(recallAtK(["a", "b"], ["a", "b"], 5), 1);
  assert.equal(recallAtK(["a", "b", "c", "d"], ["a"], 1), 0.25);
  assert.equal(recallAtK(["a", "b", "c", "d"], ["a", "b"], 2), 0.5);
});

test("recallAtK at k of zero is zero unless the pool is empty", () => {
  assert.equal(recallAtK(["a"], ["a"], 0), 0);
});

test("recallAtK of an empty pool is null, not zero", () => {
  assert.equal(recallAtK([], ["a", "b"], 5), null);
});

test("recallAtK is one when every pool member ranks inside the top k", () => {
  const ids = ["p", "q", "r", "s", "t"];
  assert.equal(recallAtK(ids, ids, 5), 1);
});

test("recallAtK ignores hits beyond the cutoff", () => {
  assert.equal(recallAtK(["a", "z"], ["q", "a", "z"], 2), 0.5);
});

test("recallAtK is monotone nondecreasing in k", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  let previous = -1;
  for (let k = 1; k <= 6; k += 1) {
    const value = recallAtK(ids, ["c", "a", "f", "b", "e", "d"], k);
    assert.ok(value >= previous);
    previous = value;
  }
  assert.equal(previous, 1);
});

test("reciprocalRankOfDoc is one over the one based position", () => {
  assert.equal(reciprocalRankOfDoc(["a", "b", "c"], "a"), 1);
  assert.equal(reciprocalRankOfDoc(["a", "b", "c"], "b"), 0.5);
  assert.equal(reciprocalRankOfDoc(["a", "b", "c"], "c"), 1 / 3);
});

test("reciprocalRankOfDoc of a missing document is zero", () => {
  assert.equal(reciprocalRankOfDoc(["a", "b"], "z"), 0);
  assert.equal(reciprocalRankOfDoc([], "a"), 0);
});

test("reciprocalRankOfDoc uses the first occurrence", () => {
  assert.equal(reciprocalRankOfDoc(["a", "b", "a"], "a"), 1);
});

test("ndcgAtK of a perfect ranking is one", () => {
  assert.ok(Math.abs(ndcgAtK([3, 3, 2, 1, 0], 5) - 1) < 1e-12);
});

test("ndcgAtK of an all zero labeling is zero", () => {
  assert.equal(ndcgAtK([0, 0, 0], 10), 0);
  assert.equal(ndcgAtK([], 10), 0);
});

test("ndcgAtK of an empty label list is zero", () => {
  assert.equal(ndcgAtK([], 5), 0);
});

test("ndcgAtK penalises a relevant document pushed down the ranking", () => {
  const top = ndcgAtK([3, 0, 0], 3);
  const middle = ndcgAtK([0, 3, 0], 3);
  const bottom = ndcgAtK([0, 0, 3], 3);
  assert.ok(top > middle);
  assert.ok(middle > bottom);
  assert.ok(bottom > 0);
});

test("ndcgAtK rewards a graded ordering of equal top hits", () => {
  // The ideal ranking sorts the labels, so a graded list placed in its own
  // ideal order is one, while a permuted list is below one.
  assert.ok(Math.abs(ndcgAtK([3, 2, 1], 3) - 1) < 1e-12);
  assert.ok(ndcgAtK([1, 2, 3], 3) < 1);
  assert.ok(ndcgAtK([1, 2, 3], 3) > 0);
});

test("ndcgAtK saturates the first position for any single relevant document", () => {
  // With exactly one relevant document, its ideal position is rank one, so any
  // level 3 or level 1 at the top gives a score of one.
  assert.ok(Math.abs(ndcgAtK([1, 0], 2) - 1) < 1e-12);
  assert.ok(Math.abs(ndcgAtK([3, 0], 2) - 1) < 1e-12);
  assert.ok(Math.abs(ndcgAtK([3, 2], 2) - 1) < 1e-12);
});

test("ndcgAtK of a graded ranking matches the closed form", () => {
  // levels 3 then 0: dcg is 7/1 and idcg is 7/1, so one.
  assert.ok(Math.abs(ndcgAtK([3, 0, 0], 3) - 1) < 1e-12);
  // levels 3 then 3 then 0: ideal is 3,3,0, so one.
  assert.ok(Math.abs(ndcgAtK([3, 3, 0], 3) - 1) < 1e-12);
  // levels 0 then 3: ideal is 3,0, so dcg is 7/log2(3) over 7/1.
  const expected = (7 / Math.log2(3)) / (7 / 1);
  assert.ok(Math.abs(ndcgAtK([0, 3], 2) - expected) < 1e-12);
});

test("ndcgAtK stops at the cutoff", () => {
  const short = ndcgAtK([3, 0, 0, 0], 2);
  const withExtraZeros = ndcgAtK([3, 0, 0, 0, 0, 0], 2);
  assert.equal(short, withExtraZeros);
});

test("ndcgAtK clamps a cutoff below one up to one", () => {
  const clamped = ndcgAtK([3, 2], 0);
  const one = ndcgAtK([3, 2], 1);
  assert.equal(clamped, one);
  assert.ok(Math.abs(one - 1) < 1e-12);
});

test("ndcgAtK stops at the label list end for a cutoff past it", () => {
  const two = ndcgAtK([3, 2], 10);
  const atEnd = ndcgAtK([3, 2], 2);
  assert.equal(two, atEnd);
});

test("ndcgAtK is invariant to which equal level comes first", () => {
  assert.ok(Math.abs(ndcgAtK([2, 2, 0], 3) - ndcgAtK([2, 2, 0], 3)) < 1e-12);
  // Permuting equal levels keeps the ideal ordering unchanged, but discounts
  // move the gain, so the permuted list scores below the ideal order.
  assert.ok(ndcgAtK([2, 0, 2], 3) < ndcgAtK([2, 2, 0], 3));
});

test("winsorize clips to the given range", () => {
  assert.deepEqual(winsorize([-2, -0.5, 0, 0.5, 1, 2], 0, 1), [0, 0, 0, 0.5, 1, 1]);
});

test("winsorize defaults to the unit interval", () => {
  assert.deepEqual(winsorize([-1, 0.25, 4]), [0, 0.25, 1]);
});

test("winsorize honours a custom range", () => {
  assert.deepEqual(winsorize([-1, 0, 5, 10], 1, 4), [1, 1, 4, 4]);
});

test("winsorize returns a new array, leaving the input alone", () => {
  const input = [-1, 0.5, 2];
  const out = winsorize(input);
  assert.deepEqual(input, [-1, 0.5, 2]);
  assert.notEqual(out, input);
});

test("winsorize of an empty array is empty", () => {
  assert.deepEqual(winsorize([], 0, 1), []);
});

test("winsorize handles a single value", () => {
  assert.deepEqual(winsorize([7]), [1]);
  assert.deepEqual(winsorize([-7]), [0]);
  assert.deepEqual(winsorize([0.3]), [0.3]);
});

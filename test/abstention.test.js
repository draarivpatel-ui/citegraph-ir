/**
 * abstention.test.js - out-of-distribution abstention and calibration.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abstentionScore,
  oovRatio,
  shouldAnswer,
  topConfidence,
  expectedCalibrationError,
  areaUnderRoc,
  rocPoints,
  auroc,
  DEFAULT_ABSTAIN_THRESHOLD
} from "../src/ir_engine.js";
import { engine as shared, bodiesById as bodies } from "./helpers/engine.js";

const engine = shared;
const signals = { idf: engine.index.idf, docFrequency: engine.index.docFrequency };

test("oovRatio is zero when every claim term is in the collection", () => {
  assert.equal(oovRatio("bm25 okapi relevance", engine.index.docFrequency), 0);
});

test("oovRatio is one when no claim term is in the collection", () => {
  assert.equal(oovRatio("zzzqqq wwwvvv", engine.index.docFrequency), 1);
});

test("oovRatio is the fraction of distinct terms that are unseen", () => {
  const df = new Map([
    ["bm25", 4],
    ["okapi", 2]
  ]);
  // contentTokens drops stop words, so "the" and "a" never reach the count.
  assert.equal(oovRatio("bm25 okapi hopscotch", df), 1 / 3);
});

test("oovRatio counts distinct terms, not occurrences", () => {
  const df = new Map([["bm25", 4]]);
  assert.equal(oovRatio("bm25 bm25 bm25 hopscotch", df), 0.5);
});

test("oovRatio of an empty claim is zero", () => {
  assert.equal(oovRatio("", engine.index.docFrequency), 0);
  assert.equal(oovRatio("the of and", engine.index.docFrequency), 0);
});

test("oovRatio is zero for stop words only, since they have no content term", () => {
  assert.equal(oovRatio("the a an", engine.index.docFrequency), 0);
});

test("oovRatio lies within the unit interval", () => {
  for (const claim of ["bm25 relevance ranking", "hopping springs and soil", "graph"]) {
    const value = oovRatio(claim, engine.index.docFrequency);
    assert.ok(value >= 0);
    assert.ok(value <= 1);
  }
});

test("topConfidence of a single document run is one", () => {
  assert.equal(topConfidence([{ id: "a", score: 1, rank: 1 }]), 1);
});

test("topConfidence of a flat run is zero", () => {
  const flat = [
    { id: "a", score: 1, rank: 1 },
    { id: "b", score: 1, rank: 2 },
    { id: "c", score: 1, rank: 3 }
  ];
  assert.equal(topConfidence(flat), 0);
});

test("topConfidence lies within the unit interval", () => {
  const run = [
    { id: "a", score: 0.05, rank: 1 },
    { id: "b", score: 0.03, rank: 2 },
    { id: "c", score: 0.02, rank: 3 },
    { id: "d", score: 0.01, rank: 4 }
  ];
  const value = topConfidence(run);
  assert.ok(value >= 0);
  assert.ok(value <= 1);
});

test("topConfidence grows as the leader pulls away", () => {
  const close = [
    { id: "a", score: 0.05, rank: 1 },
    { id: "b", score: 0.0499, rank: 2 },
    { id: "c", score: 0.0498, rank: 3 }
  ];
  const clear = [
    { id: "a", score: 0.05, rank: 1 },
    { id: "b", score: 0.001, rank: 2 },
    { id: "c", score: 0.001, rank: 3 }
  ];
  assert.ok(topConfidence(clear) > topConfidence(close));
});

test("abstentionScore of an empty run is zero", () => {
  assert.equal(abstentionScore([], "bm25 relevance", bodies, signals), 0);
});

test("abstentionScore lies within the unit interval", () => {
  const run = [
    { id: "bm25-okapi", score: 0.03, rank: 1 },
    { id: "vector-space-tfidf", score: 0.02, rank: 2 },
    { id: "dfr-divergence", score: 0.01, rank: 3 }
  ];
  for (const claim of ["bm25 okapi relevance", "zzz foreign jargon qqq"]) {
    const value = abstentionScore(run, claim, bodies, signals);
    assert.ok(value >= 0, String(value));
    assert.ok(value <= 1, String(value));
  }
});

test("an answerable claim scores above a foreign one", () => {
  const run = [
    { id: "bm25-okapi", score: 0.03, rank: 1 },
    { id: "vector-space-tfidf", score: 0.02, rank: 2 },
    { id: "dfr-divergence", score: 0.01, rank: 3 }
  ];
  const answerable = abstentionScore(run, "bm25 okapi probabilistic relevance", bodies, signals);
  const foreign = abstentionScore(run, "hopscotch nursery transit schedule", bodies, signals);
  assert.ok(answerable > foreign, `${answerable} vs ${foreign}`);
});

test("abstentionScore accepts a bodiesById plain object", () => {
  const plain = { "bm25-okapi": bodies.get("bm25-okapi") };
  const fromMap = abstentionScore(
    [{ id: "bm25-okapi", score: 0.03, rank: 1 }],
    "bm25",
    new Map([["bm25-okapi", plain["bm25-okapi"]]]),
    signals
  );
  const fromObject = abstentionScore([{ id: "bm25-okapi", score: 0.03, rank: 1 }], "bm25", plain, signals);
  assert.ok(Math.abs(fromMap - fromObject) < 1e-12);
});

test("a missing body contributes no evidence", () => {
  const value = abstentionScore(
    [{ id: "not-a-document", score: 0.03, rank: 1 }],
    "bm25 relevance",
    bodies,
    signals
  );
  assert.equal(value, 0);
});

test("a claim with a foreign term scores lower than one fully inside the collection", () => {
  const run = [
    { id: "bm25-okapi", score: 0.03, rank: 1 },
    { id: "vector-space-tfidf", score: 0.02, rank: 2 }
  ];
  const inside = abstentionScore(run, "bm25 okapi relevance", bodies, signals);
  const foreign = abstentionScore(run, "bm25 okapi hopscotch", bodies, signals);
  assert.ok(inside > foreign, `${inside} vs ${foreign}`);
});

test("shouldAnswer is inclusive at the threshold", () => {
  assert.equal(shouldAnswer(DEFAULT_ABSTAIN_THRESHOLD), true);
  assert.equal(shouldAnswer(DEFAULT_ABSTAIN_THRESHOLD - 1e-9), false);
  assert.equal(shouldAnswer(1), true);
  assert.equal(shouldAnswer(0), false);
});

test("shouldAnswer honours an explicit threshold", () => {
  assert.equal(shouldAnswer(0.5, 0.5), true);
  assert.equal(shouldAnswer(0.4, 0.5), false);
  assert.equal(shouldAnswer(0.4, 0), true);
});

test("the default threshold is a number inside the unit interval", () => {
  assert.equal(typeof DEFAULT_ABSTAIN_THRESHOLD, "number");
  assert.ok(DEFAULT_ABSTAIN_THRESHOLD >= 0);
  assert.ok(DEFAULT_ABSTAIN_THRESHOLD <= 1);
});

test("expectedCalibrationError is zero for a perfectly calibrated set", () => {
  // Each bin holds both labels, so its mean confidence equals its accuracy.
  const items = [
    { score: 0.5, answerable: true },
    { score: 0.5, answerable: false }
  ];
  assert.equal(expectedCalibrationError(items, 10), 0);
  assert.equal(expectedCalibrationError(items, 2), 0);
  assert.equal(expectedCalibrationError(items, 1), 0);
  const wider = [
    { score: 0.5, answerable: true },
    { score: 0.5, answerable: false },
    { score: 0.5, answerable: true },
    { score: 0.5, answerable: false }
  ];
  assert.equal(expectedCalibrationError(wider, 10), 0);
});

test("expectedCalibrationError is a weighted bin gap", () => {
  // Bin [0.25, 0.5) holds a pair whose confidence 0.25 meets accuracy 0.5, so
  // the gap is 0.25 weighted by that bin's half of the four items.
  const items = [
    { score: 0.5, answerable: true },
    { score: 0.5, answerable: false },
    { score: 0.25, answerable: true },
    { score: 0.25, answerable: false }
  ];
  assert.ok(Math.abs(expectedCalibrationError(items, 4) - 0.125) < 1e-12);
});

test("expectedCalibrationError reads a confidence field too", () => {
  const items = [
    { confidence: 0.9, answerable: true },
    { confidence: 0.9, answerable: true }
  ];
  assert.equal(expectedCalibrationError(items, 10), Math.abs(0.9 - 1));
});

test("expectedCalibrationError weights each bin by its share of items", () => {
  const bigBin = Array.from({ length: 8 }, () => ({ score: 0.5, answerable: false }));
  const smallBin = [{ score: 0.95, answerable: true }];
  const all = [...bigBin, ...smallBin];
  const ece = expectedCalibrationError(all, 10);
  assert.ok(Math.abs(ece - ((8 / 9) * 0.5 + (1 / 9) * Math.abs(0.95 - 1))) < 1e-12);
});

test("expectedCalibrationError ignores items it cannot bin", () => {
  const items = [
    { score: 0.5, answerable: true },
    { score: "nope" },
    { score: Number.NaN, answerable: true },
    { score: -0.5, answerable: false },
    { score: 1.5, answerable: false },
    { score: undefined }
  ];
  const value = expectedCalibrationError(items, 10);
  assert.ok(Number.isFinite(value));
  assert.ok(value >= 0);
});

test("expectedCalibrationError of an empty set is zero", () => {
  assert.equal(expectedCalibrationError([], 10), 0);
});

test("expectedCalibrationError with one bin is the whole set gap", () => {
  const items = [
    { score: 0.9, answerable: true },
    { score: 0.1, answerable: true },
    { score: 0.8, answerable: false }
  ];
  const meanConfidence = (0.9 + 0.1 + 0.8) / 3;
  const accuracy = 2 / 3;
  assert.ok(Math.abs(expectedCalibrationError(items, 1) - Math.abs(meanConfidence - accuracy)) < 1e-12);
});

test("expectedCalibrationError lies within the unit interval", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    score: (i % 10) / 10,
    answerable: i % 3 === 0
  }));
  const value = expectedCalibrationError(items, 15);
  assert.ok(value >= 0);
  assert.ok(value <= 1);
});

test("expectedCalibrationError clamps a bin count below one", () => {
  const items = [
    { score: 0.3, answerable: true },
    { score: 0.7, answerable: false }
  ];
  assert.ok(Number.isFinite(expectedCalibrationError(items, 0)));
  assert.ok(Number.isFinite(expectedCalibrationError(items, -5)));
});

test("rocPoints returns the endpoints plus the observed corners", () => {
  const points = rocPoints([
    { score: 0.9, answerable: true },
    { score: 0.8, answerable: true },
    { score: 0.2, answerable: false }
  ]);
  assert.deepEqual(points[0], [0, 0]);
  assert.deepEqual(points[points.length - 1], [1, 1]);
});

test("rocPoints is empty without both classes", () => {
  assert.deepEqual(rocPoints([{ score: 0.9, answerable: true }]), []);
  assert.deepEqual(rocPoints([]), []);
});

test("rocPoints rates stay within the unit square", () => {
  const items = Array.from({ length: 12 }, (_, i) => ({
    score: (12 - i) / 12,
    answerable: i % 2 === 0
  }));
  for (const [x, y] of rocPoints(items)) {
    assert.ok(x >= 0 && x <= 1);
    assert.ok(y >= 0 && y <= 1);
  }
});

test("areaUnderRoc of a straight diagonal is one half", () => {
  assert.equal(areaUnderRoc([[0, 0], [1, 1]]), 0.5);
});

test("areaUnderRoc of a single point or an empty list is zero", () => {
  assert.equal(areaUnderRoc([]), 0);
  assert.equal(areaUnderRoc([[0.5, 0.5]]), 0);
});

test("areaUnderRoc skips a zero width vertical segment", () => {
  // Two points sharing an x value form a vertical jump of zero width, which the
  // trapezoidal rule skips; the traversal still lands on the endpoint.
  const jump = areaUnderRoc([[0, 0], [0, 1], [1, 1]]);
  const clean = areaUnderRoc([[0, 0], [1, 1]]);
  assert.ok(jump > clean);
  assert.ok(jump <= 1);
});

test("areaUnderRoc is clamped to the unit interval", () => {
  const inverted = areaUnderRoc([
    [0, 1],
    [1, 0]
  ]);
  assert.ok(inverted >= 0);
  assert.ok(inverted <= 1);
});

test("auroc of a perfectly separating score is one", () => {
  assert.equal(auroc([{ score: 0.9, answerable: true }, { score: 0.1, answerable: false }]), 1);
});

test("auroc of an inverted score is zero", () => {
  assert.equal(auroc([{ score: 0.1, answerable: true }, { score: 0.9, answerable: false }]), 0);
});

test("auroc of an uninformative score is one half", () => {
  // A constant score gives no ordering, so the single operating point joins
  // (0,0) to (1,1) and the area is the chance diagonal.
  const items = Array.from({ length: 10 }, (_, i) => ({ score: 0.5, answerable: i < 5 }));
  assert.ok(Math.abs(auroc(items) - 0.5) < 1e-9);
  // Ties inside a mixed set contribute one step, not a walk over the ties.
  const mixed = [
    { score: 1, answerable: true },
    { score: 1, answerable: false },
    { score: 0.5, answerable: true },
    { score: 0.2, answerable: false }
  ];
  assert.ok(Math.abs(auroc(mixed) - 0.625) < 1e-9);
});

test("auroc without both classes is zero", () => {
  assert.equal(auroc([{ score: 0.9, answerable: true }]), 0);
  assert.equal(auroc([]), 0);
});

test("auroc of a real answerable set beats chance", () => {
  const items = [
    { score: 0.4, answerable: true },
    { score: 0.2, answerable: true },
    { score: 0.05, answerable: false },
    { score: 0.01, answerable: false }
  ];
  assert.ok(auroc(items) > 0.5);
});

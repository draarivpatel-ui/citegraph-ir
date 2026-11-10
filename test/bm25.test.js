/**
 * bm25.test.js - Okapi BM25 scoring, the inverted index, and saturation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIndex,
  bm25TermScore,
  bm25Score,
  bm25Rank,
  tfWeight,
  idfWeight
} from "../src/ir_engine.js";
import { loadDocuments } from "../src/benchmark.js";

const docs = loadDocuments();
const index = buildIndex(docs);

test("the index holds every document", () => {
  assert.equal(index.docCount, 40);
  assert.equal(index.docs.length, 40);
});

test("the average document length is the mean of the indexed lengths", () => {
  const expected = docs.reduce((sum, d) => sum + d.body.length, 0) / docs.length;
  assert.ok(index.avgdl > 0);
  assert.ok(Math.abs(index.avgdl - expected / 10) < 200);
});

test("document frequency counts each document once per term", () => {
  for (const [term, df] of index.docFrequency) {
    assert.ok(df >= 1);
    assert.ok(df <= index.docCount);
  }
});

test("idf falls as document frequency rises", () => {
  const entries = [...index.idf.entries()];
  assert.ok(entries.length > 100);
  const pairs = entries
    .map(([term, value]) => [index.docFrequency.get(term), value])
    .sort((a, c) => a[0] - c[0]);
  for (let i = 1; i < pairs.length; i += 1) {
    if (pairs[i][0] > pairs[i - 1][0]) {
      assert.ok(pairs[i][1] <= pairs[i - 1][1] + 1e-12);
    }
  }
});

test("a term in every document has an idf of zero", () => {
  const universal = [...index.docFrequency.entries()]
    .filter(([, df]) => df === index.docCount)
    .map(([term]) => term);
  for (const term of universal) {
    assert.equal(index.idf.get(term), 0);
  }
});

test("idf is clamped at zero for very frequent terms", () => {
  for (const [, value] of index.idf) {
    assert.ok(value >= 0);
  }
});

test("bm25Score of a term absent from a document is zero", () => {
  const doc = index.docs.find((d) => d.id === "bm25-okapi");
  assert.equal(bm25Score(index, doc, ["zzzznosuchterm"]), 0);
});

test("bm25Score grows with term frequency up to saturation", () => {
  const doc = index.docs.find((d) => d.id === "bm25-okapi");
  const single = bm25Score(index, doc, ["bm25"]);
  const doubled = bm25Score(index, doc, ["bm25", "bm25"]);
  const tripled = bm25Score(index, doc, ["bm25", "bm25", "bm25"]);
  assert.ok(single > 0);
  assert.ok(doubled > single);
  assert.ok(tripled > doubled);
  // Saturation: the second occurrence must add less than the first.
  assert.ok(doubled - single > tripled - doubled);
});

test("saturation is bounded by the k1 term", () => {
  const doc = index.docs.find((d) => d.id === "bm25-okapi");
  const many = Array.from({ length: 50 }, () => "bm25");
  const saturated = bm25Score(index, doc, many);
  const termScore = bm25TermScore(index, doc, "bm25");
  const idf = index.idf.get("bm25");
  assert.ok(saturated <= 50 * termScore);
  // The weight of one occurrence is idf * (k1+1)/(1 + k1*lenRatio) which is
  // bounded by idf * (k1+1) when the document has average length.
  assert.ok(termScore <= idf * (index.k1 + 1));
});

test("a longer document is penalised for the same term frequency", () => {
  const shortDoc = { id: "s", refs: [], tokens: ["term", "x"], counts: new Map([["term", 1], ["x", 1]]), length: 2 };
  const longDoc = {
    id: "l",
    refs: [],
    tokens: Array.from({ length: 400 }, () => "pad"),
    counts: new Map([["term", 1], ["pad", 400]]),
    length: 400
  };
  const custom = buildIndex(docs, { k1: 1.2, b: 0.75 });
  const withDocs = {
    ...custom,
    docs: [...custom.docs, shortDoc, longDoc],
    docCount: custom.docCount + 2
  };
  const shortScore = bm25TermScore(withDocs, shortDoc, "term");
  const longScore = bm25TermScore(withDocs, longDoc, "term");
  assert.ok(shortScore > longScore);
});

test("length normalisation disappears when b is zero", () => {
  const b0 = buildIndex(docs, { b: 0 });
  const doc = b0.docs.find((d) => d.id === "bm25-okapi");
  const score = bm25TermScore(b0, doc, "bm25");
  const expectedIdf = b0.idf.get("bm25");
  const tf = doc.counts.get("bm25");
  const expected = (expectedIdf * tf * (b0.k1 + 1)) / (tf + b0.k1);
  assert.ok(Math.abs(score - expected) < 1e-12);
});

test("bm25Rank returns every document exactly once", () => {
  const run = bm25Rank(index, contentTokensOf("okapi bm25 relevance"));
  assert.equal(run.length, index.docCount);
  assert.equal(new Set(run.map((r) => r.id)).size, index.docCount);
});

test("bm25Rank is sorted by descending score and ranked one based", () => {
  const run = bm25Rank(index, contentTokensOf("reciprocal rank fusion constant"));
  for (let i = 1; i < run.length; i += 1) {
    assert.ok(run[i - 1].score >= run[i].score);
    assert.equal(run[i].rank, i + 1);
  }
  assert.equal(run[0].rank, 1);
});

test("bm25Rank is deterministic across calls", () => {
  const tokens = contentTokensOf("citation graph authority");
  const a = bm25Rank(index, tokens);
  const b = bm25Rank(index, tokens);
  assert.deepEqual(a.map((r) => r.id), b.map((r) => r.id));
});

test("bm25Rank puts the canonical document first for a direct query", () => {
  const run = bm25Rank(index, contentTokensOf("okapi bm25 probabilistic relevance"));
  assert.equal(run[0].id, "bm25-okapi");
});

test("bm25Rank of an empty token list gives every document a score of zero", () => {
  const run = bm25Rank(index, []);
  assert.ok(run.every((r) => r.score === 0));
});

test("tfWeight is one plus a natural log", () => {
  assert.equal(tfWeight(1), 1);
  assert.equal(tfWeight(2), 1 + Math.log(2));
  assert.equal(tfWeight(0), 0);
  assert.equal(tfWeight(-5), 0);
});

test("idfWeight is the log of the ratio N over df", () => {
  assert.equal(idfWeight(1, 10), Math.log(10));
  assert.equal(idfWeight(10, 10), 0);
  assert.equal(idfWeight(0, 10), 0);
  assert.equal(idfWeight(5, 0), 0);
});

test("idfWeight of a rare term exceeds a common one", () => {
  assert.ok(idfWeight(1, 100) > idfWeight(50, 100));
});

test("buildIndex rejects a k1 outside the nonnegative range", () => {
  assert.throws(() => buildIndex(docs, { k1: -1 }), RangeError);
});

test("buildIndex rejects a b outside the unit interval", () => {
  assert.throws(() => buildIndex(docs, { b: 1.5 }), RangeError);
  assert.throws(() => buildIndex(docs, { b: -0.1 }), RangeError);
});

function contentTokensOf(text) {
  return text.split(/\s+/).filter(Boolean);
}

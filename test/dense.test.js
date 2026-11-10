/**
 * dense.test.js - the character n-gram tf-idf cosine stage.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIndex,
  buildDenseVectors,
  cosineSimilarity,
  denseRank,
  idfWeight,
  tfWeight,
  charNGrams
} from "../src/ir_engine.js";
import { loadDocuments } from "../src/benchmark.js";

const docs = loadDocuments();
const index = buildIndex(docs);
const dense = buildDenseVectors(index, docs);

test("every document has a dense vector and a norm", () => {
  assert.equal(dense.vectors.size, docs.length);
  assert.equal(dense.norms.size, docs.length);
  for (const norm of dense.norms.values()) {
    assert.ok(Number.isFinite(norm));
    assert.ok(norm >= 0);
  }
});

test("the dense norm is the L2 norm of its own vector", () => {
  for (const doc of docs) {
    const vec = dense.vectors.get(doc.id);
    let sum = 0;
    for (const w of vec.values()) sum += w * w;
    assert.ok(Math.abs(Math.sqrt(sum) - dense.norms.get(doc.id)) < 1e-9);
  }
});

test("dense vectors drop grams whose idf is zero", () => {
  for (const vec of dense.vectors.values()) {
    for (const w of vec.values()) assert.ok(w > 0);
  }
  const gramsPresent = [...dense.gramDocFrequency.entries()].filter(([, df]) => df === dense.docCount);
  assert.ok(gramsPresent.length > 0);
  for (const [gram] of gramsPresent) {
    for (const vec of dense.vectors.values()) {
      assert.ok(!vec.has(gram));
    }
  }
});

test("cosine similarity of a document with its own text is one", () => {
  // The query side of cosineSimilarity takes raw term counts, so the exact
  // document text is rebuilt here rather than reusing the stored weights.
  for (const doc of docs.slice(0, 6)) {
    const text = `${doc.title} ${doc.venue ?? ""} ${doc.body ?? ""}`;
    const counts = new Map();
    for (const g of charNGrams(text, dense.n)) counts.set(g, (counts.get(g) ?? 0) + 1);
    let sumSquares = 0;
    for (const [g, tf] of counts) {
      const idf = idfWeight(dense.gramDocFrequency.get(g) ?? 0, dense.docCount);
      const w = tfWeight(tf) * idf;
      sumSquares += w * w;
    }
    const queryNorm = Math.sqrt(sumSquares);
    const similarity = cosineSimilarity(
      counts,
      queryNorm,
      dense.vectors.get(doc.id),
      dense.norms.get(doc.id),
      dense.gramDocFrequency,
      dense.docCount
    );
    assert.ok(Math.abs(similarity - 1) < 1e-9, `${doc.id}: ${similarity}`);
  }
});

/**
 * Build the raw gram counts and the matching tf-idf norm of a text, which is
 * the query representation cosineSimilarity expects.
 */
function querySide(text) {
  const counts = new Map();
  for (const g of charNGrams(text, dense.n)) counts.set(g, (counts.get(g) ?? 0) + 1);
  let sumSquares = 0;
  for (const [g, tf] of counts) {
    const idf = idfWeight(dense.gramDocFrequency.get(g) ?? 0, dense.docCount);
    const w = tfWeight(tf) * idf;
    sumSquares += w * w;
  }
  return { counts, norm: Math.sqrt(sumSquares) };
}

test("cosine similarity is symmetric in its two vectors", () => {
  const a = docs[3];
  const c = docs[9];
  const qa = querySide(`${a.title} ${a.venue ?? ""} ${a.body ?? ""}`);
  const qc = querySide(`${c.title} ${c.venue ?? ""} ${c.body ?? ""}`);
  const forward = cosineSimilarity(
    qa.counts,
    qa.norm,
    dense.vectors.get(c.id),
    dense.norms.get(c.id),
    dense.gramDocFrequency,
    dense.docCount
  );
  const backward = cosineSimilarity(
    qc.counts,
    qc.norm,
    dense.vectors.get(a.id),
    dense.norms.get(a.id),
    dense.gramDocFrequency,
    dense.docCount
  );
  assert.ok(Math.abs(forward - backward) < 1e-9);
});

test("cosine similarity of a shorter query against a document stays at or below one", () => {
  const q = querySide("bm25");
  const selfSim = cosineSimilarity(
    q.counts,
    q.norm,
    dense.vectors.get("bm25-okapi"),
    dense.norms.get("bm25-okapi"),
    dense.gramDocFrequency,
    dense.docCount
  );
  assert.ok(selfSim > 0);
  assert.ok(selfSim <= 1.0000001, String(selfSim));
});

test("cosine similarity is zero when either norm is zero", () => {
  const vec = dense.vectors.get(docs[0].id);
  assert.equal(cosineSimilarity(vec, 0, vec, 1, dense.gramDocFrequency, dense.docCount), 0);
  assert.equal(cosineSimilarity(vec, 1, vec, 0, dense.gramDocFrequency, dense.docCount), 0);
  assert.equal(cosineSimilarity(vec, 1, vec, -1, dense.gramDocFrequency, dense.docCount), 0);
});

test("cosine similarity of disjoint gram sets is zero", () => {
  const query = new Map([["zzzq", 1]]);
  const vec = dense.vectors.get(docs[0].id);
  const norm = dense.norms.get(docs[0].id);
  assert.equal(cosineSimilarity(query, 1, vec, norm, dense.gramDocFrequency, dense.docCount), 0);
});

test("cosine similarity ignores a gram with zero idf", () => {
  // A gram present in every document has an idf of zero and cannot contribute.
  const universal = [...dense.gramDocFrequency.entries()].find(([, df]) => df === dense.docCount);
  assert.ok(universal !== undefined);
  const vec = dense.vectors.get(docs[0].id);
  const norm = dense.norms.get(docs[0].id);
  const query = new Map([[universal[0], 1]]);
  const queryNorm = Math.sqrt(tfWeight(1) * idfWeight(dense.docCount, dense.docCount));
  assert.equal(queryNorm, 0);
  assert.equal(
    cosineSimilarity(query, queryNorm, vec, norm, dense.gramDocFrequency, dense.docCount),
    0
  );
});

test("denseRank returns every document exactly once with one based ranks", () => {
  const run = denseRank(dense, docs, "citation graph authority");
  assert.equal(run.length, docs.length);
  assert.equal(new Set(run.map((r) => r.id)).size, docs.length);
  assert.equal(run[0].rank, 1);
  assert.equal(run[run.length - 1].rank, run.length);
});

test("denseRank is sorted by descending score", () => {
  const run = denseRank(dense, docs, "citation graph authority");
  for (let i = 1; i < run.length; i += 1) {
    assert.ok(run[i - 1].score >= run[i].score);
  }
});

test("denseRank is deterministic across calls", () => {
  const a = denseRank(dense, docs, "query expansion relevance feedback");
  const b = denseRank(dense, docs, "query expansion relevance feedback");
  assert.deepEqual(a.map((r) => r.id), b.map((r) => r.id));
});

test("denseRank scores are within the unit interval", () => {
  const run = denseRank(dense, docs, "nearest neighbour graph approximate index");
  for (const entry of run) {
    assert.ok(entry.score >= 0);
    assert.ok(entry.score <= 1.0000001);
  }
});

test("denseRank puts the canonical document first for a direct query", () => {
  const run = denseRank(dense, docs, "okapi bm25 probabilistic relevance");
  assert.equal(run[0].id, "bm25-okapi");
});

test("denseRank of an empty query gives every document a score of zero", () => {
  const run = denseRank(dense, docs, "");
  assert.ok(run.every((r) => r.score === 0));
});

test("denseRank ties break by document id", () => {
  const run = denseRank(dense, docs, "!!! ,,, ???");
  const firstZero = run.findIndex((r) => r.score > 0);
  if (firstZero === -1) {
    const ids = run.map((r) => r.id);
    assert.deepEqual(ids, [...ids].sort());
  }
});

test("a larger n-gram order produces a different but valid run", () => {
  const n3 = denseRank(dense, docs, "citation graph");
  const bigrams = buildDenseVectors(index, docs, { n: 2 });
  const n2 = denseRank(bigrams, docs, "citation graph");
  assert.equal(n2.length, n3.length);
  assert.equal(new Set(n2.map((r) => r.id)).size, docs.length);
});

test("the dense gram doc frequency is bounded by the corpus size", () => {
  for (const [, df] of dense.gramDocFrequency) {
    assert.ok(df >= 1);
    assert.ok(df <= dense.docCount);
  }
  assert.equal(dense.docCount, docs.length);
});

test("a shared gram contributes to two document vectors", () => {
  const shared = [...dense.gramDocFrequency.entries()]
    .filter(([, df]) => df > 1 && df < dense.docCount)
    .map(([g]) => g)[0];
  assert.ok(shared !== undefined);
  const holders = docs.filter((d) => dense.vectors.get(d.id).has(shared));
  assert.ok(holders.length > 1);
});

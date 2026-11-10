/**
 * citation_graph.test.js - the citation graph and personalized PageRank.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIndex,
  buildCitationGraph,
  personalizedPageRank,
  rerankWithAuthority
} from "../src/ir_engine.js";
import { loadDocuments } from "../src/benchmark.js";

const docs = loadDocuments();
const index = buildIndex(docs);
const graph = buildCitationGraph(index);

test("the graph has a node for every document", () => {
  assert.equal(graph.ids.size, docs.length);
  assert.equal(graph.docCount, docs.length);
  for (const doc of docs) {
    assert.ok(graph.outLinks.has(doc.id));
    assert.ok(graph.inLinks.has(doc.id));
  }
});

test("outgoing edges point at indexed documents only", () => {
  for (const [id, refs] of graph.outLinks) {
    for (const ref of refs) {
      assert.ok(graph.ids.has(ref), `${id} cites a document outside the index: ${ref}`);
      assert.notEqual(ref, id, "a document cannot cite itself");
    }
  }
});

test("incoming links are the mirror of outgoing links", () => {
  let forward = 0;
  let backward = 0;
  for (const [, refs] of graph.outLinks) forward += refs.length;
  for (const [, refs] of graph.inLinks) backward += refs.length;
  assert.equal(forward, backward);
  assert.ok(forward > 0);
});

test("every in link has a matching out link", () => {
  for (const [target, citers] of graph.inLinks) {
    for (const citer of citers) {
      assert.ok(graph.outLinks.get(citer).includes(target));
    }
  }
});

test("the corpus has at least one dangling document so the correction runs", () => {
  const dangling = [...graph.outLinks.entries()].filter(([, refs]) => refs.length === 0);
  assert.ok(dangling.length >= 1);
});

test("pageRank rejects a damping outside the open unit interval", () => {
  const seed = new Map([["bm25-okapi", 1]]);
  assert.throws(() => personalizedPageRank(graph, seed, { damping: 0 }), RangeError);
  assert.throws(() => personalizedPageRank(graph, seed, { damping: 1 }), RangeError);
  assert.throws(() => personalizedPageRank(graph, seed, { damping: 1.5 }), RangeError);
  assert.throws(() => personalizedPageRank(graph, seed, { damping: -0.2 }), RangeError);
});

test("pageRank rejects a seed with no mass", () => {
  assert.throws(() => personalizedPageRank(graph, new Map()), RangeError);
  assert.throws(() => personalizedPageRank(graph, new Map([["nope", 0]])), RangeError);
  assert.throws(() => personalizedPageRank(graph, new Map([["bm25-okapi", 0]])), RangeError);
});

test("pageRank mass sums to one", () => {
  const seed = new Map([["bm25-okapi", 1]]);
  const ranks = personalizedPageRank(graph, seed);
  let total = 0;
  for (const value of ranks.values()) total += value;
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("pageRank scores lie in the unit interval", () => {
  const seed = new Map([["bm25-okapi", 1]]);
  const ranks = personalizedPageRank(graph, seed);
  for (const value of ranks.values()) {
    assert.ok(value >= 0);
    assert.ok(value <= 1);
  }
});

test("pageRank gives the seed document the highest authority", () => {
  const seed = new Map([["vector-space-tfidf", 1]]);
  const ranks = personalizedPageRank(graph, seed);
  const top = [...ranks.entries()].sort((a, c) => c[1] - a[1])[0];
  assert.equal(top[0], "vector-space-tfidf");
});

test("a cited document outranks an uncited one", () => {
  const seed = new Map([["vector-space-tfidf", 1]]);
  const ranks = personalizedPageRank(graph, seed);
  const cited = [...ranks.entries()]
    .filter(([id]) => id !== "vector-space-tfidf")
    .sort((a, c) => c[1] - a[1])[0];
  assert.ok(ranks.get(cited[0]) > 0);
});

test("a normalised seed and an unnormalised seed agree", () => {
  const a = personalizedPageRank(graph, new Map([["bm25-okapi", 1], ["lm-jelinek-mercer", 3]]));
  const b = personalizedPageRank(graph, new Map([["bm25-okapi", 0.25], ["lm-jelinek-mercer", 0.75]]));
  for (const [id, value] of a) {
    assert.ok(Math.abs(value - b.get(id)) < 1e-9);
  }
});

test("a seed accepts a plain object", () => {
  const fromMap = personalizedPageRank(graph, new Map([["bm25-okapi", 1]]));
  const fromObject = personalizedPageRank(graph, { "bm25-okapi": 1 });
  for (const [id, value] of fromMap) {
    assert.ok(Math.abs(value - fromObject.get(id)) < 1e-9);
  }
});

test("seed mass is normalised so raw scale does not matter", () => {
  const small = personalizedPageRank(graph, new Map([["bm25-okapi", 1], ["rrf-fusion", 3]]));
  const big = personalizedPageRank(graph, new Map([["bm25-okapi", 1000], ["rrf-fusion", 3000]]));
  for (const [id, value] of small) {
    assert.ok(Math.abs(value - big.get(id)) < 1e-9);
  }
});

test("a seed on a well cited document spreads authority", () => {
  const seed = new Map([["vector-space-tfidf", 1]]);
  const ranks = personalizedPageRank(graph, seed);
  const others = [...ranks.values()].filter((v) => v < ranks.get("vector-space-tfidf"));
  assert.ok(others.length > 0);
  assert.ok(others.some((v) => v > 0));
});

test("lower damping pulls mass back toward the seed", () => {
  const seed = new Map([["vector-space-tfidf", 1]]);
  const concentrated = personalizedPageRank(graph, seed, { damping: 0.2 });
  const spread = personalizedPageRank(graph, seed, { damping: 0.85 });
  assert.ok(concentrated.get("vector-space-tfidf") > spread.get("vector-space-tfidf"));
});

test("pageRank converges within the iteration budget", () => {
  const seed = new Map([["vector-space-tfidf", 1]]);
  const fixed = personalizedPageRank(graph, seed, { maxIterations: 1000, tolerance: 1e-14 });
  const truncated = personalizedPageRank(graph, seed, { maxIterations: 2 });
  let delta = 0;
  for (const [id, value] of fixed) delta += Math.abs(value - truncated.get(id));
  assert.ok(delta > 1e-3, "two iterations should not already match the fixed point");
  // The default budget of 100 iterations lies past the fixed point for a 40
  // node chain with damping 0.85: the residual contracts by about a factor of
  // ten per thirty iterations.
  for (const [iterations, bound] of [[30, 1e-2], [60, 1e-4], [90, 1e-6], [120, 1e-8], [200, 1e-12]]) {
    const partial = personalizedPageRank(graph, seed, { maxIterations: iterations, tolerance: 1e-14 });
    let gap = 0;
    for (const [id, value] of fixed) gap += Math.abs(value - partial.get(id));
    assert.ok(gap < bound, `${iterations} iterations left a gap of ${gap}`);
  }
});

test("pageRank does not mutate the seed it was given", () => {
  const seed = new Map([["bm25-okapi", 2]]);
  personalizedPageRank(graph, seed);
  assert.equal(seed.size, 1);
  assert.equal(seed.get("bm25-okapi"), 2);
});

test("rerank with zero graph weight returns the fused order untouched", () => {
  const seed = new Map([["bm25-okapi", 1]]);
  const ranks = personalizedPageRank(graph, seed);
  const fused = [
    { id: "bm25-okapi", score: 0.03, rank: 1 },
    { id: "lm-jelinek-mercer", score: 0.02, rank: 2 },
    { id: "dfr-divergence", score: 0.01, rank: 3 }
  ];
  const out = rerankWithAuthority(fused, graph, index, { graphWeight: 0 });
  assert.deepEqual(out.map((r) => r.id), fused.map((r) => r.id));
  assert.deepEqual(out.map((r) => r.score), fused.map((r) => r.score));
  assert.ok(out.every((r) => typeof r.authority === "number"));
});

test("rerank keeps the fused score as the base score", () => {
  const fused = [
    { id: "bm25-okapi", score: 0.03, rank: 1 },
    { id: "lm-jelinek-mercer", score: 0.02, rank: 2 }
  ];
  const out = rerankWithAuthority(fused, graph, index);
  for (const entry of out) {
    const source = fused.find((r) => r.id === entry.id);
    assert.equal(entry.baseScore, source.score);
  }
});

test("rerank returns a permutation of the fused run", () => {
  const fused = [
    { id: "bm25-okapi", score: 0.03, rank: 1 },
    { id: "lm-jelinek-mercer", score: 0.02, rank: 2 },
    { id: "dfr-divergence", score: 0.01, rank: 3 }
  ];
  const out = rerankWithAuthority(fused, graph, index);
  assert.deepEqual([...out.map((r) => r.id)].sort(), [...fused.map((r) => r.id)].sort());
  assert.deepEqual(out.map((r) => r.rank), [1, 2, 3]);
});

test("authority is scaled by the spread of the run", () => {
  const wide = [
    { id: "vector-space-tfidf", score: 1, rank: 1 },
    { id: "dfr-divergence", score: 0.001, rank: 2 }
  ];
  const narrow = [
    { id: "vector-space-tfidf", score: 0.486, rank: 1 },
    { id: "dfr-divergence", score: 0.485, rank: 2 }
  ];
  const wideOut = rerankWithAuthority(wide, graph, index)[0];
  const narrowOut = rerankWithAuthority(narrow, graph, index)[0];
  const wideLift = wideOut.score - wideOut.baseScore;
  const narrowLift = narrowOut.score - narrowOut.baseScore;
  assert.ok(Math.abs(wideLift - 0.35 * 0.999 * wideOut.authority) < 1e-12);
  assert.ok(narrowLift < wideLift);
});

test("a flat run seeds pageRank uniformly rather than failing", () => {
  const flat = [
    { id: "bm25-okapi", score: 0, rank: 1 },
    { id: "lm-jelinek-mercer", score: 0, rank: 2 }
  ];
  const out = rerankWithAuthority(flat, graph, index);
  assert.equal(out.length, 2);
  assert.ok(out.every((r) => Number.isFinite(r.score)));
});

test("a single document run is handled", () => {
  const one = [{ id: "bm25-okapi", score: 0.5, rank: 1 }];
  const out = rerankWithAuthority(one, graph, index);
  assert.equal(out.length, 1);
  assert.equal(out[0].rank, 1);
});

test("an empty fused run is returned as an empty run", () => {
  assert.deepEqual(rerankWithAuthority([], graph, index), []);
});

test("only the top seedSize documents seed pageRank", () => {
  const fused = Array.from({ length: 40 }, (_, i) => ({
    id: docs[i].id,
    score: 1 / (61 + i),
    rank: i + 1
  }));
  const small = rerankWithAuthority(fused, graph, index, { seedSize: 3 });
  const large = rerankWithAuthority(fused, graph, index, { seedSize: 20 });
  assert.notDeepEqual(small[5].authority, large[5].authority);
  assert.equal(small.length, 40);
  assert.equal(large.length, 40);
});

test("rerank is deterministic", () => {
  const fused = [
    { id: "bm25-okapi", score: 0.03, rank: 1 },
    { id: "lm-jelinek-mercer", score: 0.02, rank: 2 }
  ];
  const a = rerankWithAuthority(fused, graph, index);
  const b = rerankWithAuthority(fused, graph, index);
  assert.deepEqual(a, b);
});

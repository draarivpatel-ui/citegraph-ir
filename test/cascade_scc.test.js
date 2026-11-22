/**
 * cascade_scc.test.js - exact Tarjan strongly connected components over the
 * citation graph.
 *
 * A circular citation ring is a component of mutually citing papers: the
 * algorithm must find every ring exactly, never merge two distinct rings,
 * never report a ring in a DAG, and count a self citing paper as a one member
 * ring. Both the component partition and the derived ring list are checked
 * here, including against a brute force reachability definition of strong
 * connectedness.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  graphFromRefs,
  stronglyConnectedComponents,
  circularRings,
  ringMembers,
  terminalIds,
  unverifiedIds,
  primarySourceId
} from "../src/cascade_lab.js";
import { buildEngine, loadDocuments } from "../src/benchmark.js";
import { buildIndex, buildCitationGraph } from "../src/ir_engine.js";

/** Brute force strong connectedness: same mutually reachable equivalence class. */
function reaches(graph, from, to) {
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === to) return true;
    for (const ref of graph.outLinks.get(node) ?? []) {
      if (!seen.has(ref)) { seen.add(ref); stack.push(ref); }
    }
  }
  return false;
}

/** The partition a brute force algorithm would report for one node. */
function bruteClass(graph, id) {
  return new Set([...graph.ids].filter((other) => reaches(graph, id, other) && reaches(graph, other, id)));
}

/* ------------------------------------------------------------------ *
 * Toy graph exactness
 * ------------------------------------------------------------------ */

test("SCC toy: a 2-cycle is one ring, an outside node is its own component", () => {
  const g = graphFromRefs({ a: ["b"], b: ["a"], c: ["a"] });
  const components = stronglyConnectedComponents(g);
  assert.equal(components.length, 2);
  const ring = components.find((c) => c.ring);
  assert.deepEqual(ring.members, ["a", "b"]);
  const lone = components.find((c) => !c.ring);
  assert.deepEqual(lone.members, ["c"]);
});

test("SCC toy: a pure DAG has a singleton component per node and no rings", () => {
  const g = graphFromRefs({ a: ["b", "c"], b: ["d"], c: ["d"], d: [] });
  const components = stronglyConnectedComponents(g);
  assert.equal(components.length, 4);
  for (const c of components) {
    assert.equal(c.ring, false);
    assert.equal(c.members.length, 1);
  }
  assert.equal(circularRings(g).length, 0);
});

test("SCC toy: a self citing paper is a one member ring", () => {
  const g = graphFromRefs({ s: ["s"], t: [] });
  const components = stronglyConnectedComponents(g);
  const self = components.find((c) => c.members.includes("s"));
  assert.equal(self.ring, true);
  assert.deepEqual(self.members, ["s"]);
  assert.equal(circularRings(g).length, 1);
});

test("SCC toy: a node without a self loop is never a ring alone", () => {
  const g = graphFromRefs({ s: ["t"], t: [] });
  for (const c of stronglyConnectedComponents(g)) assert.equal(c.ring, false);
});

test("SCC toy: a 3-cycle reports all three members in one ring", () => {
  const g = graphFromRefs({ a: ["b"], b: ["c"], c: ["a"], t: [] });
  const rings = circularRings(g);
  assert.equal(rings.length, 1);
  assert.deepEqual(rings[0].members, ["a", "b", "c"]);
});

test("SCC toy: a 3-cycle with a chord is still exactly one ring", () => {
  const g = graphFromRefs({ a: ["b", "c"], b: ["c"], c: ["a"], t: [] });
  const rings = circularRings(g);
  assert.equal(rings.length, 1);
  assert.deepEqual(rings[0].members, ["a", "b", "c"]);
});

test("SCC toy: two disjoint cycles report two rings", () => {
  const g = graphFromRefs({ a: ["b"], b: ["a"], x: ["y"], y: ["x"], t: [] });
  const rings = circularRings(g);
  assert.equal(rings.length, 2);
  assert.deepEqual(rings[0].members, ["a", "b"]);
  assert.deepEqual(rings[1].members, ["x", "y"]);
});

test("SCC toy: two cycles sharing one node merge into a single ring", () => {
  // a<->b and b<->c share b, so all three are strongly connected.
  const g = graphFromRefs({ a: ["b"], b: ["a", "c"], c: ["b"], t: [] });
  const rings = circularRings(g);
  assert.equal(rings.length, 1);
  assert.deepEqual(rings[0].members, ["a", "b", "c"]);
});

test("SCC toy: a cycle feeding a downstream chain keeps the tail acyclic", () => {
  const g = graphFromRefs({ a: ["b"], b: ["a", "c"], c: ["d"], d: [] });
  const rings = circularRings(g);
  assert.equal(rings.length, 1);
  assert.deepEqual(rings[0].members, ["a", "b"]);
});

test("SCC toy: an upstream chain feeding a cycle stays outside the ring", () => {
  const g = graphFromRefs({ u: ["v"], v: ["a"], a: ["b"], b: ["a"], t: [] });
  const rings = circularRings(g);
  assert.equal(rings.length, 1);
  assert.deepEqual(rings[0].members, ["a", "b"]);
});

test("SCC toy: a large cycle with a long tail is found whole", () => {
  const refs = { t: [] };
  for (let i = 0; i < 9; i += 1) refs[`n${i}`] = [`n${(i + 1) % 9}`];
  refs.tail = ["n0"];
  const g = graphFromRefs(refs);
  const rings = circularRings(g);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].members.length, 9);
});

test("SCC toy: ring ids are assigned ring-1, ring-2 in member order", () => {
  const g = graphFromRefs({ b: ["a"], a: ["b"], z: ["y"], y: ["z"], t: [] });
  const rings = circularRings(g);
  assert.equal(rings[0].id, "ring-1");
  assert.equal(rings[1].id, "ring-2");
});

test("SCC toy: components cover every node exactly once", () => {
  const g = graphFromRefs({ a: ["b"], b: ["a", "c"], c: ["d"], d: [], e: ["a"] });
  const seen = new Set();
  for (const c of stronglyConnectedComponents(g)) {
    for (const id of c.members) {
      assert.equal(seen.has(id), false, `${id} in two components`);
      seen.add(id);
    }
  }
  assert.equal(seen.size, g.ids.size);
});

test("SCC toy: component members match the brute force equivalence classes", () => {
  const g = graphFromRefs({
    a: ["b"], b: ["a", "c"], c: ["d", "e"], d: ["e"], e: ["d"], f: ["a"], t: []
  });
  for (const id of g.ids) {
    const expected = [...bruteClass(g, id)].sort();
    const actual = stronglyConnectedComponents(g).find((c) => c.members.includes(id)).members;
    assert.deepEqual(actual, expected, `component of ${id}`);
  }
});

test("SCC toy: ringMembers flattens every ring's members into a sorted set", () => {
  const g = graphFromRefs({ a: ["b"], b: ["a"], x: ["y"], y: ["x"], s: ["x"], t: [] });
  const members = ringMembers(g);
  assert.equal(members.size, 4);
  assert.deepEqual([...members].sort(), ["a", "b", "x", "y"]);
  assert.equal(members.has("s"), false);
});

test("SCC toy: Tarjan is deterministic across repeated runs", () => {
  const g = graphFromRefs({ a: ["b", "c"], b: ["a"], c: ["b"], d: ["a", "t"], t: [] });
  const first = JSON.stringify(stronglyConnectedComponents(g));
  const second = JSON.stringify(stronglyConnectedComponents(g));
  assert.equal(first, second);
});

test("SCC toy: a deep acyclic chain does not overflow the iterative stack", () => {
  const refs = {};
  const n = 4000;
  for (let i = 0; i < n - 1; i += 1) refs[`d${i}`] = [`d${i + 1}`];
  refs[`d${n - 1}`] = [];
  const g = graphFromRefs(refs);
  assert.equal(circularRings(g).length, 0);
});

test("SCC toy: a long cyclic chain plus tail is still found", () => {
  const refs = {};
  const n = 2000;
  for (let i = 0; i < n; i += 1) refs[`c${i}`] = [`c${(i + 1) % n}`];
  refs.tail = ["c0"];
  const g = graphFromRefs(refs);
  const rings = circularRings(g);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].members.length, n);
});

/* ------------------------------------------------------------------ *
 * Corpus rings
 * ------------------------------------------------------------------ */

const engine = buildEngine();
const GRAPH = engine.graph;

test("SCC corpus: the bundled graph reports 8 circular rings", () => {
  assert.equal(circularRings(GRAPH).length, 8);
});

test("SCC corpus: every reported ring is genuinely strongly connected", () => {
  for (const ring of circularRings(GRAPH)) {
    for (const a of ring.members) {
      for (const b of ring.members) {
        assert.equal(reaches(GRAPH, a, b), true, `${a} does not reach ${b}`);
      }
    }
  }
});

test("SCC corpus: no two rings share a member", () => {
  const seen = new Set();
  for (const ring of circularRings(GRAPH)) {
    for (const id of ring.members) {
      assert.equal(seen.has(id), false, `${id} appears in two rings`);
      seen.add(id);
    }
  }
});

test("SCC corpus: the known pagerank bibliographic pair is one ring", () => {
  const rings = circularRings(GRAPH);
  const ring = rings.find((r) => r.members.includes("pagerank-citation-graph"));
  assert.ok(ring);
  assert.deepEqual(ring.members, ["bibliographic-coupling", "pagerank-citation-graph"]);
});

test("SCC corpus: the rm3 pseudo relevance pair is one ring", () => {
  const ring = circularRings(GRAPH).find((r) => r.members.includes("rm3-query-expansion"));
  assert.ok(ring);
  assert.deepEqual(ring.members, ["pseudo-relevance-feedback", "rm3-query-expansion"]);
});

test("SCC corpus: the four member ANN ring is found whole", () => {
  const ring = circularRings(GRAPH).find((r) => r.members.includes("ann-hnsw"));
  assert.ok(ring);
  assert.deepEqual(
    ring.members,
    ["ann-hnsw", "dual-encoder-dpr", "product-quantization-ivfpq", "rrf-fusion"]
  );
});

test("SCC corpus: every corpus SCC matches brute force reachability", () => {
  for (const id of GRAPH.ids) {
    const expected = [...bruteClass(GRAPH, id)].sort();
    const actual = stronglyConnectedComponents(GRAPH).find((c) => c.members.includes(id)).members;
    assert.deepEqual(actual, expected, `component of ${id}`);
  }
});

test("SCC corpus: non ring components are singletons without self loops", () => {
  for (const c of stronglyConnectedComponents(GRAPH)) {
    if (!c.ring) {
      assert.equal(c.members.length, 1);
      const id = c.members[0];
      assert.equal((GRAPH.outLinks.get(id) ?? []).includes(id), false);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Graph primitive helpers
 * ------------------------------------------------------------------ */

test("primitives: terminalIds returns sorted out-degree zero papers", () => {
  const g = graphFromRefs({ b: ["t"], t: [], a: [] });
  assert.deepEqual(terminalIds(g), ["a", "t"]);
});

test("primitives: unverifiedIds returns sorted in-degree zero papers", () => {
  const g = graphFromRefs({ b: ["t"], c: ["t"], t: [] });
  assert.deepEqual(unverifiedIds(g), ["b", "c"]);
});

test("primitives: primarySourceId is the most cited terminal", () => {
  const g = graphFromRefs({ a: ["t1"], b: ["t1", "t2"], c: ["t1"], t1: [], t2: [] });
  assert.equal(primarySourceId(g), "t1");
});

test("primitives: primarySourceId breaks ties by id order", () => {
  const g = graphFromRefs({ a: ["t2"], b: ["t1"], t1: [], t2: [] });
  assert.equal(primarySourceId(g), "t1");
});

test("primitives: corpus has exactly one terminal, the vector space paper", () => {
  assert.deepEqual(terminalIds(GRAPH), ["vector-space-tfidf"]);
  assert.equal(primarySourceId(GRAPH), "vector-space-tfidf");
});

test("primitives: corpus unverified frontier is the uncited preprint set", () => {
  const unverified = unverifiedIds(GRAPH);
  assert.equal(unverified.length, 8);
  assert.ok(unverified.includes("scifact-claim-verification"));
  assert.ok(unverified.includes("sentence-bert"));
  for (const id of unverified) {
    assert.equal((GRAPH.inLinks.get(id) ?? []).length, 0);
  }
});

test("primitives: graphFromRefs drops references to undeclared ids", () => {
  const g = graphFromRefs({ a: ["missing", "b"], b: [] });
  assert.deepEqual(g.outLinks.get("a"), ["b"]);
  assert.equal(g.docCount, 2);
});

test("primitives: graphFromRefs deduplicates repeated references", () => {
  const g = graphFromRefs({ a: ["b", "b", "b"], b: [] });
  assert.deepEqual(g.outLinks.get("a"), ["b"]);
});

test("primitives: graphFromRefs preserves self loops like buildCitationGraph", () => {
  const corpusGraph = buildCitationGraph(buildIndex(loadDocuments()));
  const toy = graphFromRefs({ s: ["s"], t: [] });
  assert.deepEqual(toy.outLinks.get("s"), ["s"]);
  // The engine built graph has the same shape contract.
  assert.equal(typeof corpusGraph.ids.has, "function");
  assert.equal(corpusGraph.outLinks instanceof Map, true);
});

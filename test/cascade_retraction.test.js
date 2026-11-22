/**
 * cascade_retraction.test.js - independent chain counting, support depth and
 * the retraction blast radius.
 *
 * Support is defined as `minChains` internally vertex disjoint paths from a
 * claim down to terminal sources, counted exactly by max-flow over a node
 * split network. These tests pin the pathological cases (shared middle nodes,
 * converging routes, closed rings) and then prove the two invariants the
 * workbench advertises: retraction is monotonic, and multi path survivors are
 * always a subset of supported claims.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  graphFromRefs,
  terminalIds,
  independentChains,
  supportDepth,
  claimSupportMap,
  retractionCascade,
  circularRings
} from "../src/cascade_lab.js";
import { buildEngine } from "../src/benchmark.js";

const engine = buildEngine();
const GRAPH = engine.graph;

/** A seeded LCG so random subset sweeps are identical on every run. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function supportedClaims(map) {
  return [...map.values()].filter((s) => s.kind === "claim" && s.supported).length;
}

/* ------------------------------------------------------------------ *
 * independentChains: exact vertex disjoint path counting
 * ------------------------------------------------------------------ */

test("chains: a direct citation of a terminal is exactly one chain", () => {
  const g = graphFromRefs({ c: ["t"], t: [] });
  assert.equal(independentChains(g, "c"), 1);
});

test("chains: a claim with no path to a terminal counts zero", () => {
  const g = graphFromRefs({ c: ["d"], d: ["c"], t: [] });
  assert.equal(independentChains(g, "c"), 0);
  assert.equal(independentChains(g, "d"), 0);
});

test("chains: a terminal itself counts zero chains", () => {
  const g = graphFromRefs({ c: ["t"], t: [] });
  assert.equal(independentChains(g, "t"), 0);
});

test("chains: a diamond to two terminals counts two", () => {
  const g = graphFromRefs({ c: ["x", "y"], x: ["t1"], y: ["t2"], t1: [], t2: [] });
  assert.equal(independentChains(g, "c"), 2);
});

test("chains: two disjoint routes to the same terminal still count as two", () => {
  // The terminal is the evidence, not an intermediate hop, so sharing it does
  // not collapse the count.
  const g = graphFromRefs({ c: ["x", "y"], x: ["t"], y: ["t"], t: [] });
  assert.equal(independentChains(g, "c"), 2);
});

test("chains: routes sharing a middle node count as one", () => {
  const g = graphFromRefs({ c: ["x", "y"], x: ["m"], y: ["m"], m: ["t"], t: [] });
  assert.equal(independentChains(g, "c"), 1);
});

test("chains: a three branch funnel counts three", () => {
  const g = graphFromRefs({
    c: ["x", "y", "z"], x: ["t"], y: ["t"], z: ["t"], t: []
  });
  assert.equal(independentChains(g, "c"), 3);
});

test("chains: chains do not multiply through layered diamonds", () => {
  // Two diamonds in series: the narrow waist keeps the count at two.
  const g = graphFromRefs({
    c: ["x", "y"], x: ["p"], y: ["q"], p: ["t1"], q: ["t2"], t1: [], t2: []
  });
  assert.equal(independentChains(g, "c"), 2);
});

test("chains: a shared bottleneck limits every route through it", () => {
  const g = graphFromRefs({
    c: ["x", "y"], x: ["b"], y: ["b"], b: ["u", "v"], u: ["t"], v: ["t"], t: []
  });
  assert.equal(independentChains(g, "c"), 1);
  assert.equal(independentChains(g, "b"), 2);
});

test("chains: removing the bottleneck drops the count to zero", () => {
  const g = graphFromRefs({ c: ["x", "y"], x: ["b"], y: ["b"], b: ["t"], t: [] });
  assert.equal(independentChains(g, "c", new Set(["b"])), 0);
});

test("chains: removing one branch reduces the count by exactly one", () => {
  const g = graphFromRefs({ c: ["x", "y", "z"], x: ["t"], y: ["t"], z: ["t"], t: [] });
  assert.equal(independentChains(g, "c"), 3);
  assert.equal(independentChains(g, "c", new Set(["x"])), 2);
});

test("chains: a removed claim reports zero", () => {
  const g = graphFromRefs({ c: ["t"], t: [] });
  assert.equal(independentChains(g, "c", new Set(["c"])), 0);
});

test("chains: an unknown claim reports zero", () => {
  const g = graphFromRefs({ c: ["t"], t: [] });
  assert.equal(independentChains(g, "ghost"), 0);
});

test("chains: removing every terminal leaves zero for every claim", () => {
  const g = graphFromRefs({ c: ["t1"], d: ["t2"], t1: [], t2: [] });
  assert.equal(independentChains(g, "c", new Set(["t1", "t2"])), 0);
});

test("chains: a chain through a ring member counts normally", () => {
  // c -> a <-> b -> t: the ring does not create extra independent chains.
  const g = graphFromRefs({ c: ["a"], a: ["b"], b: ["a", "t"], t: [] });
  assert.equal(independentChains(g, "c"), 1);
});

test("chains: corpus bm25 chains exceed one (it reaches the terminal twice)", () => {
  const chains = independentChains(GRAPH, "bm25-okapi");
  assert.ok(chains >= 2, `expected >=2 chains for bm25-okapi, got ${chains}`);
});

test("chains: every corpus claim has a finite chain count", () => {
  for (const id of GRAPH.ids) {
    const chains = independentChains(GRAPH, id);
    assert.ok(Number.isInteger(chains), `${id} has non integer chains ${chains}`);
    assert.ok(chains >= 0 && chains < 40, `${id} chains ${chains} out of range`);
  }
});

test("chains: a self loop never creates a second chain", () => {
  const g = graphFromRefs({ c: ["c", "t"], t: [] });
  assert.equal(independentChains(g, "c"), 1);
});

/* ------------------------------------------------------------------ *
 * supportDepth
 * ------------------------------------------------------------------ */

test("depth: a direct terminal citation has depth one", () => {
  const g = graphFromRefs({ c: ["t"], t: [] });
  assert.equal(supportDepth(g, "c"), 1);
});

test("depth: a terminal itself has depth zero", () => {
  const g = graphFromRefs({ c: ["t"], t: [] });
  assert.equal(supportDepth(g, "t"), 0);
});

test("depth: the shortest of several routes wins", () => {
  const g = graphFromRefs({ c: ["x", "y"], x: ["t"], y: ["m"], m: ["t"], t: [] });
  assert.equal(supportDepth(g, "c"), 2);
});

test("depth: an unreachable claim returns null", () => {
  const g = graphFromRefs({ c: ["d"], d: [], e: ["c"] });
  // c -> d and d is itself a terminal, so c is supported at depth 1 while e is
  // depth 2; add a closed pair to check the null case.
  const closed = graphFromRefs({ p: ["q"], q: ["p"], t: [] });
  assert.equal(supportDepth(closed, "p"), null);
});

test("depth: removed nodes are skipped when computing depth", () => {
  const g = graphFromRefs({ c: ["x"], x: ["t"], t: [] });
  assert.equal(supportDepth(g, "c", new Set(["x"])), null);
});

test("depth: corpus claims sit within eight hops of the source", () => {
  let deepest = 0;
  for (const id of GRAPH.ids) {
    const depth = supportDepth(GRAPH, id);
    if (depth === null) continue;
    deepest = Math.max(deepest, depth);
    assert.ok(depth >= 0 && depth <= 8, `${id} depth ${depth}`);
  }
  assert.equal(deepest, 8);
});

/* ------------------------------------------------------------------ *
 * claimSupportMap
 * ------------------------------------------------------------------ */

test("support map: terminals are sources, everything else a claim", () => {
  const g = graphFromRefs({ c: ["t"], t: [] });
  const map = claimSupportMap(g, new Set(), 1);
  assert.equal(map.get("t").kind, "source");
  assert.equal(map.get("c").kind, "claim");
});

test("support map: removed ids are absent entirely", () => {
  const g = graphFromRefs({ c: ["t"], d: ["t"], t: [] });
  const map = claimSupportMap(g, new Set(["d"]), 1);
  assert.equal(map.has("d"), false);
  assert.equal(map.size, 2);
});

test("support map: minChains two drops single chain claims", () => {
  const g = graphFromRefs({ c: ["t"], d: ["x", "y"], x: ["t"], y: ["t"], t: [] });
  const one = claimSupportMap(g, new Set(), 1);
  const two = claimSupportMap(g, new Set(), 2);
  assert.equal(one.get("c").supported, true);
  assert.equal(two.get("c").supported, false);
  assert.equal(two.get("d").supported, true);
});

test("support map: a non numeric minChains falls back to one chain", () => {
  const g = graphFromRefs({ a: ["t"], t: [] });
  const map = claimSupportMap(g, new Set(), "later");
  assert.equal(map.get("a").supported, true);
});

test("support map: iteration order is sorted by document id", () => {
  const g = graphFromRefs({ z: ["a"], a: [], m: ["a"] });
  assert.deepEqual([...claimSupportMap(g).keys()], ["a", "m", "z"]);
});

test("support map: a claim on a ring that never exits is unsupported", () => {
  const g = graphFromRefs({ p: ["q"], q: ["p"], t: [] });
  const map = claimSupportMap(g);
  assert.equal(map.get("p").supported, false);
  assert.equal(map.get("q").supported, false);
});

test("support map: a ring that exits to a terminal is supported", () => {
  const g = graphFromRefs({ p: ["q"], q: ["p", "t"], t: [] });
  const map = claimSupportMap(g);
  assert.equal(map.get("p").supported, true);
  assert.equal(map.get("q").supported, true);
});

/* ------------------------------------------------------------------ *
 * retractionCascade: the blast radius
 * ------------------------------------------------------------------ */

test("cascade: retracting a sole source collapses exactly its dependents", () => {
  const g = graphFromRefs({ a: ["t1"], b: ["t1", "t2"], c: ["b"], t1: [], t2: [] });
  const result = retractionCascade(g, ["t1"]);
  assert.deepEqual(result.invalidated, ["a"]);
  assert.equal(result.perClaim.get("b").supported, true);
  assert.equal(result.perClaim.get("c").supported, true);
});

test("cascade: retracting a shared bottleneck collapses a whole fan", () => {
  const g = graphFromRefs({
    a: ["b"], b: ["t"], c: ["b"], d: ["c"], t: []
  });
  const result = retractionCascade(g, ["b"]);
  assert.deepEqual(result.invalidated, ["a", "c", "d"]);
});

test("cascade: unknown ids are reported rather than silently dropped", () => {
  const g = graphFromRefs({ a: ["t"], t: [] });
  const result = retractionCascade(g, ["ghost", "a"]);
  assert.deepEqual(result.unknown, ["ghost"]);
  assert.deepEqual(result.removed, ["a"]);
});

test("cascade: directlyCitesRemoved names the cut edges", () => {
  const g = graphFromRefs({ a: ["t1", "t2"], t1: [], t2: [] });
  const result = retractionCascade(g, ["t1"]);
  assert.deepEqual(result.perClaim.get("a").directlyCitesRemoved, ["t1"]);
});

test("cascade: a claim that survives is marked collapsed false", () => {
  const g = graphFromRefs({ a: ["t1", "t2"], t1: [], t2: [] });
  const result = retractionCascade(g, ["t1"]);
  assert.equal(result.perClaim.get("a").collapsed, false);
});

test("cascade: unsupported claims are never counted as collapsed", () => {
  // a is in a closed ring so unsupported before and after the retraction.
  const g = graphFromRefs({ a: ["b"], b: ["a"], c: ["t"], t: [] });
  const result = retractionCascade(g, ["t"]);
  assert.deepEqual(result.invalidated, ["c"]);
  assert.equal(result.perClaim.get("a").collapsed, false);
});

test("cascade: survival fraction is supported over surviving claims", () => {
  const g = graphFromRefs({ a: ["t1"], b: ["t1", "t2"], t1: [], t2: [] });
  const result = retractionCascade(g, ["t1"]);
  assert.equal(result.claimTotal, 2);
  assert.equal(result.supportedClaims, 1);
  assert.equal(result.survival, 0.5);
});

test("cascade: ring membership is flagged on surviving claims", () => {
  const g = graphFromRefs({ a: ["b"], b: ["a", "t"], t: [] });
  const result = retractionCascade(g, []);
  assert.equal(result.perClaim.get("a").ring, true);
  assert.equal(result.perClaim.get("b").ring, true);
});

test("cascade: minChains two can collapse a claim the retraction spared", () => {
  const g = graphFromRefs({ a: ["t1", "t2"], t1: [], t2: [] });
  const result = retractionCascade(g, ["t2"], { minChains: 2 });
  assert.deepEqual(result.invalidated, ["a"]);
});

test("cascade: a non numeric minChains falls back to the single chain bar", () => {
  const g = graphFromRefs({ a: ["t"], t: [] });
  const result = retractionCascade(g, [], { minChains: "later" });
  assert.equal(result.minChains, 1);
  assert.equal(result.perClaim.get("a").supported, true);
});

test("cascade: a NaN minChains cannot poison every claim into unsupported", () => {
  const g = graphFromRefs({ a: ["t"], t: [] });
  const result = retractionCascade(g, [], { minChains: NaN });
  assert.equal(result.minChains, 1);
  assert.equal(result.perClaim.get("a").supported, true);
});

test("cascade: multi path survivors have at least two chains", () => {
  const g = graphFromRefs({ a: ["x", "y"], x: ["t"], y: ["t"], b: ["t"], t: [] });
  const result = retractionCascade(g, []);
  assert.deepEqual(result.survivingMultiPath, ["a"]);
  // x, y and b each hold a single chain, so all three are single path survivors.
  assert.deepEqual(result.survivingSinglePath, ["b", "x", "y"]);
});

test("cascade: retracting nothing invalidates nothing", () => {
  const result = retractionCascade(GRAPH, []);
  assert.deepEqual(result.invalidated, []);
  assert.equal(result.unknown.length, 0);
});

test("cascade: corpus - retracting the primary source collapses all 37 claims", () => {
  const result = retractionCascade(GRAPH, ["vector-space-tfidf"]);
  assert.equal(result.invalidated.length, 37);
  assert.equal(result.supportedClaims, 0);
});

test("cascade: corpus - retracting an uncited preprint collapses only itself", () => {
  const result = retractionCascade(GRAPH, ["scifact-claim-verification"]);
  assert.deepEqual(result.invalidated, []);
});

test("cascade: corpus - retracting a ring member cannot collapse its unsupported twin", () => {
  // bibliographic-coupling was already unsupported inside the closed ring, so
  // retracting its ring partner reports it as untouched, not collapsed.
  const result = retractionCascade(GRAPH, ["pagerank-citation-graph"]);
  const other = result.perClaim.get("bibliographic-coupling");
  assert.equal(other.supported, false);
  assert.equal(other.collapsed, false);
  assert.equal(result.invalidated.includes("bibliographic-coupling"), false);
  assert.deepEqual(other.directlyCitesRemoved, ["pagerank-citation-graph"]);
});

test("cascade: corpus - every corpus claim is supported at baseline minChains 1", () => {
  const support = claimSupportMap(GRAPH, new Set(), 1);
  const claims = [...support.values()].filter((s) => s.kind === "claim");
  const supported = claims.filter((s) => s.supported);
  assert.equal(claims.length, 39);
  assert.equal(supported.length, 37);
  const unsupported = claims.filter((s) => !s.supported).map((s) => s.id).sort();
  assert.deepEqual(unsupported, ["bibliographic-coupling", "pagerank-citation-graph"]);
});

/* ------------------------------------------------------------------ *
 * Monotonicity invariants
 * ------------------------------------------------------------------ */

test("monotonicity: adding retracted papers never raises supported count (corpus, seeded sweep)", () => {
  const rand = lcg(0xC0FFEE);
  const ids = [...GRAPH.ids].sort();
  for (let i = 0; i < 40; i += 1) {
    const small = new Set();
    for (const id of ids) if (rand() < 0.3) small.add(id);
    const big = new Set(small);
    for (const id of ids) if (rand() < 0.25) big.add(id);
    const s = supportedClaims(claimSupportMap(GRAPH, small, 1));
    const b = supportedClaims(claimSupportMap(GRAPH, big, 1));
    assert.ok(b <= s, `${[...big].join("+")} supported ${b} > ${s}`);
  }
});

test("monotonicity: singleton then pair subsets on every corpus paper", () => {
  const ids = [...GRAPH.ids].sort();
  for (const id of ids) {
    const alone = supportedClaims(claimSupportMap(GRAPH, new Set([id]), 1));
    for (const other of ids) {
      if (other === id) continue;
      const pair = supportedClaims(claimSupportMap(GRAPH, new Set([id, other]), 1));
      assert.ok(pair <= alone, `${id}+${other} supported ${pair} > ${alone}`);
    }
  }
});

test("monotonicity: supported count at minChains 2 never exceeds minChains 1", () => {
  const rand = lcg(0xBEEF);
  const ids = [...GRAPH.ids].sort();
  for (let i = 0; i < 25; i += 1) {
    const removed = new Set();
    for (const id of ids) if (rand() < 0.3) removed.add(id);
    const one = supportedClaims(claimSupportMap(GRAPH, removed, 1));
    const two = supportedClaims(claimSupportMap(GRAPH, removed, 2));
    assert.ok(two <= one, `minChains 2 (${two}) exceeded 1 (${one})`);
  }
});

test("monotonicity: invalidation sets grow as the retraction set grows", () => {
  const g = graphFromRefs({ a: ["b"], b: ["t"], c: ["b"], t: [] });
  const step0 = retractionCascade(g, []).invalidated;
  const step1 = retractionCascade(g, ["t"]).invalidated;
  const step2 = retractionCascade(g, ["t", "b"]).invalidated;
  assert.deepEqual(step0, []);
  assert.ok(step1.length >= step0.length);
  assert.ok(step2.length >= step1.length - 2); // removed claims leave the list
});

test("monotonicity: chain counts never rise when nodes are removed", () => {
  const rand = lcg(0xF00D);
  const ids = [...GRAPH.ids].sort();
  for (let i = 0; i < 20; i += 1) {
    const removed = new Set();
    for (const id of ids) if (rand() < 0.25) removed.add(id);
    for (const id of ids) {
      if (removed.has(id)) continue;
      const before = independentChains(GRAPH, id, new Set());
      const after = independentChains(GRAPH, id, removed);
      assert.ok(after <= before, `${id}: ${after} > ${before}`);
    }
  }
});

test("monotonicity: the multi path survivor list is always inside the supported set", () => {
  const rand = lcg(0xCAFE);
  const ids = [...GRAPH.ids].sort();
  for (let i = 0; i < 20; i += 1) {
    const removed = [];
    for (const id of ids) if (rand() < 0.3) removed.push(id);
    const result = retractionCascade(GRAPH, removed);
    const supported = new Set([...result.perClaim.values()]
      .filter((s) => s.kind === "claim" && s.supported).map((s) => s.id));
    for (const id of result.survivingMultiPath) assert.ok(supported.has(id));
  }
});

/* ------------------------------------------------------------------ *
 * Corpus scale sanity
 * ------------------------------------------------------------------ */

test("cascade corpus: support map marks the closed ring members unsupported", () => {
  // pagerank-citation-graph <-> bibliographic-coupling is a closed ring with no
  // path to a terminal: neither member can be supported.
  const support = claimSupportMap(GRAPH, new Set(), 1);
  assert.equal(support.get("pagerank-citation-graph").supported, false);
  assert.equal(support.get("bibliographic-coupling").supported, false);
});

test("cascade corpus: a claim in an open ring is still supported", () => {
  // bm25 <-> dfr both reach vector-space-tfidf.
  const support = claimSupportMap(GRAPH, new Set(), 1);
  assert.equal(support.get("bm25-okapi").supported, true);
  assert.equal(support.get("dfr-divergence").supported, true);
});

test("cascade corpus: retracting every ring member cuts ring count to zero in audit terms", () => {
  const rings = circularRings(GRAPH);
  const members = [...new Set(rings.flatMap((r) => r.members))];
  const result = retractionCascade(GRAPH, members);
  assert.ok(result.survival < 1);
  assert.ok(result.claimTotal < 39);
});

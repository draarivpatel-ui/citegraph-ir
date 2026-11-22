/**
 * cascade_audits.test.js - single point of failure articulation papers and the
 * six row evidence hygiene audit table.
 *
 * Articulation papers are ranked by how many downstream claims collapse when
 * they alone are retracted; the audit battery replays the whole graph under
 * fixed transforms (baseline, retract primary source, remove unverified,
 * require two chains, retract all rings, and the live selection) and reports
 * survival, surviving ring count, and minimum support depth per row.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  graphFromRefs,
  articulationPapers,
  auditSpecifications,
  runAudit,
  auditSuite,
  buildCascadeAnalysis,
  claimSupportMap,
  circularRings,
  terminalIds,
  unverifiedIds,
  primarySourceId,
  ringMembers
} from "../src/cascade_lab.js";
import { buildEngine } from "../src/benchmark.js";

const engine = buildEngine();
const GRAPH = engine.graph;
const ANALYSIS = buildCascadeAnalysis(GRAPH);

/* ------------------------------------------------------------------ *
 * articulationPapers
 * ------------------------------------------------------------------ */

test("articulation: a single gateway paper is flagged when two claims depend", () => {
  const g = graphFromRefs({ a: ["b"], c: ["b"], b: ["t"], t: [] });
  const rows = articulationPapers(g);
  const b = rows.find((r) => r.id === "b");
  assert.equal(b.collapseCount, 2);
  assert.equal(b.articulation, true);
});

test("articulation: a paper collapsing one claim is listed but not flagged", () => {
  const g = graphFromRefs({ a: ["t"], t: [] });
  const rows = articulationPapers(g);
  const t = rows.find((r) => r.id === "t");
  assert.equal(t.collapseCount, 1);
  assert.equal(t.articulation, false);
});

test("articulation: a paper with no dependents does not appear", () => {
  const g = graphFromRefs({ a: ["t"], u: [], t: [] });
  const rows = articulationPapers(g);
  assert.equal(rows.some((r) => r.id === "u"), false);
});

test("articulation: collapses list names exactly the recount", () => {
  const g = graphFromRefs({ a: ["b"], c: ["b"], d: ["c"], b: ["t"], t: [] });
  const rows = articulationPapers(g);
  const b = rows.find((r) => r.id === "b");
  assert.deepEqual(b.collapses, ["a", "c", "d"]);
});

test("articulation: rows sort by collapse count then id", () => {
  const g = graphFromRefs({
    a: ["x"], b: ["x"], x: ["t1"],
    p: ["q"], q: ["t2"], t1: [], t2: []
  });
  const rows = articulationPapers(g);
  // t1 collapses a, b and x: the deepest blast first. x and t2 both collapse
  // two claims and break the tie by id order.
  assert.equal(rows[0].id, "t1");
  assert.equal(rows[0].collapseCount, 3);
  assert.deepEqual(rows.slice(1).map((r) => r.id), ["t2", "x", "q"]);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i].collapseCount <= rows[i - 1].collapseCount);
  }
});

test("articulation: corpus primary source collapses all 37 supported claims", () => {
  const rows = articulationPapers(GRAPH);
  const top = rows[0];
  assert.equal(top.id, "vector-space-tfidf");
  assert.equal(top.collapseCount, 37);
  assert.equal(top.articulation, true);
});

test("articulation: corpus - the metric papers are genuine articulation points", () => {
  const rows = articulationPapers(GRAPH);
  const ndcg = rows.find((r) => r.id === "ndcg-graded-relevance");
  assert.ok(ndcg);
  assert.equal(ndcg.articulation, true);
  assert.ok(ndcg.collapseCount >= 2);
});

test("articulation: corpus - every flagged paper collapses at least two claims", () => {
  for (const row of articulationPapers(GRAPH)) {
    if (row.articulation) assert.ok(row.collapseCount >= 2, row.id);
  }
});

test("articulation: corpus - retracting a flagged paper really drops the listed claims", () => {
  for (const row of articulationPapers(GRAPH).slice(0, 6)) {
    const base = claimSupportMap(GRAPH, new Set(), 1);
    const after = claimSupportMap(GRAPH, new Set([row.id]), 1);
    const recount = [...after.values()]
      .filter((s) => s.kind === "claim" && (base.get(s.id)?.supported ?? false) && !s.supported)
      .map((s) => s.id).sort();
    assert.deepEqual(recount, [...row.collapses].sort(), row.id);
  }
});

test("articulation: a ring member alone cannot be an articulation point for its twin", () => {
  // p and q support each other through a terminal exit; neither alone is a
  // bottleneck for the other.
  const g = graphFromRefs({ p: ["q"], q: ["p", "t"], t: [] });
  const rows = articulationPapers(g);
  assert.equal(rows.some((r) => r.id === "p" && r.collapses.includes("q")), false);
});

/* ------------------------------------------------------------------ *
 * auditSpecifications and runAudit
 * ------------------------------------------------------------------ */

test("audit specs: the fixed battery has five deterministic audits", () => {
  const specs = auditSpecifications(GRAPH);
  assert.equal(specs.length, 5);
  assert.deepEqual(specs.map((s) => s.id),
    ["baseline", "retract-primary", "remove-unverified", "require-two", "retract-rings"]);
});

test("audit specs: baseline removes nothing and requires one chain", () => {
  const spec = auditSpecifications(GRAPH).find((s) => s.id === "baseline");
  assert.deepEqual(spec.removed, []);
  assert.equal(spec.minChains, 1);
});

test("audit specs: retract-primary removes the most cited terminal", () => {
  const spec = auditSpecifications(GRAPH).find((s) => s.id === "retract-primary");
  assert.deepEqual(spec.removed, [primarySourceId(GRAPH)]);
});

test("audit specs: remove-unverified removes every uncited paper", () => {
  const spec = auditSpecifications(GRAPH).find((s) => s.id === "remove-unverified");
  assert.deepEqual(spec.removed, unverifiedIds(GRAPH));
});

test("audit specs: require-two keeps the graph but raises the bar", () => {
  const spec = auditSpecifications(GRAPH).find((s) => s.id === "require-two");
  assert.deepEqual(spec.removed, []);
  assert.equal(spec.minChains, 2);
});

test("audit specs: retract-rings removes every ring member", () => {
  const spec = auditSpecifications(GRAPH).find((s) => s.id === "retract-rings");
  assert.deepEqual(spec.removed, [...ringMembers(GRAPH)].sort());
});

test("runAudit: baseline reports the corpus state exactly", () => {
  const row = runAudit(GRAPH, auditSpecifications(GRAPH)[0]);
  assert.equal(row.claims, 39);
  assert.equal(row.supported, 37);
  assert.equal(row.sources, 1);
  assert.equal(row.ringCount, 8);
  assert.equal(row.collapsed, 0);
  assert.equal(row.minSupportDepth, 1);
});

test("runAudit: survival is supported over claims", () => {
  const row = runAudit(GRAPH, auditSpecifications(GRAPH)[0]);
  assert.ok(Math.abs(row.survival - 37 / 39) < 1e-12);
});

test("runAudit: retract-primary kills every claim but keeps the rings", () => {
  const spec = auditSpecifications(GRAPH).find((s) => s.id === "retract-primary");
  const row = runAudit(GRAPH, spec);
  assert.equal(row.supported, 0);
  assert.equal(row.collapsed, 37);
  assert.equal(row.ringCount, 8);
  assert.equal(row.minSupportDepth, null);
});

test("runAudit: remove-unverified shrinks claims without touching rings", () => {
  const row = runAudit(GRAPH, auditSpecifications(GRAPH).find((s) => s.id === "remove-unverified"));
  assert.equal(row.removedCount, 8);
  assert.equal(row.claims, 31);
  assert.equal(row.ringCount, 8);
  assert.equal(row.supported, 29);
});

test("runAudit: require-two supports fewer claims than baseline", () => {
  const row = runAudit(GRAPH, auditSpecifications(GRAPH).find((s) => s.id === "require-two"));
  assert.equal(row.claims, 39);
  assert.ok(row.supported < 37, `expected < 37, got ${row.supported}`);
  assert.equal(row.multiChain, row.supported);
  assert.equal(row.singleChain, 0);
});

test("runAudit: retract-rings reports zero rings in the audited subgraph", () => {
  const row = runAudit(GRAPH, auditSpecifications(GRAPH).find((s) => s.id === "retract-rings"));
  assert.equal(row.ringCount, 0);
  assert.equal(row.removedCount, ringMembers(GRAPH).size);
});

test("runAudit: single and multi partition the supported claims", () => {
  for (const spec of auditSpecifications(GRAPH)) {
    const row = runAudit(GRAPH, spec);
    assert.equal(row.singleChain + row.multiChain, row.supported, spec.id);
  }
});

test("runAudit: claims plus sources equal surviving documents", () => {
  for (const spec of auditSpecifications(GRAPH)) {
    const row = runAudit(GRAPH, spec);
    assert.equal(row.claims + row.sources, GRAPH.docCount - row.removedCount, spec.id);
  }
});

test("runAudit: unsupported plus supported equals claims", () => {
  for (const spec of auditSpecifications(GRAPH)) {
    const row = runAudit(GRAPH, spec);
    assert.equal(row.supported + row.unsupported, row.claims, spec.id);
  }
});

test("runAudit: minSupportDepth is the smallest supported depth or null", () => {
  for (const spec of auditSpecifications(GRAPH)) {
    const row = runAudit(GRAPH, spec);
    if (row.supported === 0) {
      assert.equal(row.minSupportDepth, null, spec.id);
    } else {
      assert.ok(row.minSupportDepth >= 1, spec.id);
    }
  }
});

test("runAudit: an unknown spec still yields a coherent row", () => {
  const row = runAudit(GRAPH, { id: "custom", label: "Custom", removed: ["bm25-okapi"], minChains: 1 });
  assert.equal(row.removedCount, 1);
  assert.equal(row.claims, 38);
});

test("runAudit: unknown ids in the removed list are dropped, not counted", () => {
  const row = runAudit(GRAPH, { id: "x", label: "x", removed: ["ghost", "bm25-okapi"], minChains: 1 });
  assert.equal(row.removedCount, 1);
  assert.deepEqual(row.removed, ["bm25-okapi"]);
  assert.equal(row.claims + row.sources, GRAPH.docCount - row.removedCount);
});

test("runAudit: a non numeric minChains falls back to one", () => {
  const row = runAudit(GRAPH, { id: "x", label: "x", removed: [], minChains: NaN });
  assert.equal(row.minChains, 1);
});

test("audit specs: a terminal free graph retracts nothing for retract-primary", () => {
  const g = graphFromRefs({ a: ["b"], b: ["a"] });
  const spec = auditSpecifications(g).find((s) => s.id === "retract-primary");
  assert.deepEqual(spec.removed, []);
});

/* ------------------------------------------------------------------ *
 * auditSuite and buildCascadeAnalysis
 * ------------------------------------------------------------------ */

test("auditSuite: five rows without a selection, six with one", () => {
  assert.equal(auditSuite(GRAPH).length, 5);
  const withSel = auditSuite(GRAPH, { removed: ["bm25-okapi"], minChains: 1 });
  assert.equal(withSel.length, 6);
  assert.equal(withSel[5].id, "selection");
});

test("auditSuite: an empty selection adds no sixth row", () => {
  assert.equal(auditSuite(GRAPH, { removed: [], minChains: 1 }).length, 5);
});

test("auditSuite: a null selection adds no sixth row", () => {
  assert.equal(auditSuite(GRAPH, null).length, 5);
});

test("auditSuite: the selection row mirrors a direct runAudit of the same spec", () => {
  const sel = { removed: ["vector-space-tfidf"], minChains: 1 };
  const suite = auditSuite(GRAPH, sel);
  const direct = runAudit(GRAPH, { id: "x", label: "x", ...sel });
  assert.equal(suite[5].supported, direct.supported);
  assert.equal(suite[5].survival, direct.survival);
});

test("auditSuite: survival never exceeds 1 and never goes negative", () => {
  for (const row of auditSuite(GRAPH, { removed: ["bm25-okapi", "vector-space-tfidf"], minChains: 2 })) {
    assert.ok(row.survival >= 0 && row.survival <= 1, row.id);
  }
});

test("analysis: bundles doc and edge counts, terminals, rings, unverified and articulation", () => {
  assert.equal(ANALYSIS.docCount, 40);
  assert.equal(ANALYSIS.edgeCount, 77);
  assert.deepEqual(ANALYSIS.terminals, ["vector-space-tfidf"]);
  assert.equal(ANALYSIS.primarySource, "vector-space-tfidf");
  assert.equal(ANALYSIS.rings.length, 8);
  assert.equal(ANALYSIS.unverified.length, 8);
  assert.equal(ANALYSIS.articulation[0].id, "vector-space-tfidf");
});

test("analysis: ringMembers is the sorted union of all rings", () => {
  const flat = ANALYSIS.rings.flatMap((r) => r.members).sort();
  assert.deepEqual(ANALYSIS.ringMembers, flat);
});

test("analysis: edge count equals the corpus citation link total", () => {
  const total = [...GRAPH.outLinks.values()].reduce((n, refs) => n + refs.length, 0);
  assert.equal(ANALYSIS.edgeCount, total);
});

test("analysis: the audit battery is deterministic across builds", () => {
  const a = auditSuite(GRAPH, { removed: ["bm25-okapi"], minChains: 1 });
  const b = auditSuite(GRAPH, { removed: ["bm25-okapi"], minChains: 1 });
  assert.deepEqual(JSON.stringify(a), JSON.stringify(b));
});

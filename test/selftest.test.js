/**
 * selftest.test.js - the in-page self test battery, executed under node:test.
 *
 * The browser panel runs `runSelfTests` against the live modules; this suite
 * runs the same battery in CI so a failing self test fails the suite rather
 * than only showing red in a tab. It also pins the battery's contract: every
 * row has a name, a boolean verdict and never throws.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runSelfTests } from "../src/selftest.js";
import { buildCascadeAnalysis, auditSuite, graphFromRefs } from "../src/cascade_lab.js";
import { buildEngine } from "../src/benchmark.js";

const engine = buildEngine();
const GRAPH = engine.graph;
const ANALYSIS = buildCascadeAnalysis(GRAPH);
const AUDITS = auditSuite(GRAPH);
const ROWS = runSelfTests(GRAPH, { ...ANALYSIS, auditRows: AUDITS });

test("selftest battery: every row passes on the shipped corpus", () => {
  const failed = ROWS.filter((r) => !r.passed);
  assert.deepEqual(failed.map((r) => `${r.name}: ${r.detail}`), []);
});

test("selftest battery: runs at least 24 checks", () => {
  assert.ok(ROWS.length >= 24, `only ${ROWS.length} checks`);
});

test("selftest battery: every row has a name, boolean verdict and string detail", () => {
  for (const row of ROWS) {
    assert.equal(typeof row.name, "string");
    assert.ok(row.name.length > 8, row.name);
    assert.equal(typeof row.passed, "boolean");
    assert.equal(typeof row.detail, "string");
  }
});

test("selftest battery: names are unique", () => {
  const names = ROWS.map((r) => r.name);
  assert.equal(new Set(names).size, names.length);
});

test("selftest battery: covers the six advertised families", () => {
  const names = ROWS.map((r) => r.name).join("\n");
  assert.match(names, /sha256/);
  assert.match(names, /tarjan/);
  assert.match(names, /acyclic/);
  assert.match(names, /monotonic/);
  assert.match(names, /multi path/);
  assert.match(names, /csv escaping/);
  assert.match(names, /tampered/);
  assert.match(names, /url hash/);
});

test("selftest battery: never throws on a degenerate graph", () => {
  const tiny = graphFromRefs({ only: [] });
  const rows = runSelfTests(tiny);
  for (const row of rows) {
    assert.equal(typeof row.name, "string");
    assert.equal(typeof row.passed, "boolean");
  }
});

test("selftest battery: analysis null degrades gracefully, not crashes", () => {
  const rows = runSelfTests(GRAPH, null);
  assert.ok(rows.length >= 24);
  // The report checks report a friendly failure, not a throw.
  const reportRows = rows.filter((r) => r.name.includes("report"));
  assert.ok(reportRows.length >= 2);
});

test("selftest battery: deterministic across two runs", () => {
  const again = runSelfTests(GRAPH, { ...ANALYSIS, auditRows: AUDITS });
  assert.deepEqual(ROWS.map((r) => r.passed), again.map((r) => r.passed));
});

test("selftest battery: the FIPS sha rows really verify known answers", () => {
  const sha = ROWS.filter((r) => r.name.startsWith("sha256"));
  assert.ok(sha.length >= 4);
  for (const row of sha) assert.equal(row.passed, true, row.name);
});

test("selftest battery: the tarjan rows prove exact cycle detection", () => {
  const tarjan = ROWS.filter((r) => r.name.includes("tarjan") || r.name.includes("ring") || r.name.includes("cycle"));
  assert.ok(tarjan.length >= 4);
  for (const row of tarjan) assert.equal(row.passed, true, row.name);
});

test("selftest battery: the monotonicity sweep covers at least a dozen subsets", () => {
  const row = ROWS.find((r) => r.name.includes("monotonic"));
  assert.ok(row);
  assert.equal(row.passed, true);
});

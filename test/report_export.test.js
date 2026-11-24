/**
 * report_export.test.js - canonical serialization, the checksummed audit
 * report, injection safe CSV and the Markdown export.
 *
 * The digest is an unkeyed SHA-256 over the canonical body, so the same input
 * always produces the same checksum and any edit of the body is detected on
 * replay. These tests cover the canonicalizer, the report builder, the
 * verifier's exact failure modes, the CSV cell rules (including spreadsheet
 * formula injection) and the Markdown rendering.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJson,
  corpusFingerprint,
  buildProvenanceReport,
  verifyReportJson,
  csvCell,
  csvRow,
  reportCsv,
  reportMarkdown,
  REPORT_KIND,
  REPORT_VERSION
} from "../src/report_export.js";
import { sha256Hex } from "../src/sha256.js";
import { buildCascadeAnalysis, auditSuite } from "../src/cascade_lab.js";
import { buildEngine } from "../src/benchmark.js";

const engine = buildEngine();
const GRAPH = engine.graph;
const ANALYSIS = buildCascadeAnalysis(GRAPH);
const AUDITS = auditSuite(GRAPH, { removed: ["vector-space-tfidf"], minChains: 1 });
const REPORT = buildProvenanceReport({
  graph: GRAPH,
  analysis: ANALYSIS,
  audits: AUDITS,
  selection: { retracted: ["vector-space-tfidf"], minChains: 1 }
});

/* ------------------------------------------------------------------ *
 * canonicalJson
 * ------------------------------------------------------------------ */

test("canonical: object keys are sorted recursively", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
});

test("canonical: array order is preserved", () => {
  assert.equal(canonicalJson([3, 1, 2]), "[3,1,2]");
});

test("canonical: strings, numbers and booleans serialize like JSON.stringify", () => {
  assert.equal(canonicalJson("x"), '"x"');
  assert.equal(canonicalJson(1.5), "1.5");
  assert.equal(canonicalJson(true), "true");
  assert.equal(canonicalJson(null), "null");
});

test("canonical: nested arrays and objects interleave", () => {
  assert.equal(canonicalJson({ a: [{ b: 1, a: 0 }] }), '{"a":[{"a":0,"b":1}]}');
});

test("canonical: non finite numbers become null", () => {
  assert.equal(canonicalJson({ a: Infinity, b: NaN }), '{"a":null,"b":null}');
});

test("canonical: undefined object fields become null like JSON", () => {
  assert.equal(canonicalJson({ a: undefined }), '{"a":null}');
});

test("canonical: two insertion orders serialize identically", () => {
  assert.equal(canonicalJson({ a: 1, b: 2, c: 3 }), canonicalJson({ c: 3, b: 2, a: 1 }));
});

test("canonical: empty containers", () => {
  assert.equal(canonicalJson({}), "{}");
  assert.equal(canonicalJson([]), "[]");
});

/* ------------------------------------------------------------------ *
 * corpusFingerprint
 * ------------------------------------------------------------------ */

test("fingerprint: documents, edges and a 64 char digest", () => {
  const fp = corpusFingerprint(GRAPH);
  assert.equal(fp.documents, 40);
  assert.equal(fp.edges, 77);
  assert.match(fp.digest, /^[0-9a-f]{64}$/);
});

test("fingerprint: identical graphs share a digest", () => {
  assert.equal(corpusFingerprint(GRAPH).digest, corpusFingerprint(GRAPH).digest);
});

test("fingerprint: a different edge set changes the digest", () => {
  const toy = {
    ids: new Set(["a", "b"]),
    outLinks: new Map([["a", ["b"]], ["b", []]]),
    inLinks: new Map([["a", []], ["b", ["a"]]]),
    docCount: 2
  };
  const fp = corpusFingerprint(toy);
  assert.notEqual(fp.digest, corpusFingerprint(GRAPH).digest);
  assert.equal(fp.documents, 2);
  assert.equal(fp.edges, 1);
});

/* ------------------------------------------------------------------ *
 * buildProvenanceReport
 * ------------------------------------------------------------------ */

test("report: kind, version, body and integrity blocks are present", () => {
  assert.equal(REPORT.kind, REPORT_KIND);
  assert.equal(REPORT.version, REPORT_VERSION);
  assert.equal(typeof REPORT.body, "object");
  assert.equal(typeof REPORT.integrity, "object");
  assert.match(REPORT.integrity.digest, /^[0-9a-f]{64}$/);
});

test("report: the digest is sha256 of the canonical body", () => {
  assert.equal(REPORT.integrity.digest, sha256Hex(canonicalJson(REPORT.body)));
});

test("report: the integrity block is honestly labelled unkeyed", () => {
  assert.equal(REPORT.integrity.keyed, false);
  assert.match(REPORT.integrity.purpose, /unkeyed/i);
  assert.match(REPORT.integrity.purpose, /not a MAC/);
  assert.match(REPORT.integrity.algorithm, /SHA-256/);
});

test("report: body carries corpus fingerprint and all six audit rows", () => {
  assert.equal(REPORT.body.corpus.documents, 40);
  assert.equal(REPORT.body.corpus.citationEdges, 77);
  assert.equal(REPORT.body.corpus.terminalSources, 1);
  assert.equal(REPORT.body.audits.length, 6);
  assert.equal(REPORT.body.audits[5].id, "selection");
});

test("report: selection is sorted and clamped into the body", () => {
  const report = buildProvenanceReport({
    graph: GRAPH, analysis: ANALYSIS, audits: AUDITS,
    selection: { retracted: ["bm25-okapi", "ann-hnsw"], minChains: 2 }
  });
  assert.deepEqual(report.body.selection.retracted, ["ann-hnsw", "bm25-okapi"]);
  assert.equal(report.body.selection.minChains, 2);
});

test("report: circular rings and articulation papers are serialized", () => {
  assert.equal(REPORT.body.circularRings.length, 8);
  assert.equal(REPORT.body.circularRings[0].id, "ring-1");
  assert.ok(REPORT.body.articulationPapers.length > 0);
  assert.equal(REPORT.body.articulationPapers[0].id, "vector-space-tfidf");
});

test("report: the scope note keeps the synthetic corpus disclosure", () => {
  assert.match(REPORT.body.scope, /[Ss]ynthetic/);
  assert.match(REPORT.body.scope, /unkeyed SHA-256/);
});

test("report: no timestamp - two builds of one state are byte identical", () => {
  const a = buildProvenanceReport({
    graph: GRAPH, analysis: ANALYSIS, audits: AUDITS,
    selection: { retracted: ["vector-space-tfidf"], minChains: 1 }
  });
  const b = buildProvenanceReport({
    graph: GRAPH, analysis: ANALYSIS, audits: AUDITS,
    selection: { retracted: ["vector-space-tfidf"], minChains: 1 }
  });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.integrity.digest, b.integrity.digest);
});

test("report: different selections produce different digests", () => {
  const other = buildProvenanceReport({
    graph: GRAPH, analysis: ANALYSIS, audits: AUDITS,
    selection: { retracted: ["bm25-okapi"], minChains: 1 }
  });
  assert.notEqual(other.integrity.digest, REPORT.integrity.digest);
});

test("report: a missing selection still yields a valid report", () => {
  const report = buildProvenanceReport({ graph: GRAPH, analysis: ANALYSIS, audits: AUDITS });
  assert.deepEqual(report.body.selection, { retracted: [], minChains: 1 });
  assert.equal(verifyReportJson(JSON.stringify(report)).ok, true);
});

test("report: audit rows carry the workbench readouts verbatim", () => {
  const row = REPORT.body.audits[0];
  assert.equal(row.id, "baseline");
  assert.equal(row.claims, 39);
  assert.equal(row.supported, 37);
  assert.equal(row.circularRings, 8);
  assert.equal(row.minSupportDepth, 1);
  assert.equal(typeof row.supportedSurvivalPct, "number");
});

/* ------------------------------------------------------------------ *
 * verifyReportJson
 * ------------------------------------------------------------------ */

test("verify: a freshly built report verifies", () => {
  const result = verifyReportJson(JSON.stringify(REPORT));
  assert.equal(result.ok, true);
  assert.equal(result.digest, REPORT.integrity.digest);
});

test("verify: an edited body is caught by the digest", () => {
  const tampered = JSON.parse(JSON.stringify(REPORT));
  tampered.body.audits[0].supported += 1;
  const result = verifyReportJson(JSON.stringify(tampered));
  assert.equal(result.ok, false);
  assert.match(result.reason, /mismatch/);
  assert.equal(result.expected, REPORT.integrity.digest);
});

test("verify: an edited digest is caught too", () => {
  const tampered = JSON.parse(JSON.stringify(REPORT));
  tampered.integrity.digest = "0".repeat(64);
  assert.equal(verifyReportJson(JSON.stringify(tampered)).ok, false);
});

test("verify: key reordering still verifies, canonicalization is order free", () => {
  const reordered = {
    integrity: REPORT.integrity,
    body: Object.fromEntries(Object.entries(REPORT.body).reverse()),
    version: REPORT.version,
    kind: REPORT.kind
  };
  assert.equal(verifyReportJson(JSON.stringify(reordered)).ok, true);
});

test("verify: empty input is rejected politely", () => {
  assert.equal(verifyReportJson("").ok, false);
  assert.equal(verifyReportJson("   ").ok, false);
});

test("verify: non JSON input is rejected politely", () => {
  const result = verifyReportJson("not json at all {");
  assert.equal(result.ok, false);
  assert.match(result.reason, /JSON/);
});

test("verify: a foreign JSON format is rejected by kind", () => {
  const result = verifyReportJson(JSON.stringify({ kind: "other.format", body: {}, integrity: { digest: "x" } }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /provenance audit/);
});

test("verify: a missing integrity block is rejected", () => {
  const result = verifyReportJson(JSON.stringify({ kind: REPORT_KIND, body: REPORT.body }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /integrity/);
});

test("verify: a missing body is rejected", () => {
  const result = verifyReportJson(JSON.stringify({ kind: REPORT_KIND, integrity: { digest: "x" } }));
  assert.equal(result.ok, false);
  assert.match(result.reason, /body/);
});

test("verify: a string instead of an object is rejected", () => {
  assert.equal(verifyReportJson('"a string"').ok, false);
  assert.equal(verifyReportJson("42").ok, false);
});

test("verify: the digest scope is exactly the body, so extra top level fields verify", () => {
  // The checksum statement is honest: integrity covers `body`, and a sibling
  // field cannot corrupt it - it is simply outside the signed region.
  const withExtra = JSON.parse(JSON.stringify(REPORT));
  withExtra.extra = "outside the digest scope";
  assert.equal(verifyReportJson(JSON.stringify(withExtra)).ok, true);
});

test("verify: editing a ring member inside the body is detected", () => {
  const tampered = JSON.parse(JSON.stringify(REPORT));
  tampered.body.circularRings[0].members.push("ghost-doc");
  assert.equal(verifyReportJson(JSON.stringify(tampered)).ok, false);
});

/* ------------------------------------------------------------------ *
 * CSV escaping
 * ------------------------------------------------------------------ */

test("csv: a formula leading equals is neutralised with a quote prefix", () => {
  assert.equal(csvCell("=SUM(A1:A9)"), "'=SUM(A1:A9)");
});

test("csv: leading plus, minus and at signs are neutralised", () => {
  assert.equal(csvCell("+cmd"), "'+cmd");
  assert.equal(csvCell("-1+1"), "'-1+1");
  assert.equal(csvCell("@mention"), "'@mention");
});

test("csv: a leading tab or carriage return is neutralised", () => {
  assert.equal(csvCell("\tevil"), "'\tevil");
  // A carriage return also trips the quoting rule, so the neutralised cell
  // arrives quoted.
  assert.equal(csvCell("\r=cmd"), '"\'\r=cmd"');
});

test("csv: commas quote the field", () => {
  assert.equal(csvCell("a,b"), '"a,b"');
});

test("csv: embedded quotes are doubled inside a quoted field", () => {
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
});

test("csv: line breaks quote the field", () => {
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell("line1\r\nline2"), '"line1\r\nline2"');
});

test("csv: a formula containing commas gets both treatments", () => {
  assert.equal(csvCell("=cmd,x"), '"\'=cmd,x"');
});

test("csv: numbers, null and undefined serialize plainly", () => {
  assert.equal(csvCell(42), "42");
  assert.equal(csvCell(0), "0");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
});

test("csv: ordinary text passes through untouched", () => {
  assert.equal(csvCell("Baseline graph"), "Baseline graph");
});

test("csv: csvRow joins cells with commas", () => {
  assert.equal(csvRow(["a", "b,c", 1]), 'a,"b,c",1');
});

test("csv: reportCsv has a header plus one row per audit", () => {
  const lines = reportCsv(REPORT).trimEnd().split("\r\n");
  assert.equal(lines.length, 1 + REPORT.body.audits.length);
  assert.equal(lines[0].split(",").length, 9);
});

test("csv: reportCsv rows carry the numeric readouts", () => {
  const lines = reportCsv(REPORT).trimEnd().split("\r\n");
  const baseline = lines[1].split(",");
  assert.equal(baseline[0], "Baseline graph");
  assert.equal(baseline[3], "39");
  assert.equal(baseline[4], "37");
  assert.equal(baseline[6], "8");
});

test("csv: reportCsv ends with a CRLF", () => {
  assert.equal(reportCsv(REPORT).endsWith("\r\n"), true);
});

/* ------------------------------------------------------------------ *
 * Markdown export
 * ------------------------------------------------------------------ */

test("markdown: renders the audit table with all six rows", () => {
  const md = reportMarkdown(REPORT);
  const tableRows = md.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| ---"));
  assert.equal(tableRows.length, 1 + 6); // header + audits
  assert.ok(md.includes("Require 2 independent chains"));
});

test("markdown: lists every circular ring", () => {
  const md = reportMarkdown(REPORT);
  const ringLines = md.split("\n").filter((l) => l.startsWith("- ring-"));
  assert.equal(ringLines.length, 8);
});

test("markdown: lists articulation papers with collapse counts", () => {
  const md = reportMarkdown(REPORT);
  assert.ok(md.includes("vector-space-tfidf"));
  assert.match(md, /collapses \d+ claims/);
});

test("markdown: carries the digest and the honest scope note", () => {
  const md = reportMarkdown(REPORT);
  assert.ok(md.includes(REPORT.integrity.digest));
  assert.ok(md.includes("unkeyed SHA-256"));
  assert.ok(md.includes("Synthetic bundled collection"));
});

test("markdown: names the corpus fingerprint", () => {
  const md = reportMarkdown(REPORT);
  assert.ok(md.includes(REPORT.body.corpus.fingerprint));
});

/* ------------------------------------------------------------------ *
 * Cross format consistency: one digest everywhere
 * ------------------------------------------------------------------ */

test("consistency: JSON, CSV and Markdown all derive from one report object", () => {
  const json = JSON.stringify(REPORT);
  const csv = reportCsv(REPORT);
  const md = reportMarkdown(REPORT);
  assert.ok(json.includes(REPORT.integrity.digest));
  assert.ok(md.includes(REPORT.integrity.digest));
  assert.ok(csv.length > 0);
});

test("regression: verify rejects a report from an unsupported format version", () => {
  const future = JSON.parse(JSON.stringify(REPORT));
  future.version = REPORT_VERSION + 1;
  const result = verifyReportJson(JSON.stringify(future));
  assert.equal(result.ok, false);
  assert.match(result.reason, /version/);
});

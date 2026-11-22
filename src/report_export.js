/**
 * report_export.js - the checksummed provenance audit report.
 *
 * A report is a JSON object with three parts:
 *   kind      - a format tag so a pasted blob is recognised as ours
 *   body      - the audit payload: corpus fingerprint, audits, rings,
 *               articulation papers and the interactive selection
 *   integrity - { algorithm, keyed: false, purpose, digest }
 *
 * The digest is the SHA-256 of the canonical serialization of `body`. Canonical
 * means object keys sorted recursively, so the same content always hashes to
 * the same string regardless of the order a producer happened to write the
 * fields in. There is deliberately no timestamp in the payload: a field that
 * changes on every build would give a different digest for identical content,
 * and would make the checksum useless as a reproducibility check.
 *
 * The digest is unkeyed. It detects accidental corruption and casual edits; it
 * cannot prove authorship because anyone can recompute it. Every surface that
 * prints the digest repeats that scope note.
 *
 * No dependency on the DOM, on Node built ins, or on any package.
 */

import { sha256Hex, utf8Bytes } from "./sha256.js";

/* ------------------------------------------------------------------ *
 * Canonical JSON
 * ------------------------------------------------------------------ */

/**
 * Serialize a JSON value with object keys in sorted order at every depth.
 * Two structurally equal values always produce byte identical strings, which
 * is the property the checksum relies on. Non finite numbers and undefined
 * follow JSON.stringify semantics and become null.
 */
export function canonicalJson(value) {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number" && !Number.isFinite(value)) return "null";
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalJson(item)).join(",") + "]";
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return "{" + parts.join(",") + "}";
  }
  return "null";
}

/* ------------------------------------------------------------------ *
 * Report construction and verification
 * ------------------------------------------------------------------ */

export const REPORT_KIND = "citegraph-ir.provenance-audit";
export const REPORT_VERSION = 1;

const INTEGRITY_NOTE =
  "Unkeyed SHA-256 (FIPS 180-4) digest of the canonical JSON body. Detects accidental " +
  "corruption and casual edits. It is not a MAC and not a signature: anyone can recompute " +
  "it, so it proves integrity of the copy, never authorship of the content.";

/**
 * A deterministic corpus fingerprint: the digest of the sorted document ids
 * and the sorted edge list. Two collections only share a fingerprint when the
 * ids and citation links are identical.
 */
export function corpusFingerprint(graph) {
  const ids = [...graph.ids].sort();
  const edges = [];
  for (const id of ids) {
    for (const ref of [...(graph.outLinks.get(id) ?? [])].sort()) {
      edges.push([id, ref]);
    }
  }
  edges.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  return { documents: ids.length, edges: edges.length, digest: sha256Hex(canonicalJson({ ids, edges })) };
}

/**
 * Build the provenance audit report body. Everything in it is derived data:
 * audits rows come from `auditSuite`, rings and articulation from the cascade
 * analysis, and the selection echoes the interactive retraction set. Pass the
 * same inputs and the same body (and therefore the same digest) comes out.
 */
export function buildProvenanceReport({ graph, analysis, audits, selection }) {
  const fingerprint = corpusFingerprint(graph);
  const body = {
    format: REPORT_KIND,
    formatVersion: REPORT_VERSION,
    corpus: {
      documents: fingerprint.documents,
      citationEdges: fingerprint.edges,
      terminalSources: analysis.terminals.length,
      fingerprint: fingerprint.digest
    },
    selection: {
      retracted: [...(selection?.retracted ?? [])].sort(),
      minChains: selection?.minChains ?? 1
    },
    audits: audits.map((row) => ({
      id: row.id,
      label: row.label,
      removedCount: row.removedCount,
      minChains: row.minChains,
      claims: row.claims,
      sources: row.sources,
      supported: row.supported,
      unsupported: row.unsupported,
      singleChain: row.singleChain,
      multiChain: row.multiChain,
      supportedSurvivalPct: Math.round(row.survival * 10000) / 100,
      circularRings: row.ringCount,
      minSupportDepth: row.minSupportDepth,
      collapsed: row.collapsed
    })),
    circularRings: analysis.rings.map((ring) => ({ id: ring.id, members: [...ring.members].sort() })),
    articulationPapers: analysis.articulation.map((row) => ({
      id: row.id,
      collapseCount: row.collapseCount,
      articulation: row.articulation,
      collapses: [...row.collapses].sort()
    })),
    scope: [
      "Synthetic bundled collection: the 40 documents are authored for this workbench,",
      "not a live index of any real corpus.",
      "Support means citation-chain support to terminal sources under vertex disjoint",
      "counting; it is a structural measure, not a judgement of scientific validity.",
      "The digest is unkeyed SHA-256: tamper detection only, never proof of authorship."
    ].join(" ")
  };
  return {
    kind: REPORT_KIND,
    version: REPORT_VERSION,
    body,
    integrity: {
      algorithm: "SHA-256 (FIPS 180-4)",
      keyed: false,
      purpose: INTEGRITY_NOTE,
      scope: "body",
      digest: sha256Hex(canonicalJson(body))
    }
  };
}

/**
 * Verify a report JSON string. Recomputes the digest over the canonical body
 * and compares it to the recorded one. The result names exactly what was
 * wrong: unparsable text, a foreign format, a missing integrity block or a
 * digest mismatch (a tampered or corrupted body).
 */
export function verifyReportJson(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { ok: false, reason: "empty input" };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  if (parsed === null || typeof parsed !== "object" || parsed.kind !== REPORT_KIND) {
    return { ok: false, reason: "not a citegraph-ir provenance audit report" };
  }
  const integrity = parsed.integrity;
  if (integrity === null || typeof integrity !== "object" || typeof integrity.digest !== "string") {
    return { ok: false, reason: "missing integrity digest" };
  }
  if (parsed.body === null || typeof parsed.body !== "object") {
    return { ok: false, reason: "missing report body" };
  }
  const digest = sha256Hex(canonicalJson(parsed.body));
  const expected = integrity.digest.toLowerCase();
  if (digest === expected) {
    return { ok: true, digest, reason: "digest matches the body" };
  }
  return { ok: false, digest, expected, reason: "digest mismatch: the body was edited or corrupted" };
}

/* ------------------------------------------------------------------ *
 * CSV export (injection safe)
 * ------------------------------------------------------------------ */

/**
 * One CSV cell, safe for spreadsheet import. Following the CSV injection
 * guidance used for untrusted exports: a value that begins with =, +, -, @,
 * a tab or a carriage return is prefixed with a single quote so a spreadsheet
 * treats it as text rather than a formula, then quotes are doubled and the
 * field is quoted when it holds a comma, quote or line break.
 */
export function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

/** One CSV line from an array of values. */
export function csvRow(values) {
  return values.map(csvCell).join(",");
}

/**
 * The audit table as CSV: one header row plus one row per audit, carrying the
 * three readouts the workbench reports - supported claim survival percent,
 * the surviving circular ring count, and the minimum support depth.
 */
export function reportCsv(report) {
  const lines = [
    csvRow(["audit", "removed docs", "min chains", "claims", "supported",
      "supported survival pct", "circular rings", "min support depth", "collapsed"])
  ];
  for (const row of report.body.audits) {
    lines.push(csvRow([
      row.label, row.removedCount, row.minChains, row.claims, row.supported,
      row.supportedSurvivalPct, row.circularRings, row.minSupportDepth ?? "", row.collapsed
    ]));
  }
  return lines.join("\r\n") + "\r\n";
}

/* ------------------------------------------------------------------ *
 * Markdown export
 * ------------------------------------------------------------------ */

/**
 * The same report as a Markdown document: the audit table, the circular
 * rings, the articulation papers and the digest line, with the scope note
 * quoted verbatim so the honest labelling travels with the file.
 */
export function reportMarkdown(report) {
  const lines = [];
  lines.push("# CiteGraph-IR provenance audit");
  lines.push("");
  lines.push(`Corpus: ${report.body.corpus.documents} documents, ` +
    `${report.body.corpus.citationEdges} citation edges, ` +
    `${report.body.corpus.terminalSources} terminal sources.`);
  lines.push(`Corpus fingerprint: \`${report.body.corpus.fingerprint}\``);
  lines.push("");
  const sel = report.body.selection;
  lines.push(sel.retracted.length > 0
    ? `Interactive retraction selection: ${sel.retracted.join(", ")} (min chains ${sel.minChains}).`
    : "No interactive retraction selection was active.");
  lines.push("");
  lines.push("| Audit | Removed | Min chains | Claims | Supported | Survival % | Rings | Min depth | Collapsed |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of report.body.audits) {
    lines.push(`| ${row.label} | ${row.removedCount} | ${row.minChains} | ${row.claims} | ` +
      `${row.supported} | ${row.supportedSurvivalPct} | ${row.circularRings} | ` +
      `${row.minSupportDepth ?? "-"} | ${row.collapsed} |`);
  }
  lines.push("");
  lines.push("## Circular citation rings");
  lines.push("");
  for (const ring of report.body.circularRings) {
    lines.push(`- ${ring.id}: ${ring.members.join(", ")}`);
  }
  lines.push("");
  lines.push("## Single point of failure papers");
  lines.push("");
  for (const row of report.body.articulationPapers.filter((r) => r.articulation)) {
    lines.push(`- ${row.id}: retracting it collapses ${row.collapseCount} claims (${row.collapses.join(", ")})`);
  }
  lines.push("");
  lines.push("## Integrity");
  lines.push("");
  lines.push(`- Algorithm: ${report.integrity.algorithm} over the canonical JSON body`);
  lines.push(`- Digest: \`${report.integrity.digest}\``);
  lines.push(`- Scope: ${report.integrity.purpose}`);
  lines.push("");
  lines.push(`Scope note: ${report.body.scope}`);
  return lines.join("\n") + "\n";
}

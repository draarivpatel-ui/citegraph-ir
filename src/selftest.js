/**
 * selftest.js - the in-page self test battery for the cascade lab.
 *
 * The same checks the unit suites run are rerun here against the live modules
 * inside the page, so a reader can prove the shipped code does what the README
 * claims without installing anything. `runSelfTests(graph)` returns a list of
 * { name, passed, detail } rows and never throws: a broken build shows up as
 * failed rows, not a dead panel.
 *
 * Everything is deterministic. Randomised monotonicity coverage uses a seeded
 * linear congruential generator so the same samples are checked on every run.
 */

import {
  graphFromRefs,
  stronglyConnectedComponents,
  circularRings,
  terminalIds,
  independentChains,
  supportDepth,
  claimSupportMap,
  retractionCascade,
  articulationPapers,
  runAudit
} from "./cascade_lab.js";
import { sha256Hex } from "./sha256.js";
import {
  canonicalJson,
  buildProvenanceReport,
  verifyReportJson,
  csvCell,
  corpusFingerprint,
  REPORT_KIND
} from "./report_export.js";
import { encodeCascadeState, decodeCascadeState } from "./url_hash.js";

/* A seeded linear congruential generator so "random" subsets are identical on
 * every run of the panel and of the node suite. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function check(results, name, passed, detail = "") {
  results.push({ name, passed: Boolean(passed), detail });
}

/** Depth first reachability from `from` to `to` over out-links, honoring removed. */
function reaches(graph, from, to, removed = new Set()) {
  if (removed.has(from) || removed.has(to)) return false;
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === to) return true;
    for (const ref of graph.outLinks.get(node) ?? []) {
      if (!removed.has(ref) && !seen.has(ref)) {
        seen.add(ref);
        stack.push(ref);
      }
    }
  }
  return false;
}

export function runSelfTests(graph, analysis = null) {
  const results = [];
  const g = (name, fn) => {
    try {
      fn();
    } catch (error) {
      results.push({ name, passed: false, detail: `threw: ${error.message}` });
    }
  };

  /* ---- SHA-256 known answer vectors (FIPS 180-4) -------------------- */
  g("sha256 empty string matches the FIPS known answer", () => {
    check(results, "sha256 empty string matches the FIPS known answer",
      sha256Hex("") === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      sha256Hex("").slice(0, 24));
  });
  g("sha256 'abc' matches the FIPS known answer", () => {
    check(results, "sha256 'abc' matches the FIPS known answer",
      sha256Hex("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      sha256Hex("abc").slice(0, 24));
  });
  g("sha256 448 bit message matches the FIPS known answer", () => {
    const input = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    check(results, "sha256 448 bit message matches the FIPS known answer",
      sha256Hex(input) === "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
      sha256Hex(input).slice(0, 24));
  });
  g("sha256 is deterministic over multi byte UTF-8 text", () => {
    const text = "citation λ ring ÷ evidence";
    check(results, "sha256 is deterministic over multi byte UTF-8 text",
      sha256Hex(text) === sha256Hex(text), sha256Hex(text).slice(0, 16));
  });

  /* ---- Tarjan strongly connected components ------------------------- */
  g("tarjan finds the exact cycle in a toy 2-cycle graph", () => {
    const toy = graphFromRefs({ a: ["b"], b: ["a"], c: ["a"] });
    const rings = circularRings(toy);
    check(results, "tarjan finds the exact cycle in a toy 2-cycle graph",
      rings.length === 1 && rings[0].members.join(",") === "a,b",
      `${rings.length} ring(s)`);
  });
  g("tarjan reports zero rings on an acyclic graph", () => {
    const dag = graphFromRefs({ d: ["e"], e: ["f"], f: [], g: ["e"] });
    const rings = circularRings(dag);
    const nonTrivial = stronglyConnectedComponents(dag).filter((c) => c.ring).length;
    check(results, "tarjan reports zero rings on an acyclic graph",
      rings.length === 0 && nonTrivial === 0,
      `${rings.length} rings`);
  });
  g("a self citing node is a one member ring", () => {
    const self = graphFromRefs({ s: ["s"], t: [] });
    const rings = circularRings(self);
    check(results, "a self citing node is a one member ring",
      rings.length === 1 && rings[0].members.length === 1 && rings[0].members[0] === "s",
      `${rings.length} rings`);
  });
  g("corpus circular rings are reported and their members mutually cite", () => {
    const rings = circularRings(graph);
    let mutual = rings.length > 0;
    for (const ring of rings) {
      for (const a of ring.members) {
        for (const b of ring.members) {
          if (a !== b && !reaches(graph, a, b)) mutual = false;
        }
      }
    }
    check(results, "corpus circular rings are reported and their members mutually cite",
      mutual, `${rings.length} rings`);
  });

  /* ---- Independent chain counting ----------------------------------- */
  g("a diamond to two terminals counts two independent chains", () => {
    const diamond = graphFromRefs({ c: ["x", "y"], x: ["t1"], y: ["t2"], t1: [], t2: [] });
    check(results, "a diamond to two terminals counts two independent chains",
      independentChains(diamond, "c") === 2,
      `${independentChains(diamond, "c")} chains`);
  });
  g("two disjoint routes to one terminal still count as two chains", () => {
    const merged = graphFromRefs({ c: ["x", "y"], x: ["t"], y: ["t"], t: [] });
    check(results, "two disjoint routes to one terminal still count as two chains",
      independentChains(merged, "c") === 2,
      `${independentChains(merged, "c")} chains`);
  });
  g("a path through a shared middle node is one chain not two", () => {
    const pinched = graphFromRefs({ c: ["x", "y"], x: ["m"], y: ["m"], m: ["t"], t: [] });
    check(results, "a path through a shared middle node is one chain not two",
      independentChains(pinched, "c") === 1,
      `${independentChains(pinched, "c")} chain`);
  });
  g("a claim in a closed ring with no exit is unsupported", () => {
    const closed = graphFromRefs({ p: ["q"], q: ["p"], t: [] });
    check(results, "a claim in a closed ring with no exit is unsupported",
      independentChains(closed, "p") === 0 && supportDepth(closed, "p") === null,
      `${independentChains(closed, "p")} chains`);
  });

  /* ---- Retraction cascade ------------------------------------------- */
  g("retracting a sole source collapses exactly its dependents", () => {
    const toy = graphFromRefs({ a: ["t1"], b: ["t1", "t2"], c: ["b"], t1: [], t2: [] });
    const result = retractionCascade(toy, ["t1"]);
    check(results, "retracting a sole source collapses exactly its dependents",
      result.invalidated.join(",") === "a" && result.survivingMultiPath.join(",") === "",
      `invalidated: ${result.invalidated.join(",") || "none"}`);
  });
  g("a claim survives on an alternative path when one of two sources is retracted", () => {
    const toy = graphFromRefs({ a: ["t1"], b: ["t1", "t2"], t1: [], t2: [] });
    const result = retractionCascade(toy, ["t1"]);
    check(results, "a claim survives on an alternative path when one of two sources is retracted",
      result.perClaim.get("b")?.supported === true && result.invalidated.includes("a"),
      `b supported: ${result.perClaim.get("b")?.supported}`);
  });
  g("retraction is monotonic over seeded random subsets", () => {
    const rand = lcg(0x5eed);
    const ids = [...graph.ids].sort();
    const base = claimSupportMap(graph, new Set(), 1);
    const baseCount = [...base.values()].filter((s) => s.kind === "claim" && s.supported).length;
    let monotone = true;
    let last = null;
    for (let i = 0; i < 14 && monotone; i += 1) {
      const subset = new Set();
      for (const id of ids) if (rand() < 0.35) subset.add(id);
      const extra = new Set(subset);
      for (const id of ids) if (rand() < 0.2) extra.add(id);
      const small = claimSupportMap(graph, subset, 1);
      const big = claimSupportMap(graph, extra, 1);
      const s = [...small.values()].filter((v) => v.kind === "claim" && v.supported).length;
      const b = [...big.values()].filter((v) => v.kind === "claim" && v.supported).length;
      if (b > s) monotone = false;
      last = `${s} -> ${b}`;
    }
    check(results, "retraction is monotonic over seeded random subsets",
      monotone && baseCount > 0, last ?? "no samples");
  });
  g("multi path survivors are a subset of supported claims", () => {
    const result = retractionCascade(graph, [analysis?.primarySource ?? terminalIds(graph)[0]]);
    const supported = new Set([...result.perClaim.entries()]
      .filter(([, s]) => s.kind === "claim" && s.supported).map(([id]) => id));
    check(results, "multi path survivors are a subset of supported claims",
      result.survivingMultiPath.every((id) => supported.has(id)),
      `${result.survivingMultiPath.length} multi path survivors`);
  });
  g("articulation papers each collapse the claims a recount confirms", () => {
    const rows = articulationPapers(graph);
    const top = rows.find((r) => r.articulation) ?? rows[0];
    if (!top) {
      check(results, "articulation papers each collapse the claims a recount confirms", false, "none found");
      return;
    }
    const base = claimSupportMap(graph, new Set(), 1);
    const after = claimSupportMap(graph, new Set([top.id]), 1);
    const recount = [...after.values()]
      .filter((s) => s.kind === "claim" && (base.get(s.id)?.supported ?? false) && !s.supported)
      .map((s) => s.id).sort();
    check(results, "articulation papers each collapse the claims a recount confirms",
      recount.join(",") === [...top.collapses].sort().join(","),
      `${top.id}: ${top.collapseCount} collapses`);
  });
  g("requiring two chains never supports more claims than one chain", () => {
    const one = runAudit(graph, { id: "t-one", label: "t", removed: [], minChains: 1 });
    const two = runAudit(graph, { id: "t-two", label: "t", removed: [], minChains: 2 });
    check(results, "requiring two chains never supports more claims than one chain",
      two.supported <= one.supported,
      `${two.supported} <= ${one.supported}`);
  });

  /* ---- Export integrity --------------------------------------------- */
  g("csv escaping doubles quotes and neutralises formula cells", () => {
    const ok = csvCell('a,"b"') === '"a,""b"""' &&
      csvCell("=cmd|'/c calc'!A0") === "'=cmd|'/c calc'!A0" &&
      csvCell("@x") === "'@x" &&
      csvCell("-1+1") === "'-1+1" &&
      csvCell("plain") === "plain";
    check(results, "csv escaping doubles quotes and neutralises formula cells", ok, "5 cases");
  });
  g("canonical json sorts keys recursively", () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    check(results, "canonical json sorts keys recursively",
      a === '{"a":{"c":3,"d":2},"b":1}', a.slice(0, 28));
  });
  g("a built report verifies, and a tampered body is detected", () => {
    if (!analysis) {
      check(results, "a built report verifies, and a tampered body is detected", false, "no analysis");
      return;
    }
    const audits = analysis.auditRows ?? [];
    const report = buildProvenanceReport({
      graph,
      analysis,
      audits,
      selection: { retracted: ["vector-space-tfidf"], minChains: 1 }
    });
    const round = verifyReportJson(JSON.stringify(report));
    const tampered = JSON.parse(JSON.stringify(report));
    tampered.body.audits[0].supported += 1;
    const bad = verifyReportJson(JSON.stringify(tampered));
    check(results, "a built report verifies, and a tampered body is detected",
      round.ok && report.kind === REPORT_KIND && !bad.ok,
      `verify ${round.ok}, tamper detected ${!bad.ok}`);
  });
  g("a report is reproducible: two builds share one digest", () => {
    if (!analysis) {
      check(results, "a report is reproducible: two builds share one digest", false, "no analysis");
      return;
    }
    const audits = analysis.auditRows ?? [];
    const a = buildProvenanceReport({ graph, analysis, audits, selection: { retracted: [], minChains: 1 } });
    const b = buildProvenanceReport({ graph, analysis, audits, selection: { retracted: [], minChains: 1 } });
    check(results, "a report is reproducible: two builds share one digest",
      a.integrity.digest === b.integrity.digest,
      a.integrity.digest.slice(0, 16));
  });
  g("the corpus fingerprint is stable and nonempty", () => {
    const fp = corpusFingerprint(graph);
    check(results, "the corpus fingerprint is stable and nonempty",
      fp.digest.length === 64 && fp.documents === graph.ids.size,
      `${fp.documents} docs, ${fp.edges} edges`);
  });

  /* ---- URL hash bookmarking ----------------------------------------- */
  g("url hash round trips the real state shape", () => {
    const state = { retracted: ["vector-space-tfidf", "bm25-okapi"], minChains: 1 };
    const hash = encodeCascadeState(state);
    const back = decodeCascadeState(hash, graph.ids);
    check(results, "url hash round trips the real state shape",
      back !== null && back.state.retracted.join(",") === "bm25-okapi,vector-space-tfidf" &&
      back.dropped.length === 0 && hash.startsWith("#cg="),
      hash.slice(0, 22));
  });
  g("url hash rejects malformed payloads and drops unknown ids", () => {
    const bad = decodeCascadeState("#cg=!!!not-base64!!!", graph.ids);
    const forged = "#cg=" + encodeCascadeState({ retracted: ["no-such-doc"], minChains: 1 }).slice(4);
    const dropped = decodeCascadeState(forged, graph.ids);
    check(results, "url hash rejects malformed payloads and drops unknown ids",
      bad === null && dropped !== null && dropped.dropped.join(",") === "no-such-doc" &&
      dropped.state.retracted.length === 0,
      "2 cases");
  });

  return results;
}

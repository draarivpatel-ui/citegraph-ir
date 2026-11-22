/**
 * cascade_dom.test.js - static markup checks and live UI execution for the
 * cascade lab page.
 *
 * The live tests run the actual inline module against the DOM shim: presets,
 * node clicks, export formats, tamper verification, the self test panel and
 * URL hash restore all execute exactly as they would in a browser, so a broken
 * binding or a missed render fails here rather than in production.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePage, makeDom, runInlineScript } from "./helpers/dom.js";
import { encodeCascadeState } from "../src/url_hash.js";

const PAGE = parsePage("cascade/index.html");

async function boot(options = {}) {
  const env = makeDom(PAGE, { page: "cascade", ...options });
  await runInlineScript(PAGE, env);
  return env;
}

/* ------------------------------------------------------------------ *
 * Boot render
 * ------------------------------------------------------------------ */

test("UI cascade: boot renders KPIs, audits, graph, export and bookmark", async () => {
  const env = await boot();
  assert.equal(env.getEl("kpis").children.length, 6);
  assert.equal(env.getEl("audit-body").children.length, 5);
  assert.ok(env.getEl("graph-svg").children.length > 80);
  assert.match(env.getEl("digest-line").innerHTML, /sha256 [0-9a-f]{64}/);
  assert.match(env.getEl("export-view").textContent, /citegraph-ir\.provenance-audit/);
  assert.match(env.getEl("bookmark-url").value, /#cg=/);
  assert.equal(env.getEl("min-chains").value, "1");
});

test("UI cascade: the support graph draws one group per paper and every edge", async () => {
  const env = await boot();
  const svg = env.getEl("graph-svg");
  const nodes = svg.children.filter((n) => n.classList.contains("node"));
  const edges = svg.children.filter((n) => n.getAttribute("class")?.startsWith("edge"));
  const halos = svg.children.filter((n) => n.getAttribute("class") === "ring-halo");
  assert.equal(nodes.length, 40);
  assert.equal(edges.length, 77);
  // Seven halos: the 4-member ring and six 2-rings get one rect each; the
  // eighth ring overlaps but still draws a halo.
  assert.ok(halos.length >= 7, `${halos.length} halos`);
});

test("UI cascade: every node group carries a circle, a label and a title tip", async () => {
  const env = await boot();
  const nodes = env.getEl("graph-svg").children.filter((n) => n.classList.contains("node"));
  for (const node of nodes) {
    const tags = node.children.map((c) => c.tagName);
    assert.ok(tags.includes("CIRCLE"));
    assert.ok(tags.includes("TEXT"));
    assert.ok(tags.includes("TITLE"));
    assert.equal(node.getAttribute("role"), "button");
    assert.match(node.getAttribute("aria-label"), /Activate to retract/);
  }
});

test("UI cascade: baseline KPI strip reports the real corpus numbers", async () => {
  const env = await boot();
  const html = env.getEl("kpis").children.map((c) => c.innerHTML).join("");
  assert.ok(html.includes("37 of 39"));
  assert.ok(html.includes("94.9%"));
  assert.ok(html.includes("8"));
});

test("UI cascade: the audit table carries the five battery rows in order", async () => {
  const env = await boot();
  const labels = env.getEl("audit-body").children.map((tr) =>
    tr.innerHTML.match(/<td class="doc-id">([^<]+)</)[1]);
  assert.deepEqual(labels, [
    "Baseline graph", "Retract primary source", "Remove unverified preprints",
    "Require 2 independent chains", "Retract every ring member"
  ]);
});

test("UI cascade: the articulation table lists the primary source first", async () => {
  const env = await boot();
  const first = env.getEl("artic-body").children[0];
  assert.ok(first.innerHTML.includes("vector-space-tfidf"));
  assert.ok(first.innerHTML.includes("37"));
  assert.match(env.getEl("artic-note").textContent, /single points of failure/);
});

/* ------------------------------------------------------------------ *
 * Presets and selection
 * ------------------------------------------------------------------ */

test("UI cascade: retract primary source collapses all 37 claims", async () => {
  const env = await boot();
  env.getEl("preset-primary").fire("click");
  const html = env.getEl("kpis").children.map((c) => c.innerHTML).join("");
  assert.ok(html.includes("0.0%"));
  assert.ok(html.includes("37"));
  const chips = env.getEl("selection-chips").children;
  assert.equal(chips.length, 1);
  assert.match(chips[0].textContent, /vector-space-tfidf/);
  // The audit table gains the sixth selection row.
  assert.equal(env.getEl("audit-body").children.length, 6);
});

test("UI cascade: the ring preset retracts the PageRank ring members", async () => {
  const env = await boot();
  env.getEl("preset-ring").fire("click");
  const chips = env.getEl("selection-chips").children;
  assert.equal(chips.length, 2);
  const names = chips.map((c) => c.textContent).join(" ");
  assert.ok(names.includes("pagerank-citation-graph"));
  assert.ok(names.includes("bibliographic-coupling"));
});

test("UI cascade: the unverified preset retracts all eight frontier papers", async () => {
  const env = await boot();
  env.getEl("preset-unverified").fire("click");
  assert.equal(env.getEl("selection-chips").children.length, 8);
});

test("UI cascade: clear restores the baseline state", async () => {
  const env = await boot();
  env.getEl("preset-primary").fire("click");
  env.getEl("preset-clear").fire("click");
  const html = env.getEl("kpis").children.map((c) => c.innerHTML).join("");
  assert.ok(html.includes("94.9%"));
  assert.equal(env.getEl("audit-body").children.length, 5);
  assert.match(env.getEl("selection-chips").children[0].textContent, /Nothing retracted/);
});

test("UI cascade: picking a paper and pressing retract adds it to the selection", async () => {
  const env = await boot();
  env.getEl("pick").value = "bm25-okapi";
  env.getEl("pick-add").fire("click");
  const chips = env.getEl("selection-chips").children;
  assert.equal(chips.length, 1);
  assert.match(chips[0].textContent, /bm25-okapi/);
});

test("UI cascade: clicking a sel chip restores that paper", async () => {
  const env = await boot();
  env.getEl("preset-primary").fire("click");
  env.getEl("preset-unverified").fire("click");
  const before = env.getEl("selection-chips").children.length;
  env.getEl("selection-chips").children[0].fire("click");
  assert.equal(env.getEl("selection-chips").children.length, before - 1);
});

test("UI cascade: the min chains select re-renders with the stricter bar", async () => {
  const env = await boot();
  const chains = env.getEl("min-chains");
  chains.value = "2";
  chains.fire("change");
  const html = env.getEl("kpis").children.map((c) => c.innerHTML).join("");
  // 13 of 39 claims keep two independent chains on the corpus.
  assert.ok(html.includes("13 of 39"), html.slice(0, 200));
  assert.ok(html.includes("33.3%"));
});

test("UI cascade: the bookmark state clamps minChains into range on decode", async () => {
  // The select only offers 1 and 2, but a forged hash can request more: the
  // codec clamps to 8 and applyState keeps the same bound.
  const hash = encodeCascadeState({ retracted: ["bm25-okapi"], minChains: 99 });
  const env = await boot({ hash });
  assert.equal(env.getEl("min-chains").value, "8");
});

test("UI cascade: clicking a graph node toggles its retraction", async () => {
  const env = await boot();
  const nodes = env.getEl("graph-svg").children.filter((n) => n.classList.contains("node"));
  const bm25 = nodes.find((n) => n.getAttribute("data-doc") === "bm25-okapi");
  bm25.fire("click");
  assert.match(env.getEl("selection-chips").children.map((c) => c.textContent).join(" "), /bm25-okapi/);
  assert.equal(bm25.classList.contains("st-removed"), true);
  bm25.fire("click");
  assert.equal(bm25.classList.contains("st-removed"), false);
});

test("UI cascade: keyboard activation of a node toggles too", async () => {
  const env = await boot();
  const nodes = env.getEl("graph-svg").children.filter((n) => n.classList.contains("node"));
  const node = nodes.find((n) => n.getAttribute("data-doc") === "ann-hnsw");
  node.fire("keydown", { key: "Enter" });
  assert.equal(node.classList.contains("st-removed"), true);
});

test("UI cascade: a cut edge is styled and dead edges are dashed", async () => {
  const env = await boot();
  // Retracting the primary source cuts every edge into it.
  env.getEl("preset-primary").fire("click");
  const svg = env.getEl("graph-svg");
  const afterPrimary = svg.children.map((n) => n.getAttribute("class") ?? "").join(" ");
  assert.ok(afterPrimary.includes("edge cut"), "no cut edges styled");
  // Retracting a mid graph paper kills its outgoing edges (dead) and cuts the
  // incoming ones.
  env.getEl("pick").value = "bm25-okapi";
  env.getEl("pick-add").fire("click");
  const afterBm25 = svg.children.map((n) => n.getAttribute("class") ?? "").join(" ");
  assert.ok(afterBm25.includes("edge dead"), "no dead edges styled");
  assert.ok(afterBm25.includes("edge cut"), "no cut edges styled");
});

test("UI cascade: collapsed nodes get the critical state class", async () => {
  const env = await boot();
  env.getEl("preset-primary").fire("click");
  const nodes = env.getEl("graph-svg").children.filter((n) => n.classList.contains("st-collapsed"));
  assert.equal(nodes.length, 37);
});

/* ------------------------------------------------------------------ *
 * Exports and verification
 * ------------------------------------------------------------------ */

test("UI cascade: the export view swaps between JSON, CSV and Markdown", async () => {
  const env = await boot();
  assert.match(env.getEl("export-view").textContent, /"kind": "citegraph-ir\.provenance-audit"/);
  env.getEl("export-csv").fire("click");
  assert.match(env.getEl("export-view").textContent, /audit,removed docs,min chains/);
  assert.match(env.getEl("export-view").textContent, /Baseline graph,0,1,39,37/);
  env.getEl("export-md").fire("click");
  assert.match(env.getEl("export-view").textContent, /# CiteGraph-IR provenance audit/);
  env.getEl("export-json").fire("click");
  assert.match(env.getEl("export-view").textContent, /"integrity"/);
});

test("UI cascade: all three export formats share one digest", async () => {
  const env = await boot();
  const digest = env.getEl("digest-line").innerHTML.match(/sha256 ([0-9a-f]{64})/)[1];
  env.getEl("export-json").fire("click");
  assert.ok(env.getEl("export-view").textContent.includes(digest), "JSON export carries the digest");
  env.getEl("export-md").fire("click");
  assert.ok(env.getEl("export-view").textContent.includes(digest), "Markdown export carries the digest");
  env.getEl("export-csv").fire("click");
  assert.ok(env.getEl("export-view").textContent.length > 0, "CSV export renders");
});

test("UI cascade: the digest stays stable across a render with the same state", async () => {
  const env = await boot();
  const first = env.getEl("digest-line").innerHTML.match(/sha256 ([0-9a-f]{64})/)[1];
  env.getEl("preset-primary").fire("click");
  const second = env.getEl("digest-line").innerHTML.match(/sha256 ([0-9a-f]{64})/)[1];
  assert.notEqual(first, second);
  env.getEl("preset-clear").fire("click");
  const third = env.getEl("digest-line").innerHTML.match(/sha256 ([0-9a-f]{64})/)[1];
  assert.equal(first, third);
});

test("UI cascade: verifying the exported report reports ok", async () => {
  const env = await boot();
  env.getEl("verify-input").value = env.getEl("export-view").textContent;
  env.getEl("verify-btn").fire("click");
  assert.match(env.getEl("verify-out").textContent, /Verified intact/);
  assert.equal(env.getEl("verify-out").className, "verify-out ok");
});

test("UI cascade: tamper check reports the single digit edit as detected", async () => {
  const env = await boot();
  env.getEl("tamper-btn").fire("click");
  assert.match(env.getEl("verify-out").textContent, /Tamper check passed/);
  assert.equal(env.getEl("verify-out").className, "verify-out bad");
});

test("UI cascade: pasting garbage into the verifier fails politely", async () => {
  const env = await boot();
  env.getEl("verify-input").value = "definitely not a report";
  env.getEl("verify-btn").fire("click");
  assert.match(env.getEl("verify-out").textContent, /Verification failed/);
  assert.equal(env.getEl("verify-out").className, "verify-out bad");
});

test("UI cascade: the digest note repeats the unkeyed disclaimer on the page", async () => {
  const env = await boot();
  assert.match(env.getEl("digest-note").textContent, /Unkeyed SHA-256/);
  assert.match(env.getEl("digest-note").textContent, /not a MAC/);
});

/* ------------------------------------------------------------------ *
 * Self tests panel
 * ------------------------------------------------------------------ */

test("UI cascade: run self tests renders a row per check and the pass count", async () => {
  const env = await boot();
  env.getEl("selftest-btn").fire("click");
  const rows = env.getEl("selftest-list").children;
  assert.ok(rows.length >= 24, `${rows.length} rows`);
  const passes = rows.filter((li) => li.children[0].classList.contains("pass")).length;
  assert.match(env.getEl("selftest-count").innerHTML, new RegExp(`${passes}/${rows.length}`));
  assert.equal(passes, rows.length);
});

test("UI cascade: self test rows name the advertised checks", async () => {
  const env = await boot();
  env.getEl("selftest-btn").fire("click");
  const names = env.getEl("selftest-list").children.map((li) => li.text).join("\n");
  assert.match(names, /sha256 empty string matches the FIPS known answer/);
  assert.match(names, /tarjan reports zero rings on an acyclic graph/);
  assert.match(names, /retraction is monotonic over seeded random subsets/);
  assert.match(names, /csv escaping doubles quotes/);
  assert.match(names, /url hash round trips/);
});

/* ------------------------------------------------------------------ *
 * Bookmarking
 * ------------------------------------------------------------------ */

test("UI cascade: the bookmark URL tracks the live selection", async () => {
  const env = await boot();
  env.getEl("preset-primary").fire("click");
  assert.match(env.getEl("bookmark-url").value, /#cg=/);
  assert.notEqual(env.getEl("bookmark-url").value, "http://localhost/#cg=eyJ2IjoxLCJyIjpbXSwibSI6MX0");
});

test("UI cascade: location.hash is synced through history.replaceState", async () => {
  const env = await boot();
  env.getEl("preset-primary").fire("click");
  assert.match(env.window.location.hash, /#cg=/);
  env.getEl("preset-clear").fire("click");
  assert.match(env.window.location.hash, /#cg=/);
});

test("UI cascade: booting on a bookmarked hash restores the selection", async () => {
  const hash = encodeCascadeState({ retracted: ["vector-space-tfidf", "bm25-okapi"], minChains: 2 });
  const env = await boot({ hash });
  assert.equal(env.getEl("selection-chips").children.length, 2);
  assert.equal(env.getEl("min-chains").value, "2");
  const html = env.getEl("kpis").children.map((c) => c.innerHTML).join("");
  assert.ok(html.includes("0.0%"));
});

test("UI cascade: a bookmark with unknown ids drops them and notes it", async () => {
  const forged = encodeCascadeState({ retracted: ["ghost-paper", "bm25-okapi"], minChains: 1 });
  const env = await boot({ hash: forged });
  // ghost-paper is not a corpus id: only bm25-okapi restores, and the note
  // names the dropped id.
  assert.equal(env.getEl("selection-chips").children.length, 1);
  assert.match(env.getEl("restore-note").textContent, /ghost-paper/);
});

test("UI cascade: a malformed bookmark leaves the page at baseline", async () => {
  const env = await boot({ hash: "#cg=!!!garbage" });
  assert.match(env.getEl("selection-chips").children[0].textContent, /Nothing retracted/);
  assert.match(env.getEl("kpis").children.map((c) => c.innerHTML).join(""), /94\.9%/);
});

test("UI cascade: a hashchange event re-renders to the new state", async () => {
  const env = await boot();
  env.window.location.hash = encodeCascadeState({ retracted: ["vector-space-tfidf"], minChains: 1 });
  env.window.fire("hashchange");
  assert.equal(env.getEl("selection-chips").children.length, 1);
  assert.match(env.getEl("kpis").children.map((c) => c.innerHTML).join(""), /0\.0%/);
});

test("UI cascade: the graph note names the collapsed count", async () => {
  const env = await boot();
  env.getEl("preset-primary").fire("click");
  assert.match(env.getEl("graph-note").textContent, /37 claims collapsed/);
});

/* ------------------------------------------------------------------ *
 * Theme and nav
 * ------------------------------------------------------------------ */

test("UI cascade: the theme toggle flips the root dataset", async () => {
  const env = await boot();
  env.getEl("theme").fire("click");
  assert.equal(env.document.documentElement.dataset.theme, "dark");
});

test("UI cascade: nav links carry the other pages and none is marked current", async () => {
  const env = await boot();
  const navs = [...env.elements.values()].filter((el) => el.getAttribute("data-nav"));
  assert.ok(navs.some((el) => el.getAttribute("data-nav") === "lab"));
  assert.ok(navs.some((el) => el.getAttribute("data-nav") === "sweep"));
  assert.equal(navs.filter((el) => el.getAttribute("aria-current") === "page").length, 0);
});

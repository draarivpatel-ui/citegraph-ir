/**
 * dom.test.js - static markup checks and live UI execution for all three pages.
 *
 * The live tests execute the actual inline module scripts against a DOM shim,
 * so a broken binding, a missing control or a regression in the rendered table
 * fails here rather than in a browser. Run with `npm test`, which enables the
 * VM module flag the shim needs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parsePage, makeDom, runInlineScript, repoRoot } from "./helpers/dom.js";

const HOME = parsePage("index.html");
const LAB = parsePage("lab/index.html");
const SWEEP = parsePage("sweep/index.html");
const CSS = fs.readFileSync(path.join(repoRoot, "shell.css"), "utf8");

const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
const BANNED_DASH = new RegExp("[\\u2013\\u2014]");
const FRAG = (...parts) => parts.join("");
const BANNED_NAMES = (() => {
  // Fragments and escapes keep this source file free of the strings it scans for.
  const parts = [
    FRAG("clau", "\\u0073", "e"), FRAG("chat", "g\\u0070", "t"), FRAG("co", "p\\u0069", "lot"),
    FRAG("op\\u0065", "n\\u0061", "i"), FRAG("g\\u0065", "m\\u0069", "ni"),
    FRAG("anthro", "p\\u0069", "c"), FRAG("deep", "s\\u0065", "ek"),
    FRAG("q\\u0077", "en"), FRAG("lla", "\\u006d", "a"), FRAG("mag", "p\\u0069", "e"),
    FRAG("work", "b\\u0075", "ddy"), FRAG("hun", "y\\u0075", "an")
  ];
  return new RegExp(parts.join("|"), "i");
})();

/* ------------------------------------------------------------------ *
 * Static markup and compliance
 * ------------------------------------------------------------------ */

const PAGES = [
  { name: "home", page: HOME, rel: "index.html" },
  { name: "lab", page: LAB, rel: "lab/index.html" },
  { name: "sweep", page: SWEEP, rel: "sweep/index.html" }
];

for (const { name, page, rel } of PAGES) {
  test(`DOM ${name}: HTML5 doctype, lang, charset, viewport and title`, () => {
    assert.match(page.source.trimStart(), /^<!DOCTYPE html>/i);
    assert.match(page.source, /<html lang="en">/);
    assert.match(page.source, /<meta charset="utf-8">/);
    assert.match(page.source, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(page.source, /<title>CiteGraph-IR/);
    assert.match(page.source, /<meta name="description" content="[^"]{40,}">/);
  });

  test(`DOM ${name}: exactly one h1, no skipped heading levels and unique ids`, () => {
    assert.equal((page.source.match(/<h1\b/g) || []).length, 1);
    const levels = [...page.source.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    for (let i = 1; i < levels.length; i += 1) assert.ok(levels[i] <= levels[i - 1] + 1);
    assert.equal(new Set(page.ids).size, page.ids.length, `${rel} has duplicate ids`);
  });

  test(`DOM ${name}: semantic landmarks, theme toggle and nav links`, () => {
    assert.match(page.source, /<header class="top">/);
    assert.match(page.source, /<nav class="nav" aria-label="Pages">/);
    assert.match(page.source, /<main class="wrap">/);
    assert.match(page.source, /<footer class="foot">/);
    assert.match(page.source, /id="theme"/);
    assert.match(page.source, /rel="stylesheet" href="\.\.\/shell\.css"|rel="stylesheet" href="shell\.css"/);
  });

  test(`DOM ${name}: no forbidden dashes, no vendor names, no remote assets`, () => {
    assert.equal(BANNED_DASH.test(page.source), false, `${rel} has a forbidden dash`);
    assert.equal(BANNED_NAMES.test(page.source), false, `${rel} names a vendor model`);
    // A source link is allowed; a runtime asset loaded over the network is not.
    const assetRefs = [...page.source.matchAll(/<script[^>]*src="([^"]+)"|<link[^>]*href="([^"]+)"/g)]
      .map((m) => m[1] ?? m[2]);
    assert.ok(assetRefs.length >= 1);
    assert.equal(assetRefs.some((ref) => /^https?:/i.test(ref)), false, `${rel} loads a remote asset`);
  });

  test(`DOM ${name}: every aria-labelledby target resolves to a real id`, () => {
    const set = new Set(page.ids);
    for (const m of page.source.matchAll(/aria-labelledby="([^"]+)"/g)) {
      for (const ref of m[1].split(/\s+/)) assert.ok(set.has(ref), `missing #${ref}`);
    }
  });

  test(`DOM ${name}: every label[for] resolves to a real control`, () => {
    const set = new Set(page.ids);
    for (const m of page.source.matchAll(/<label[^>]*for="([^"]+)"/g)) {
      assert.ok(set.has(m[1]), `missing control #${m[1]}`);
    }
  });

  test(`DOM ${name}: the inline module script is present and non trivial`, () => {
    assert.equal(page.scripts.length, 1);
    assert.ok(page.scripts[0].length > 1000);
  });
}

test("DOM shell.css: focus visible, reduced motion, tabular numerals and dark theme", () => {
  assert.match(CSS, /:focus-visible/);
  assert.match(CSS, /font-variant-numeric:\s*tabular-nums/);
  assert.match(CSS, /:root\[data-theme="dark"\]/);
  assert.match(CSS, /@media\s*\(prefers-color-scheme:\s*dark\)/);
  assert.equal(BANNED_DASH.test(CSS), false);
});

test("DOM compliance: every text file in the repo is free of forbidden dashes and vendor names", () => {
  const exts = new Set([".md", ".html", ".js", ".json", ".py", ".css", ".txt", ".yml"]);
  const skip = new Set([".git", "node_modules", "dist", "build"]);
  const walk = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (exts.has(path.extname(entry.name).toLowerCase())) out.push(full);
    }
    return out;
  };
  const files = walk(repoRoot);
  assert.ok(files.length >= 20);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    assert.equal(BANNED_DASH.test(text), false, `${path.relative(repoRoot, file)} has a forbidden dash`);
    assert.equal(BANNED_NAMES.test(text), false, `${path.relative(repoRoot, file)} names a vendor model`);
  }
});

test("DOM compliance: markdown docs never use a literal dash as a separator", () => {
  for (const rel of ["README.md", "DEVPOST_UPGRADE.md"]) {
    const text = read(rel);
    assert.equal(BANNED_DASH.test(text), false, `${rel} has a forbidden dash`);
    assert.ok(text.length > 500);
  }
});

/* ------------------------------------------------------------------ *
 * Live home dashboard
 * ------------------------------------------------------------------ */

test("UI home: all headline KPIs, stage rows, meters and movement cards render from the report", async () => {
  const env = makeDom(HOME, { page: "home" });
  await runInlineScript(HOME, env);
  assert.equal(env.getEl("k-ndcg").textContent, "0.9344");
  assert.equal(env.getEl("k-auroc").textContent, "0.9889");
  assert.equal(env.getEl("k-cov").textContent, "88.9%");
  assert.equal(env.getEl("k-far").textContent, "0.0%");
  assert.equal(env.getEl("k-ece").textContent, "0.7118");
  assert.equal(env.getEl("k-tests").textContent, "41");

  const rows = env.getEl("stage-body").children;
  assert.equal(rows.length, 4);
  assert.ok(rows[0].innerHTML.includes("Lexical, BM25"));
  assert.ok(rows[3].innerHTML.includes("Re-ranked, PageRank"));
  assert.ok(rows[3].innerHTML.includes("0.9344"));

  const meters = env.getEl("abstention-meters").children;
  assert.equal(meters.length, 3);
  assert.ok(meters[0].innerHTML.includes("88.9%"));
  assert.ok(meters[1].innerHTML.includes("100.0%"));

  const moves = env.getEl("stage-moves").children;
  assert.equal(moves.length, 3);
  assert.ok(moves[0].innerHTML.includes("34.6"));
  assert.ok(moves[1].innerHTML.includes("9.6"));
  assert.ok(moves[1].innerHTML.includes("0.984"));

  const lines = env.getEl("attribution-lines").children;
  assert.equal(lines.length, 3);
  for (const line of lines) assert.match(line.innerHTML, /\d+\.\d%<\/span>/);
});

test("UI home: theme toggle flips the root and stores the choice", async () => {
  const env = makeDom(HOME, { page: "home" });
  await runInlineScript(HOME, env);
  const toggle = env.getEl("theme");
  assert.equal(toggle.textContent, "Dark mode");
  toggle.fire("click");
  assert.equal(env.document.documentElement.dataset.theme, "dark");
  assert.equal(toggle.textContent, "Light mode");
  toggle.fire("click");
  assert.equal(env.document.documentElement.dataset.theme, "light");
  assert.equal(toggle.textContent, "Dark mode");
  assert.equal(env.window.localStorage.getItem("citegraph-theme"), "light");
});

test("UI home: only links whose data-nav matches the page are marked current", async () => {
  const env = makeDom(HOME, { page: "home" });
  await runInlineScript(HOME, env);
  // The home page links to the lab and the sweep, and the brand is the home
  // link, so no data-nav entry carries the home key.
  const current = [...env.elements.values()].filter((el) => el.getAttribute("aria-current") === "page");
  assert.equal(current.length, 0);
  assert.equal(env.elements.get("nav-0").getAttribute("data-nav"), "lab");
  assert.equal(env.elements.get("nav-1").getAttribute("data-nav"), "sweep");
});

/* ------------------------------------------------------------------ *
 * Live retrieval lab
 * ------------------------------------------------------------------ */

async function bootLab() {
  const env = makeDom(LAB, { page: "lab" });
  await runInlineScript(LAB, env);
  return env;
}

test("UI lab: the initial run populates verdict, table, ledger and evidence", async () => {
  const env = await bootLab();
  assert.equal(env.getEl("verdict").hidden, false);
  assert.equal(env.getEl("verdict-badge").textContent, "ANSWER");
  assert.equal(env.getEl("score-out").textContent, "0.1765");
  assert.equal(env.getEl("runs-body").children.length, 12);
  assert.equal(env.getEl("runs-scroll").hidden, false);
  assert.equal(env.getEl("legend").hidden, false);
  assert.equal(env.getEl("attribution-panel").hidden, false);
  assert.equal(env.getEl("attribution-ledger").children.length, 3);
  assert.ok(env.getEl("evidence-span").textContent.length > 40);
  assert.match(env.getEl("rank-note").textContent, /changed rank from lexical to re-ranked/);
  assert.match(env.getEl("signal-row").innerHTML, /fingerprint/);
  assert.match(env.getEl("attribution-note").textContent, /Top document covers/);
});

test("UI lab: the top N slider changes the number of rendered rows", async () => {
  const env = await bootLab();
  const slider = env.getEl("top-n");
  slider.value = "5";
  slider.fire("input");
  assert.equal(env.getEl("runs-body").children.length, 5);
  assert.equal(env.getEl("top-n-out").textContent, "5 of 40 documents");
  slider.value = "40";
  slider.fire("input");
  assert.equal(env.getEl("runs-body").children.length, 40);
});

test("UI lab: the score view swaps the column headers and cell values", async () => {
  const env = await bootLab();
  const select = env.getEl("score-view");
  select.value = "scores";
  select.fire("change");
  assert.match(env.getEl("runs-head").innerHTML, /BM25 score/);
  assert.match(env.getEl("runs-body").children[0].innerHTML, /<td class="score">0\.\d{4}<\/td>/);
  select.value = "delta";
  select.fire("change");
  assert.match(env.getEl("runs-head").innerHTML, /Change/);
  assert.ok(env.getEl("runs-body").children[0].innerHTML.includes("n/a") || /\+\d|\-\d|>\d</.test(env.getEl("runs-body").children[0].innerHTML));
  select.value = "ranks";
  select.fire("change");
  assert.match(env.getEl("runs-head").innerHTML, /PageRank/);
});

test("UI lab: the evidence depth slider reattributes the ledger", async () => {
  const env = await bootLab();
  const slider = env.getEl("evidence-depth");
  slider.value = "1";
  slider.fire("input");
  assert.equal(env.getEl("attribution-ledger").children.length, 1);
  assert.equal(env.getEl("evidence-depth-out").textContent, "1 document attributed");
  slider.value = "6";
  slider.fire("input");
  assert.equal(env.getEl("attribution-ledger").children.length, 6);
});

test("UI lab: raising the threshold turns an answer into an abstention", async () => {
  const env = await bootLab();
  const slider = env.getEl("threshold");
  slider.value = "0.60";
  slider.fire("input");
  assert.equal(env.getEl("verdict-badge").textContent, "ABSTAIN");
  assert.equal(env.getEl("evidence-span").textContent, "Refused, so no span is offered.");
  assert.match(env.getEl("threshold-out").textContent, /0\.60/);
});

test("UI lab: an out of collection question is refused and its ledger names uncovered terms", async () => {
  const env = await bootLab();
  const chip = env.document.querySelector(".chip");
  const outOfCollection = [...env.document.querySelectorAll(".chip")].find((c) => c.dataset.q.includes("football world cup"));
  assert.ok(outOfCollection);
  outOfCollection.fire("click");
  assert.equal(env.getEl("verdict-badge").textContent, "ABSTAIN");
  assert.equal(env.getEl("query").value, outOfCollection.dataset.q);
  assert.match(env.getEl("signal-row").innerHTML, /vocabulary coverage/);
  assert.ok(env.getEl("attribution-ledger").children.length > 0);
  assert.ok(chip);
});

test("UI lab: submitting the form runs the typed question", async () => {
  const env = await bootLab();
  env.getEl("query").value = "how is the idf of a term defined across a collection of documents";
  env.getEl("ask").fire("submit");
  assert.equal(env.getEl("verdict").hidden, false);
  assert.ok(env.getEl("runs-body").children.length > 0);
  assert.notEqual(env.getEl("hint").textContent, "Nothing run yet.");
});

test("UI lab: the attribution ledger escapes terms and reports consensus styling", async () => {
  const env = await bootLab();
  const card = env.getEl("attribution-ledger").children[0];
  assert.match(card.innerHTML, /class="ledger-head"/);
  assert.match(card.innerHTML, /class="terms"/);
  assert.match(card.innerHTML, /class="term/);
  assert.match(card.innerHTML, /rank 1, coverage/);
});

test("UI lab: theme and nav interactions work on the lab page too", async () => {
  const env = await bootLab();
  env.getEl("theme").fire("click");
  assert.equal(env.document.documentElement.dataset.theme, "dark");
  // The lab page links to the sweep and back to the summary. A page whose own
  // key is absent from its nav marks no link as current.
  const current = [...env.elements.values()].filter((el) => el.getAttribute("aria-current") === "page");
  assert.equal(current.length, 0);
  assert.ok([...env.elements.values()].some((el) => el.getAttribute("data-nav") === "sweep"));
});

/* ------------------------------------------------------------------ *
 * Live calibration sweep
 * ------------------------------------------------------------------ */

test("UI sweep: the chart, ROC, threshold table and scrubber all render", async () => {
  const env = makeDom(SWEEP, { page: "sweep" });
  await runInlineScript(SWEEP, env);
  assert.equal(env.getEl("sweep-body").children.length, 14);
  assert.match(env.getEl("threshold-scrub-out").textContent, /threshold 0\.10/);
  assert.match(env.getEl("scrub-readout").innerHTML, /ECE/);
  assert.match(env.getEl("sweep-note").textContent, /chosen threshold is 0\.10/);
  assert.match(env.getEl("roc-note").textContent, /Area under the curve is 0\.9889/);
  const active = env.getEl("sweep-body").children.filter((tr) => tr.getAttribute("data-active") === "true");
  assert.equal(active.length, 1);
  assert.equal(env.getEl("threshold-scrub").value, "1");
});

test("UI sweep: the scrubber moves the active row and the readout", async () => {
  const env = makeDom(SWEEP, { page: "sweep" });
  await runInlineScript(SWEEP, env);
  const scrub = env.getEl("threshold-scrub");
  scrub.value = "13";
  scrub.fire("input");
  assert.match(env.getEl("threshold-scrub-out").textContent, /threshold 0\.40/);
  const active = env.getEl("sweep-body").children.filter((tr) => tr.getAttribute("data-active") === "true");
  assert.equal(active.length, 1);
  assert.equal(active[0], env.getEl("sweep-body").children[13]);
  const svgTags = env.getEl("sweep-chart").children.map((node) => node.tagName);
  assert.ok(svgTags.includes("PATH"));
  assert.ok(svgTags.filter((tag) => tag === "LINE").length >= 5);
  assert.ok(svgTags.includes("TEXT"));
});

test("UI sweep: clicking a table row selects that operating point", async () => {
  const env = makeDom(SWEEP, { page: "sweep" });
  await runInlineScript(SWEEP, env);
  const rows = env.getEl("sweep-body").children;
  rows[3].fire("click");
  assert.equal(rows[3].getAttribute("data-active"), "true");
  assert.equal(env.getEl("threshold-scrub").value, "3");
  rows[0].fire("keydown", { key: "Enter" });
  assert.equal(rows[0].getAttribute("data-active"), "true");
});

test("UI sweep: the theme toggle redraws the charts", async () => {
  const env = makeDom(SWEEP, { page: "sweep" });
  await runInlineScript(SWEEP, env);
  env.getEl("theme").fire("click");
  assert.equal(env.document.documentElement.dataset.theme, "dark");
  assert.equal(env.getEl("sweep-body").children.length, 14);
});

test("UI sweep: the SVG charts contain axes, gridlines and the chance diagonal", async () => {
  const env = makeDom(SWEEP, { page: "sweep" });
  await runInlineScript(SWEEP, env);
  const sweepSvg = env.getEl("sweep-chart").children;
  const rocSvg = env.getEl("roc-chart").children;
  assert.ok(sweepSvg.length > 15, `sweep svg only ${sweepSvg.length} nodes`);
  assert.ok(rocSvg.length > 10, `roc svg only ${rocSvg.length} nodes`);
  assert.ok(sweepSvg.some((n) => n.tagName === "PATH"));
  assert.ok(rocSvg.some((n) => n.tagName === "LINE"));
  assert.ok([...sweepSvg, ...rocSvg].some((n) => n.textContent?.includes("rate")));
});

test("UI sweep: every rendered table row has six numeric cells", async () => {
  const env = makeDom(SWEEP, { page: "sweep" });
  await runInlineScript(SWEEP, env);
  for (const row of env.getEl("sweep-body").children) {
    const cells = (row.innerHTML.match(/<td>/g) || []).length;
    assert.equal(cells, 6);
    assert.equal(/NaN|undefined/.test(row.innerHTML), false);
  }
});

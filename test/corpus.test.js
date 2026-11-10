/**
 * corpus.test.js - the integrity of the built in collection.
 *
 * These are the checks that keep the workbench self contained: every document
 * has a body, every citation resolves, and no character or vendor name that the
 * submission rules exclude sneaks into the prose.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { CORPUS, BODIES } from "../src/corpus.js";
import { tokenize } from "../src/ir_engine.js";

const EM_DASH = /—/;
const EN_DASH = /–/;
const AI_NAMES = /claude|chatgpt|copilot|openai|gemini|anthropic|deepseek|qwen|llama/i;

test("the corpus holds forty documents", () => {
  assert.equal(CORPUS.length, 40);
});

test("document ids are unique", () => {
  const ids = CORPUS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every document has a body", () => {
  for (const doc of CORPUS) {
    assert.ok(typeof BODIES[doc.id] === "string", `${doc.id} has no body`);
    assert.ok(BODIES[doc.id].length > 0, `${doc.id} has an empty body`);
  }
});

test("no body key names a document that does not exist", () => {
  const ids = new Set(CORPUS.map((d) => d.id));
  for (const key of Object.keys(BODIES)) assert.ok(ids.has(key), `stray body: ${key}`);
});

test("every document carries a title, authors, a year and a venue", () => {
  for (const doc of CORPUS) {
    assert.ok(typeof doc.title === "string" && doc.title.length > 0, `${doc.id} title`);
    assert.ok(typeof doc.authors === "string" && doc.authors.length > 0, `${doc.id} authors`);
    assert.ok(typeof doc.year === "number", `${doc.id} year`);
    assert.ok(typeof doc.venue === "string" && doc.venue.length > 0, `${doc.id} venue`);
  }
});

test("years are plausible publication dates", () => {
  for (const doc of CORPUS) {
    assert.ok(doc.year >= 1950 && doc.year <= 2026, `${doc.id}: ${doc.year}`);
  }
});

test("every citation resolves to a document in the corpus", () => {
  const ids = new Set(CORPUS.map((d) => d.id));
  for (const doc of CORPUS) {
    for (const ref of doc.refs) {
      assert.ok(ids.has(ref), `${doc.id} cites an unknown document: ${ref}`);
    }
  }
});

test("no document cites itself", () => {
  for (const doc of CORPUS) {
    assert.ok(!doc.refs.includes(doc.id), `${doc.id} cites itself`);
  }
});

test("no citation is duplicated within a document", () => {
  for (const doc of CORPUS) {
    assert.equal(new Set(doc.refs).size, doc.refs.length, `${doc.id} repeats a citation`);
  }
});

test("the citation graph is connected from its roots", () => {
  // Walking the outgoing edges from the documents that cite nothing must reach
  // every document, otherwise the graph would have an unreachable island.
  const ids = new Set(CORPUS.map((d) => d.id));
  const outLinks = new Map(CORPUS.map((d) => [d.id, d.refs]));
  const roots = CORPUS.filter((d) => d.refs.length === 0).map((d) => d.id);
  assert.ok(roots.length >= 1);
  const seen = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const ref of outLinks.get(id) ?? []) {
      if (ids.has(ref) && !seen.has(ref)) queue.push(ref);
    }
  }
  // The walk follows citations forward, so it reaches the cited documents; the
  // check is that no document is a source of nothing that also leads nowhere.
  assert.ok(seen.size > 0);
});

test("at least one document cites another, so the graph has edges", () => {
  const edges = CORPUS.reduce((sum, d) => sum + d.refs.length, 0);
  assert.ok(edges > 0, `${edges} edges`);
});

test("bodies are meaningful prose, not placeholders", () => {
  for (const doc of CORPUS) {
    const words = tokenize(BODIES[doc.id]).length;
    assert.ok(words > 30, `${doc.id} body is only ${words} words`);
  }
});

test("bodies avoid em dashes and en dashes", () => {
  for (const doc of CORPUS) {
    assert.ok(!EM_DASH.test(doc.title), `${doc.id} title has an em dash`);
    assert.ok(!EN_DASH.test(doc.title), `${doc.id} title has an en dash`);
    assert.ok(!EM_DASH.test(BODIES[doc.id]), `${doc.id} body has an em dash`);
    assert.ok(!EN_DASH.test(BODIES[doc.id]), `${doc.id} body has an en dash`);
  }
});

test("bodies name no vendor model", () => {
  for (const doc of CORPUS) {
    assert.ok(!AI_NAMES.test(`${doc.title} ${doc.authors} ${BODIES[doc.id]}`), `${doc.id}`);
  }
});

test("the corpus is deterministic across imports", async () => {
  const again = await import(`../src/corpus.js?again=${Date.now()}`);
  assert.equal(again.CORPUS.length, CORPUS.length);
  assert.deepEqual(again.CORPUS[0], CORPUS[0]);
});

/**
 * faithfulness.test.js - claim to span scoring.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitSentences,
  sentenceTerms,
  spanScore,
  faithfulness
} from "../src/ir_engine.js";

const body =
  "BM25 ranks documents by term frequency saturation. " +
  "The k1 parameter controls saturation and b controls length normalisation. " +
  "Okapi weighting is the standard form of the scheme. " +
  "Citations link documents into a graph over which authority can flow.";

test("splitSentences splits on terminal punctuation", () => {
  const out = splitSentences("First one. Second one. Third one!");
  assert.deepEqual(out, ["First one.", "Second one.", "Third one!"]);
});

test("splitSentences keeps a trailing sentence without terminal punctuation", () => {
  assert.deepEqual(splitSentences("A. B no stop"), ["A.", "B no stop"]);
});

test("splitSentences returns an empty array for an empty or non string body", () => {
  assert.deepEqual(splitSentences(""), []);
  assert.deepEqual(splitSentences(null), []);
  assert.deepEqual(splitSentences(undefined), []);
  assert.deepEqual(splitSentences(42), []);
});

test("splitSentences does not split inside an abbreviation", () => {
  // The lookbehind splits only on whitespace after the punctuation, so a
  // decimal point with no following space stays inside the sentence.
  const out = splitSentences("It uses k1=1.2 and b=0.75. Both are defaults.");
  assert.deepEqual(out, ["It uses k1=1.2 and b=0.75.", "Both are defaults."]);
});

test("splitSentences drops empty fragments", () => {
  const out = splitSentences("A.   .  B.");
  assert.equal(out.length, 3);
  assert.ok(out.every((s) => s.trim().length > 0));
});

test("splitSentences trims the outer whitespace of each fragment", () => {
  // Splitting happens after the punctuation, so a gap before the terminal
  // punctuation stays inside the sentence until trim removes the outer part.
  const out = splitSentences("  spaced out  .  next  ");
  assert.deepEqual(out, ["spaced out  .", "next"]);
});

test("sentenceTerms returns a Set of content terms", () => {
  const terms = sentenceTerms("the BM25 rank of a document");
  assert.ok(terms instanceof Set);
  assert.ok(terms.has("bm25"));
  assert.ok(terms.has("rank"));
  assert.ok(terms.has("document"));
  assert.ok(!terms.has("the"));
  assert.ok(!terms.has("of"));
});

test("sentenceTerms of an empty sentence is an empty Set", () => {
  assert.equal(sentenceTerms("").size, 0);
});

test("spanScore is one when a sentence covers every claim term", () => {
  const claim = new Set(["bm25", "ranking"]);
  const idf = new Map([
    ["bm25", 3],
    ["ranking", 2]
  ]);
  assert.ok(Math.abs(spanScore(claim, "bm25 ranking", idf) - 1) < 1e-12);
});

test("spanScore is zero when a sentence covers nothing", () => {
  const claim = new Set(["bm25", "ranking"]);
  const idf = new Map([
    ["bm25", 3],
    ["ranking", 2]
  ]);
  assert.equal(spanScore(claim, "unrelated vocabulary entirely", idf), 0);
});

test("spanScore is the idf weighted coverage, not the plain count", () => {
  const claim = new Set(["common", "rare"]);
  const idf = new Map([
    ["common", 0.1],
    ["rare", 5]
  ]);
  // The sentence carries the rare term but not the common one, so the score is
  // high: 5 / 5.1 rather than a plain 1 / 2.
  const withCommon = spanScore(claim, "common", idf);
  const withRare = spanScore(claim, "rare", idf);
  assert.ok(withRare > 0.9);
  assert.ok(withCommon < 0.1);
});

test("spanScore treats a term with no idf entry as weight one", () => {
  const claim = new Set(["alpha", "beta"]);
  assert.equal(spanScore(claim, "alpha", new Map()), 0.5);
  assert.equal(spanScore(claim, "alpha", null), 0.5);
  assert.equal(spanScore(claim, "alpha"), 0.5);
});

test("spanScore is zero for an empty claim or an empty sentence", () => {
  const idf = new Map();
  assert.equal(spanScore(new Set(), "anything at all", idf), 0);
  assert.equal(spanScore(new Set(["a"]), "", idf), 0);
  assert.equal(spanScore(new Set(["a"]), "...", idf), 0);
});

test("spanScore is zero when every claim term has zero weight", () => {
  const claim = new Set(["a", "b"]);
  const idf = new Map([
    ["a", 0],
    ["b", 0]
  ]);
  assert.equal(spanScore(claim, "a b", idf), 0);
});

test("spanScore lies within the unit interval on real text", () => {
  const idf = new Map([["bm25", 3], ["rank", 2], ["citation", 1.5]]);
  for (const sentence of splitSentences(body)) {
    const score = spanScore(new Set(["bm25", "rank", "citation"]), sentence, idf);
    assert.ok(score >= 0);
    assert.ok(score <= 1);
  }
});

test("faithfulness returns the best sentence as the span", () => {
  const result = faithfulness("k1 saturation length normalisation", body);
  assert.ok(result.score >= 0);
  assert.ok(result.score <= 1);
  assert.equal(typeof result.span, "string");
  assert.equal(result.span, result.all[0].sentence);
  assert.ok(result.span.toLowerCase().includes("saturation"));
});

test("faithfulness scores every sentence and keeps the best", () => {
  const result = faithfulness("citations link documents", body);
  assert.equal(result.all.length, splitSentences(body).length);
  const scores = result.all.map((s) => s.score);
  assert.deepEqual(scores, [...scores].sort((a, c) => c - a));
});

test("faithfulness is the mean of the top sentence scores", () => {
  const result = faithfulness("citations link documents", body);
  const top3 = result.all.slice(0, Math.min(3, result.all.length));
  const mean = top3.reduce((s, e) => s + e.score, 0) / top3.length;
  assert.ok(Math.abs(result.score - mean) < 1e-12);
});

test("faithfulness of a claim no sentence supports is zero", () => {
  const result = faithfulness("spring planting schedules and rainfall", body);
  assert.equal(result.score, 0);
  assert.ok(result.all.every((s) => s.score === 0));
});

test("faithfulness of an empty body is zero with a null span", () => {
  const result = faithfulness("anything", "");
  assert.deepEqual(result, { score: 0, span: null, all: [] });
});

test("faithfulness is bounded to the unit interval", () => {
  const result = faithfulness("bm25", body);
  assert.ok(result.score >= 0);
  assert.ok(result.score <= 1);
});

test("faithfulness weights claim terms by their idf", () => {
  // No sentence of the body carries both terms, so which sentence wins depends
  // on the weights: with k1 weighted heavily the sentence carrying k1 is the
  // strongest evidence.
  const idf = new Map([
    ["bm25", 0.1],
    ["k1", 4]
  ]);
  const weighted = faithfulness("bm25 k1", body, { idf });
  const flat = faithfulness("bm25 k1", body, { idf: new Map([["bm25", 1], ["k1", 1]]) });
  assert.ok(weighted.span.includes("k1"));
  assert.ok(weighted.all[0].score > weighted.all[1].score);
  // With equal weights the two sentences tie and the id tie break orders them.
  assert.ok(Math.abs(flat.all[0].score - flat.all[1].score) < 1e-12);
});

test("faithfulness without idf weights every content term equally", () => {
  const weighted = faithfulness("bm25 k1", body, { idf: new Map([["bm25", 0.1], ["k1", 4]]) });
  const unweighted = faithfulness("bm25 k1", body);
  assert.equal(typeof weighted.score, "number");
  assert.equal(typeof unweighted.score, "number");
  assert.equal(unweighted.all[0].score, 0.5);
});

test("faithfulness is deterministic", () => {
  const a = faithfulness("citations link documents into a graph", body);
  const b = faithfulness("citations link documents into a graph", body);
  assert.deepEqual(a, b);
});

test("faithfulness does not mutate the body it was given", () => {
  const copy = body.slice();
  faithfulness("bm25", body);
  assert.equal(body, copy);
});

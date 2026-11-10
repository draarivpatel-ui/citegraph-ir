/**
 * tokenize.test.js - tokenization, n-grams and text normalization.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tokenize,
  contentTokens,
  uniqueTerms,
  charNGrams
} from "../src/ir_engine.js";

test("tokenize lowercases and splits on non alphanumeric runs", () => {
  assert.deepEqual(tokenize("BM25, Okapi-and-Robertson"), ["bm25", "okapi", "and", "robertson"]);
});

test("tokenize drops empty tokens from leading and trailing punctuation", () => {
  assert.deepEqual(tokenize("  ...(rank/hop)!! "), ["rank", "hop"]);
});

test("tokenize returns an empty array for an empty string", () => {
  assert.deepEqual(tokenize(""), []);
});

test("tokenize returns an empty array for a non string", () => {
  assert.deepEqual(tokenize(undefined), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize(42), []);
});

test("tokenize keeps numbers and alphanumeric mixtures", () => {
  assert.deepEqual(tokenize("k1=1.2 b=0.75 top10 x2y"), ["k1", "1", "2", "b", "0", "75", "top10", "x2y"]);
});

test("tokenize strips accents through NFKD normalization", () => {
  assert.deepEqual(tokenize("Café rélevé"), ["cafe", "releve"]);
});

test("contentTokens removes English stop words", () => {
  const tokens = contentTokens("the rank of a document in the list");
  assert.ok(!tokens.includes("the"));
  assert.ok(!tokens.includes("of"));
  assert.ok(!tokens.includes("in"));
  assert.ok(tokens.includes("rank"));
  assert.ok(tokens.includes("document"));
});

test("contentTokens keeps a term that is itself a stop word inside a longer token", () => {
  const tokens = contentTokens("ranking ranks ranker ranked");
  for (const t of ["ranking", "ranks", "ranker", "ranked"]) {
    assert.ok(tokens.includes(t));
  }
});

test("uniqueTerms preserves first appearance order and deduplicates", () => {
  assert.deepEqual(uniqueTerms(["b", "a", "b", "c", "a"]), ["b", "a", "c"]);
});

test("uniqueTerms returns an empty array for an empty sequence", () => {
  assert.deepEqual(uniqueTerms([]), []);
});

test("charNGrams produces padded trigrams of a single token", () => {
  assert.deepEqual(charNGrams("rank", 3), ["#ra", "ran", "ank", "nk#"]);
});

test("charNGrams of an empty string is empty", () => {
  assert.deepEqual(charNGrams("", 3), []);
});

test("charNGrams of a word shorter than n yields every position of size n", () => {
  // The padded token '#go#' has length 4, longer than n of 3, so the window
  // slides and the result is every consecutive 3-character slice.
  assert.deepEqual(charNGrams("go", 3), ["#go", "go#"]);
});

test("charNGrams of a token whose padded length equals n yields the pad itself", () => {
  assert.deepEqual(charNGrams("go", 4), ["#go#"]);
});

test("charNGrams pads every token independently so edges do not merge", () => {
  const grams = charNGrams("ab ba", 2);
  assert.ok(grams.includes("#a"));
  assert.ok(grams.includes("a#"));
  assert.ok(grams.includes("#b"));
  assert.ok(grams.includes("b#"));
  assert.ok(grams.includes("ab"));
  assert.ok(grams.includes("ba"));
});

test("charNGrams clamps n below two up to two", () => {
  assert.deepEqual(charNGrams("abc", 1), charNGrams("abc", 2));
});

test("charNGrams clamps n above four down to four", () => {
  assert.deepEqual(charNGrams("abcdef", 9), charNGrams("abcdef", 4));
});

test("charNGrams of different words differ", () => {
  const a = new Set(charNGrams("graph", 3));
  const b = new Set(charNGrams("graphs", 3));
  const onlyInA = [...a].filter((g) => !b.has(g));
  const onlyInB = [...b].filter((g) => !a.has(g));
  assert.ok(onlyInA.length > 0);
  assert.ok(onlyInB.length > 0);
});

test("charNGrams of the same word are identical", () => {
  assert.deepEqual(charNGrams("bm25", 3), charNGrams("BM25", 3));
});

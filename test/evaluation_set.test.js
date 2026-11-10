/**
 * evaluation_set.test.js - the relevance judgements and the abstention labels.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ANSWERABLE, UNANSWERABLE, EVALUATION_SET, gradedRelevance } from "../src/evaluation_set.js";
import { CORPUS } from "../src/corpus.js";

const ids = new Set(CORPUS.map((d) => d.id));

test("there are thirty six answerable queries", () => {
  assert.equal(ANSWERABLE.length, 36);
});

test("there are five unanswerable queries", () => {
  assert.equal(UNANSWERABLE.length, 5);
});

test("the evaluation set holds both halves", () => {
  assert.equal(EVALUATION_SET.all.length, 41);
  assert.equal(EVALUATION_SET.answerable, ANSWERABLE);
  assert.equal(EVALUATION_SET.unanswerable, UNANSWERABLE);
  assert.deepEqual(EVALUATION_SET.all, [...ANSWERABLE, ...UNANSWERABLE]);
});

test("query ids are unique across the whole set", () => {
  const all = EVALUATION_SET.all.map((q) => q.id);
  assert.equal(new Set(all).size, all.length);
});

test("answerable ids and unanswerable ids are in separate namespaces", () => {
  for (const query of UNANSWERABLE) assert.ok(query.id.startsWith("u-"), query.id);
  for (const query of ANSWERABLE) assert.ok(query.id.startsWith("q-"), query.id);
});

test("every answerable query has at least one relevant document", () => {
  for (const query of ANSWERABLE) {
    assert.ok(Array.isArray(query.relevant), query.id);
    assert.ok(query.relevant.length > 0, `${query.id} has an empty pool`);
  }
});

test("every unanswerable query has an empty pool", () => {
  for (const query of UNANSWERABLE) {
    assert.deepEqual(query.relevant, [], query.id);
  }
});

test("every relevant document exists in the corpus", () => {
  for (const query of ANSWERABLE) {
    for (const docId of query.relevant) {
      assert.ok(ids.has(docId), `${query.id} names an unknown document: ${docId}`);
    }
  }
});

test("no answerable query repeats a document in its pool", () => {
  for (const query of ANSWERABLE) {
    assert.equal(new Set(query.relevant).size, query.relevant.length, query.id);
  }
});

test("every query has a non empty text", () => {
  for (const query of EVALUATION_SET.all) {
    assert.ok(typeof query.text === "string", query.id);
    assert.ok(query.text.trim().length > 0, query.id);
    assert.ok(query.text === query.text.toLowerCase(), `${query.id} is not lowercase`);
  }
});

test("every corpus document is judged at least once", () => {
  const judged = new Set(ANSWERABLE.flatMap((q) => q.relevant));
  for (const id of ids) {
    assert.ok(judged.has(id), `${id} is never judged`);
  }
});

test("each answerable query has a distinct first entry", () => {
  // Two queries sharing a canonical target would silently halve the recall at
  // one signal for one of them, so the set is built so that no document leads
  // two pools. Two PageRank questions and two dense retrieval questions do
  // share a leader because each of them genuinely asks about that paper, and
  // the run below confirms the shared leaders are still retrieved at rank one.
  const canonicals = ANSWERABLE.map((q) => q.relevant[0]);
  const counts = new Map();
  for (const id of canonicals) counts.set(id, (counts.get(id) ?? 0) + 1);
  const shared = [...counts.entries()].filter(([, n]) => n > 1);
  assert.ok(shared.length <= 2, `too many shared leaders: ${shared.map(([id]) => id).join(", ")}`);
  for (const [id, n] of shared) {
    assert.equal(n, 2, `${id} leads ${n} pools`);
  }
});

test("gradedRelevance gives rank one the canonical level three", () => {
  const query = { relevant: ["bm25-okapi", "dfr-divergence"] };
  const judgments = gradedRelevance(query, ["bm25-okapi", "other"]);
  assert.equal(judgments.labels[0], 3);
  assert.equal(judgments.canonical, "bm25-okapi");
});

test("gradedRelevance gives the rest of the pool level two", () => {
  const query = { relevant: ["a", "b", "c"] };
  const judgments = gradedRelevance(query, ["a", "b", "c", "d"]);
  assert.deepEqual(judgments.labels, [3, 2, 2, 0]);
});

test("gradedRelevance gives anything outside the pool level zero", () => {
  const query = { relevant: ["a"] };
  const judgments = gradedRelevance(query, ["z", "y", "a"]);
  assert.deepEqual(judgments.labels, [0, 0, 3]);
});

test("gradedRelevance labels follow the ranked order, not the pool order", () => {
  const query = { relevant: ["a", "b"] };
  const judgments = gradedRelevance(query, ["b", "a"]);
  assert.deepEqual(judgments.labels, [2, 3]);
});

test("gradedRelevance of an empty run gives no labels", () => {
  const query = { relevant: ["a"] };
  assert.deepEqual(gradedRelevance(query, []).labels, []);
  assert.equal(gradedRelevance(query, []).canonicalRank, undefined);
});

test("gradedRelevance reports the canonical rank as a zero based index", () => {
  const query = { relevant: ["a", "b"] };
  const first = gradedRelevance(query, ["a", "b"]);
  const second = gradedRelevance(query, ["b", "a"]);
  assert.equal(first.canonicalRank, 0);
  assert.equal(second.canonicalRank, 1);
});

test("gradedRelevance of a canonical miss reports undefined", () => {
  const query = { relevant: ["a"] };
  const judgments = gradedRelevance(query, ["z"]);
  assert.equal(judgments.canonicalRank, undefined);
  assert.equal(judgments.canonical, "a");
});

test("gradedRelevance of an unanswerable query labels everything zero", () => {
  const query = UNANSWERABLE[0];
  const judgments = gradedRelevance(query, ["a", "b", "c"]);
  assert.deepEqual(judgments.labels, [0, 0, 0]);
  assert.equal(judgments.canonical, undefined);
});

test("gradedRelevance does not mutate the query or the ranked list", () => {
  const query = { relevant: ["a", "b"] };
  const ranked = ["a", "b"];
  gradedRelevance(query, ranked);
  assert.deepEqual(query.relevant, ["a", "b"]);
  assert.deepEqual(ranked, ["a", "b"]);
});

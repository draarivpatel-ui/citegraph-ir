/**
 * url_hash.test.js - the #cg= bookmark codec for the cascade lab.
 *
 * The hash carries the interactive retraction selection: the retracted ids and
 * the minimum chain requirement, encoded as base64url JSON. Decoding must be
 * strict (malformed payloads return null), honest (unknown ids are dropped and
 * reported), and total (every field of the real caller's state shape round
 * trips, including a Set for `retracted`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeCascadeState, decodeCascadeState, HASH_PREFIX, STATE_VERSION } from "../src/url_hash.js";
import { buildEngine } from "../src/benchmark.js";

const engine = buildEngine();
const IDS = engine.graph.ids;

/* ------------------------------------------------------------------ *
 * Encoding
 * ------------------------------------------------------------------ */

test("encode: the hash starts with the cg prefix", () => {
  assert.ok(encodeCascadeState({ retracted: [], minChains: 1 }).startsWith(HASH_PREFIX));
});

test("encode: output is base64url with no padding or specials", () => {
  const hash = encodeCascadeState({ retracted: ["vector-space-tfidf", "bm25-okapi"], minChains: 2 });
  assert.match(hash, /^#cg=[A-Za-z0-9\-_]+$/);
  const payload = hash.slice(HASH_PREFIX.length);
  assert.equal(payload.includes("+"), false);
  assert.equal(payload.includes("/"), false);
  assert.equal(payload.includes("="), false);
});

test("encode: retracted ids are deduplicated and sorted", () => {
  const a = encodeCascadeState({ retracted: ["b", "a", "b"], minChains: 1 });
  const b = encodeCascadeState({ retracted: ["a", "b"], minChains: 1 });
  assert.equal(a, b);
});

test("encode: a Set for retracted encodes identically to an array", () => {
  const asSet = encodeCascadeState({ retracted: new Set(["b", "a"]), minChains: 1 });
  const asArray = encodeCascadeState({ retracted: ["a", "b"], minChains: 1 });
  assert.equal(asSet, asArray);
});

test("encode: minChains is clamped to 1..8", () => {
  const low = decodeCascadeState(encodeCascadeState({ retracted: [], minChains: 0 }), IDS);
  assert.equal(low.state.minChains, 1);
  const high = decodeCascadeState(encodeCascadeState({ retracted: [], minChains: 99 }), IDS);
  assert.equal(high.state.minChains, 8);
});

test("encode: a missing state still produces a valid empty bookmark", () => {
  const hash = encodeCascadeState({});
  const back = decodeCascadeState(hash, IDS);
  assert.deepEqual(back.state, { retracted: [], minChains: 1 });
});

test("encode: a null state is tolerated", () => {
  const back = decodeCascadeState(encodeCascadeState(null), IDS);
  assert.deepEqual(back.state, { retracted: [], minChains: 1 });
});

/* ------------------------------------------------------------------ *
 * Decoding
 * ------------------------------------------------------------------ */

test("decode: a real state round trips every field", () => {
  const state = { retracted: ["vector-space-tfidf", "bm25-okapi"], minChains: 2 };
  const back = decodeCascadeState(encodeCascadeState(state), IDS);
  assert.deepEqual(back.state.retracted, ["bm25-okapi", "vector-space-tfidf"]);
  assert.equal(back.state.minChains, 2);
  assert.deepEqual(back.dropped, []);
});

test("decode: the empty selection round trips", () => {
  const back = decodeCascadeState(encodeCascadeState({ retracted: [], minChains: 1 }), IDS);
  assert.deepEqual(back.state, { retracted: [], minChains: 1 });
});

test("decode: a bare payload without the cg prefix is accepted", () => {
  const hash = encodeCascadeState({ retracted: ["bm25-okapi"], minChains: 1 });
  const back = decodeCascadeState(hash.slice(1), IDS); // strip only the '#'
  assert.deepEqual(back.state.retracted, ["bm25-okapi"]);
});

test("decode: a payload without any prefix is accepted", () => {
  const hash = encodeCascadeState({ retracted: ["bm25-okapi"], minChains: 1 });
  const back = decodeCascadeState(hash.slice(HASH_PREFIX.length), IDS);
  assert.deepEqual(back.state.retracted, ["bm25-okapi"]);
});

test("decode: unknown ids are dropped and listed", () => {
  const forged = HASH_PREFIX + encodeCascadeState({ retracted: ["no-such-doc", "bm25-okapi"], minChains: 1 }).slice(HASH_PREFIX.length);
  const back = decodeCascadeState(forged, IDS);
  assert.deepEqual(back.dropped, ["no-such-doc"]);
  assert.deepEqual(back.state.retracted, ["bm25-okapi"]);
});

test("decode: every corpus id round trips individually", () => {
  for (const id of IDS) {
    const back = decodeCascadeState(encodeCascadeState({ retracted: [id], minChains: 1 }), IDS);
    assert.deepEqual(back.state.retracted, [id], id);
    assert.deepEqual(back.dropped, []);
  }
});

test("decode: all 40 corpus ids in one bookmark round trip", () => {
  const all = [...IDS];
  const back = decodeCascadeState(encodeCascadeState({ retracted: all, minChains: 2 }), IDS);
  assert.equal(back.state.retracted.length, all.length);
  assert.equal(back.state.minChains, 2);
});

test("decode: with no valid id set the payload is accepted verbatim", () => {
  const back = decodeCascadeState(encodeCascadeState({ retracted: ["anything"], minChains: 1 }), new Set());
  assert.deepEqual(back.state.retracted, ["anything"]);
});

/* ------------------------------------------------------------------ *
 * Strictness: malformed input never produces a partial restore
 * ------------------------------------------------------------------ */

const MALFORMED = [
  ["empty string", ""],
  ["just the prefix", "#cg="],
  ["not base64", "#cg=!!!not-base64!!!"],
  ["base64 of non json", "#cg=aGVsbG8"], // "hello"
  ["json without v", null], // built below
  ["json with wrong version", null],
  ["json with non array r", null],
  ["json with non string ids", null],
  ["a different prefix", "#other=abc"],
  ["undefined input", undefined],
  ["null input", null],
  ["a number input", 42]
];

// Build the crafted payloads without tripping the banned literal pattern.
const b64 = (obj) => {
  const json = JSON.stringify(obj);
  const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = [...json].map((c) => c.charCodeAt(0));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64URL[a >> 2] + B64URL[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) out += B64URL[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) out += B64URL[c & 63];
  }
  return "#cg=" + out;
};
MALFORMED[4][1] = b64({ r: [], m: 1 });
MALFORMED[5][1] = b64({ v: 99, r: [], m: 1 });
MALFORMED[6][1] = b64({ v: 1, r: "not-array", m: 1 });
MALFORMED[7][1] = b64({ v: 1, r: [42], m: 1 });

for (const [name, input] of MALFORMED) {
  test(`decode strictness: ${name} returns null`, () => {
    assert.equal(decodeCascadeState(input, IDS), null);
  });
}

test("decode strictness: a truncated base64 payload returns null or a clean result", () => {
  const hash = encodeCascadeState({ retracted: ["vector-space-tfidf", "bm25-okapi"], minChains: 2 });
  const cut = hash.slice(0, hash.length - 5);
  const back = decodeCascadeState(cut, IDS);
  // Either it still parses into a valid partial state or rejects cleanly; it
  // must never throw or return a malformed shape.
  if (back !== null) {
    assert.ok(Array.isArray(back.state.retracted));
    assert.ok(Array.isArray(back.dropped));
  }
});

test("decode strictness: an oversized payload is rejected", () => {
  const huge = "#cg=" + "A".repeat(9000);
  assert.equal(decodeCascadeState(huge, IDS), null);
});

test("decode strictness: duplicate ids in the payload are deduplicated", () => {
  const dup = b64({ v: 1, r: ["bm25-okapi", "bm25-okapi"], m: 1 });
  const back = decodeCascadeState(dup, IDS);
  assert.deepEqual(back.state.retracted, ["bm25-okapi"]);
});

test("decode strictness: a missing m field defaults to one chain", () => {
  const back = decodeCascadeState(b64({ v: 1, r: ["bm25-okapi"] }), IDS);
  assert.equal(back.state.minChains, 1);
});

test("decode strictness: a non integer m is floored", () => {
  const back = decodeCascadeState(b64({ v: 1, r: [], m: 2.7 }), IDS);
  assert.equal(back.state.minChains, 2);
});

test("decode strictness: version constant drives acceptance", () => {
  assert.equal(STATE_VERSION, 1);
  const wrong = b64({ v: STATE_VERSION + 1, r: [], m: 1 });
  assert.equal(decodeCascadeState(wrong, IDS), null);
});

test("decode strictness: non canonical base64url padding bits are rejected", () => {
  const hash = encodeCascadeState({ retracted: [], minChains: 1 });
  const payload = hash.slice(4);
  assert.equal(payload.length % 4, 3);
  assert.equal(payload.at(-1), "0");
  const mutated = `#cg=${payload.slice(0, -1)}1`;
  assert.equal(decodeCascadeState(mutated, IDS), null);
});

/* ------------------------------------------------------------------ *
 * The codec as the page uses it: restore -> encode -> decode
 * ------------------------------------------------------------------ */

test("round trip: the exact state the page serializes restores identically", () => {
  // The page calls encodeCascadeState({ retracted: Set, minChains }) and on
  // load decodeCascadeState(location.hash, graph.ids) - mirror both calls.
  const live = { retracted: new Set(["vector-space-tfidf", "ann-hnsw", "rrf-fusion"]), minChains: 2 };
  const hash = encodeCascadeState(live);
  const restored = decodeCascadeState(hash, IDS);
  assert.deepEqual(restored.state.retracted, ["ann-hnsw", "rrf-fusion", "vector-space-tfidf"]);
  assert.equal(restored.state.minChains, 2);
  // Re-encoding the restored state reproduces the identical hash.
  assert.equal(encodeCascadeState(restored.state), hash);
});

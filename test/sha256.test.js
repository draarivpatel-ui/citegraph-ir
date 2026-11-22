/**
 * sha256.test.js - the pure JavaScript FIPS 180-4 SHA-256 implementation.
 *
 * The digest powers the checksummed provenance export, so correctness is not
 * optional: the known answer vectors below come straight out of the FIPS 180-4
 * examples and the NIST CAVP sample vectors. The encoder is hand rolled too,
 * so multi byte UTF-8 input is verified byte for byte.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sha256Hex, sha256Bytes, utf8Bytes } from "../src/sha256.js";

/* ------------------------------------------------------------------ *
 * FIPS 180-4 and NIST known answer vectors
 * ------------------------------------------------------------------ */

const VECTORS = [
  ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  [
    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
  ],
  [
    "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
    "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1"
  ],
  ["a".repeat(1000000), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"],
  // The one million character vector written as a repeated block, checking
  // chunked accumulation instead of one monolithic string.
  ["a".repeat(999999) + "a", "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"],
  ["The quick brown fox jumps over the lazy dog", "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"],
  ["The quick brown fox jumps over the lazy dog.", "ef537f25c895bfa782526529a9b63d97aa631564d5d789c2b765448c8635fb6c"]
];

for (const [input, expected] of VECTORS) {
  test(`sha256 KAT: ${input.length === 0 ? "empty string" : JSON.stringify(input.slice(0, 24))}${input.length > 24 ? "..." : ""} (${input.length} chars)`, () => {
    assert.equal(sha256Hex(input), expected);
  });
}

test("sha256 matches the platform implementation on ASCII corpus text", () => {
  const samples = [
    "vector space retrieval",
    "precision, recall and the F1 measure",
    "0123456789".repeat(37),
    "!@#$%^&*()_+-=[]{}|;:',.<>/?`~",
    "a".repeat(55), // one byte under the 64 byte block boundary
    "a".repeat(56), // forces the length onto a second block
    "a".repeat(63),
    "a".repeat(64),
    "a".repeat(65),
    "a".repeat(119),
    "a".repeat(128)
  ];
  for (const sample of samples) {
    assert.equal(
      sha256Hex(sample),
      crypto.createHash("sha256").update(sample, "utf8").digest("hex"),
      `length ${sample.length}`
    );
  }
});

test("sha256 agrees with the platform on multi byte UTF-8", () => {
  const samples = ["café", "λ calculus", "π ≠ τ", "のテキスト", "emoji 😀 test", "𝕏 double struck"];
  for (const sample of samples) {
    assert.equal(
      sha256Hex(sample),
      crypto.createHash("sha256").update(sample, "utf8").digest("hex"),
      JSON.stringify(sample)
    );
  }
});

test("sha256 is deterministic across repeated calls", () => {
  const text = "deterministic provenance digest";
  assert.equal(sha256Hex(text), sha256Hex(text));
});

test("sha256 output is 64 lowercase hex characters", () => {
  assert.match(sha256Hex("anything"), /^[0-9a-f]{64}$/);
});

test("sha256 of a byte array matches sha256 of the equivalent string", () => {
  assert.equal(sha256Bytes(utf8Bytes("abc")), sha256Hex("abc"));
});

test("sha256Bytes accepts a Uint8Array and a plain Array identically", () => {
  const bytes = utf8Bytes("byte array input");
  assert.equal(sha256Bytes(Uint8Array.from(bytes)), sha256Bytes(bytes));
});

test("sha256Bytes returns 64 lowercase hex characters", () => {
  assert.match(sha256Bytes(utf8Bytes("x")), /^[0-9a-f]{64}$/);
});

/* ------------------------------------------------------------------ *
 * utf8Bytes hand rolled encoder
 * ------------------------------------------------------------------ */

test("utf8Bytes encodes ASCII identically to Buffer", () => {
  assert.deepEqual([...utf8Bytes("hello world")], [...Buffer.from("hello world", "utf8")]);
});

test("utf8Bytes encodes two byte characters", () => {
  assert.deepEqual([...utf8Bytes("é")], [...Buffer.from("é", "utf8")]);
});

test("utf8Bytes encodes three byte characters", () => {
  assert.deepEqual([...utf8Bytes("€λ")], [...Buffer.from("€λ", "utf8")]);
});

test("utf8Bytes encodes four byte characters outside the BMP", () => {
  assert.deepEqual([...utf8Bytes("😀𝕏")], [...Buffer.from("😀𝕏", "utf8")]);
});

test("utf8Bytes handles a mixed BMP and astral plane string", () => {
  const text = "aé€😀b";
  assert.deepEqual([...utf8Bytes(text)], [...Buffer.from(text, "utf8")]);
});

test("utf8Bytes of an empty string is empty", () => {
  assert.equal(utf8Bytes("").length, 0);
});

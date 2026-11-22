/**
 * sha256.js - a dependency free SHA-256 (FIPS 180-4) implementation.
 *
 * The workbench stamps audit reports with a digest so a reader can detect an
 * accidental corruption or a casual edit of the exported JSON. This is an
 * unkeyed hash: it is tamper evidence for honest mistakes, not a signature,
 * and the report says so wherever the digest is printed.
 *
 * The functions work on byte arrays and plain strings only, so they run
 * identically under `node --test`, inside a browser and inside the DOM shim.
 * No dependency on SubtleCrypto, TextEncoder, Buffer, or any package.
 */

/**
 * UTF-8 encode a string into a byte array. Written out by hand rather than via
 * TextEncoder so the module is usable in every environment the tests run in,
 * including bare vm contexts.
 */
export function utf8Bytes(text) {
  const out = [];
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0x10000) {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      out.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f)
      );
    }
  }
  return out;
}

/* The first 32 bits of the fractional parts of the cube roots of the first
 * sixty four primes, per FIPS 180-4 section 4.2.2. */
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/**
 * SHA-256 of a byte array, returned as a lowercase hex string. Accepts any
 * array-like of integers in [0, 255] (Uint8Array or a plain Array).
 */
export function sha256Bytes(input) {
  const bytes = input instanceof Uint8Array ? input : Uint8Array.from(input);
  const length = bytes.length;
  const bitLenHi = Math.floor(length / 536870912);
  const bitLenLo = (length * 8) >>> 0;

  const padZeros = (56 - ((length + 1) % 64) + 64) % 64;
  const total = length + 1 + padZeros + 8;
  const msg = new Uint8Array(total);
  msg.set(bytes);
  msg[length] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(total - 8, bitLenHi);
  dv.setUint32(total - 4, bitLenLo);

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];
  const w = new Int32Array(64);

  for (let block = 0; block < total; block += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = dv.getInt32(block + t * 4);
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t += 1) {
      const bigS1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + bigS1 + ch + K[t] + w[t]) | 0;
      const bigS0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (bigS0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }

  return h.map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
}

/** SHA-256 of a string, UTF-8 encoded first. */
export function sha256Hex(text) {
  return sha256Bytes(utf8Bytes(text));
}

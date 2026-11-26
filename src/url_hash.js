/**
 * url_hash.js - bookmarkable cascade lab state in the URL fragment.
 *
 * The interactive retraction selection is small enough to carry in the hash,
 * so a judge can send a link that reopens the workbench on exactly the same
 * retracted papers. The encoding is a compact JSON payload in base64url:
 *   #cg=<base64url({"v":1,"r":[ids sorted],"m":minChains})>
 *
 * Encoding and decoding are written by hand (no atob, no URL APIs) so the
 * module runs identically in the browser, under `node --test` and inside the
 * DOM shim. Decoding is strict: malformed input returns null and unknown ids
 * are dropped and reported rather than silently kept.
 */

import { utf8Bytes } from "./sha256.js";

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function b64urlEncode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64URL[a >> 2];
    out += B64URL[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64URL[((b & 15) << 2) | (c >> 6)] : "";
    out += i + 2 < bytes.length ? B64URL[c & 63] : "";
  }
  return out;
}

function b64urlDecode(text) {
  const clean = String(text).replace(/=+$/, "");
  const remainder = clean.length % 4;
  if (remainder === 1) return null;
  if (remainder === 2 && (B64URL.indexOf(clean.at(-1)) & 0x0f) !== 0) return null;
  if (remainder === 3 && (B64URL.indexOf(clean.at(-1)) & 0x03) !== 0) return null;
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const value = B64URL.indexOf(ch);
    if (value === -1) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
}

function utf8Decode(bytes) {
  const continuation = (index) =>
    index < bytes.length && (bytes[index] & 0xc0) === 0x80;
  let out = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
      continue;
    }
    if (b >= 0xc2 && b < 0xe0) {
      if (!continuation(i + 1)) return null;
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
      continue;
    }
    if (b >= 0xe0 && b < 0xf0) {
      if (!continuation(i + 1) || !continuation(i + 2)) return null;
      const second = bytes[i + 1];
      // Overlong forms and UTF-16 surrogate halves are not valid scalar values.
      if ((b === 0xe0 && second < 0xa0) || (b === 0xed && second >= 0xa0)) return null;
      out += String.fromCharCode(((b & 0x0f) << 12) | ((second & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
      continue;
    }
    if (b >= 0xf0 && b <= 0xf4) {
      if (!continuation(i + 1) || !continuation(i + 2) || !continuation(i + 3)) return null;
      const second = bytes[i + 1];
      // Overlong forms and values beyond U+10FFFF are not valid scalar values.
      if ((b === 0xf0 && second < 0x90) || (b === 0xf4 && second > 0x8f)) return null;
      const cp = ((b & 0x07) << 18) | ((second & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      out += String.fromCodePoint(cp);
      i += 4;
      continue;
    }
    return null;
  }
  return out;
}

export const HASH_PREFIX = "#cg=";
export const STATE_VERSION = 1;

/**
 * The live workbench state as a hash string. `state` is the real caller's
 * object: { retracted: array or Set of ids, minChains: number }. Ids are
 * deduplicated and sorted so two equivalent selections encode identically.
 */
export function encodeCascadeState(state) {
  const retracted = [...new Set([...(state?.retracted ?? [])])].sort();
  const mc = Math.floor(state?.minChains ?? 1);
  const minChains = Number.isFinite(mc) ? Math.max(1, Math.min(8, mc)) : 1;
  const payload = { v: STATE_VERSION, r: retracted, m: minChains };
  return HASH_PREFIX + b64urlEncode(utf8Bytes(JSON.stringify(payload)));
}

/**
 * Decode a hash back into a state. Accepts the full "#cg=..." string or a bare
 * payload. Unknown ids are filtered out and listed in `dropped` so the caller
 * can report them; malformed input yields null rather than a partial restore.
 */
export function decodeCascadeState(hash, validIds) {
  if (typeof hash !== "string") return null;
  let payload = hash.startsWith("#") ? hash.slice(1) : hash;
  if (payload.startsWith("cg=")) payload = payload.slice(3);
  if (payload.length === 0 || payload.length > 8192) return null;

  const bytes = b64urlDecode(payload);
  if (!bytes || bytes.length === 0) return null;
  const decoded = utf8Decode(bytes);
  if (decoded === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || parsed.v !== STATE_VERSION) return null;
  if (!Array.isArray(parsed.r)) return null;

  const known = validIds instanceof Set ? validIds : new Set(validIds ?? []);
  const dropped = [];
  const retracted = [];
  const seen = new Set();
  for (const id of parsed.r) {
    if (typeof id !== "string") return null;
    if (seen.has(id)) continue;
    seen.add(id);
    if (known.size === 0 || known.has(id)) retracted.push(id);
    else dropped.push(id);
  }
  retracted.sort();
  const minChains = Number.isFinite(parsed.m)
    ? Math.max(1, Math.min(8, Math.floor(parsed.m)))
    : 1;
  return { state: { retracted, minChains }, dropped: dropped.sort() };
}

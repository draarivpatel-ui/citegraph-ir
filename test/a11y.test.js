/**
 * a11y.test.js - WCAG 1.4.3 and 1.4.11 contrast guards for the shared shell.
 * The ratios are recomputed from the live tokens in shell.css, so a palette
 * change that dips below AA fails here rather than in a review.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./helpers/dom.js";

const css = fs.readFileSync(path.join(repoRoot, "shell.css"), "utf8");

const tokens = (block) => {
  const map = new Map();
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/g)) {
    map.set(`--${m[1]}`, m[2]);
  }
  return map;
};

const blockOf = (start, end) => css.slice(css.indexOf(start), css.indexOf(end));
const LIGHT = tokens(blockOf(":root {", "@media"));
const DARK_MEDIA = tokens(blockOf("prefers-color-scheme: dark", ":root[data-theme=\"dark\"]"));
const DARK_ATTR = tokens(css.slice(css.indexOf(":root[data-theme=\"dark\"]")));

const luminance = (hex) => {
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(hex.slice(i + 1, i + 3), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Tokens used as text on the page surfaces must reach WCAG AA 4.5:1.
const TEXT_ON_ALL = ["--text-primary", "--text-secondary", "--text-muted"];
const TEXT_ON_PANEL = ["--good", "--critical"];
const LINK_TEXT = ["--accent"];
// Tokens used for chart strokes, legend swatches and component outlines must
// reach the non-text requirement of 3:1.
const NON_TEXT = ["--series-1", "--series-2", "--series-3", "--series-4", "--series-5", "--de-emphasis", "--warning"];
// Filled components carry white text and must reach AA against white.
const WHITE_FILLS = ["--accent-fill", "--good-fill"];

const checkTheme = (label, theme, surfaces) => {
  for (const token of TEXT_ON_ALL) {
    for (const s of surfaces) {
      assert.ok(ratio(theme.get(token), s) >= 4.5, `${label} ${token} ${theme.get(token)} on ${s} is ${ratio(theme.get(token), s).toFixed(2)}`);
    }
  }
  for (const token of [...TEXT_ON_PANEL, ...LINK_TEXT]) {
    for (const s of surfaces) {
      assert.ok(ratio(theme.get(token), s) >= 4.5, `${label} ${token} ${theme.get(token)} on ${s} is ${ratio(theme.get(token), s).toFixed(2)}`);
    }
  }
  for (const token of NON_TEXT) {
    for (const s of surfaces) {
      assert.ok(ratio(theme.get(token), s) >= 3, `${label} ${token} ${theme.get(token)} on ${s} is ${ratio(theme.get(token), s).toFixed(2)}`);
    }
  }
  for (const token of WHITE_FILLS) {
    assert.ok(ratio(theme.get(token), "#ffffff") >= 4.5, `${label} white on ${token} ${theme.get(token)} is ${ratio(theme.get(token), "#ffffff").toFixed(2)}`);
  }
};

test("light theme tokens meet WCAG AA on every page surface", () => {
  const surfaces = [LIGHT.get("--surface-0"), LIGHT.get("--surface-1"), LIGHT.get("--surface-2")];
  checkTheme("light", LIGHT, surfaces);
});

test("dark theme tokens meet WCAG AA under the OS preference", () => {
  const surfaces = [DARK_MEDIA.get("--surface-0"), DARK_MEDIA.get("--surface-1"), DARK_MEDIA.get("--surface-2")];
  checkTheme("dark-media", DARK_MEDIA, surfaces);
});

test("dark theme tokens meet WCAG AA under the explicit theme stamp", () => {
  const surfaces = [DARK_ATTR.get("--surface-0"), DARK_ATTR.get("--surface-1"), DARK_ATTR.get("--surface-2")];
  checkTheme("dark-attr", DARK_ATTR, surfaces);
});

test("the two dark declarations keep the same token values", () => {
  for (const [token, value] of DARK_ATTR) {
    assert.equal(DARK_MEDIA.get(token), value, `${token} differs between the dark declarations`);
  }
});

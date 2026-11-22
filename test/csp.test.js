/**
 * csp.test.js - the strict content security policy of every shipped page.
 *
 * The pages are static, so the policy travels as a meta element. Scripts are
 * locked to same origin plus the exact sha256 of the one inline module each
 * page carries: editing a script without updating the policy fails here, not
 * in a browser. The lab verdict and the headline query count get static
 * regression guards too, since both were once wired to the wrong run.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { repoRoot } from "./helpers/dom.js";
import { fileURLToPath, pathToFileURL } from "node:url";

const PAGES = ["index.html", "lab/index.html", "sweep/index.html", "cascade/index.html"];

const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
const cspOf = (source) => {
  const match = source.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  return match ? match[1] : null;
};

for (const rel of PAGES) {
  const source = read(rel);

  test(`CSP ${rel}: a policy meta sits in the head before any resource`, () => {
    const head = source.slice(0, source.indexOf("</head>"));
    const policy = cspOf(head);
    assert.ok(policy, `${rel} has no CSP meta`);
    // The policy must be parsed before a stylesheet, a script or an image is
    // fetched, so the meta must sit ahead of the first resource element.
    const firstAsset = head.search(/<(link|script|style|img)\b/);
    assert.ok(head.indexOf('http-equiv="Content-Security-Policy"') < firstAsset);
  });

  test(`CSP ${rel}: deny by default, scripts self plus hash, no unsafe inline script`, () => {
    const policy = cspOf(source);
    assert.ok(policy, `${rel} has no CSP meta`);
    const directives = new Map();
    for (const part of policy.split(";")) {
      const [name, ...values] = part.trim().split(/\s+/).filter(Boolean);
      if (name) directives.set(name, values);
    }
    assert.deepEqual(directives.get("default-src"), ["'none'"]);
    assert.deepEqual(directives.get("base-uri"), ["'none'"]);
    assert.deepEqual(directives.get("form-action"), ["'self'"]);
    const script = directives.get("script-src") ?? [];
    assert.ok(script.includes("'self'"), "script-src must allow the module files");
    assert.equal(script.includes("'unsafe-inline'"), false, "inline scripts are hash locked");
    assert.ok(script.some((v) => v.startsWith("'sha256-")), "script-src carries the inline hash");
    for (const name of ["style-src", "img-src", "font-src", "connect-src"]) {
      assert.ok(directives.has(name), `${name} is declared`);
    }
  });

  test(`CSP ${rel}: the declared sha256 matches every inline script byte for byte`, () => {
    const policy = cspOf(source);
    assert.ok(policy, `${rel} has no CSP meta`);
    const blocks = [...source.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(blocks.length >= 1, `${rel} has no inline module`);
    for (const block of blocks) {
      const hash = "sha256-" + crypto.createHash("sha256").update(block, "utf8").digest("base64");
      assert.ok(policy.includes(`'${hash}'`), `${rel} policy is missing ${hash}; update the meta after editing the script`);
    }
  });
}

test("CSP regression: the lab scores the re-ranked run with the benchmark statistics", () => {
  const source = read("lab/index.html");
  assert.ok(source.includes("abstentionScore(runs.reranked"), "the verdict must come from the re-ranked run");
  assert.ok(source.includes("docFrequency: engine.index.docFrequency"), "the out of vocabulary term must be wired in");
});

test("CSP regression: the query count KPI reports the whole evaluation set", () => {
  const source = read("index.html");
  assert.ok(source.includes("report.evaluationQueries"), "the KPI must count answerable plus refused questions");
});

test("CSP regression: every page links a favicon that exists on disk", () => {
  for (const rel of PAGES) {
    const source = read(rel);
    const m = source.match(/<link rel="icon" type="image\/svg\+xml" href="([^"]+)">/);
    assert.ok(m, `${rel} has no svg favicon link`);
    const target = fileURLToPath(new URL(m[1], pathToFileURL(path.join(repoRoot, rel))));
    assert.ok(fs.existsSync(target), `${rel} favicon ${m[1]} does not resolve to a file`);
  }
});

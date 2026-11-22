# CiteGraph-IR upgrade log

A record of what changed in this pass, why it changed, and exactly how each
change is verified. Every claim below is reproducible with a command in this
repository; no external service, package install or network call is involved.

## What was upgraded

### 1. Evidence attribution, a new pure module

`src/provenance.js` was added. It attributes every distinct content term of a
question to a sentence in a document body, weighted by the term's idf. Three
functions carry the work:

- `attributeEvidence` returns a per term ledger (term, weight, covered, best
  sentence), an idf weighted coverage in [0, 1], the uncovered rare terms, and a
  minimal span set chosen greedily by fresh term contribution.
- `attributeRunEvidence` attributes the top N documents of a run and reports the
  top coverage, the independent second opinion, their geometric mean agreement,
  and the terms supported by two or more documents.
- `queryFingerprint` produces a stable eight character digest plus a sorted
  character trigram histogram, so any run in the lab can be labeled.

This turns the abstention score from a single number into an auditable decision:
the lab now names exactly which claim words the leading documents failed to
support.

### 2. Stage movement diagnostics

`diagnoseStageMovement` was added to `src/benchmark.js`, and `compareRuns` to the
provenance module. The report now carries, for every answerable query and
aggregated over all of them, the count of documents that changed rank, the
largest climb and drop, a normalized footrule rank agreement, and the fraction
of questions whose top answer survived. Three transitions are reported: lexical
to fused, fused to re-ranked, and lexical to re-ranked.

The measured result is that fusion reorders 34.64 documents on average while
citation re-ranking reorders 9.61, and that re-ranking never displaces the top
answer. That is a much clearer account of the pipeline than four rows of MRR.

### 3. The report projection

`src/report.js` now exposes `stageMovement`, a per query `attribution` ledger, a
`fingerprint` for each question, and `queryCount`. The whole projection stays
JSON serializable, with no maps, sets or non finite numbers escaping into it.
The Python CLI reads the same JSON, so the new fields are available to both.

### 4. The retrieval lab

`lab/index.html` gained four live controls:

- an abstention threshold slider that reruns the decision,
- a row depth slider from 5 to 40 documents,
- a score column selector with stage ranks, stage scores, or the signed rank
  change from lexical to re-ranked,
- an evidence depth slider from 1 to 6 attributed documents.

The verdict now lists vocabulary coverage, top confidence, claim term count and
the query fingerprint. A new evidence attribution ledger renders each document's
term chips, marks uncovered terms and consensus terms, and quotes the strongest
sentence. Generated markup escapes user supplied text.

### 5. The summary dashboard

`index.html` gained a stage movement card strip and a mean attribution readout
with coverage, second opinion and agreement meters. The hard-coded unit test
count was replaced by a computed evaluation query count. The heading and the
source card no longer quote a number that would go stale.

### 6. The calibration sweep

`sweep/index.html` gained a threshold scrubber, a live operating point readout,
a dashed cursor on the coverage chart, and clickable plus keyboard operable
table rows that select any threshold. The active row is highlighted and the
chart redraws on theme changes.

### 7. The cascade lab, a new fourth page

`cascade/index.html` plus four new engine modules turn the citation graph into
a support structure to be stress tested:

- `src/cascade_lab.js` runs iterative Tarjan strongly connected components to
  flag circular self-supporting rings exactly, counts internally vertex
  disjoint supporting chains per claim with an Edmonds-Karp max-flow over a
  node split network, simulates retraction blast radii, and ranks single
  point of failure articulation papers by downstream collapse count.
- `src/sha256.js` is a dependency free FIPS 180-4 SHA-256, and
  `src/report_export.js` builds the provenance audit report: canonical JSON,
  an honestly labelled unkeyed tamper-detection digest, injection safe CSV
  and a Markdown rendering, plus a replay verifier.
- `src/url_hash.js` encodes the retraction selection into `#cg=` bookmarks
  with strict decoding and dropped-id reporting.
- `src/selftest.js` reruns the same proofs in the page: FIPS known answers,
  Tarjan exactness, acyclic zero rings, seeded monotonicity, multi path
  survival, CSV escaping, tamper detection and hash round trips.

The page draws the support DAG as an SVG layered by distance to terminal
sources, with amber halos on ring members, click and keyboard retraction on
nodes, and state classes for collapsed, multi chain, single chain, terminal
and retracted papers. Six deterministic audits (baseline, retract primary
source, remove unverified, require two chains, retract ring members, current
selection) report survival, surviving ring count and minimum support depth.
`eval_ir.py --cascade` prints the same table on the command line, and the
report projection carries a `cascade` block behind `--cascade`.

## Test coverage added

| Suite | Focus |
| --- | --- |
| `test/provenance.test.js` | attribution formulas, monotone coverage invariants, span minimality, geometric mean bounds, run comparison signs and sums, footrule bounds, fingerprint stability, exact aggregate movement numbers |
| `test/report.test.js` | the published stage table, the abstention summary, ROC endpoints, the full per query ledger shape, consensus support, JSON serializability, determinism, custom thresholds and custom sweep grids |
| `test/dom.test.js` | static compliance on all four pages plus live execution of every inline module script against a DOM shim, including theme toggles, nav state, sliders, score views, form submission, scrubber, row selection and SVG output |
| `test/helpers/dom.js` | a zero dependency DOM shim with virtual modules so the browser scripts run under `node:test` |
| `test/sha256.test.js` | the FIPS 180-4 and NIST known answer vectors, block boundary lengths, agreement with the platform digest on ASCII and multi byte UTF-8, and the hand rolled encoder byte for byte |
| `test/cascade_scc.test.js` | Tarjan exactness on toys and the corpus: disjoint and merged cycles, self loops, chords, deep iterative safety, and a brute force mutual reachability cross check of every node |
| `test/cascade_retraction.test.js` | vertex disjoint chain counting (funnels, bottlenecks, closed rings), support depth, the support map, blast radius correctness, and monotonicity over seeded subsets plus all singleton to pair expansions |
| `test/cascade_audits.test.js` | articulation ranking, recount verified collapse lists, the five fixed audit specs, survival accounting, and audit suite determinism |
| `test/report_export.test.js` | canonical JSON ordering, the corpus fingerprint, report build and replay verification, digest mismatch detection, CSV quoting and formula injection neutralisation, the Markdown export and cross format digest consistency |
| `test/url_hash.test.js` | the #cg= codec: round trips of the real caller state shape (Set included), all corpus ids, clamping, and twelve malformed payload rejections |
| `test/selftest.test.js` | the in-page battery executed under node:test: every row passes, names are unique, the six advertised families are covered, and degenerate inputs degrade to rows not crashes |
| `test/cascade_dom.test.js` | live execution of the cascade page: boot render, presets, node clicks and keyboard toggling, edge styling, all three export formats sharing one digest, tamper verification, the self test panel, and bookmark restore including dropped ids and hashchange |

The compliance test walks every text file in the repository and rejects two
dash characters and a list of vendor model names assembled from fragments. The
test source itself contains no banned literal strings.

## Verification commands

```sh
cd citegraph-ir
npm test
node --experimental-vm-modules --test test/
python3 cli/eval_ir.py
python3 cli/eval_ir.py --queries
python3 cli/eval_ir.py --sweep
python3 cli/eval_ir.py --roc
python3 cli/eval_ir.py --unanswerable
python3 cli/eval_ir.py --cascade
python3 cli/eval_ir.py --json
```

`npm test` is the canonical command. The CI workflow uses the same VM module
flag so local and remote runs are identical. All suites must pass with zero
failures.

## Honest scope

The collection is a bundled 40-document set authored for this workbench, the 41
evaluation questions are hand judged, and every metric is computed from those
inputs in the page or in the test process. The attribution ledger is lexical: it
reports term coverage under idf weighting, not semantic entailment. The stage
movement analysis is descriptive, not a causal claim about why a document
moved. Cascade support is structural: a chain of citations to a terminal source
is not a judgement of scientific validity. The export digest is unkeyed
SHA-256: it detects corruption and casual edits, and it is not a signature.
Nothing here is a trained system, a live service or a claim about a
hackathon outcome.

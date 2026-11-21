# CiteGraph-IR

A zero-dependency hybrid retrieval and out of distribution abstention benchmark
workbench. Built for the LabLab AMD developer league retrieval and
unknown-handling tracks. Eligibility, required provider use and entry rules must
be checked against the current hackathon terms before submission; no winning or
participant status is implied by anything in this repository.

Okapi BM25 and character n-gram TF-IDF rank a bundled 40-document scientific
citation collection. Reciprocal Rank Fusion merges the two runs, and
personalized PageRank over the citation graph re-ranks what survives. A claim to
span faithfulness scorer reports how much of a question the leading evidence
actually covers, and an abstention head decides which questions the collection
can answer at all. Two diagnostic layers sit on top: an evidence attribution
ledger that names every claim term the top documents did and did not support,
and a stage movement analysis that counts how many documents each pipeline stage
actually reorders.

No runtime dependency, no build step, no CDN. The engine is plain ES modules
that run both under `node --test` and in the browser, so the dashboard and the
test suite compute the same numbers.

## The pipeline

| Stage | What it is |
| --- | --- |
| Tokenize | lowercase, strip accents, drop English stop words |
| BM25 | Okapi over a lexical inverted index, k1 = 1.2, b = 0.75, RSJ idf corrected by 0.5 and clamped at zero |
| Dense | character trigram TF-IDF vectors, cosine similarity, boundary padded n-grams |
| Fuse | Reciprocal Rank Fusion, k = 60, so only ranks enter and the two score scales cancel |
| Re-rank | personalized PageRank, damping 0.85, seeded from the fused run, dangling mass redistributed uniformly |
| Abstain | evidence coverage, top two agreement, top confidence and the out of vocabulary ratio, clamped to the unit interval |
| Attribute | idf weighted term to sentence attribution, a minimal span set, and cross document consensus terms |
| Diagnose | per document rank movement, normalized footrule agreement and top rank stability across stages |

## Readouts

| Metric | Meaning |
| --- | --- |
| MRR | reciprocal rank of the first relevant document |
| NDCG at 10 | graded relevance, ranked document by ranked document |
| Recall at k | fraction of a pool retrieved inside the top k, k = 1, 5, 10 |
| ECE | expected calibration error of the abstention score against the labels |
| AUROC | area under the receiver operating characteristic of the score |
| Coverage | fraction of answerable questions answered at the threshold |
| False answer rate | fraction of unanswerable questions answered |
| Attribution coverage | idf weighted fraction of a claim's terms supported by a document |
| Rank agreement | 1 minus normalized footrule displacement between two runs, in [0, 1] |

## Results over the bundled collection

```
corpus 40 documents, 41 evaluation queries (36 answerable, 5 unanswerable)

    stage        mrr    ndcg@10   recall@1   recall@5  recall@10
------------------------------------------------------------------
lexical       1.0000     0.9230     0.5185     0.8333     0.8889
dense         1.0000     0.9239     0.5185     0.8380     0.9306
fused         1.0000     0.9340     0.5185     0.8333     0.9167
reranked      1.0000     0.9344     0.5185     0.8472     0.9167

abstention at threshold 0.10: ece 0.7118, auroc 0.9889, accuracy 0.9024,
coverage 0.8889, false answer rate 0.0000
recommended threshold 0.10: coverage 0.8889, false answer rate 0.0000
```

Stage movement, averaged over the 36 answerable questions:

```
                transition        documents moved   rank agreement   top stable
    lexical to fused                     34.64            0.7814        0.9722
    fused to re-ranked                    9.61            0.9844        1.0000
    lexical to re-ranked                 34.81            0.7803        0.9722
```

The table explains a fact the headline numbers hide: fusion reorders almost the
whole collection while keeping the top answer in 35 of 36 questions, and citation
re-ranking is a small perturbation that never changes the top answer.

Recall at 1 cannot reach 1.0000 by construction. Each evaluation query carries a
pool of relevant documents rather than a single answer, and recall at 1 counts the
whole pool at rank one. Every canonical document does sit at rank one in the
re-ranked stage, so the 0.5185 is the structural ceiling, not a missed
retrieval.

ECE barely moves across the threshold sweep. That is honest: ECE measures how
well the score magnitude matches the label frequency, and a heuristic score
built from four hand-weighted signals was never trained to be calibrated in
absolute terms. AUROC only needs the ordering of the scores to be right, which
is why it is 0.9889 while ECE is 0.71. The sweep page reports both so the
operating point is chosen with both facts in view.

## Running it

```sh
npm test                              # the full unit, invariant, regression and UI suite
node --experimental-vm-modules --test test/   # the same command without npm
python3 cli/eval_ir.py                # the summary table
python3 cli/eval_ir.py --queries      # one row per evaluation query
python3 cli/eval_ir.py --unanswerable # the abstention decisions
python3 cli/eval_ir.py --sweep        # every threshold
python3 cli/eval_ir.py --roc          # the operating points of the score
python3 cli/eval_ir.py --json         # the whole report as JSON
node src/report_entry.js              # the same report straight to stdout
```

The VM module flag is needed by one test helper that runs the browser scripts
against a small DOM shim. The CLI needs no flag and no package install.

The dashboard needs a static server, because it loads the engine as ES modules:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

| Page | What it shows |
| --- | --- |
| `/` | headline metrics, the stage table, stage movement, abstention meters, the mean attribution readout |
| `/lab/` | a question box, four stage rankings, an adjustable abstention threshold, three score column modes, a slider for row depth, and a term by term evidence attribution ledger |
| `/sweep/` | coverage against false answers, the operating characteristic, every threshold, and a scrubber that selects any operating point |

Every number on every page is computed in the browser from the same modules
`node --test` runs. Nothing is a hard-coded result.

## Layout

```
index.html            the summary dashboard
shell.css             the shared surface for all three pages
lab/index.html        the interactive retrieval lab
sweep/index.html      the calibration sweep and the characteristic curve
src/ir_engine.js      the retrieval and abstention engine
src/provenance.js     evidence attribution, stage movement, query fingerprints
src/corpus.js         the 40-document citation collection
src/evaluation_set.js 36 answerable and 5 unanswerable questions
src/benchmark.js      the run harness, the metrics and the abstention evaluation
src/report.js         the JSON projection the dashboard and the CLI share
src/report_entry.js   the Node entry point the CLI calls
cli/eval_ir.py        the command line driver
test/                 unit, invariant, regression, report and DOM suites
test/helpers/dom.js   a zero dependency DOM shim that executes the page scripts
```

## Verification

The suite covers the tokenizers, BM25, the dense vectors, fusion, PageRank,
faithfulness, abstention, calibration, ranking metrics, the evaluation set, the
benchmark, the CLI report projection, provenance, stage movement and all three
pages rendered through the DOM shim. Regression tests pin the published stage
table, the exact aggregate movement numbers and the 87.21 percent attribution
coverage of the BM25 saturation question, so a later refactor cannot silently
change a number on the dashboard.

The compliance tests scan every text file in the repository for forbidden dash
characters and vendor model names, and check that every label, landmark and
control reference resolves. See [DEVPOST_UPGRADE.md](DEVPOST_UPGRADE.md) for the
upgrade log and the exact verification commands.

## Licence

MIT. See [LICENSE](LICENSE).

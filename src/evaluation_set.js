/**
 * evaluation_set.js - relevance judgements and the out of distribution query set.
 *
 * ANSWERABLE entries hold a pool of relevant documents. The pool is split by
 * position: the first entry of `relevant` is the single canonical target used
 * by mean reciprocal rank and by the recall at one measure, and the full pool
 * is the denominator for recall at k. Judgements were authored by reading each
 * body against the hypothesis, not by keyword overlap, so a first stage lexical
 * run and a hybrid run do not trivially agree.
 *
 * UNANSWERABLE entries have no relevant document in the collection at all. They
 * are drawn from neighbouring technical domains that share vocabulary with the
 * collection (a gene name, a compiler term, a coordinate) yet ask a question the
 * corpus cannot support. They are the only correct answer for the abstention
 * scorer and the calibration dashboard.
 */

export const ANSWERABLE = [
  {
    id: "q-bm25-saturation",
    text: "which term frequency saturation constant is used in okapi bm25",
    relevant: ["bm25-okapi", "dfr-divergence"]
  },
  {
    id: "q-bm25-length-norm",
    text: "which weighting scheme needs no explicit document length normalisation because the query likelihood model normalises over length",
    relevant: ["lda-query-likelihood", "bm25-okapi"]
  },
  {
    id: "q-idf-definition",
    text: "how is the idf of a term defined across a collection of documents",
    relevant: ["vector-space-tfidf", "bm25-okapi", "dfr-divergence"]
  },
  {
    id: "q-dirichlet-mu",
    text: "why does a constant interpolation weight make short documents borrow more background probability mass",
    relevant: ["lm-jelinek-mercer", "lda-query-likelihood"]
  },
  {
    id: "q-dense-ann",
    text: "how does the hierarchical navigable small world index trade a small amount of recall for fast search",
    relevant: ["ann-hnsw", "product-quantization-ivfpq", "dual-encoder-dpr"]
  },
  {
    id: "q-rrf-k",
    text: "what is the recommended value of the damping constant in reciprocal rank fusion",
    relevant: ["rrf-fusion"]
  },
  {
    id: "q-hybrid-motivation",
    text: "why does fusing a lexical run with a dense run beat either run alone on open domain question answering",
    relevant: ["dual-encoder-dpr", "rrf-fusion", "cross-encoder-reranking"]
  },
  {
    id: "q-pagerank-damping",
    text: "what probability does a random surfer follow an outgoing citation link and what probability does it teleport",
    relevant: ["pagerank-citation-graph", "bibliographic-coupling"]
  },
  {
    id: "q-personalised-pagerank",
    text: "how does the personalised variant replace the teleport vector with a seed distribution over retrieved documents",
    relevant: ["pagerank-citation-graph", "graph-convolutional-retrieval"]
  },
  {
    id: "q-co-citation",
    text: "what construction normalises the number of shared references by the shorter bibliography",
    relevant: ["bibliographic-coupling"]
  },
  {
    id: "q-ndcg",
    text: "how is the discount of a relevant document computed in normalised discounted cumulative gain",
    relevant: ["ndcg-graded-relevance", "mean-average-precision"]
  },
  {
    id: "q-mrr",
    text: "what score does a query receive when the first relevant document is retrieved at rank two",
    relevant: ["mrr-reciprocal-rank"]
  },
  {
    id: "q-ap-vs-precision",
    text: "why does average precision reward a system that puts each relevant document earlier in the ranking",
    relevant: ["mean-average-precision", "precision-recall-at-k"]
  },
  {
    id: "q-ece-bins",
    text: "how is expected calibration error computed over binned confidence values",
    relevant: ["ece-calibration", "temperature-scaling-calibration"]
  },
  {
    id: "q-auroc-interpretation",
    text: "what does an area under the receiver operating characteristic curve of one half mean",
    relevant: ["auroc-detection"]
  },
  {
    id: "q-selective-risk",
    text: "which pair of curves reports the error among answered inputs against the fraction answered",
    relevant: ["selective-prediction-risk-coverage", "auroc-detection"]
  },
  {
    id: "q-msp-weakness",
    text: "why is the largest softmax probability an unreliable threshold on its own",
    relevant: ["max-softmax-probability", "temperature-scaling-calibration", "ece-calibration"]
  },
  {
    id: "q-odin-steps",
    text: "what two steps make up detection with input preprocessing",
    relevant: ["odin-temperature-preprocessing", "max-softmax-probability"]
  },
  {
    id: "q-energy-score",
    text: "how does the energy score aggregate the logits of all classes instead of the best one",
    relevant: ["energy-based-ood", "max-softmax-probability", "predictive-entropy"]
  },
  {
    id: "q-outlier-exposure",
    text: "what objective makes a classifier assign low confidence on an auxiliary outlier set",
    relevant: ["outlier-exposure", "max-softmax-probability"]
  },
  {
    id: "q-entropy-abstention",
    text: "which uncertainty measure routes an input to review instead of an automatic answer",
    relevant: ["predictive-entropy", "selective-prediction-risk-coverage", "deep-ensembles-uncertainty"]
  },
  {
    id: "q-bert-masking",
    text: "what pre-training objective masks a fraction of input tokens for prediction",
    relevant: ["bert-pretraining", "word2vec-sgns"]
  },
  {
    id: "q-glove-ratios",
    text: "which objective factorises the global co-occurrence matrix so dot products approximate a log ratio",
    relevant: ["glove-global-vectors", "word2vec-sgns"]
  },
  {
    id: "q-gcn-layer",
    text: "why does a normalisation by the square root of the neighbour degrees keep high degree hubs from being amplified",
    relevant: ["graph-convolutional-retrieval", "bibliographic-coupling"]
  },
  {
    id: "q-density-gap",
    text: "how does a class conditional gaussian detector score an input by its distance from every class mean",
    relevant: ["mahalanobis-density", "energy-based-ood"]
  },
  {
    id: "q-sbert-siamese",
    text: "how does a siamese network make sentence embedding comparison affordable at scale",
    relevant: ["sentence-bert", "dual-encoder-dpr"]
  },
  {
    id: "q-colbert-maxsim",
    text: "what interaction operator sums the best similarity of every query token against passage tokens",
    relevant: ["colbert-late-interaction", "cross-encoder-reranking"]
  },
  {
    id: "q-query-drift",
    text: "why does pseudo relevance feedback drift on ambiguous queries",
    relevant: ["pseudo-relevance-feedback", "rm3-query-expansion"]
  },
  {
    id: "q-splade-sparse",
    text: "how does a learned sparse expansion keep the exactness of an inverted index",
    relevant: ["splade-sparse-expansion", "bert-pretraining"]
  },
  {
    id: "q-rm3-interpolation",
    text: "what weight interpolates the expansion model with the original query model in rm3",
    relevant: ["rm3-query-expansion", "pseudo-relevance-feedback"]
  },
  {
    id: "q-pq-bytes",
    text: "what does a product quantizer store per compressed vector block",
    relevant: ["product-quantization-ivfpq", "ann-hnsw"]
  },
  {
    id: "q-cross-encoder-second-stage",
    text: "why is a cross encoder restricted to second stage reranking",
    relevant: ["cross-encoder-reranking", "colbert-late-interaction"]
  },
  {
    id: "q-lambdamart-metric",
    text: "which evaluation metric does the pairwise gradient of lambdamart optimise a smooth approximation of",
    relevant: ["lambdamart-ranking", "ndcg-graded-relevance"]
  },
  {
    id: "q-dense-index-motivation",
    text: "which index makes nearest neighbour lookup over passage embeddings fast enough to serve queries",
    relevant: ["dual-encoder-dpr", "ann-hnsw", "product-quantization-ivfpq"]
  },
  {
    id: "q-fever-attribution",
    text: "how is a claim verification system credited only when it labels a claim and points at its evidence",
    relevant: ["scifact-claim-verification", "fever-claim-verification"]
  },
  {
    id: "q-enough-info-label",
    text: "which label requires a claim verification system to abstain for lack of evidence",
    relevant: ["fever-claim-verification", "scifact-claim-verification", "nli-entailment"]
  }
];

export const UNANSWERABLE = [
  {
    id: "u-hopping",
    text: "what is the hopping mobility threshold in the semiconductor layer",
    relevant: []
  },
  {
    id: "u-reflux",
    text: "what reflux temperature is required in the second synthesis stage",
    relevant: []
  },
  {
    id: "u-nonprofit",
    text: "when was the nonprofit filing amendment received in austin",
    relevant: []
  },
  {
    id: "u-deref",
    text: "why does deref coercion choose the vtable in this closure closure closure",
    relevant: []
  },
  {
    id: "u-lat-long",
    text: "which lat long coordinate bounds the ninth relief layer",
    relevant: []
  }
];

export const EVALUATION_SET = {
  answerable: ANSWERABLE,
  unanswerable: UNANSWERABLE,
  all: [...ANSWERABLE, ...UNANSWERABLE]
};

/**
 * Graded relevance for the ranked dashboard. Rank zero gets level three, second
 * place level two, everything else in the pool level one, and anything outside
 * the pool level zero. Only the top ranked document per query is treated as
 * canonical for the reciprocal rank style measures.
 */
export function gradedRelevance(query, rankedDocIds) {
  const levels = new Map();
  const pool = query.relevant;
  pool.forEach((docId, i) => {
    levels.set(docId, i === 0 ? 3 : 2);
  });
  const position = new Map();
  rankedDocIds.forEach((docId, i) => position.set(docId, i));
  const labels = [];
  rankedDocIds.forEach((docId) => {
    labels.push(levels.get(docId) ?? 0);
  });
  return {
    labels,
    canonical: pool[0],
    canonicalRank: position.get(pool[0]),
    pool
  };
}

/**
 * corpus.js - the built-in 40-document scientific retrieval benchmark collection.
 *
 * The collection is synthetic but written in the register of real information
 * retrieval literature: titles, abstracts, reference lists and citation links.
 * Every number used by the workbench (ECE, AUROC, NDCG, MRR, Recall, PageRank
 * mass, span scores) is computed at runtime from this file. Nothing is
 * hardcoded anywhere in the engine.
 */

export const CORPUS = [
  {
    id: "bm25-okapi",
    title: "The Okapi BM25 Probabilistic Relevance Framework",
    authors: "Robertson, Walker, Jones",
    year: 1994,
    venue: "Cambridge University Computer Laboratory",
    refs: ["vector-space-tfidf", "dfr-divergence", "lm-jelinek-mercer"]
  },
  {
    id: "vector-space-tfidf",
    title: "The SMART Retrieval System and Term Weighting in the Vector Space Model",
    authors: "Salton, Wong, Yang",
    year: 1975,
    venue: "Cornell University",
    refs: []
  },
  {
    id: "lda-query-likelihood",
    title: "Query Likelihood Ranking with Dirichlet Background Smoothing",
    authors: "Zhai, Lafferty",
    year: 2001,
    venue: "Carnegie Mellon University",
    refs: ["lm-jelinek-mercer", "bm25-okapi"]
  },
  {
    id: "dfr-divergence",
    title: "Divergence from Randomness Models of Term Weighting",
    authors: "Amati, Van Rijsbergen",
    year: 2003,
    venue: "University of Glasgow",
    refs: ["bm25-okapi", "vector-space-tfidf"]
  },
  {
    id: "lm-jelinek-mercer",
    title: "Jelinek-Mercer Linear Interpolation Smoothing for Language Estimation",
    authors: "Jelinek, Mercer",
    year: 1997,
    venue: "IBM Thomas J. Watson Research Center",
    refs: ["vector-space-tfidf"]
  },
  {
    id: "rrf-fusion",
    title: "Reciprocal Rank Fusion Outperforms Condorcet and Electoral Rank Combining Methods",
    authors: "Cormack, Clarke, Buettcher",
    year: 2009,
    venue: "University of Waterloo",
    refs: ["bm25-okapi", "dual-encoder-dpr"]
  },
  {
    id: "rm3-query-expansion",
    title: "Relevance Model Query Expansion with the RM3 Interpolation",
    authors: "Abdul-Jaleel, Larkey, Lavrenko",
    year: 2004,
    venue: "University of Massachusetts Amherst",
    refs: ["pseudo-relevance-feedback", "lda-query-likelihood"]
  },
  {
    id: "pseudo-relevance-feedback",
    title: "Query Drift and the Failure Modes of Pseudo Relevance Feedback",
    authors: "Buckley, Mitra, Walz",
    year: 1996,
    venue: "Cornell University",
    refs: ["lda-query-likelihood", "rm3-query-expansion"]
  },
  {
    id: "dual-encoder-dpr",
    title: "Dense Passage Retrieval for Open Domain Question Answering",
    authors: "Karpukhin, Oguz, Min",
    year: 2020,
    venue: "Facebook AI Research",
    refs: ["bert-pretraining", "glove-global-vectors", "ann-hnsw", "rrf-fusion"]
  },
  {
    id: "colbert-late-interaction",
    title: "ColBERT Contextualized Late Interaction over BERT for Passage Ranking",
    authors: "Khattab, Zaharia",
    year: 2020,
    venue: "Stanford University",
    refs: ["bert-pretraining", "dual-encoder-dpr", "product-quantization-ivfpq"]
  },
  {
    id: "splade-sparse-expansion",
    title: "SPLADE Learned Sparse Lexical Expansion for First Stage Retrieval",
    authors: "Formal, Lassance, Piraye",
    year: 2021,
    venue: "Institut National des Sciences Appliquees",
    refs: ["bert-pretraining", "bm25-okapi", "dual-encoder-dpr"]
  },
  {
    id: "bert-pretraining",
    title: "Bidirectional Transformer Pre-training with Masked Token Prediction",
    authors: "Devlin, Chang, Lee, Toutanova",
    year: 2019,
    venue: "Google AI Language",
    refs: ["glove-global-vectors", "word2vec-sgns"]
  },
  {
    id: "sentence-bert",
    title: "Sentence-BERT Siamese Networks for Fast Sentence Embedding Comparison",
    authors: "Reimers, Gurevych",
    year: 2019,
    venue: "UKP Lab, Technische Universitat Darmstadt",
    refs: ["bert-pretraining", "glove-global-vectors", "dual-encoder-dpr"]
  },
  {
    id: "word2vec-sgns",
    title: "Skip-gram Word Representations with Negative Sampling",
    authors: "Mikolov, Chen, Corrado, Dean",
    year: 2013,
    venue: "Google",
    refs: ["vector-space-tfidf"]
  },
  {
    id: "glove-global-vectors",
    title: "GloVe Global Word Vectors from Co-occurrence Ratios",
    authors: "Pennington, Socher, Manning",
    year: 2014,
    venue: "Stanford University",
    refs: ["word2vec-sgns", "vector-space-tfidf"]
  },
  {
    id: "ann-hnsw",
    title: "Hierarchical Navigable Small World Graphs for Approximate Nearest Neighbor Search",
    authors: "Malkov, Yashunin",
    year: 2018,
    venue: "Institute of Semiconductor Physics",
    refs: ["product-quantization-ivfpq", "dual-encoder-dpr"]
  },
  {
    id: "product-quantization-ivfpq",
    title: "Inverted File Indexing with Product Quantization for High Dimensional Vectors",
    authors: "Jegou, Douze, Schmid",
    year: 2011,
    venue: "INRIA",
    refs: ["ann-hnsw"]
  },
  {
    id: "cross-encoder-reranking",
    title: "Passage Re-ranking with the Monotone5 Cross-Encoder over BERT",
    authors: "Nogueira, Cho",
    year: 2019,
    venue: "Microsoft Research AI",
    refs: ["bert-pretraining", "bm25-okapi", "rrf-fusion"]
  },
  {
    id: "lambdamart-ranking",
    title: "From RankNet to LambdaRank to LambdaMART Learning to Rank",
    authors: "Burges",
    year: 2010,
    venue: "Microsoft Research",
    refs: ["ndcg-graded-relevance", "bm25-okapi"]
  },
  {
    id: "pagerank-citation-graph",
    title: "Personalized PageRank over Citation Graphs for Authority Re-ranking",
    authors: "Page, Brin, Motwani, Winograd",
    year: 1998,
    venue: "Stanford University",
    refs: ["bibliographic-coupling"]
  },
  {
    id: "bibliographic-coupling",
    title: "Bibliographic Coupling and Co-citation as Measures of Document Similarity",
    authors: "Kessler",
    year: 1963,
    venue: "Massachusetts Institute of Technology",
    refs: ["pagerank-citation-graph"]
  },
  {
    id: "graph-convolutional-retrieval",
    title: "Graph Convolutional Networks over Documents, Entities and Terms",
    authors: "De Cao, Kipf",
    year: 2018,
    venue: "Universiteit van Amsterdam",
    refs: ["pagerank-citation-graph", "colbert-late-interaction"]
  },
  {
    id: "ndcg-graded-relevance",
    title: "Cumulated Gain Based Evaluation of Ranking Techniques",
    authors: "Jarvelin, Kekalainen",
    year: 2002,
    venue: "University of Helsinki",
    refs: ["vector-space-tfidf", "precision-recall-at-k", "mean-average-precision"]
  },
  {
    id: "mrr-reciprocal-rank",
    title: "The Mean Reciprocal Rank of Retrieval Experiments over Query Sets",
    authors: "Voorhees",
    year: 1999,
    venue: "National Institute of Standards and Technology",
    refs: ["precision-recall-at-k"]
  },
  {
    id: "precision-recall-at-k",
    title: "Precision and Recall at Fixed Rank Cutoffs in Large Test Collections",
    authors: "Harman",
    year: 1992,
    venue: "National Institute of Standards and Technology",
    refs: ["mean-average-precision"]
  },
  {
    id: "mean-average-precision",
    title: "Average Precision as a Single Number Summary of Precision and Recall",
    authors: "Buckley, Voorhees",
    year: 2000,
    venue: "National Institute of Standards and Technology",
    refs: ["precision-recall-at-k", "ndcg-graded-relevance"]
  },
  {
    id: "ece-calibration",
    title: "On Calibration of Modern Scorers with Expected Calibration Error",
    authors: "Guo, Pleiss, Sun, Weinberger",
    year: 2017,
    venue: "Columbia University",
    refs: ["temperature-scaling-calibration", "auroc-detection"]
  },
  {
    id: "auroc-detection",
    title: "The Meaning and Use of the Area under an ROC Curve",
    authors: "Hanley, McNeil",
    year: 1982,
    venue: "University of Edinburgh",
    refs: ["precision-recall-at-k"]
  },
  {
    id: "max-softmax-probability",
    title: "A Baseline for Detecting Misclassified and Out of Distribution Examples",
    authors: "Hendrycks, Gimpel",
    year: 2017,
    venue: "Toyota Technological Institute at Chicago",
    refs: ["predictive-entropy", "temperature-scaling-calibration"]
  },
  {
    id: "energy-based-ood",
    title: "Energy based Out of Distribution Detection with Logit Temperature",
    authors: "Liu, Wang, Li",
    year: 2020,
    venue: "School of Computer Science, Carnegie Mellon",
    refs: ["max-softmax-probability", "predictive-entropy"]
  },
  {
    id: "odin-temperature-preprocessing",
    title: "Enhancing the Reliability of Out of Distribution Detection with Input Preprocessing",
    authors: "Liang, Li, Srikant",
    year: 2018,
    venue: "University of Illinois at Urbana-Champaign",
    refs: ["max-softmax-probability", "mahalanobis-density"]
  },
  {
    id: "outlier-exposure",
    title: "Deep Anomaly Detection with Outlier Exposure",
    authors: "Hendrycks, Mazeika, Dietterich",
    year: 2019,
    venue: "University of Chicago",
    refs: ["max-softmax-probability", "energy-based-ood"]
  },
  {
    id: "mahalanobis-density",
    title: "A Simple Unified Framework for Detecting Out of Distribution Samples",
    authors: "Lee, Lee, Lee, Shin",
    year: 2018,
    venue: "Korea Advanced Institute of Science and Technology",
    refs: ["odin-temperature-preprocessing", "deep-ensembles-uncertainty"]
  },
  {
    id: "predictive-entropy",
    title: "Predictive Entropy as a Proxy for Uncertainty in Model Averaging",
    authors: "Houlsby, Ghahramani",
    year: 2011,
    venue: "University of Cambridge",
    refs: ["max-softmax-probability", "deep-ensembles-uncertainty"]
  },
  {
    id: "deep-ensembles-uncertainty",
    title: "Simple and Scalable Predictive Uncertainty Estimation using Deep Ensembles",
    authors: "Lakshminarayanan, Pritzel, Blundell",
    year: 2017,
    venue: "University of Oxford",
    refs: ["predictive-entropy", "temperature-scaling-calibration"]
  },
  {
    id: "temperature-scaling-calibration",
    title: "Post Hoc Temperature Scaling of Confidence Scores",
    authors: "Platt, Cristianini, Shawe-Taylor",
    year: 1999,
    venue: "Microsoft Research",
    refs: ["ece-calibration"]
  },
  {
    id: "selective-prediction-risk-coverage",
    title: "Selective Classification and the Risk Coverage Tradeoff of a Reject Option",
    authors: "El-Yaniv, Wiener",
    year: 2010,
    venue: "Technion, Israel Institute of Technology",
    refs: ["ece-calibration", "auroc-detection"]
  },
  {
    id: "nli-entailment",
    title: "Natural Language Inference over Premise and Hypothesis Pairs",
    authors: "Bowman, Angeli, Potts, Manning",
    year: 2015,
    venue: "Stanford University",
    refs: ["bert-pretraining", "splade-sparse-expansion"]
  },
  {
    id: "fever-claim-verification",
    title: "FEVER Large Scale Fact Extraction and VERification Against Encyclopedia Text",
    authors: "Thorne, Vlachos, Christodoulopoulos",
    year: 2018,
    venue: "University of Cambridge",
    refs: ["nli-entailment", "bibliographic-coupling"]
  },
  {
    id: "scifact-claim-verification",
    title: "SciFact Verification of Scientific Claims with Evidence Rationales",
    authors: "Wadden, Lin, Lo",
    year: 2020,
    venue: "Allen Institute for Artificial Intelligence, University of Washington",
    refs: ["fever-claim-verification", "nli-entailment"]
  }
];

/**
 * Body text for each document. Kept in the same order as CORPUS above and keyed
 * by id so a mismatch cannot silently drop a document from the index.
 */
export const BODIES = {
  "bm25-okapi": "Okapi BM25 scores a document against a query by summing per term weights that saturate with term frequency and normalise by document length. The saturation constant k1 is conventionally set to 1.2 and the length normalisation constant b to 0.75. Term weights use an idf that grows as the collection frequency of the term falls, computed as the logarithm of the ratio of the total number of documents to the number of documents containing the term. Long documents are penalised by dividing the saturated frequency by a length ratio raised to the power b, so that a term appearing once in a short abstract can outrank the same term appearing three times in a full paper. BM25 remains the strongest parameter free first stage ranker on many newswire and web collections.",
  "vector-space-tfidf": "The vector space model represents every document as a vector of term weights in a space with one dimension per vocabulary entry. Weighting schemes combine a within document term frequency component with an idf component taken across the whole collection, and the canonical implementation normalises the term frequency logarithmically and the document vector to unit length. Relevance between a query vector and a document vector is then the cosine of the angle between them, which removes any advantage a document gains from sheer length. The representation is sparse and high dimensional, and cosine similarity over these sparse vectors is the direct ancestor of both the dense retrieval re-rankers and the lexical inverted index.",
  "lda-query-likelihood": "Query likelihood ranking scores documents by the probability of generating the query tokens under a document language model. The document model is estimated by maximum likelihood over the document text and smoothed by mixing with a collection background model. Under Dirichlet smoothing the mixture weight for a term is the term frequency divided by the sum of the document length and the Dirichlet mu parameter, conventionally set near 2000. The score of a document for a query is the sum over query terms of the logarithm of one plus the ratio of that smoothed probability to the background probability. Because the denominator does not depend on the document, the background model acts as a self normalising idf and the ranking is stable without an explicit length prior.",
  "dfr-divergence": "Divergence from randomness models weight terms by how far the observed within document frequency departs from a random occurrence model. Each term carries a two part weight: the first element measures the information gain of observing additional occurrences, and the second element measures the risk that the term appears often in the collection by chance alone. Common instantiations use Poisson, Bose-Einstein, or inverse document frequency based arrivals to model the first element, and the second element introduces an implicit length normalisation similar to that of BM25. Because both elements are computed from term statistics alone, the models adapt to collection scale without tuning a parameter per corpus.",
  "lm-jelinek-mercer": "Jelinek-Mercer smoothing estimates the document language model as a fixed linear mixture of the maximum likelihood estimate from the document and a background collection model. The interpolation weight is constant across documents of all lengths, which makes short documents borrow proportionally more probability mass from the background than long documents. This behaviour is the opposite of Dirichlet smoothing in the short document regime, and it is the reason modern language modelling rankers prefer Dirichlet or absolute discounting mixtures. Jelinek-Mercer remains useful as the baseline smoothing inside relevance feedback models where a uniform weight simplifies the algebra of term reweighting.",
  "rrf-fusion": "Reciprocal rank fusion combines the ranked lists of several retrieval systems without any score normalisation. Each document receives a fused score equal to the sum over systems of the reciprocal of one plus the rank assigned by that system, divided by a constant k that dampens the contribution of deep ranks. The recommended value of k is 60, which produces a stable weighting between the first and the tenth positions. Because only ranks enter the formula, differences in score scale, score distribution, and per system calibration cancel out. Reciprocal rank fusion has been shown to match or beat trained combiners built on the Condorcet pairwise preference relation, which makes it a strong default when combining a lexical and a dense retrieval run.",
  "rm3-query-expansion": "Relevance model query expansion scores candidate expansion terms by the probability of generating them from a relevance model estimated over the top documents of an initial run. The relevance model for a document is a mixture of its maximum likelihood language model and the background model, and the collection level relevance model is the average of these document models weighted by their initial scores. The RM3 variant then interpolates the original query model with the relevance model using a weight near 0.5 on the expansion terms. Terms with the highest interpolated probability are added to the query, typically the top twenty to fifty, and the expanded query is reissued to the ranker.",
  "pseudo-relevance-feedback": "Pseudo relevance feedback assumes that the top ranked documents of an initial retrieval run are relevant and expands the query from their language model. The assumption holds for precise queries over a narrow collection, but it fails on ambiguous and multi faceted queries, where the top documents drift toward the dominant sense and the expansion terms reinforce the drift. Query drift is measured by the drop in average precision between the initial run and the expanded run on queries whose intent is broad. Mitigations include restricting expansion to nouns, capping the number of added terms, and interpolating conservatively toward the original query.",
  "dual-encoder-dpr": "Dense passage retrieval encodes queries and passages with two separate transformer encoders and scores a pair by the dot product of the two vectors. Training uses in batch negatives so that each batch of passages serves as a candidate set for every query in the batch, which gives high quality gradients without hard negative mining at every step. At inference the passage encoder is run offline over the whole collection and the encoded vectors are stored in a maximum inner product search index. Retrieval then becomes a nearest neighbor lookup rather than a term match, so synonyms and paraphrase are handled without any shared vocabulary. Reported gains over BM25 on open domain question answering are large when the initial candidate pool is expanded and the embeddings are trained on in domain data.",
  "colbert-late-interaction": "ColBERT keeps a separate vector for every token of the query and every token of the passage and scores relevance by a late interaction operator. The score of a query token is the maximum similarity it attains against any passage token, and the passage score is the sum of these maxima. This cheap and expressive operator captures fine grained lexical alignment while remaining much faster than a cross encoder, because passage vectors can still be stored offline. To control memory the passage vectors are compressed to a small number of bits per dimension, and the index supports very large collections. ColBERT style late interaction is the usual second stage in hybrid retrieval systems that are limited by first stage recall.",
  "splade-sparse-expansion": "SPLADE learns a sparse expansion of query and document into vocabulary dimensions using a masked language modelling objective regularised toward sparsity. The learned vectors look like an inverted index: most dimensions are zero, the non zero dimensions correspond to whole word pieces, and scoring is a dot product over shared dimensions. Because the output is sparse the system keeps the exactness and interpretability of an inverted index while adding the expansion of a dense retrieval model, so a term absent from the query can still match the document. Regularisation strength controls the tradeoff between expansion quality and index size.",
  "bert-pretraining": "The bidirectional encoder representations from transformers model is pre-trained on masked token prediction over a large corpus and a next sentence prediction objective over sentence pairs. Tokenisation uses a word piece vocabulary of about thirty thousand entries, so rare scientific terms split into subword units that the model can still represent. Attention is computed over a window of tokens with learned positional embeddings, and pre-training requires several days on accelerators. The pre-trained weights transfer to retrieval and ranking tasks by fine-tuning, usually by adding a task head on top of the final hidden state of a special classification token.",
  "sentence-bert": "Sentence-BERT modifies a bidirectional transformer into a siamese network so that sentence embeddings can be compared with cosine similarity directly. Two structurally identical encoders are shared, and training uses classification and regression objectives over pairs and triplets of sentences. Because the encoding is done once per sentence, the cost of finding the most similar pair among thousands of sentences falls from many hours of cross encoder scoring to a few seconds of vector search, with only a small loss in ranking quality. The resulting embeddings are the standard dense representation in hybrid retrieval and semantic clustering.",
  "word2vec-sgns": "Skip-gram word representation learning predicts context words from a centre word using a softmax over the vocabulary that is approximated by negative sampling. Frequent words are subsampled during training, which speeds convergence and improves the quality of vectors for rare words. The learned vectors place synonyms near each other in the vector space and support simple vector arithmetic on relational regularities. With a window of about ten context words and a few epochs over a large corpus the model produces vectors that outperform count based weighting on word similarity benchmarks.",
  "glove-global-vectors": "GloVe trains word vectors by factorising the global word word co-occurrence matrix with a weighted least squares objective. The weighting function downweights pairs with very low co-occurrence counts, so the model focuses its capacity on informative ratios of co-occurrence probabilities. Once trained, the vectors capture both synonymy and analogical structure, and their dot products approximate the logarithm of the co-occurrence ratio between two words. Because the objective is global rather than window local, training is stable and reproducible with a fixed random seed.",
  "ann-hnsw": "Hierarchical navigable small world graphs build a proximity graph in which every node is linked to a set of near neighbors and longer links are reserved for upper layers. Search enters at the top layer of a sparse long range graph, descends toward denser layers, and conducts a greedy best first traversal with a bounded candidate queue. The construction parameter controls how many links are added per inserted vector, and the search parameter controls the size of the candidate queue at query time. Larger values of both increase recall and decrease throughput, and the tradeoff is reported as a recall against queries per second curve so that a target recall can be met with minimum cost.",
  "product-quantization-ivfpq": "An inverted file partitioner with a product quantizer compresses high dimensional vectors by first assigning them to a coarse k-means centroid and then splitting the residual into blocks. Each block is quantised independently with a small codebook of a few hundred centroids, so the compressed code for a vector is a sequence of bytes with one byte per block. Asymmetric distance computation compares the query vector against the stored codes without reconstructing them, which keeps the scan fast. The tradeoff is between the number of blocks and the codebook size: more blocks raise memory per vector and raise the fidelity of the distance approximation, and recall is reported as a function of scan fraction.",
  "cross-encoder-reranking": "A cross encoder concatenates the query and the passage into a single sequence and scores the pair with one forward pass, which allows full attention between every query token and every passage token. This expressive scoring is far too slow to run over the whole collection, so it is reserved for the top hundred candidates retrieved by a cheap first stage. On passage ranking benchmarks the cross encoder lifts mean average precision substantially over BM25 and over dual encoder retrieval, and the gain is largest for queries whose relevant passages share no vocabulary with the query. The cost scales linearly with the number of candidates, which limits deployment to second stage use.",
  "lambdamart-ranking": "LambdaMART is a pairwise learning to rank method trained by gradient boosted regression trees. Each pair of documents for a query contributes a gradient scaled by the change in the evaluation metric that would result from swapping the pair, which means the trees are optimised against a smooth approximation of normalised discounted cumulative gain rather than against classification error. Tree building uses histogram based splitting so that training scales to millions of query document pairs on a single machine. Feature sets combine lexical signals such as term frequencies in the title and the body with graph signals such as citation counts and anchor text, so the model can learn a weighting across heterogeneous evidence.",
  "pagerank-citation-graph": "PageRank models a random surfer who follows an outgoing citation link with probability equal to a damping factor and teleports to a random document with the remaining probability. The stationary distribution of this Markov chain assigns each document a share of authority, and power iteration converges when the chain is irreducible and aperiodic. In the personalised variant the teleport vector is replaced by a seed distribution over the documents retrieved for the query, so the resulting score is a query dependent re-ranking signal rather than a global importance score. Walking to a fixed depth or to an epsilon threshold bounds the number of propagation steps, and the running score at the current query is the mass that reached each document.",
  "bibliographic-coupling": "Bibliographic coupling measures the similarity of two documents by the number of references they share, normalised by the smaller of the two bibliography lengths so that a paper citing three references is not credited as strongly as a paper citing three hundred. Co-citation is the dual measure: two documents are similar when later documents cite both of them. Both measures are symmetric, require no text, and are computable directly from a reference graph, which makes them a reliable signal for re-ranking retrieval results in scientific collections. Coupling strength decays with age because recent documents have not yet accumulated citations.",
  "graph-convolutional-retrieval": "Graph convolutional networks over a heterogeneous graph of documents, entities and terms aggregate features across neighbourhoods. Each layer replaces the representation of a node with a weighted sum of its neighbours representations, normalised by the square root of the product of the neighbour degrees, so that high degree hubs are not amplified. Over a citation graph this propagation makes the representation of a paper depend on the papers it cites and on the papers that cite it, which is how a traversal signal becomes part of a learned ranker. Two or three layers are usually enough, because deeper propagation mixes topics across a whole field.",
  "ndcg-graded-relevance": "Normalised discounted cumulative gain evaluates a ranked list against graded relevance labels. The gain of a document at a rank is the graded relevance level, and the cumulative gain at cutoff is the sum of gains, discounted by the logarithm of the rank plus one. The ideal discounted cumulative gain is computed from the same labels sorted in decreasing order, and the ratio of the two is reported between zero and one. Because the discount is applied per rank position rather than per retrieved document, the measure is sensitive to how quickly relevant documents appear near the top of the list, and it is the standard metric for web and bibliographic ranking tasks.",
  "mrr-reciprocal-rank": "The mean reciprocal rank of a query set is the average over queries of the reciprocal of the rank at which the first relevant document is retrieved. A relevant document at rank one scores exactly one, at rank two it scores one half, and a run that retrieves no relevant document scores zero. The measure rewards only the first hit and ignores what follows it, which suits known item search and navigational queries but hides failures in the tail. It is reported with the number of queries averaged and with the cutoff beyond which the run is treated as a failure.",
  "precision-recall-at-k": "Precision at cutoff is the fraction of the top ranked documents that are relevant, and recall at cutoff is the fraction of all relevant documents that appear within the top ranked documents. Raising the cutoff monotonically increases recall while usually lowering precision, so the two are reported as a pair at a fixed cutoff. The cutoff is chosen from the operating point of the system: a first stage retrieval component aiming to feed a re-ranker targets a high recall, and a shown results page targets a high precision. Both measures require a binary relevance judgement for every assessed document.",
  "mean-average-precision": "Average precision for a single query is the mean of the precision values measured at the ranks of the relevant documents. Because the precision at each relevant rank already accounts for the recall level at that point, average precision rewards runs that place relevant documents near the top and penalises runs that leave relevant documents deep in the list. Mean average precision is the arithmetic mean of average precision over all queries in the set. The measure is undefined when a query has no relevant documents, and run sets with no relevance judgements are excluded from the average.",
  "ece-calibration": "Expected calibration error partitions predictions into equal width bins by predicted confidence and reports the average absolute gap between the accuracy and the confidence in each bin, weighted by the fraction of predictions in the bin. With fifteen bins the measure is sensitive to the sharpness of the confidence distribution as well as to its correctness, and a perfectly calibrated system has an expected calibration error near zero. The measure requires held out evaluation data and does not by itself identify whether the miscalibration is overconfidence or underconfidence, so it is reported alongside the reliability diagram that produced it.",
  "auroc-detection": "The area under the receiver operating characteristic curve is the probability that a randomly chosen positive example receives a higher score than a randomly chosen negative example. The operating curve plots the true positive rate against the false positive rate as the decision threshold sweeps across all scores, and the area is computed by the trapezoidal rule over the observed operating points. An area of one half indicates a score indistinguishable from a coin toss, and an area of one indicates perfect separation. The measure is threshold free and independent of class prevalence, which is why it is reported for out of distribution detection, though it can look optimistic when negatives are far easier than the negatives a deployment will meet.",
  "max-softmax-probability": "The simplest out of distribution detection score is the largest softmax probability of a classifier over its in distribution classes. The rule estimates the likelihood that the highest scoring class is correct and flags an input for review below a threshold. The method requires no extra training and no outlier data, which is its main practical advantage. Its weakness is systematic overconfidence: a classifier trained on a closed set assigns high softmax mass to novel inputs that fall far from the training distribution, so the score must be calibrated on a held out out of distribution set before it is trusted at an operating threshold.",
  "energy-based-ood": "The energy score of an input is the negative logarithm of the sum of the exponentials of the logits, scaled by a temperature parameter. Taking the log sum exp rather than the maximum pulls in the mass of all classes, so the score reflects how well supported the input is by every class rather than by the best one. With a temperature below one the separation between in distribution and out of distribution energy widens, and the temperature is tuned on a validation set containing both kinds of examples. The score is threshold free, needs no extra forward pass, and consistently separates better than the maximum softmax probability across image and text benchmarks.",
  "odin-temperature-preprocessing": "The out of distribution detector with input preprocessing decomposes out of distribution scoring into two steps. First the input logits are divided by a temperature parameter, which sharpens the softmax distribution and increases the margin between classes. Second a small controlled perturbation of the input is computed by gradient ascent on the temperature scaled softmax score, which moves ambiguous inputs toward the decision boundary and amplifies their uncertainty. Both the temperature and the perturbation magnitude are hyperparameters tuned on a held out mixture of in and out of distribution data, and the tuned detector improves separation by a wide margin over the plain maximum softmax baseline.",
  "outlier-exposure": "Outlier exposure trains a classifier to assign uniform low confidence on an auxiliary outlier dataset while keeping its accuracy on the task distribution. The objective adds a penalty on the entropy of the predictions over the auxiliary set to the standard cross entropy over the task set, so the model learns a boundary of empty space around the task classes. The auxiliary data is only used at training time and never at test time, and it can be drawn from any corpus sufficiently distinct from the task. The method is simple, adds no inference cost, and transfers to new out of distribution sets that were not used in training.",
  "mahalanobis-density": "The Mahalanobis out of distribution detector fits a class conditional Gaussian to the features of each class in the final layer of a trained network and shares a single precision matrix across classes. The confidence of an input is the negative Mahalanobis distance to the closest class mean adjusted by the class prior, optionally followed by input preprocessing. Because the distances are computed in a feature space that already separates classes, the detector distinguishes novel inputs that are far from every class mean from in distribution inputs that are merely ambiguous. The cost is storing one mean and one precision matrix per class, which is small.",
  "predictive-entropy": "Predictive entropy is the Shannon entropy of the probability vector a model assigns to its output classes. A prediction concentrated on one class has low predictive entropy, and a prediction spread across many classes has high predictive entropy. In a Bayesian or ensemble setting the predictive distribution is an average over models, so its entropy carries both the noise in the data and the disagreement between models about that input. The measure is used as an abstention signal: inputs above an entropy cutoff are passed to a review stage instead of being answered automatically.",
  "deep-ensembles-uncertainty": "A deep ensemble trains several models independently from different random initialisations and aggregates their predictive distributions by averaging. The variance of the member predictions measures epistemic uncertainty, which is how much the models disagree about an input, while the ensemble mean carries the most accurate central estimate. Ensembles are the most reliable practical estimate of uncertainty for a moderate training budget, at a cost that scales linearly with the number of members. Each member is a full model, so an ensemble of five is five times the memory and five times the inference cost, which limits the technique to systems that can afford it.",
  "temperature-scaling-calibration": "Post hoc temperature scaling rescales the logits of a trained classifier by a single positive parameter before the softmax is applied, leaving the ranking of the classes unchanged. The parameter is fitted on a validation set by minimising the negative log likelihood, which is a convex one dimensional search, and it corrects miscalibration after training without touching the weights. Scaling only fixes miscalibration that is uniform across the confidence range, so it is reported together with the expected calibration error it was fitted to improve. The technique is the standard calibration step before any confidence score is used as an abstention threshold.",
  "selective-prediction-risk-coverage": "Selective classification gives a classifier the option to abstain. A gating function scores each input, the inputs above the gate are answered, and the inputs below it are routed to a human reviewer. The operating behaviour is summarised by coverage, the fraction of inputs answered, against selective risk, the error rate among the answered inputs. The area under the risk coverage curve is one number summary of the tradeoff, and the point at which the curve crosses the full automation error rate marks the coverage at which automation is worthwhile. Any score can serve as the gate, so the same curve is used to compare an abstention score against the maximum softmax probability baseline.",
  "nli-entailment": "Natural language inference scores a pair of sentences, a premise and a hypothesis, with a label of entailment, contradiction or neutral. The task is treated as three way classification over the concatenated pair, and benchmark collections are built by crowd workers writing a hypothesis for a premise under a prompt that specifies the intended label. Accuracy on these benchmarks is the standard measure for a representation that must capture semantic relations rather than surface overlap. In claim verification the same three way head decides whether a retrieved evidence sentence supports, refutes, or is uninformative about a claim.",
  "fever-claim-verification": "The fact extraction and verification task builds a large set of claims by mutating encyclopedia sentences and labels each as supported, refuted, or not enough information. Systems run a staged pipeline: a document retriever narrows the encyclopedia page, a sentence selector picks the evidence sentence, and a three way classifier assigns the label. The shared evaluation reports label accuracy, evidence recall and the retrieval stage recall separately, because a failure at the retrieval stage cannot be recovered downstream. The not enough information label is the hardest class, because the correct behaviour is to abstain when no evidence sentence matches the claim.",
  "scifact-claim-verification": "The SciFact task provides expert written claims about biomedical abstracts together with evidence sentences that support or refute them. Compared with encyclopedia claims, the vocabulary is specialised and the evidence is usually a single sentence in an abstract of about two hundred and fifty words. Evaluation combines the label of the claim with the correctness of the selected evidence rationale, so a system is credited only when it both labels the claim and points at the sentence that produced the label. The reference collection is an order of magnitude smaller than the encyclopedia task, which makes per query analysis more informative than aggregate numbers."
};

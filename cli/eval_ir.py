#!/usr/bin/env python3
"""CiteGraph-IR command line interface.

Runs the benchmark over the bundled 40-document citation collection and prints
the retrieval and abstention metrics. The engine is JavaScript so this driver
shells out to a small Node entry point and formats the JSON it returns; no
third-party package is needed on either side.

    ./cli/eval_ir.py                # the summary table
    ./cli/eval_ir.py --json         # the whole report as JSON
    ./cli/eval_ir.py --threshold 0.2
    ./cli/eval_ir.py --queries       # one row per evaluation query
    ./cli/eval_ir.py --unanswerable
    ./cli/eval_ir.py --sweep
"""

import argparse
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def node_available():
    return shutil.which("node") is not None


def run_report(options):
    """Ask the Node entry point for the report and return it as a dict."""
    env = dict(os.environ)
    env["CITEGRAPH_OPTIONS"] = json.dumps(options)
    completed = subprocess.run(
        ["node", os.path.join(ROOT, "src", "report_entry.js")],
        capture_output=True,
        text=True,
        cwd=ROOT,
        env=env,
    )
    if completed.returncode != 0:
        sys.stderr.write(completed.stderr)
        raise SystemExit("the benchmark run failed")
    return json.loads(completed.stdout)


def fmt(value, digits=4):
    if value is None:
        return "     -   "
    return f"{value:.{digits}f}"


def print_summary(report):
    print("CiteGraph-IR benchmark")
    print(
        f"corpus {report['corpus']} documents, "
        f"{report['evaluationQueries']} evaluation queries "
        f"({report['answerable']} answerable, {report['unanswerable']} unanswerable)"
    )
    print()
    header = ["stage", "mrr", "ndcg@10", "recall@1", "recall@5", "recall@10"]
    print("  ".join(h.rjust(9) for h in header))
    print("-" * (11 * len(header)))
    for stage in ["lexical", "dense", "fused", "reranked"]:
        row = report["stages"].get(stage)
        if row is None:
            continue
        print(
            "  ".join(
                [
                    stage.ljust(9),
                    fmt(row["mrr"]).rjust(9),
                    fmt(row["ndcgAt10"]).rjust(9),
                    fmt(row["recallAt1"]).rjust(9),
                    fmt(row["recallAt5"]).rjust(9),
                    fmt(row["recallAt10"]).rjust(9),
                ]
            )
        )
    print()
    abst = report["abstention"]
    print(
        "abstention at threshold "
        f"{fmt(abst['threshold'], 2)}: "
        f"ece {fmt(abst['ece'])}, "
        f"auroc {fmt(abst['auroc'])}, "
        f"accuracy {fmt(abst['accuracy'])}, "
        f"coverage {fmt(abst['coverage'])}, "
        f"false answer rate {fmt(abst['falseAnswerRate'])}"
    )
    rec = report["recommendedThreshold"]
    print(
        "recommended threshold "
        f"{fmt(rec['threshold'], 2)}: "
        f"coverage {fmt(rec['coverage'])}, "
        f"false answer rate {fmt(rec['falseAnswerRate'])}, "
        f"accuracy {fmt(rec['accuracy'])}"
    )


def print_queries(report):
    print("{:<28} {:<30} {:>4} {:>5} {:>5} {:>5} {:>7} {:>6} {:>6}".format(
        "query", "canonical", "rank", "r@1", "r@5", "r@10", "score", "kept", "right"))
    print("-" * 100)
    for row in report["perQuery"]:
        print("{:<28} {:<30} {:>4} {:>5} {:>5} {:>5} {:>7} {:>6} {:>6}".format(
            row["queryId"][:28],
            (row["canonical"] or "-")[:30],
            row["canonicalRank"] if row["canonicalRank"] else "-",
            fmt(row["recallAt1"], 2),
            fmt(row["recallAt5"], 2),
            fmt(row["recallAt10"], 2),
            fmt(row["abstentionScore"], 4),
            "yes" if row["decided"] else "no",
            "yes" if row["correct"] else "no",
        ))


def print_unanswerable(report):
    print("unanswerable queries")
    print("-" * 100)
    for row in report["unanswerableRows"]:
        print(
            "{:<20} {:<50} score {}  decided {}".format(
                row["queryId"][:20],
                row["text"][:50],
                fmt(row["abstentionScore"], 4),
                "ANSWER" if row["decided"] else "abstain",
            )
        )
    far = report["abstention"]["falseAnswerRate"]
    print(f"\nfalse answer rate: {fmt(far)}")


def print_sweep(report):
    print("abstention threshold sweep")
    header = ["threshold", "coverage", "false answers", "accuracy", "ece", "auroc"]
    print("  ".join(h.rjust(14) for h in header))
    print("-" * (16 * len(header)))
    for row in report["calibrationSweep"]:
        print(
            "  ".join(
                [
                    fmt(row["threshold"], 2).rjust(14),
                    fmt(row["coverage"]).rjust(14),
                    fmt(row["falseAnswerRate"]).rjust(14),
                    fmt(row["accuracy"]).rjust(14),
                    fmt(row["ece"]).rjust(14),
                    fmt(row["auroc"]).rjust(14),
                ]
            )
        )


def print_roc(report):
    print("receiver operating characteristic for the abstention score")
    print("     false answer rate   true answer rate")
    for x, y in report["roc"]:
        print(f"    {fmt(x, 4).rjust(14)}   {fmt(y, 4).rjust(16)}")


def build_parser():
    parser = argparse.ArgumentParser(
        description="Run the CiteGraph-IR benchmark over the bundled collection."
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=None,
        help="abstention threshold to evaluate (default: the recommended one)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="print the whole report as JSON instead of the tables",
    )
    parser.add_argument("--queries", action="store_true", help="one row per evaluation query")
    parser.add_argument("--unanswerable", action="store_true", help="the unanswerable decisions")
    parser.add_argument("--sweep", action="store_true", help="the threshold sweep")
    parser.add_argument("--roc", action="store_true", help="the operating points of the score")
    parser.add_argument("--stage", default="reranked", help="stage to score (reranked)")
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    options = {}
    if args.threshold is not None:
        options["threshold"] = args.threshold
    if args.stage != "reranked":
        options["stage"] = args.stage

    if not node_available():
        raise SystemExit("node is required to run the engine")

    report = run_report(options)

    if args.json:
        print(json.dumps(report, indent=2))
        return 0

    print_summary(report)
    if args.queries:
        print()
        print_queries(report)
    if args.unanswerable:
        print()
        print_unanswerable(report)
    if args.sweep:
        print()
        print_sweep(report)
    if args.roc:
        print()
        print_roc(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())

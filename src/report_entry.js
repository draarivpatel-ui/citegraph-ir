#!/usr/bin/env node
/**
 * report_entry.js - the Node side of the command line interface.
 *
 * Reads a JSON options object from the environment and writes the benchmark
 * report to stdout. The Python driver in cli/eval_ir.py calls this, so the two
 * entry points share one projection of the metrics.
 */

import { buildReport } from "./report.js";

const options = JSON.parse(process.env.CITEGRAPH_OPTIONS ?? "{}");
const report = buildReport(options);
process.stdout.write(JSON.stringify(report));

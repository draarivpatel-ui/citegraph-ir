/**
 * helpers/engine.js - a shared engine for the test modules.
 *
 * Building the index, the dense vectors and the citation graph is the same work
 * for every test that needs them, so it happens once here.
 */

import { buildEngine } from "../../src/benchmark.js";

export const engine = buildEngine();
export const documents = engine.documents;
export const index = engine.index;
export const dense = engine.dense;
export const graph = engine.graph;
export const bodiesById = engine.bodiesById;

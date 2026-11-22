/**
 * cascade_lab.js - retraction cascade, circular citation and evidence fragility
 * analysis over the citation graph.
 *
 * The citation graph points each document at the sources it relies on: an edge
 * d -> r reads "the claim of d depends on r". A document with no outgoing
 * references is a terminal, the primary evidence of the collection. A claim is
 * supported when it can still trace at least `minChains` internally vertex
 * disjoint paths down to terminal sources after any retracted papers are
 * removed. Retracting a paper can therefore invalidate a claim in exactly two
 * ways: it can remove the claim's only surviving chain outright, or it can
 * leave the claim held up by a single chain when two are required.
 *
 * Everything here is a pure function over the graph object built by
 * `buildCitationGraph` in ir_engine.js, so the page, the test suite and the
 * CLI compute identical answers. No dependency on the DOM, on Node built ins,
 * or on any package.
 */

/* ------------------------------------------------------------------ *
 * Graph primitives
 * ------------------------------------------------------------------ */

/**
 * Build a citation graph object directly from a refs map, matching the shape
 * `buildCitationGraph` returns (ids, outLinks, inLinks, docCount). References
 * to undeclared ids are dropped, exactly as the engine does. Used by the self
 * test panel and by unit tests to build toy graphs without the corpus.
 */
export function graphFromRefs(refsById) {
  const ids = new Set(Object.keys(refsById));
  const outLinks = new Map();
  const inLinks = new Map();
  for (const id of ids) {
    outLinks.set(id, []);
    inLinks.set(id, []);
  }
  for (const [id, refs] of Object.entries(refsById)) {
    for (const ref of new Set(refs)) {
      if (!ids.has(ref)) continue;
      outLinks.get(id).push(ref);
      inLinks.get(ref).push(id);
    }
  }
  return { ids, outLinks, inLinks, docCount: ids.size };
}

/**
 * The terminal documents: papers that cite nothing inside the collection and
 * therefore stand as primary evidence. Every other document's claim must reach
 * at least one of these to be counted as supported.
 */
export function terminalIds(graph) {
  const out = [];
  for (const id of graph.ids) {
    if ((graph.outLinks.get(id) ?? []).length === 0) out.push(id);
  }
  out.sort();
  return out;
}

/** The documents no other document cites: the unverified frontier. */
export function unverifiedIds(graph) {
  const out = [];
  for (const id of graph.ids) {
    if ((graph.inLinks.get(id) ?? []).length === 0) out.push(id);
  }
  out.sort();
  return out;
}

/**
 * The chain requirement as a positive integer. Anything missing, non numeric
 * or non finite falls back to the standard single chain bar rather than
 * propagating NaN into every support comparison.
 */
function clampMinChains(value) {
  const n = Math.floor(value ?? 1);
  return Number.isFinite(n) ? Math.max(1, n) : 1;
}

/** The terminal with the heaviest incoming citation load. */
export function primarySourceId(graph) {
  const terminals = terminalIds(graph);
  let best = null;
  let bestIn = -1;
  for (const id of terminals) {
    const incoming = (graph.inLinks.get(id) ?? []).length;
    if (incoming > bestIn || (incoming === bestIn && best !== null && id < best)) {
      best = id;
      bestIn = incoming;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * Tarjan strongly connected components (iterative, exact)
 * ------------------------------------------------------------------ */

/**
 * Tarjan's algorithm over the citation graph, written iteratively so a deep
 * chain cannot overflow the call stack. Returns the strongly connected
 * components in a deterministic order: members sorted inside each component,
 * components sorted by first member. A component is reported together with
 * whether it is a genuine ring (more than one member, or a single member that
 * cites itself).
 */
export function stronglyConnectedComponents(graph) {
  const ids = [...graph.ids].sort();
  const indexOf = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let nextIndex = 0;

  for (const root of ids) {
    if (indexOf.has(root)) continue;
    // Each work item is [node, child position]. The child position walks the
    // adjacency list so the algorithm resumes exactly where it descended.
    const work = [[root, 0]];
    while (work.length > 0) {
      const [node, childPos] = work[work.length - 1];
      if (childPos === 0) {
        indexOf.set(node, nextIndex);
        low.set(node, nextIndex);
        nextIndex += 1;
        stack.push(node);
        onStack.add(node);
      }
      const successors = [...(graph.outLinks.get(node) ?? [])].sort();
      if (childPos < successors.length) {
        work[work.length - 1][1] = childPos + 1;
        const target = successors[childPos];
        if (!indexOf.has(target)) {
          work.push([target, 0]);
        } else if (onStack.has(target)) {
          low.set(node, Math.min(low.get(node), indexOf.get(target)));
        }
      } else {
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1][0];
          low.set(parent, Math.min(low.get(parent), low.get(node)));
        }
        if (low.get(node) === indexOf.get(node)) {
          const members = [];
          let member;
          do {
            member = stack.pop();
            onStack.delete(member);
            members.push(member);
          } while (member !== node);
          members.sort();
          const ring =
            members.length > 1 ||
            (graph.outLinks.get(node) ?? []).includes(node);
          components.push({ members, ring });
        }
      }
    }
  }
  components.sort((a, b) => (a.members[0] < b.members[0] ? -1 : 1));
  return components;
}

/**
 * The circular citation rings: components of mutually citing papers, each one
 * a set of member ids. A ring is non trivial when it holds more than one
 * member or a single paper citing itself.
 */
export function circularRings(graph) {
  return stronglyConnectedComponents(graph)
    .filter((c) => c.ring)
    .map((c, i) => ({ id: `ring-${i + 1}`, members: c.members }));
}

/** A Set of every document id that sits inside a circular ring. */
export function ringMembers(graph) {
  const out = new Set();
  for (const ring of circularRings(graph)) {
    for (const id of ring.members) out.add(id);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Independent supporting chains (vertex disjoint path counting)
 * ------------------------------------------------------------------ */

/**
 * The number of internally vertex disjoint citation chains from `claimId` down
 * to terminal sources, in the graph with `removed` nodes deleted. Two chains
 * are independent when they share no intermediate paper: they may end at the
 * same terminal source, because the terminal is the evidence itself, not an
 * intermediate hop. The count is an exact max-flow over the node split
 * network: every non claim, non terminal paper becomes an in/out pair joined
 * by an edge of capacity one, the claim and the terminals are uncapacitated,
 * and each terminal feeds a super sink.
 */
export function independentChains(graph, claimId, removed = new Set()) {
  if (!graph.ids.has(claimId) || removed.has(claimId)) return 0;
  const terminals = terminalIds(graph).filter((id) => !removed.has(id));
  if (terminals.length === 0 || terminals.includes(claimId)) return 0;

  // Flow network keyed by synthetic node names. cap[a][b] is residual capacity.
  const SINK = "\u0000sink";
  const source = `${claimId}\u0000out`;
  const cap = new Map();
  const addEdge = (from, to, w) => {
    if (!cap.has(from)) cap.set(from, new Map());
    if (!cap.has(to)) cap.set(to, new Map());
    cap.get(from).set(to, (cap.get(from).get(to) ?? 0) + w);
    if (!cap.get(to).has(from)) cap.get(to).set(from, 0);
  };
  const INF = Number.MAX_SAFE_INTEGER;

  for (const id of graph.ids) {
    if (removed.has(id)) continue;
    const internal = id !== claimId && !terminals.includes(id);
    addEdge(`${id}\u0000in`, `${id}\u0000out`, internal ? 1 : INF);
    if (terminals.includes(id)) addEdge(`${id}\u0000out`, SINK, INF);
  }
  for (const id of graph.ids) {
    if (removed.has(id)) continue;
    for (const ref of graph.outLinks.get(id) ?? []) {
      if (removed.has(ref)) continue;
      // One citation edge can carry at most one chain: two internally disjoint
      // paths may share the claim or a terminal, but never an edge itself.
      addEdge(`${id}\u0000out`, `${ref}\u0000in`, 1);
    }
  }

  let flow = 0;
  // Edmonds-Karp: shortest augmenting path by BFS until no path remains.
  for (;;) {
    const parent = new Map([[source, null]]);
    const queue = [source];
    let head = 0;
    while (head < queue.length && !parent.has(SINK)) {
      const node = queue[head];
      head += 1;
      for (const [next, residual] of cap.get(node) ?? new Map()) {
        if (residual > 0 && !parent.has(next)) {
          parent.set(next, node);
          queue.push(next);
        }
      }
    }
    if (!parent.has(SINK)) break;
    let bottleneck = INF;
    for (let n = SINK; n !== source; n = parent.get(n)) {
      bottleneck = Math.min(bottleneck, cap.get(parent.get(n)).get(n));
    }
    for (let n = SINK; n !== source; n = parent.get(n)) {
      const p = parent.get(n);
      cap.get(p).set(n, cap.get(p).get(n) - bottleneck);
      cap.get(n).set(p, (cap.get(n).get(p) ?? 0) + bottleneck);
    }
    flow += bottleneck;
  }
  return flow;
}

/**
 * The hop distance from a claim to its nearest terminal source along citation
 * edges, with removed nodes deleted. A terminal answers zero. A claim that
 * cannot reach any source returns null, which is the unsupported case.
 */
export function supportDepth(graph, claimId, removed = new Set()) {
  if (!graph.ids.has(claimId) || removed.has(claimId)) return null;
  if ((graph.outLinks.get(claimId) ?? []).length === 0) return 0;
  const seen = new Map([[claimId, 0]]);
  const queue = [claimId];
  let head = 0;
  while (head < queue.length) {
    const node = queue[head];
    head += 1;
    for (const ref of graph.outLinks.get(node) ?? []) {
      if (removed.has(ref) || seen.has(ref)) continue;
      const dist = seen.get(node) + 1;
      seen.set(ref, dist);
      if ((graph.outLinks.get(ref) ?? []).length === 0) return dist;
      queue.push(ref);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The support map and the retraction cascade
 * ------------------------------------------------------------------ */

/**
 * The support status of every document that survives `removed`. A terminal is
 * reported as a source: it is the evidence and needs no chain. Any other
 * document is a claim, supported when its internally disjoint chain count
 * reaches `minChains`. The map is deterministic by insertion order over the
 * sorted document ids.
 */
export function claimSupportMap(graph, removed = new Set(), minChains = 1) {
  const required = clampMinChains(minChains);
  const terminals = new Set(terminalIds(graph));
  const out = new Map();
  const ids = [...graph.ids].sort();
  for (const id of ids) {
    if (removed.has(id)) continue;
    if (terminals.has(id)) {
      out.set(id, { id, kind: "source", chains: 0, depth: 0, supported: true });
      continue;
    }
    const chains = independentChains(graph, id, removed);
    const depth = supportDepth(graph, id, removed);
    out.set(id, {
      id,
      kind: "claim",
      chains,
      depth,
      supported: chains >= required
    });
  }
  return out;
}

/**
 * Simulate the retraction of a set of papers and measure the blast radius.
 * `removed` lists the retracted ids; ids outside the graph are reported as
 * `unknown` rather than silently ignored. For every surviving claim the result
 * says whether it stays supported, whether at least two independent chains
 * remain (a multi path survivor), and which retracted papers it cited
 * directly. `invalidated` is the exact set of claims that were supported
 * before the retraction and are not supported after it.
 */
export function retractionCascade(graph, removedIds, options = {}) {
  const minChains = clampMinChains(options.minChains);
  const removed = new Set();
  const unknown = [];
  for (const id of removedIds ?? []) {
    if (graph.ids.has(id)) removed.add(id);
    else unknown.push(id);
  }

  const before = claimSupportMap(graph, new Set(), minChains);
  const after = claimSupportMap(graph, removed, minChains);
  const rings = circularRings(graph);
  const inRing = new Set();
  for (const ring of rings) for (const id of ring.members) inRing.add(id);

  const invalidated = [];
  const survivingMultiPath = [];
  const survivingSinglePath = [];
  const perClaim = new Map();
  for (const [id, status] of after) {
    const was = before.get(id);
    const collapsed = was !== undefined && was.supported && !status.supported;
    const directlyCitesRemoved = [...(graph.outLinks.get(id) ?? [])].filter((r) => removed.has(r)).sort();
    perClaim.set(id, {
      ...status,
      ring: inRing.has(id),
      collapsed,
      directlyCitesRemoved
    });
    if (collapsed) invalidated.push(id);
    else if (status.kind === "claim" && status.chains >= 2) survivingMultiPath.push(id);
    else if (status.kind === "claim" && status.chains === 1) survivingSinglePath.push(id);
  }
  invalidated.sort();
  survivingMultiPath.sort();
  survivingSinglePath.sort();

  const claimTotal = after.size - [...after.values()].filter((s) => s.kind === "source").length;
  const supported = [...perClaim.values()].filter((s) => s.kind === "claim" && s.supported).length;

  return {
    removed: [...removed].sort(),
    unknown: unknown.sort(),
    minChains,
    perClaim,
    invalidated,
    survivingMultiPath,
    survivingSinglePath,
    rings,
    claimTotal,
    supportedClaims: supported,
    survival: claimTotal === 0 ? 0 : supported / claimTotal
  };
}

/* ------------------------------------------------------------------ *
 * Single point of failure articulation papers
 * ------------------------------------------------------------------ */

/**
 * Every paper whose solo retraction collapses at least one downstream claim,
 * ranked by how many claims fall. A paper is flagged an articulation paper
 * when two or more claims depend on it entirely: it is the single point of
 * failure in every supporting chain each of those claims has.
 */
export function articulationPapers(graph) {
  const base = claimSupportMap(graph, new Set(), 1);
  const rows = [];
  for (const id of [...graph.ids].sort()) {
    const after = claimSupportMap(graph, new Set([id]), 1);
    const collapses = [];
    for (const [claim, status] of after) {
      const was = base.get(claim);
      if (was?.kind === "claim" && was.supported && !status.supported) collapses.push(claim);
    }
    if (collapses.length > 0) {
      rows.push({ id, collapseCount: collapses.length, collapses, articulation: collapses.length >= 2 });
    }
  }
  rows.sort((a, b) => b.collapseCount - a.collapseCount || (a.id < b.id ? -1 : 1));
  return rows;
}

/* ------------------------------------------------------------------ *
 * Deterministic evidence hygiene audits
 * ------------------------------------------------------------------ */

/**
 * The fixed audit battery. Each audit is a deterministic transform of the
 * graph plus a chain requirement:
 *   baseline          - the collection as it stands
 *   retract-primary   - delete the most cited terminal source
 *   remove-unverified - delete every paper no other paper cites
 *   require-two       - demand two independent chains instead of one
 *   retract-rings     - delete every member of every circular ring
 * The current user selection is appended by the caller as a sixth row.
 */
export function auditSpecifications(graph) {
  const primary = primarySourceId(graph);
  return [
    { id: "baseline", label: "Baseline graph", removed: [], minChains: 1 },
    { id: "retract-primary", label: "Retract primary source", removed: primary === null ? [] : [primary], minChains: 1 },
    { id: "remove-unverified", label: "Remove unverified preprints", removed: unverifiedIds(graph), minChains: 1 },
    { id: "require-two", label: "Require 2 independent chains", removed: [], minChains: 2 },
    { id: "retract-rings", label: "Retract every ring member", removed: [...ringMembers(graph)].sort(), minChains: 1 }
  ];
}

/**
 * Run one audit and report the evidence hygiene readouts: the supported claim
 * survival fraction, the number of circular rings still standing in the
 * audited graph, the minimum support depth among surviving claims, and the
 * count of claims that collapsed relative to the intact baseline.
 */
export function runAudit(graph, spec) {
  // Only ids that exist in the graph can be retracted, so unknown entries are
  // dropped before counting: removedCount must equal the papers actually gone,
  // or the claims + sources accounting in the row would disagree.
  const removed = new Set([...(spec.removed ?? [])].filter((id) => graph.ids.has(id)));
  const minChains = clampMinChains(spec.minChains);
  const support = claimSupportMap(graph, removed, minChains);
  const baseline = claimSupportMap(graph, new Set(), minChains);

  let claims = 0;
  let supported = 0;
  let single = 0;
  let multi = 0;
  let sources = 0;
  let minDepth = null;
  let collapsed = 0;
  for (const [id, status] of support) {
    if (status.kind === "source") {
      sources += 1;
      continue;
    }
    claims += 1;
    if (status.supported) {
      supported += 1;
      if (status.chains >= 2) multi += 1;
      else single += 1;
      if (status.depth !== null && (minDepth === null || status.depth < minDepth)) {
        minDepth = status.depth;
      }
    }
    if ((baseline.get(id)?.supported ?? false) && !status.supported) collapsed += 1;
  }

  // Rings are counted inside the audited graph, so a removal that breaks a
  // ring lowers the count honestly rather than hiding it.
  const subgraph = {
    ids: new Set([...graph.ids].filter((id) => !removed.has(id))),
    outLinks: new Map(),
    inLinks: new Map(),
    docCount: 0
  };
  for (const id of subgraph.ids) {
    subgraph.outLinks.set(id, (graph.outLinks.get(id) ?? []).filter((r) => subgraph.ids.has(r)));
    subgraph.inLinks.set(id, (graph.inLinks.get(id) ?? []).filter((r) => subgraph.ids.has(r)));
  }
  subgraph.docCount = subgraph.ids.size;

  return {
    id: spec.id,
    label: spec.label,
    removed: [...removed].sort(),
    removedCount: removed.size,
    minChains,
    claims,
    sources,
    supported,
    unsupported: claims - supported,
    singleChain: single,
    multiChain: multi,
    survival: claims === 0 ? 0 : supported / claims,
    ringCount: circularRings(subgraph).length,
    minSupportDepth: minDepth,
    collapsed
  };
}

/**
 * The whole audit table: the five fixed audits plus the caller's current
 * retraction selection as a sixth row when one is supplied.
 */
export function auditSuite(graph, selection = null) {
  const specs = auditSpecifications(graph);
  if (selection && (selection.removed?.length ?? 0) > 0) {
    specs.push({
      id: "selection",
      label: "Current selection",
      removed: [...selection.removed],
      minChains: selection.minChains ?? 1
    });
  }
  return specs.map((spec) => runAudit(graph, spec));
}

/**
 * One call that bundles every analysis the workbench needs: the rings, the
 * articulation papers, the unverified frontier and the terminal sources, all
 * computed once over one graph.
 */
export function buildCascadeAnalysis(graph) {
  const terminals = terminalIds(graph);
  const rings = circularRings(graph);
  return {
    docCount: graph.docCount,
    edgeCount: [...graph.outLinks.values()].reduce((n, refs) => n + refs.length, 0),
    terminals,
    primarySource: primarySourceId(graph),
    rings,
    ringMembers: rings.flatMap((r) => r.members).sort(),
    unverified: unverifiedIds(graph),
    articulation: articulationPapers(graph)
  };
}

// Plan sequencing (§12.1): a Plan is an ordered, dependency-aware DAG of
// Actions, never a flat list. This module is the pure core — no DB, no model —
// so the invariants the /codex-fallback pass flagged are unit-testable in
// isolation:
//   A1  a dependency edge requires STRICT index ordering. sequence_index ties
//       mean "parallelizable", so seq(dep) <= seq(action) would admit a
//       dependency running concurrently with its own dependency. Level
//       assignment (level = 1 + max(dep levels)) makes the ordering strict by
//       construction; assertValidSequence re-checks it strictly.
//   A2  acyclicity is checked on the edge set via Kahn's algorithm, independent
//       of sequence_index (index monotonicity does not imply acyclicity). A
//       self-edge is a trivial cycle.
//   A3  every dependency key must resolve to a node in the same plan — Postgres
//       cannot FK an array element, so this membership check is the only guard.

/** A node before indexing: a candidate Action keyed locally by `key`. */
export type SequenceNode = { key: string; dependsOn: string[] };

/** A node carrying an explicit index (a persisted or re-sequenced plan). */
export type SequencedNode = SequenceNode & { sequenceIndex: number };

export class PlanCycleError extends Error {
  constructor(message = "plan has a dependency cycle") {
    super(message);
    this.name = "PlanCycleError";
  }
}

export class DanglingDependencyError extends Error {
  constructor(key: string, dep: string) {
    super(`action "${key}" depends on "${dep}", which is not in the plan`);
    this.name = "DanglingDependencyError";
  }
}

function indexByKey<T extends { key: string }>(nodes: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const n of nodes) {
    if (map.has(n.key)) throw new Error(`duplicate action key "${n.key}"`);
    map.set(n.key, n);
  }
  return map;
}

// A3: every dependency resolves within the plan (self-dep is left to A2 as a
// trivial cycle, so it surfaces as PlanCycleError, not dangling).
function assertNoDangling(nodes: readonly SequenceNode[], keys: ReadonlySet<string>): void {
  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      if (!keys.has(dep)) throw new DanglingDependencyError(n.key, dep);
    }
  }
}

// Kahn topological sort — the acyclicity check (A2). Returns keys in dependency
// order; throws PlanCycleError if any node never reaches in-degree zero.
function topoOrder(nodes: readonly SequenceNode[]): string[] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep -> nodes that depend on it
  for (const n of nodes) inDegree.set(n.key, 0);
  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      inDegree.set(n.key, (inDegree.get(n.key) ?? 0) + 1);
      dependents.set(dep, [...(dependents.get(dep) ?? []), n.key]);
    }
  }
  const ready = [...inDegree].filter(([, d]) => d === 0).map(([k]) => k);
  const order: string[] = [];
  while (ready.length > 0) {
    const key = ready.shift() as string;
    order.push(key);
    for (const dependent of dependents.get(key) ?? []) {
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) ready.push(dependent);
    }
  }
  if (order.length !== nodes.length) throw new PlanCycleError();
  return order;
}

/**
 * Assign each node a sequence_index by longest dependency path (topological
 * level): level = 0 for a node with no dependencies, else 1 + max(dep levels).
 * Nodes at the same level are parallelizable and share an index; every
 * dependency edge is strictly ordered (A1) by construction. Throws on a cycle
 * (A2), a dangling dependency (A3), or a duplicate key.
 */
export function sequenceActions<T extends SequenceNode>(
  nodes: readonly T[],
): (T & { sequenceIndex: number })[] {
  const byKey = indexByKey(nodes);
  assertNoDangling(nodes, new Set(byKey.keys()));
  const order = topoOrder(nodes); // throws on cycle
  const level = new Map<string, number>();
  for (const key of order) {
    const n = byKey.get(key) as SequenceNode;
    const lvl = n.dependsOn.reduce((max, dep) => Math.max(max, (level.get(dep) ?? 0) + 1), 0);
    level.set(key, lvl);
  }
  return nodes.map((n) => ({ ...n, sequenceIndex: level.get(n.key) as number }));
}

/**
 * Re-sequence a plan while preserving completed work (§12.4: "the ratchet
 * applied to sequence, preserving what's done and re-ordering what remains").
 * Frozen nodes (done / in_progress) keep their current index; every other node
 * is re-levelled strictly above its dependencies. The result is re-validated
 * (A4: acyclicity, membership, and the strict `<` edge rule are re-checked
 * after the mutation, not just at first generation) so a re-sequence can never
 * introduce a cycle, orphan a dependency, or renumber a mutable action below
 * something it depends on. Caller drops/edits nodes before calling.
 */
export function resequence<T extends SequenceNode>(
  nodes: readonly T[],
  frozenIndexByKey: ReadonlyMap<string, number>,
): (T & { sequenceIndex: number })[] {
  const byKey = indexByKey(nodes);
  assertNoDangling(nodes, new Set(byKey.keys()));
  const order = topoOrder(nodes); // A2
  const level = new Map<string, number>();
  for (const key of order) {
    const frozen = frozenIndexByKey.get(key);
    if (frozen !== undefined) {
      level.set(key, frozen);
      continue;
    }
    const n = byKey.get(key) as SequenceNode;
    level.set(
      key,
      n.dependsOn.reduce((max, dep) => Math.max(max, (level.get(dep) ?? 0) + 1), 0),
    );
  }
  const result = nodes.map((n) => ({ ...n, sequenceIndex: level.get(n.key) as number }));
  assertValidSequence(result); // A4: re-check strict ordering after mutation
  return result;
}

/**
 * Validate a plan that already carries explicit indexes — used after a
 * re-sequence and to guard persisted plans. Enforces all three invariants:
 * A3 dangling, A2 acyclicity, and A1 the strict `<` on every dependency edge.
 */
export function assertValidSequence(nodes: readonly SequencedNode[]): void {
  const byKey = indexByKey(nodes);
  assertNoDangling(nodes, new Set(byKey.keys()));
  topoOrder(nodes); // A2: throws PlanCycleError (covers self-edge)
  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      const depNode = byKey.get(dep) as SequencedNode;
      if (!(depNode.sequenceIndex < n.sequenceIndex)) {
        throw new Error(
          `action "${n.key}" (index ${n.sequenceIndex}) must be strictly after its ` +
            `dependency "${dep}" (index ${depNode.sequenceIndex})`,
        );
      }
    }
  }
}

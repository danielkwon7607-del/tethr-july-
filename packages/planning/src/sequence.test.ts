import { describe, expect, it } from "vitest";
import {
  assertValidSequence,
  DanglingDependencyError,
  PlanCycleError,
  resequence,
  type SequenceNode,
  sequenceActions,
} from "./sequence";

// The Plan is a sequenced, dependency-aware DAG, never a flat list (§12.1).
// These are the invariants the /codex-fallback adversarial pass flagged as the
// "looks right on first read, subtly wrong on second" surface:
//  A1 — a dependency edge needs STRICT sequence_index ordering (ties = parallel,
//       so <= would let a dependency run concurrently with its dependency).
//  A2 — cycle detection independent of index; self-edge is a trivial cycle.
//  A3 — every depends_on key resolves within the same plan (no dangling).

const node = (key: string, dependsOn: string[] = []): SequenceNode => ({ key, dependsOn });

describe("sequenceActions — index assignment", () => {
  it("gives independent actions the same index (parallelizable)", () => {
    const out = sequenceActions([node("a"), node("b"), node("c")]);
    expect(out.map((n) => n.sequenceIndex)).toEqual([0, 0, 0]);
  });

  it("orders a linear chain by dependency depth, strictly increasing", () => {
    // c depends on b depends on a → a=0, b=1, c=2.
    const out = sequenceActions([node("c", ["b"]), node("b", ["a"]), node("a")]);
    const byKey = Object.fromEntries(out.map((n) => [n.key, n.sequenceIndex]));
    expect(byKey.a).toBe(0);
    expect(byKey.b).toBe(1);
    expect(byKey.c).toBe(2);
  });

  it("assigns diamond dependencies by longest path", () => {
    // d depends on b,c; b,c depend on a → a=0, b=c=1, d=2.
    const out = sequenceActions([
      node("a"),
      node("b", ["a"]),
      node("c", ["a"]),
      node("d", ["b", "c"]),
    ]);
    const byKey = Object.fromEntries(out.map((n) => [n.key, n.sequenceIndex]));
    expect(byKey.a).toBe(0);
    expect(byKey.b).toBe(1);
    expect(byKey.c).toBe(1);
    expect(byKey.d).toBe(2);
  });

  it("guarantees strict index ordering across every dependency edge (A1)", () => {
    const out = sequenceActions([node("a"), node("b", ["a"]), node("c", ["a", "b"])]);
    const byKey = Object.fromEntries(out.map((n) => [n.key, n.sequenceIndex]));
    for (const n of out) {
      for (const dep of n.dependsOn) {
        expect(byKey[dep]).toBeLessThan(byKey[n.key] as number);
      }
    }
  });

  it("throws PlanCycleError on a dependency cycle (A2)", () => {
    expect(() => sequenceActions([node("a", ["b"]), node("b", ["a"])])).toThrow(PlanCycleError);
  });

  it("throws PlanCycleError on a self-dependency (A2, trivial cycle)", () => {
    expect(() => sequenceActions([node("a", ["a"])])).toThrow(PlanCycleError);
  });

  it("throws DanglingDependencyError on a dependency outside the plan (A3)", () => {
    expect(() => sequenceActions([node("a", ["ghost"])])).toThrow(DanglingDependencyError);
  });

  it("throws on a duplicate key", () => {
    expect(() => sequenceActions([node("a"), node("a")])).toThrow();
  });
});

describe("assertValidSequence — checks explicit indexes (post-resequence, persisted plans)", () => {
  const seqNode = (key: string, sequenceIndex: number, dependsOn: string[] = []) => ({
    key,
    sequenceIndex,
    dependsOn,
  });

  it("accepts a valid strictly-ordered diamond", () => {
    expect(() =>
      assertValidSequence([
        seqNode("a", 0),
        seqNode("b", 1, ["a"]),
        seqNode("c", 1, ["a"]),
        seqNode("d", 2, ["b", "c"]),
      ]),
    ).not.toThrow();
  });

  it("rejects an action sharing its dependency's index (A1 — the subtle bug)", () => {
    // b depends on a but both at index 2: <= would pass, strict < must reject.
    expect(() => assertValidSequence([seqNode("a", 2), seqNode("b", 2, ["a"])])).toThrow();
  });

  it("rejects an action ordered before its dependency", () => {
    expect(() => assertValidSequence([seqNode("a", 5), seqNode("b", 1, ["a"])])).toThrow();
  });

  it("rejects a dangling dependency (A3)", () => {
    expect(() => assertValidSequence([seqNode("a", 0, ["ghost"])])).toThrow(
      DanglingDependencyError,
    );
  });

  it("rejects a cycle even with distinct indexes (A2)", () => {
    // Distinct indexes but a graph cycle a↔b — index monotonicity ≠ acyclicity.
    expect(() => assertValidSequence([seqNode("a", 0, ["b"]), seqNode("b", 1, ["a"])])).toThrow(
      PlanCycleError,
    );
  });
});

describe("resequence — the §12.4 ratchet", () => {
  it("keeps completed actions frozen and re-levels the rest strictly above deps", () => {
    // a is done (frozen @0); b depends on a; c depends on b (both re-levelled).
    const out = resequence([node("a"), node("b", ["a"]), node("c", ["b"])], new Map([["a", 0]]));
    const byKey = Object.fromEntries(out.map((n) => [n.key, n.sequenceIndex]));
    expect(byKey.a).toBe(0);
    expect(byKey.b).toBe(1);
    expect(byKey.c).toBe(2);
  });

  it("preserves an in-progress action's index even when a lower one is free", () => {
    // b frozen at 3 (in_progress) stays at 3; c depends on a (done@0) → c=1.
    const out = resequence(
      [node("a"), node("b"), node("c", ["a"])],
      new Map([
        ["a", 0],
        ["b", 3],
      ]),
    );
    const byKey = Object.fromEntries(out.map((n) => [n.key, n.sequenceIndex]));
    expect(byKey.b).toBe(3);
    expect(byKey.c).toBe(1);
  });

  it("re-validates after mutation — a cycle survives nothing (A4)", () => {
    expect(() => resequence([node("a", ["b"]), node("b", ["a"])], new Map())).toThrow(
      PlanCycleError,
    );
  });
});

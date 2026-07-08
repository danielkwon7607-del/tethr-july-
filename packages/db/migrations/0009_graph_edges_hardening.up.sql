-- 0009 — Graph edge hardening (ADR 0008, Build 5 gate review of Build 4).
--
-- Three defects found by adversarial review of the graph layer:
--   1. Nothing stopped two live edges for the same (source, relation): the
--      supersession read-then-write in assertFact races under concurrent
--      background writes. traits already has the one-live-row guarantee
--      (traits_live_dimension); graph_edges gets the same treatment.
--   2. Supersession assumed every relation is single-valued; a legitimately
--      multi-valued fact (works_with Alice, works_with Bob) was wrongly
--      invalidated. Edges now carry a caller-declared cardinality.
--   3. The assertFact supersession lookup (source, relation) over live rows
--      had no matching index and degrades as invalidated history accrues.

-- A relation's cardinality is fixed by the extraction vocabulary (Build 6);
-- 'one' preserves the original supersede-on-different-target semantics.
alter table graph_edges add column cardinality text not null default 'one'
  check (cardinality in ('one', 'many'));

-- At most one live edge per (source, relation) for single-valued relations.
-- Concurrent conflicting asserts fail loudly on this index instead of
-- corrupting state — same accepted behavior as traits (ADR 0007).
create unique index graph_edges_live_one
  on graph_edges (founder_id, source_entity_id, relation)
  where invalidated_at is null and cardinality = 'one';

-- No duplicate identical live edges, either cardinality: a race between two
-- identical asserts cannot insert the same fact twice.
create unique index graph_edges_live_identity
  on graph_edges (founder_id, source_entity_id, relation, target_entity_id)
  where invalidated_at is null;

-- The supersession lookup reads (source_entity_id, relation) over live rows.
create index graph_edges_source_live
  on graph_edges (source_entity_id, relation)
  where invalidated_at is null;

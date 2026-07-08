drop index if exists graph_edges_source_live;
drop index if exists graph_edges_live_identity;
drop index if exists graph_edges_live_one;
alter table graph_edges drop column if exists cardinality;

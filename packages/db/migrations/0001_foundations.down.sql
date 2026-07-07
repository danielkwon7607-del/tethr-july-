drop table founders;
drop function current_founder_id();
-- Revoke everything granted to the app role in this database, then drop it.
-- Cluster-level caveat: if another database on this cluster still uses the
-- role, the drop fails there by design — rerun its down first.
drop owned by tethr_app;
drop role tethr_app;
drop extension if exists vector;

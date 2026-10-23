-- supabase-rls-grants.sql
--
-- Run once in the Supabase SQL editor for the existing CURFPatentMachine
-- project. Non-destructive: it does not drop tables, columns, or rows.
-- supabase-setup.sql now includes the same statements for a fresh project.
--
-- The app reaches these tables only from Netlify functions using the
-- service_role key. There is no browser client and no logged-in role.
-- Enabling RLS with no policies denies anon and authenticated. Explicit
-- grants match that design: anon is not granted SELECT, authenticated
-- is not granted DML, service_role keeps select/insert/update/delete.

alter table public.evaluated_patents enable row level security;
alter table public.publication_watch enable row level security;

revoke all on table public.evaluated_patents from public, anon, authenticated;
revoke all on table public.publication_watch from public, anon, authenticated;
revoke all on sequence public.publication_watch_id_seq from public, anon, authenticated;

grant select, insert, update, delete on table public.evaluated_patents to service_role;
grant select, insert, update, delete on table public.publication_watch to service_role;
grant usage, select on sequence public.publication_watch_id_seq to service_role;

-- supabase-publication-scan.sql
--
-- Run once in the Supabase SQL editor on the existing CURFPatentMachine
-- project. Non-destructive. It does not change publication_watch rows.
--
-- publication_scan_runs is how the Publication Watch page shows the
-- last scan's time, status, counts, and error. The browser never
-- queries it. Netlify functions use the service_role key.
--
-- This does not fix a wrong SUPABASE_SERVICE_KEY. If that variable is
-- the anon key, RLS with no policies still rejects every insert,
-- including inserts into this table. Copy the service_role key.

create table if not exists public.publication_scan_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null,
  status text not null,
  found_count integer,
  stored_count integer,
  scored_count integer,
  error text,
  detail jsonb
);

alter table public.publication_scan_runs enable row level security;

revoke all on table public.publication_scan_runs from public, anon, authenticated;
revoke all on sequence public.publication_scan_runs_id_seq from public, anon, authenticated;

grant select, insert, update, delete on table public.publication_scan_runs to service_role;
grant usage, select on sequence public.publication_scan_runs_id_seq to service_role;

-- supabase-workflow.sql
--
-- NOT applied. Run once in the Supabase SQL editor for the
-- CURFPatentMachine project after this change is reviewed.
--
-- Non-destructive. It does not alter evaluated_patents, patent_triage,
-- publication_watch rows, or sc_investment_groups. It adds two columns
-- to publication_watch and creates two new tables.
--
-- The browser never queries these tables. Netlify functions use the
-- service_role key. There is no logged-in user, so RLS is enabled with
-- no policies: anon and authenticated are denied. service_role bypasses
-- RLS. Grants match that design. Safe to re-run.

alter table public.publication_watch add column if not exists review_json jsonb;
alter table public.publication_watch add column if not exists reviewed_at timestamptz;

-- publication_watch already has RLS and a service_role grant. New
-- columns stay on that same table and do not widen access.

create table if not exists public.discovered_patents (
  patent_key text primary key,
  patent_id text not null,
  title text,
  abstract text,
  publication_date text,
  filing_date text,
  kind_code text,
  record_type text,
  assignees jsonb not null default '[]'::jsonb,
  inventors jsonb not null default '[]'::jsonb,
  cpc_codes jsonb not null default '[]'::jsonb,
  family_id text,
  backward_citation_count integer,
  sources jsonb not null default '[]'::jsonb,
  google_patents_url text,
  uspto_url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists discovered_patents_publication_date_idx
  on public.discovered_patents (publication_date desc);

alter table public.discovered_patents enable row level security;

revoke all on table public.discovered_patents from public, anon, authenticated;

grant select, insert, update, delete on table public.discovered_patents to service_role;

create table if not exists public.discovery_scan_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  google_count integer,
  uspto_count integer,
  stored_count integer,
  error text,
  detail jsonb
);

create index if not exists discovery_scan_runs_started_at_idx
  on public.discovery_scan_runs (started_at desc);

alter table public.discovery_scan_runs enable row level security;

revoke all on table public.discovery_scan_runs from public, anon, authenticated;
revoke all on sequence public.discovery_scan_runs_id_seq from public, anon, authenticated;

grant select, insert, update, delete on table public.discovery_scan_runs to service_role;
grant usage, select on sequence public.discovery_scan_runs_id_seq to service_role;

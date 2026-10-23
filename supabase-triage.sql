-- supabase-triage.sql
--
-- Run once in the Supabase SQL editor for the CURFPatentMachine project.
-- Non-destructive: creates the licensing-triage cache if it is missing
-- and does not drop or rewrite evaluated_patents or publication_watch.
-- Do not re-run the model for a patent_id that is already in this table.
-- The background function skips those rows.
--
-- The browser never queries this table. Netlify functions use the
-- service_role key. RLS is on with no policies, so anon and
-- authenticated are denied. Grants match that design.

create table if not exists public.patent_triage (
  patent_id text primary key,
  tier text not null,
  reason text not null,
  confidence text not null,
  signals jsonb not null default '{}'::jsonb,
  model text,
  screened_at timestamptz not null default now(),
  sc_industry_group text,
  sc_focus_area text,
  sc_alignment_score integer,
  sc_alignment_note text,
  sc_alignment_source text
);

alter table public.patent_triage add column if not exists sc_industry_group text;
alter table public.patent_triage add column if not exists sc_focus_area text;
alter table public.patent_triage add column if not exists sc_alignment_score integer;
alter table public.patent_triage add column if not exists sc_alignment_note text;
alter table public.patent_triage add column if not exists sc_alignment_source text;

alter table public.patent_triage enable row level security;

revoke all on table public.patent_triage from public, anon, authenticated;

grant select, insert, update, delete on table public.patent_triage to service_role;

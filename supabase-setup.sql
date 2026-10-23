-- supabase-setup.sql
--
-- Run this once in Supabase's SQL editor (Project > SQL Editor > New
-- query) to create the table the CURF Docket app uses for shared,
-- cross-device storage of patent evaluations.
--
-- IMPORTANT: this table now stores the FULL evaluation result, not
-- just a "was it evaluated" flag. Opening a patent evaluated tonight
-- from a different browser or three months from now returns the exact
-- same stored breakdown, it does not silently re-run or recompute
-- anything. If you already ran an earlier version of this file that
-- only had patent_id and evaluated_at, the ALTER TABLE statement below
-- adds the missing column without losing anything already there.
--
-- After running this, you still need to set two Netlify environment
-- variables for the app to actually use it: SUPABASE_URL and
-- SUPABASE_SERVICE_KEY (the service_role key, not the anon key). See
-- DEPLOYMENT.md for those steps. Until both of those are set, the app
-- keeps working fine on browser localStorage alone, just on one
-- browser and device rather than shared, this table sits unused with
-- no harm done.

create table if not exists evaluated_patents (
  patent_id text primary key,
  evaluated_at timestamptz not null default now()
);

-- Adds the full-record column if this table already existed from an
-- earlier version of this file. Safe to run even if the column is
-- already there.
alter table evaluated_patents add column if not exists record_json jsonb;

-- Backs the Publication Watch feature: a weekly (or manually triggered)
-- search for new Clemson research publications, with a quick
-- commercial relevance read on each. source_url is unique so repeated
-- scans naturally avoid re-storing or re-alerting on the same finding.
create table if not exists publication_watch (
  id bigserial primary key,
  title text not null,
  source_url text not null unique,
  authors text,
  summary text,
  commercial_relevance_score text,
  commercial_rationale text,
  found_at timestamptz not null default now(),
  alerted boolean not null default false
);

-- The Netlify functions read and write these tables with the
-- service_role key. The browser never queries Supabase directly, and
-- this app has no logged-in user. RLS is enabled with no policies so
-- the anon and authenticated roles are denied. service_role bypasses
-- RLS. The grants below match that design: anon gets nothing
-- (including no SELECT), authenticated gets nothing, service_role
-- gets select/insert/update/delete. Safe to re-run.
alter table evaluated_patents enable row level security;
alter table publication_watch enable row level security;

revoke all on table evaluated_patents from public, anon, authenticated;
revoke all on table publication_watch from public, anon, authenticated;
revoke all on sequence publication_watch_id_seq from public, anon, authenticated;

grant select, insert, update, delete on table evaluated_patents to service_role;
grant select, insert, update, delete on table publication_watch to service_role;
grant usage, select on sequence publication_watch_id_seq to service_role;

-- Last Publication Watch run: time, status, counts, and error text.
-- Safe to re-run. The page reads this through the Netlify function.
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


-- sc_investment_groups and patent_triage
-- Fresh projects: the statements below match supabase-sc-investment.sql
-- and supabase-triage.sql. Existing projects can run those two files
-- on their own. Safe to re-run.

-- supabase-sc-investment.sql
--
-- Reference table for South Carolina investment alignment.
-- Source: PitchBook industry-group pivot, completed deals located in
-- South Carolina, 2023 through 2026 YTD, downloaded 07-Oct-2026.
-- Focus-area labels are the ones already on that sheet. This file does
-- not load investor names or the investor-level export.
--
-- median_capital_musd is the deal-weighted average of yearly medians
-- PitchBook reported. It is a typical check size, not the sum of
-- capital invested. Years with a blank median are excluded from that
-- average and still counted in the deal columns.
-- alignment_score uses the same formula as netlify/functions/sc-investment.js:
--   volume  = min(40, 40 * log10(deals+1) / log10(522))
--   recency = min(25, 25 * recent_deals / deal_count)
--   focus   = 40 when the group is a stated CURF focus, else 0
--   score   = round(volume + recency + focus), capped at 100
-- recent_deals is 2025 plus 2026 YTD.
--
-- Not applied to production by this change. Run it once in the
-- Supabase SQL editor. Safe to re-run: the insert updates in place.
--
-- The browser never queries this table. Netlify functions use the
-- service_role key. RLS is on with no policies, so anon and
-- authenticated are denied. Grants match that design.

create table if not exists public.sc_investment_groups (
  industry_group text primary key,
  focus_area text not null,
  is_focus boolean not null,
  deal_count integer not null,
  deals_2023 integer not null,
  deals_2024 integer not null,
  deals_2025 integer not null,
  deals_2026_ytd integer not null,
  recent_deals integer not null,
  median_capital_musd numeric(12, 4),
  deals_with_median integer not null,
  alignment_score integer not null,
  as_of date not null
);

alter table public.sc_investment_groups enable row level security;

revoke all on table public.sc_investment_groups from public, anon, authenticated;

grant select, insert, update, delete on table public.sc_investment_groups to service_role;

insert into public.sc_investment_groups (
  industry_group, focus_area, is_focus, deal_count,
  deals_2023, deals_2024, deals_2025, deals_2026_ytd, recent_deals,
  median_capital_musd, deals_with_median, alignment_score, as_of
) values
('Other Business Products and Services', 'Other (not a stated focus)', false, 521, 159, 163, 146, 53, 199, 5.7978, 521, 50, date '2026-10-07'),
('Commercial Services', 'Other (not a stated focus)', false, 468, 114, 149, 128, 77, 205, 2.833, 468, 50, date '2026-10-07'),
('Software', 'Software & IT (AI / quantum proxy)', true, 250, 71, 72, 63, 44, 107, 0.4613, 250, 86, date '2026-10-07'),
('Services (Non-Financial)', 'Other (not a stated focus)', false, 208, 46, 62, 84, 16, 100, 0.6731, 208, 46, date '2026-10-07'),
('Commercial Products', 'Other (not a stated focus)', false, 207, 58, 50, 54, 45, 99, 1.4184, 207, 46, date '2026-10-07'),
('Healthcare Services', 'Other (not a stated focus)', false, 175, 36, 48, 64, 27, 91, 15.0212, 175, 46, date '2026-10-07'),
('Restaurants, Hotels and Leisure', 'Other (not a stated focus)', false, 137, 35, 41, 44, 17, 61, 39.3112, 137, 43, date '2026-10-07'),
('Consumer Non-Durables', 'Other (not a stated focus)', false, 68, 19, 20, 22, 7, 29, 0.9374, 68, 38, date '2026-10-07'),
('Transportation', 'Other (not a stated focus)', false, 68, 19, 22, 14, 13, 27, 293.6716, 68, 37, date '2026-10-07'),
('Other Financial Services', 'Other (not a stated focus)', false, 59, 10, 27, 15, 7, 22, 148.828, 59, 35, date '2026-10-07'),
('Healthcare Technology Systems', 'Other (not a stated focus)', false, 58, 21, 13, 18, 6, 24, 1.2238, 58, 36, date '2026-10-07'),
('Healthcare Devices and Supplies', 'Medical Devices', true, 53, 21, 11, 15, 6, 21, 1.0147, 53, 75, date '2026-10-07'),
('IT Services', 'Software & IT (AI / quantum proxy)', true, 47, 15, 13, 9, 10, 19, 16.2011, 47, 75, date '2026-10-07'),
('Pharmaceuticals and Biotechnology', 'Life Sciences / Drug Delivery (proxy)', true, 47, 14, 9, 18, 6, 24, 8.2738, 47, 78, date '2026-10-07'),
('Consumer Durables', 'Other (not a stated focus)', false, 39, 14, 7, 17, 1, 18, 2.5967, 39, 35, date '2026-10-07'),
('Insurance', 'Other (not a stated focus)', false, 39, 10, 10, 13, 6, 19, 1.7713, 39, 36, date '2026-10-07'),
('Retail', 'Other (not a stated focus)', false, 38, 12, 11, 10, 5, 15, 0.5364, 33, 33, date '2026-10-07'),
('Computer Hardware', 'Software & IT (AI / quantum proxy)', true, 36, 10, 11, 7, 8, 15, 0.2619, 36, 73, date '2026-10-07'),
('Chemicals and Gases', 'Advanced Materials (proxy)', true, 23, 6, 6, 8, 3, 11, 99.5948, 23, 72, date '2026-10-07'),
('Apparel and Accessories', 'Other (not a stated focus)', false, 17, 3, 2, 9, 3, 12, 1.178, 15, 36, date '2026-10-07'),
('Media', 'Other (not a stated focus)', false, 17, 5, 4, 7, 1, 8, 2.7588, 17, 30, date '2026-10-07'),
('Containers and Packaging', 'Other (not a stated focus)', false, 14, 2, 8, 2, 2, 4, 55.1867, 12, 24, date '2026-10-07'),
('Commercial Transportation', 'Other (not a stated focus)', false, 13, 5, 3, 2, 3, 5, 0.29, 13, 26, date '2026-10-07'),
('Capital Markets/Institutions', 'Other (not a stated focus)', false, 12, 1, 3, 3, 5, 8, 74.75, 3, 33, date '2026-10-07'),
('Communications and Networking', 'Software & IT (AI / quantum proxy)', true, 11, 4, 2, 5, 0, 5, 254.5327, 11, 67, date '2026-10-07'),
('Agriculture', 'Agriculture', true, 10, 1, 4, 4, 1, 5, 0.48, 8, 68, date '2026-10-07'),
('Commercial Banks', 'Other (not a stated focus)', false, 9, 2, 2, 3, 2, 5, 80.2244, 9, 29, date '2026-10-07'),
('Energy Equipment', 'Energy & Grid (proxy)', true, 9, 2, 4, 2, 1, 3, 20.9967, 6, 63, date '2026-10-07'),
('Exploration, Production and Refining', 'Other (not a stated focus)', false, 9, 2, 3, 2, 2, 4, 5.5443, 7, 26, date '2026-10-07'),
('Other / Unknown', 'Other (not a stated focus)', false, 8, 2, 3, 3, 0, 3, 0.1913, 8, 23, date '2026-10-07'),
('Energy Services', 'Energy & Grid (proxy)', true, 7, 3, 3, 1, 0, 1, 38.77, 7, 57, date '2026-10-07'),
('Textiles', 'Other (not a stated focus)', false, 6, 0, 2, 4, 0, 4, null, 0, 29, date '2026-10-07'),
('Utilities', 'Energy & Grid (proxy)', true, 6, 1, 1, 3, 1, 4, 143.19, 5, 69, date '2026-10-07'),
('Forestry', 'Other (not a stated focus)', false, 5, 2, 1, 2, 0, 2, 798.0, 5, 21, date '2026-10-07'),
('Metals, Minerals and Mining', 'Other (not a stated focus)', false, 4, 1, 0, 2, 1, 3, 235.0, 3, 29, date '2026-10-07'),
('Other Consumer Products and Services', 'Other (not a stated focus)', false, 4, 0, 3, 1, 0, 1, 0.5375, 4, 17, date '2026-10-07'),
('Construction (Non-Wood)', 'Other (not a stated focus)', false, 3, 0, 0, 1, 2, 3, null, 0, 34, date '2026-10-07'),
('Other Energy', 'Energy & Grid (proxy)', true, 1, 0, 1, 0, 0, 0, null, 0, 44, date '2026-10-07'),
('Other Healthcare', 'Other (not a stated focus)', false, 1, 0, 1, 0, 0, 0, null, 0, 4, date '2026-10-07'),
('Other Materials', 'Advanced Materials (proxy)', true, 1, 0, 0, 0, 1, 1, null, 0, 69, date '2026-10-07')
on conflict (industry_group) do update set
  focus_area = excluded.focus_area,
  is_focus = excluded.is_focus,
  deal_count = excluded.deal_count,
  deals_2023 = excluded.deals_2023,
  deals_2024 = excluded.deals_2024,
  deals_2025 = excluded.deals_2025,
  deals_2026_ytd = excluded.deals_2026_ytd,
  recent_deals = excluded.recent_deals,
  median_capital_musd = excluded.median_capital_musd,
  deals_with_median = excluded.deals_with_median,
  alignment_score = excluded.alignment_score,
  as_of = excluded.as_of;


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

-- Portfolio New badge columns, backfill, trigger, and grants.
-- Same statements as supabase-portfolio-new.sql. An existing project
-- can run that file alone. A fresh project that only runs this file
-- gets the same result. Safe to re-run.

-- supabase-portfolio-new.sql
--
-- Portfolio "New" badge. Non-destructive: adds two columns to
-- public.evaluated_patents, backfills the add time, and keeps that
-- add time from moving later on a re-save.
--
-- portfolio_added_at is when the patent landed in the portfolio.
-- Existing rows are backfilled from the earliest stored evaluation
-- time (record_json.portfolioAddedAt, then record_json.evaluation
-- .evaluated_at). The table's evaluated_at column is only a fallback:
-- a bulk re-save has stamped that column without changing the
-- evaluation itself.
--
-- portfolio_seen_at is when someone opened the case or used
-- Mark all seen. Null means not acknowledged. A later save cannot
-- clear it.
--
-- Grants, adjusted to RLS: this table stays row-level-security
-- enabled with no anon or authenticated policy, so the Data API
-- still denies those roles. The explicit grants are:
--   anon: select
--   authenticated: select, insert, update, delete
--   service_role: select, insert, update, delete
-- service_role bypasses RLS and is the key Netlify functions use.
-- Extra privileges anon and authenticated held before (writes,
-- truncate, references, trigger) are revoked.
--
-- Safe to re-run.

alter table public.evaluated_patents
  add column if not exists portfolio_added_at timestamptz;

alter table public.evaluated_patents
  add column if not exists portfolio_seen_at timestamptz;

create or replace function public.portfolio_parse_timestamptz(raw text)
returns timestamptz
language plpgsql
immutable
security invoker
set search_path = public
as $$
begin
  if raw is null or btrim(raw) = '' then
    return null;
  end if;
  if raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
    return null;
  end if;
  begin
    return raw::timestamptz;
  exception
    when others then
      return null;
  end;
end;
$$;

update public.evaluated_patents
set portfolio_added_at = coalesce(
  least(
    public.portfolio_parse_timestamptz(record_json #>> '{portfolioAddedAt}'),
    case
      when coalesce(record_json #>> '{evaluation,cached_only}', '') = 'true' then null
      else public.portfolio_parse_timestamptz(record_json #>> '{evaluation,evaluated_at}')
    end
  ),
  evaluated_at,
  now()
)
where portfolio_added_at is null;

alter table public.evaluated_patents
  alter column portfolio_added_at set default now();

alter table public.evaluated_patents
  alter column portfolio_added_at set not null;

comment on column public.evaluated_patents.portfolio_added_at is
  'When this patent first landed in the portfolio. Backfilled from the stored evaluation time.';

comment on column public.evaluated_patents.portfolio_seen_at is
  'When the case was opened or Mark all seen was used. Null means not acknowledged.';

create or replace function public.evaluated_patents_keep_portfolio_times()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  from_record timestamptz;
  from_eval timestamptz;
  added timestamptz;
begin
  from_record := public.portfolio_parse_timestamptz(new.record_json #>> '{portfolioAddedAt}');
  if new.record_json is null
     or coalesce(new.record_json #>> '{evaluation,cached_only}', '') = 'true' then
    from_eval := null;
  else
    from_eval := public.portfolio_parse_timestamptz(new.record_json #>> '{evaluation,evaluated_at}');
  end if;

  added := least(
    new.portfolio_added_at,
    from_record,
    from_eval,
    case when tg_op = 'UPDATE' then old.portfolio_added_at else null end
  );
  if added is null then
    added := coalesce(new.evaluated_at, now());
  end if;
  new.portfolio_added_at := added;

  if tg_op = 'UPDATE' then
    new.portfolio_seen_at := greatest(old.portfolio_seen_at, new.portfolio_seen_at);
  end if;

  return new;
end;
$$;

drop trigger if exists evaluated_patents_keep_portfolio_times on public.evaluated_patents;

create trigger evaluated_patents_keep_portfolio_times
  before insert or update on public.evaluated_patents
  for each row
  execute function public.evaluated_patents_keep_portfolio_times();

alter table public.evaluated_patents enable row level security;

revoke all on table public.evaluated_patents from public, anon, authenticated;

grant select on table public.evaluated_patents to anon;

grant select, insert, update, delete on table public.evaluated_patents to authenticated;

grant select, insert, update, delete on table public.evaluated_patents to service_role;

revoke all on function public.portfolio_parse_timestamptz(text) from public, anon, authenticated;
revoke all on function public.evaluated_patents_keep_portfolio_times() from public, anon, authenticated;

grant execute on function public.portfolio_parse_timestamptz(text) to service_role;
grant execute on function public.evaluated_patents_keep_portfolio_times() to service_role;

notify pgrst, 'reload schema';

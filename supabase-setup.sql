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

-- Nothing else is required. Row level security is intentionally left
-- off on this table: it is only ever queried using the service_role
-- key from a Netlify function running server side, never from the
-- browser with the anon key, so there is no client-facing surface
-- that RLS would need to restrict. If you later add any other way of
-- reading this table (e.g. a dashboard using the anon key), add RLS
-- policies at that point, don't assume this table is safe to expose
-- more broadly than it is today.

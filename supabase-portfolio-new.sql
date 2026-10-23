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

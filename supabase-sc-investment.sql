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

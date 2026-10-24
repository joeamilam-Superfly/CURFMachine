-- supabase-publication-dates.sql
--
-- Run once in the Supabase SQL editor on an existing project.
-- Adds the publication date looked up from a paper's DOI.
-- Safe to re-run. It does not change existing dates.

alter table public.publication_watch add column if not exists published_on date;

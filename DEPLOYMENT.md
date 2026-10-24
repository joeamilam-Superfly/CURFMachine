# Deploying the CURF Docket app for real

How the staff use the app, step by step, is in [README.md](README.md). This file is the setup.

This folder is the deploy bundle:

- `index.html`, the app itself (this is the file the browser loads at the site's root by default, no redirect rule needed)
- `sc-investment.js`, the South Carolina investment aggregates the browser uses. It has no investor names.
- `netlify/functions/`, the server side proxies (evaluation, patent scan, quick rank, problem match, evaluated-patent storage, pilot sites, publication scans, and alert email). They use Node's built-in `fetch` only, no npm packages.
- `supabase-setup.sql`, the one-time SQL for a new project. `supabase-rls-grants.sql` locks down tables that already exist. `supabase-publication-scan.sql`, `supabase-triage.sql`, and `supabase-sc-investment.sql` are the same statements for a project that is already in use. None of these files have been applied to production by this change.
- `netlify.toml`, wiring so Netlify serves all of it together
- `package.json`, declaring this project uses ES modules. This is required for the function syntax used here (`export default`, `export const config`) to be recognized by Netlify's build system at all. Without it, the functions silently fail to register and calling them returns a 404, not an error naming the actual problem.

## Before deploying with real IP data

Do not put real, unpublished Clemson disclosures through this app until both of the following are true. Neither is a step in this folder, both are conversations someone at CURF needs to have first.

1. Clemson (or CURF specifically) has a Zero Data Retention agreement with Anthropic, arranged through Anthropic's sales team, on the same Anthropic organization whose API key this app will use.
2. CURF's IT security office has reviewed this proxy pattern the same way they would review any new vendor integration touching institutional IP.

See `SECURITY-AND-PRIVACY.md` for the full reasoning behind both of those.

## Steps

1. Push this folder to a GitHub repository, or drag the folder into Netlify's manual deploy.
2. In Netlify, set a site environment variable named `ANTHROPIC_API_KEY` with a real Anthropic API key for the account that has the ZDR arrangement in place. Do this in Netlify's site settings, never in the code.
3. Deploy the site. The checked Aug 29, 2026 list on Triage needs no extra key. Scan for new patents uses Google Cloud, and the USPTO only when `USPTO_ODP_API_KEY` is set. See the patent scan section below.
4. Confirm `const USE_BACKEND_PROXY = true` in `index.html`. It is already true in this tree. Leave it true so the browser calls `/api/evaluate-patent` instead of Anthropic directly.
5. Confirm an evaluation from Submit patents calls `/api/evaluate-patent`. Triage does not call Google or the USPTO until someone clicks **Scan for new patents**, which starts `POST /api/discover-patents-background`. `GET /api/discover-patents` only reads the saved list.

## What this does and does not solve

This proxy keeps the API key out of the browser and makes the traffic eligible to sit behind a Zero Data Retention arrangement. It does not, by itself, grant that arrangement, redact sensitive fields, or make the decision about which patents are sensitive enough to withhold from the pipeline entirely. Those are policy decisions for CURF, not something this file can decide for you.

## If a function route still 404s after this

Check Netlify's deploy log for the specific build (Site > Deploys > click the deploy > Deploy log) and look for a "Functions bundling" section. It should list the functions in `netlify/functions` by name, including `evaluate-patent` and `discover-patents`. If a function is missing from that list entirely, the problem is upstream of routing, most likely the `netlify/functions` folder didn't make it into the repository or build as expected, check that first before touching netlify.toml again.

## Setting up Scan for new patents (Google Patents Public Data on BigQuery, plus the USPTO)

Triage can show the checked Aug 29, 2026 list with no setup at all. Click **Show the Aug 29, 2026 list**. The steps below are what **Scan for new patents** needs. That scan reads Google's public patent table, and the USPTO Open Data Portal when `USPTO_ODP_API_KEY` is set. If the USPTO key is missing, the Google rows still save. The same document from both sources is one row in `discovered_patents`. An application and its later grant stay on separate rows. Each run is stored in `discovery_scan_runs`. `GET /api/discover-patents` only reads those tables.

1. Create a Google Cloud project at console.cloud.google.com if you don't already have one for this.
2. In that project, enable the BigQuery API (APIs & Services > Enable APIs and Services > search "BigQuery API").
3. Attach a billing account to the project. This is a Google requirement to run any BigQuery query at all, even against free public datasets like this one; querying `patents-public-data.patents.publications` at the scale this tool uses is expected to be covered by BigQuery's free monthly query processing tier.
4. Go to IAM & Admin > Service Accounts, create a new service account, and grant it the "BigQuery Job User" role.
5. On that service account, create a key (JSON format) and download it. Keep this file private, it's equivalent to a password.
6. Base64 encode the entire contents of that downloaded JSON file. On Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\your-key.json"))`. On Mac or Linux: `base64 -i your-key.json`.
7. In Netlify, set two environment variables: `GCP_PROJECT_ID` (your Google Cloud project's ID, not its display name) and `GCP_SERVICE_ACCOUNT_KEY_BASE64` (the long string from step 6).
8. Redeploy, then go to Triage and click **Scan for new patents**. Set `USPTO_ODP_API_KEY` as well if you want the USPTO half of that scan. Without it, the scan record says the USPTO step was skipped and the Google list still saves.

If that button's error message includes a `raw_response` field, that's BigQuery's own error, naming the actual problem (a permissions issue, a billing issue, a changed field name) rather than a generic failure. Read that message first before assuming the code is wrong.

## Setting up shared, cross-device tracking of evaluated patents (optional, Supabase)

By default, the complete evaluation for every patent, not just a flag saying it was done, lives in browser localStorage. Opening a patent evaluated tonight from this same browser in three months returns the exact same stored breakdown, it does not re-run or recompute anything. This works immediately with no setup, but only remembers on the one browser and device you use. To make that shared across your team instead:

1. In Supabase (a new project, or an existing one you already run), open the SQL editor and run the contents of `supabase-setup.sql`, included in this same folder. It creates one table:
   ```sql
   create table evaluated_patents (
     patent_id text primary key,
     evaluated_at timestamptz not null default now()
   );
   ```
2. In Supabase's project settings, under API, copy the Project URL and the `service_role` key. Use the service_role key here, not the anon key. The anon key does not bypass row level security. With it, `/api/evaluated-patents` still returns `configured: true` and an empty list, and every save fails with Postgres `42501` (`new row violates row-level security policy`). That looks like a successful empty database. It is not.
3. In Netlify, set two environment variables: `SUPABASE_URL` (must be `https://lxindmkredduovyfzszq.supabase.co` for the CURFPatentMachine project) and `SUPABASE_SERVICE_KEY` (the service_role key).
4. Redeploy. The app checks for these automatically. If the key is an anon JWT, the page shows a warning instead of pretending the save worked.

On the existing CURFPatentMachine project, `supabase-portfolio-new.sql` adds `portfolio_added_at` and `portfolio_seen_at` to `evaluated_patents` for the Portfolio New badge. A fresh `supabase-setup.sql` includes those same statements. The Portfolio view menu uses them together with the timestamp stored on each case.

If these aren't set, `/api/evaluated-patents` returns a normal response saying so, and the app keeps using localStorage. If they are set to the wrong key, the warning above is the symptom. On the browser where the evaluations already completed, reload after the key is fixed. That browser still has them in localStorage and will upload the missing rows. They are not on the server until that happens.

## Setting up Publication Watch and email alerts (optional)

The findings list needs `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. `SUPABASE_SERVICE_KEY` must be the service_role key. With the anon key, the page reports `configured: true` and an empty list, and every save is rejected by row level security. That is the same failure as evaluated patents. `ANTHROPIC_API_KEY` is used only to score relevance. Items are still stored when scoring fails.

Run `supabase-setup.sql` on a new project. On the existing project, run `supabase-publication-scan.sql` as well. It creates `publication_scan_runs` (last scan time, status, counts, and error) and grants that table to `service_role` only. Do not expect a scan status line until that file has been run. Also run `supabase-publication-dates.sql`. It adds `published_on` to `publication_watch`. No new environment variable is required.

The scan reads the Clemson news RSS feed, PubMed (affiliation Clemson), OpenAlex (Clemson University ROR `037s24f05`), and arXiv. It does not ask the model to discover publications, and it does not use web search. The button defaults to the last year. The page can send `window` `2`, `5`, or `all`. The weekly run stays on the last year. When a paper has a DOI, the scan asks the Crossref works API for a full publication day and stores it in `published_on`. A year without a day is not stored.

For actual email alerts on top of that:

1. Create a free account at resend.com and get an API key from its dashboard.
2. Set `RESEND_API_KEY` in Netlify.
3. Set `CURF_ALERT_EMAIL` to whatever address should receive alerts.
4. Optionally set `RESEND_FROM_EMAIL` once you've verified your own sending domain in Resend. Without it, emails send from Resend's shared sandbox address (`onboarding@resend.dev`), which works for testing but is commonly restricted in who it can actually deliver to once past initial testing, verify a real domain before relying on this for real alerts.
5. Redeploy.

An email only goes out for a finding scored HIGH that has not already been alerted. A later scan does not send a second email for the same row. If the email send fails, `alerted` stays false and a later scan tries again.

The weekly automatic run (`weekly-publication-scan.js`) cannot be tested by visiting a URL. Use **Scan for new papers**, which calls `run-publication-scan-background.js` with the range chosen on the page. Both runs use the same four sources. The weekly run has a 30 second limit, stays on the last year, and may leave new rows unscored. The button run scores a larger batch and can look further back. Either way, stored rows show up even when scoring does not finish. The page shows the last run's time, counts, range, and error once `publication_scan_runs` exists.

**What this cannot do**: get behind Clemson library's paywalled journal subscriptions. It searches public web sources only, titles, abstracts, press releases, and anything already publicly indexed. That is a known, stated limitation, not an oversight, closing it would require a specific integration with Clemson's own library systems that does not exist here.

## Quick rank (Triage)

**Rank patents with no rank yet** sends the patents already loaded on Triage to `/api/triage-patents-background`. The page then polls `GET /api/triage-patents` until the rows appear. The background function does not call BigQuery again.

The rank call uses `claude-haiku-5-5`, with no web search, effort set to low, and thinking disabled on the first attempt. A rejected thinking block is retried once. Batches are 12 patents. A `patent_id` already stored in `patent_triage` is skipped, so a second click does not send that patent again.

Published starting rates for that model are $0.10 per million input tokens and $0.50 per million output tokens. With thinking off, 300 patents are on the order of 75,000 input tokens and 18,000 output tokens, a few cents. If low-effort thinking still adds tokens, plan on under $0.30 for the full list. Runtime is usually 2 to 4 minutes, and the 15 minute background limit covers a slow run. Do not expect a synchronous function to finish 300 patents inside 60 seconds.

Each row uses the fields the live pull already has: title, abstract, CPC codes, kind, filing and publication dates, backward citations, and co-assignees. Claims text is not in the pull. Forward citations are not queried. Maintenance status is an age note, not a USPTO fee check. Remaining term is 20 years from filing for utility and plant records, and 15 years from the grant publication for design records, ignoring term adjustment. An estimated expired term forces the tier to Needs work.

Run `supabase-triage.sql` in the Supabase SQL editor before the first rank. It creates `patent_triage` and grants select, insert, update, and delete to `service_role` only. Row level security is on with no policies. The same statements are at the bottom of `supabase-setup.sql`. This file has not been applied. No new environment variable is required. `SUPABASE_SERVICE_KEY` still has to be the service_role key, or the rank read looks empty and the write is rejected.

## South Carolina investment alignment

`supabase-sc-investment.sql` loads one row per PitchBook industry group: deal counts for 2023, 2024, 2025, and 2026 year to date, a deal-weighted median check size, the focus-area label from that sheet, and the alignment score. It does not load investor names. Row level security is on, `anon` and `authenticated` are revoked, and `service_role` is granted select, insert, update, and delete in the same file. Run it in the SQL editor. It has not been applied. The app scores from `public/sc-investment.js` and `netlify/lib/sc-investment.js`, so a rank still works before the table exists. The table is the shared reference copy.

The score is 0 to 100. Volume is log-scaled against the largest group in the extract (521 deals) and tops out at 40. Recency is the share of deals in 2025 or 2026 YTD and tops out at 25. A stated focus area adds 40. Focus areas on the sheet are Software and IT, medical devices, life sciences and drug delivery, advanced materials, agriculture, and energy and grid. Seventy or higher adds 2 points to the value score. Fifty-five or higher adds 1. Letter thresholds stay at 10, 7, and 4, on a new maximum of 15. In the quick rank, 75 or higher can lift Low or Needs work to Medium, and 80 or higher can lift Medium to High, when an abstract exists and the estimated term has not run out. A High tier is not lowered for a weak match.

The dollar sentence is a typical PitchBook median, not the sum of capital invested. Some medians are skewed by a few large deals. The mapping uses CPC codes first, then keywords. A tie or a thin keyword hit stays overridable by the model's industry group, which must be one of the 40 names. A high-confidence CPC or keyword match is kept. Prompts receive the group names only, not investor names and not the dollar table.

Triage shows the rank and the South Carolina fit score, and can filter by rank, focus area, or score band. The Portfolio column and the case page show the same read. New evaluations freeze the points into the value score. Older evaluations keep their stored score until someone re-runs them. The case page still shows the live alignment note.

## One more setting worth pinning explicitly

Netlify's function runtime normally matches the Node.js version detected from your build, but a drag-and-drop deploy doesn't run a real build, so which Node version it lands on isn't guaranteed. The functions rely on Node's built in `fetch`, which needs Node 18 or newer. Rather than trust an implicit fallback, set this explicitly: in Netlify, go to Site configuration > Environment variables and add `AWS_LAMBDA_JS_RUNTIME` set to `nodejs20.x`, then redeploy. This must be set as an environment variable in the Netlify UI, not in netlify.toml, Netlify does not read it from there.

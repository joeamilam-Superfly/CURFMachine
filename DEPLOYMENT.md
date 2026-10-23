# Deploying the CURF Docket app for real

This folder is the deploy bundle:

- `index.html`, the app itself (this is the file the browser loads at the site's root by default, no redirect rule needed)
- `netlify/functions/`, the server side proxies (evaluation, BigQuery registry, problem match, evaluated-patent storage, publication scans, and alert email). They use Node's built-in `fetch` only, no npm packages.
- `supabase-setup.sql`, the one-time SQL to run in Supabase if you want shared tracking and Publication Watch (optional, see below). `supabase-rls-grants.sql` is the same lock-down for a project where the tables already exist.
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
3. Deploy the site. The known Clemson snapshot on the Registry tab needs no extra key. The optional live pull uses Google Cloud, not a PatentsView key. See the BigQuery section below.
4. Confirm `const USE_BACKEND_PROXY = true` in `index.html`. It is already true in this tree. Leave it true so the browser calls `/api/evaluate-patent` instead of Anthropic directly.
5. Confirm an evaluation from Intake calls `/api/evaluate-patent`. The Registry tab does not call `/api/clemson-patents` until someone clicks "Try live fetch from Google Patents".

## What this does and does not solve

This proxy keeps the API key out of the browser and makes the traffic eligible to sit behind a Zero Data Retention arrangement. It does not, by itself, grant that arrangement, redact sensitive fields, or make the decision about which patents are sensitive enough to withhold from the pipeline entirely. Those are policy decisions for CURF, not something this file can decide for you.

## If a function route still 404s after this

Check Netlify's deploy log for the specific build (Site > Deploys > click the deploy > Deploy log) and look for a "Functions bundling" section. It should list both `evaluate-patent` and `fetch-clemson-patents` by name. If a function is missing from that list entirely, the problem is upstream of routing, most likely the `netlify/functions` folder didn't make it into the repository or build as expected, check that first before touching netlify.toml again.

## Setting up the Clemson Registry's live data source (Google Patents Public Data on BigQuery)

The Registry tab's default view is a manually pulled, real, verified snapshot that needs no setup at all, just click "Load known Clemson patents." The steps below are only needed if you want the live, comprehensive pull instead, which draws on Google's full historical patent dataset rather than one hand curated page.

1. Create a Google Cloud project at console.cloud.google.com if you don't already have one for this.
2. In that project, enable the BigQuery API (APIs & Services > Enable APIs and Services > search "BigQuery API").
3. Attach a billing account to the project. This is a Google requirement to run any BigQuery query at all, even against free public datasets like this one; querying `patents-public-data.patents.publications` at the scale this tool uses is expected to be covered by BigQuery's free monthly query processing tier.
4. Go to IAM & Admin > Service Accounts, create a new service account, and grant it the "BigQuery Job User" role.
5. On that service account, create a key (JSON format) and download it. Keep this file private, it's equivalent to a password.
6. Base64 encode the entire contents of that downloaded JSON file. On Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\your-key.json"))`. On Mac or Linux: `base64 -i your-key.json`.
7. In Netlify, set two environment variables: `GCP_PROJECT_ID` (your Google Cloud project's ID, not its display name) and `GCP_SERVICE_ACCOUNT_KEY_BASE64` (the long string from step 6).
8. Redeploy, then go to the Registry tab and click "Try live fetch from Google Patents".

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

If these aren't set, `/api/evaluated-patents` returns a normal response saying so, and the app keeps using localStorage. If they are set to the wrong key, the warning above is the symptom. On the browser where the evaluations already completed, reload after the key is fixed. That browser still has them in localStorage and will upload the missing rows. They are not on the server until that happens.

## Setting up Publication Watch and email alerts (optional)

The findings list needs `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. `SUPABASE_SERVICE_KEY` must be the service_role key. With the anon key, the page reports `configured: true` and an empty list, and every save is rejected by row level security. That is the same failure as evaluated patents. `ANTHROPIC_API_KEY` is used only to score relevance. Items are still stored when scoring fails.

Run `supabase-setup.sql` on a new project. On the existing project, run `supabase-publication-scan.sql` as well. It creates `publication_scan_runs` (last scan time, status, counts, and error) and grants that table to `service_role` only. Do not expect a scan status line until that file has been run. No new environment variable is required.

The scan reads the Clemson news RSS feed, PubMed (affiliation Clemson), OpenAlex (Clemson University ROR `037s24f05`), and arXiv. It does not ask the model to discover publications, and it does not use web search.

For actual email alerts on top of that:

1. Create a free account at resend.com and get an API key from its dashboard.
2. Set `RESEND_API_KEY` in Netlify.
3. Set `CURF_ALERT_EMAIL` to whatever address should receive alerts.
4. Optionally set `RESEND_FROM_EMAIL` once you've verified your own sending domain in Resend. Without it, emails send from Resend's shared sandbox address (`onboarding@resend.dev`), which works for testing but is commonly restricted in who it can actually deliver to once past initial testing, verify a real domain before relying on this for real alerts.
5. Redeploy.

An email only goes out for a finding scored HIGH that has not already been alerted. A later scan does not send a second email for the same row. If the email send fails, `alerted` stays false and a later scan tries again.

The weekly automatic run (`weekly-publication-scan.js`) cannot be tested by visiting a URL. Use "Run scan now", which calls `run-publication-scan-background.js`. Both runs use the same four sources. The weekly run has a 30 second limit and may leave new rows unscored. The button run scores a larger batch. Either way, stored rows show up even when scoring does not finish. The page shows the last run's time, counts, and error once `publication_scan_runs` exists.

**What this cannot do**: get behind Clemson library's paywalled journal subscriptions. It searches public web sources only, titles, abstracts, press releases, and anything already publicly indexed. That is a known, stated limitation, not an oversight, closing it would require a specific integration with Clemson's own library systems that does not exist here.

## One more setting worth pinning explicitly

Netlify's function runtime normally matches the Node.js version detected from your build, but a drag-and-drop deploy doesn't run a real build, so which Node version it lands on isn't guaranteed. Both functions rely on Node's built in `fetch`, which needs Node 18 or newer. Rather than trust an implicit fallback, set this explicitly: in Netlify, go to Site configuration > Environment variables and add `AWS_LAMBDA_JS_RUNTIME` set to `nodejs20.x`, then redeploy. This must be set as an environment variable in the Netlify UI, not in netlify.toml, Netlify does not read it from there.

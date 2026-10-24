# CURF Patent Machine

This app helps CURF staff find Clemson patents and papers, sort the promising ones, and keep a full review so the same case is not reviewed twice.

The live site is [https://curfpatentmachine.netlify.app](https://curfpatentmachine.netlify.app). The pages you use are **Triage**, **Portfolio**, **Publications**, **Tools**, **Submit patents**, and **How we score**.

Setup, keys, and database files are in [DEPLOYMENT.md](DEPLOYMENT.md). What may be sent to outside services is in [SECURITY-AND-PRIVACY.md](SECURITY-AND-PRIVACY.md).

## How a case moves

### 1. Scan for Clemson patents, and scan for papers

On **Triage**, click **Scan for new patents**. The scan looks in Google's public patent records and at the USPTO for US patents whose owner name contains Clemson. If both places name the same document, you see one row. A patent application and the patent it later becomes stay on two rows, because they are different documents.

Until a scan is saved, or if shared storage is off, the page shows the checked list from Aug 29, 2026. **Show the Aug 29, 2026 list** brings that list back. **Scan for new patents** replaces it with the newer lookup.

The list only includes patents Clemson or CURF owns. It cannot find a patent owned by a company, even when a Clemson graduate or staff member is an inventor.

On **Publications**, click **Scan for new papers**. That scan reads public Clemson sources: the Clemson news feed, PubMed, OpenAlex, and arXiv. It looks about 120 days back. It cannot open a paid journal article. Each paper gets a quick score: High, Moderate, Low, or Not scored. High means it looks more commercial. A weekly scan also runs. It has less time, so some new rows can stay Not scored until you click the button. A High paper is emailed once, when email is set up. Finding it again does not send a second email.

### 2. Quick rank, and what the South Carolina fit score means

On Triage, click **Rank patents with no rank yet**. The rank is a first look from the title and summary. It is not the full review.

The rank is one of these:

- **High.** Looks most worth a full review.
- **Medium.** Worth a look. Not the first in line.
- **Low.** Weaker signs from the text.
- **Needs work.** The text is thin, or the patent term looks like it has run out.
- **Not ranked yet.** This row has not been ranked.

A utility or plant patent is treated as lasting 20 years from the filing date. A design patent is treated as lasting 15 years from the grant date. If that estimate says the term has run out, the rank is Needs work. This is an estimate. It is not a USPTO fee check.

**South Carolina fit** is a separate number from 0 to 100. It is on the row even before you rank. The app matches the patent to one South Carolina industry using the patent classes and words in the title and summary. The number comes from three things: how many deals that industry has had in South Carolina since 2023, how many of those deals are in 2025 or 2026 so far, and whether the industry is a CURF focus area. Focus areas are software and IT, medical devices, life sciences and drug delivery, advanced materials, agriculture, and energy and the grid.

A fit of 70 or higher can add 2 points to the later patent score. A fit of 55 or higher can add 1 point. During the quick rank, a fit of 75 or higher can lift Low or Needs work to Medium, and a fit of 80 or higher can lift Medium to High. That lift happens only when a summary is present and the term estimate has not run out. A High rank is never lowered because the fit is weak.

The dollar in the fit note is a typical deal size in that industry. It is one deal, not the total dollars invested, and it is not the value of this patent. Investor names are not used.

Filter the list by New, rank, or South Carolina fit. Then pick rows and click **Evaluate selected**.

### 3. Full review

**Evaluate selected** opens a full review. A patent you already reviewed opens the saved review. It is not sent again unless you click **Re-evaluate** on the case.

The review does three jobs, in order.

1. It reads the patent. You see how far along the technology is, whether anyone would pay for it, a next step, the risks, and a short summary a business reader can follow.
2. It looks for organizations that could buy or license it. The case needs **at least three** named organizations. Fewer than three is marked **No real market**. The list is not filled with guesses. If the first read already finds weak or no demand, the case is marked No real market and the buyer search is skipped.
3. It looks for **pilot sites** only when the case is not No real market. Each site should include a public page that shows earlier work in the same area. Sites with that page are listed first. A site with no page shows **No proof link** and is listed last. It is a lead to check, not a promise from that organization. If the case is No real market, the pilot section says a pilot is not a good next step.

**What already exists**, on the open case, is a separate search you start yourself. It is not part of the automatic review. It looks for similar patents, products already for sale, and anything that might block use. It is a first look. It is not legal advice.

**The patent score is out of 15.** The app adds it up from the lines already on the page. The AI does not pick the number. The same inputs always give the same score. The page says what raised the score, what lowered it, and the fastest way to raise it, using facts from this patent. The score is not a dollar value. Older reviews keep the score they were given. Run the review again to refresh it.

About 13 of the 15 points come from the review: market interest, how far along the technology is, adoption risk, whether a real buyer is named with a link, and whether the inventor or a company contact is confirmed. Up to 2 more points come from South Carolina fit. Letter lines stay at 10, 7, and 4, shown as A, strong through D. Fit can raise a grade. It cannot by itself push a case over the line for A.

You can draft an outreach email for a named buyer. That draft uses only facts the buyer search already found. This app does not send the email.

### 4. Saving to the Portfolio

A finished review is saved to **Portfolio**. Patents and publications are two lists. Each list has its own count, New badge, and view filter.

A row added in the last 7 days shows **New** until you open it, or until you click **Mark all seen**. If any new rows are waiting, that list opens on **New**. Otherwise it opens on **Active**.

Opening a case does not run the review again. **Re-evaluate**, on the case, is what replaces a patent review. The saved time it was added to the Portfolio stays.

**Archive** hides a case from the main list and from the counts. It does not delete the review. Choose Archived or All to see it again. **Restore** puts it back.

On a patent case, **Add pilot sites** or **Refresh pilot sites** updates only that section. It does not run the whole review again. While it runs, the sites already on the page stay visible. If the case is No real market, the button does not start a new search. It keeps the note that a pilot is not a good next step.

Patents in the list sort by score, highest first, then by South Carolina fit.

### 5. The publications path

A paper is not graded like a patent. On Publications, filter by the quick score, pick up to five papers, and click **Review selected**. While that runs, the row stays on the list and says it is being reviewed. A paper you already reviewed opens the saved review. **Re-review selected** is what replaces it.

The full paper review produces a **Venture Readiness** score from 0 to 100. The AI only pulls facts from the saved title and summary. The app adds the points. The parts are:

- What is new: up to 20
- How far along it is: up to 15
- Whether it can be protected: up to 20
- Who needs it: up to 20
- The path to a product: up to 10
- Signs of a founding team: up to 10
- Fit with South Carolina: up to 5 (5 at 70 or higher, 3 at 55 or higher, 1 if any industry matched)

The bands are:

- **75 to 100: Ready to pursue**
- **55 to 74: Promising, lower the risk first**
- **35 to 54: Early research**
- **Below 35: Not ready to sell**

The recommended next step is one of these: **File with CURF now**, **Look at a startup**, **Ask for early funding**, **Find a company partner**, **License the know-how**, or **Check back later**.

The **filing clock** counts one year from the publication date. That is the US window people often use before a public paper makes a later US filing harder. The labels are:

- **Not published yet**
- **US filing window only. Other countries are likely closed.** This is the amber window, while days are still left in that year.
- **Too late to file in the US.** The year has passed.
- **Publication date unknown.** There is no exact date, so the clock is not guessed from a year in a link.

This is not legal advice. Check with CURF or a patent lawyer.

A paper does not fail just because fewer than three buyers are named. Buyer names and pilot sites are still looked up. They are extra information. They do not decide the Venture Readiness score. Papers do not use the patent score out of 15.

The paper review is stored with the patent reviews, and it shows on the Publications list in Portfolio. That list uses Rating, Score, and Filing clock instead of the patent columns.

### 6. Tools

**Tools** sits beside the main path.

**Specific patent search** looks through the list already loaded on Triage. Search by patent or application number, or by words in the title and summary. If Triage is still showing the Aug 29, 2026 list, the search stays inside that list. A patent you already reviewed opens that review.

**Problem match** is the box at the top of Tools. You describe a problem the way a company would say it. The app checks a recent slice of the Clemson list, then looks at the wider field. If a company wrote the problem, treat it as private. Do not paste it unless they said you may share it this way. The text is sent to the AI and to a public web search.

**Submit patents** is for a case that is not on the scanned list. You can drop a text or PDF file, or paste a title and text. The review starts from there. Word files need to be saved as PDF or text first.

## What happens behind the scenes

This section is for people who maintain the app. Staff do not need it to use the pages above.

The browser never holds the API keys. It calls `/api/...` routes in `netlify.toml`, which Netlify serves from `netlify/functions`. Shared storage is Supabase, reached with the service role key from those functions. The browser also keeps a copy in `localStorage` under `curf_docket_evaluated_patent_ids` and `curf_docket_patent_records`, so one browser still works when shared storage is off.

### Scan for patents

The button sends `POST /api/discover-patents-background`. That starts `netlify/functions/discover-patents-background.js`, which calls `runDiscoveryScan` in `netlify/lib/discover-patents.js`. The page then polls `GET /api/discover-patents`. The GET only reads what was saved. It does not call Google or the USPTO.

Google is a BigQuery query on `patents-public-data.patents.publications`: US rows whose assignee name contains "clemson", newest first, up to 8,000 rows. The USPTO Open Data Portal runs only when `USPTO_ODP_API_KEY` is set, up to 2,000 rows. If that key is missing, the Google rows still save, and the scan record says the USPTO step was skipped.

Rows are written to `discovered_patents`, one row per document (`patent_key`). The same document from both sources keeps one key and stores both source names. An application and its later grant stay on separate keys. Each run is written to `discovery_scan_runs`.

The Aug 29, 2026 list is `KNOWN_CLEMSON_PATENTS` inside `public/index.html`. It is used when shared storage is off, or when someone clicks **Show the Aug 29, 2026 list**.

### Scan for papers

The button sends `POST /api/run-publication-scan-background` (`run-publication-scan-background.js`, up to 15 minutes, `scoreLimit` 24). `GET /api/run-publication-scan` only lists saved findings. `weekly-publication-scan.js` is the scheduled run. It has no public URL, a 30 second limit, and a smaller scoring batch.

The work lives in `netlify/lib/publication-watch-lib.js`. Findings go to `publication_watch`. Each run goes to `publication_scan_runs`. Sources are the Clemson news RSS feed, PubMed (affiliation Clemson), OpenAlex (Clemson ROR `037s24f05`), and arXiv. Crossref is not used. The window is 120 days.

The quick commercial score uses `claude-haiku-5-5` with no web search. If scoring fails, the row is still stored as `UNSCORED`. A finding scored `HIGH` that has not been alerted is emailed through `send-email.js` when `RESEND_API_KEY` and `CURF_ALERT_EMAIL` are set. A later scan does not send a second email for that row.

### Quick rank and South Carolina fit

**Rank patents with no rank yet** sends the patents already on the page to `POST /api/triage-patents-background`. The page polls `GET /api/triage-patents`. The rank function does not call BigQuery again.

Rows are stored in `patent_triage` (`patent_id`, tier, reason, confidence, signals, and the South Carolina columns). A `patent_id` that is already in that table is skipped, so a second click does not send it again. Batches are 12. The rank call uses `claude-haiku-5-5`, no web search. Create the table with `supabase-triage.sql` before the first rank.

South Carolina fit is computed in `public/sc-investment.js` (browser, `window.CURF_SC`) and `netlify/lib/sc-investment.js` (server). The two files carry the same rules. `supabase-sc-investment.sql` loads a reference table. The app still scores from the JavaScript files if that table is missing. Volume is log-scaled against 521 deals and tops out at 40. Recency is the share of deals in 2025 or 2026 so far and tops out at 25. A focus area adds 40. Prompts receive industry group names only, not investor names and not the dollar table.

On a new patent review, fit of 70 or higher adds 2 points to the value score, and 55 or higher adds 1. Those points are frozen on `evaluation.value_score_snapshot`. Letter lines stay at 10, 7, and 4 out of 15.

### Full review

The browser builds the prompts and posts them to `POST /api/evaluate-patent` (`evaluate-patent.js`). The function holds `ANTHROPIC_API_KEY`. Search limits are fixed in that function. The browser can only ask for search on or off.

A patent is three calls:

1. Core read, search off. Any buyer list the core call returns is dropped before it is saved.
2. `task: "licensing_targets"`. Schema and prompt: `netlify/lib/licensing-targets.js`. Web search is on, `max_uses` 3. Names are kept only when they have a real name, a type, and a reason. Fewer than 3 destinations sets `licensing_recommendation` to `hard pass`. The page shows that as **No real market**. The stored reason text still begins with the words the normalizer writes. The page rewrites that sentence when it renders. Weak or no demand, or a path of `NO_DEMAND`, sets the same `hard pass` and skips the buyer search.
3. `task: "pilot_targets"`, only when the case is not a hard pass and the buyer list finished. Schema and prompt: `netlify/lib/pilot-targets.js`. Web search is on, `max_uses` 3. A prior pilot with no link is dropped. A target with no `http` or `https` link is kept, sorted last, and shown as **No proof link**. The search is instructed to emit the stored phrase "No verified prior pilot found" when no public page was found. Do not change that phrase in the prompt. The page translates it.

The value score is computed in the page from the review, not chosen by the AI, and stored on `evaluation.value_score_snapshot`. The sentences on the panel come from `public/value-score-copy.js` (`window.CURF_VALUE`). Breakdown labels must keep their prefixes (`Market demand`, `Technology readiness`, `Adoption risk`, `Clear monetization path`, licensee or acquirer, `Confirmed inventor`, `SC investment alignment`) so an older saved score still parses. The score version stored with a review is `EVALUATION_SCHEMA_VERSION` (`v3` in the current page).

The full record is saved with `POST /api/evaluated-patents` into `evaluated_patents` (`patent_id`, `record_json`, `evaluated_at`, `portfolio_added_at`, `portfolio_seen_at`). There is no separate table for buyers or pilot sites. They live inside `record_json.evaluation`.

**Add pilot sites** and **Refresh pilot sites** call `POST /api/generate-pilot-targets`. That function does not call the AI. A hard pass is saved as not recommended with no search. Any other case is marked pending on `record_json.evaluation.pilot_job` and handed to `generate-pilot-targets-background.js` (up to 15 minutes). The page polls `GET /api/generate-pilot-targets?patent_id=`. A pending or error state does not clear `pilot_targets` that are already stored. A missing buyer list is not treated as No real market when demand is moderate and the path is license or needs more work. That case can still get a pilot search from this button.

**What already exists** and the Tools problem match both post to `POST /api/solve-problem`. Outreach drafts post to `/api/evaluate-patent` with search off.

### Portfolio

Portfolio reads `evaluated_patents`. Patents and publications are split in the page by `recordType` or `portfolioKind` equal to `publication` (compared in lower case). There is no second portfolio table.

`portfolio_added_at` and `portfolio_seen_at` come from `supabase-portfolio-new.sql`. A row is New when it was added in the last 7 days (`PORTFOLIO_NEW_MS`) and `portfolio_seen_at` is empty. If any New rows exist for that list, the view starts on New. Otherwise it starts on Active. Opening a case, or **Mark all seen**, writes `portfolio_seen_at`. A later save of the same `patent_id` keeps the original `portfolio_added_at` and `portfolio_seen_at`.

Archive is a flag on the stored record. It hides the row from the active counts. It does not delete the row.

### Publications review

**Review selected** uses the same `/api/evaluate-patent` route, in this order:

1. `task: "publication_evidence"`, search off. The AI returns evidence fields only.
2. `licensing_targets`, search on. The result is stored with `licensing_recommendation` set to `informational`, and `hard_pass_reason` cleared. Fewer than three names does not fail the paper.
3. `pilot_targets`, search on. `pilot_recommendation` is `optional` when the list is empty, and `pursue` when it has sites.

Points, band, path, advice, and the filing flag are computed in `netlify/lib/venture-readiness.js`. The browser copy is `public/venture-readiness.js` (`window.CURF_VENTURE`). Regenerate that file from the library. Do not hand-edit the two copies apart. A point total returned by the AI is ignored. The stored shape is `evaluation.venture_readiness` with schema `publication-venture-v1`. The page recomputes the band, path, and filing flag from the stored evidence plus today's UTC date, so the one-year clock moves without a new review.

The clock date is the publication date plus one year, in UTC. Days left at 0 or more is the amber label. Days left below 0 is the red label. No exact date, and not marked unpublished, is the unknown label. `publication_watch` has no published-date column. Do not invent a date from a year in a DOI.

The scored paper is written to `evaluated_patents` through `/api/evaluated-patents`, the same table as patents. The scan row stays in `publication_watch`. `review-publications.js` exists at `/api/review-publications`. The page review flow calls `/api/evaluate-patent` with the three tasks above.

### Tools

Number and keyword search run in the browser against the Triage list already in memory (`registryAll`). They do not call a server route.

Problem match posts the text to `POST /api/solve-problem` (`solve-problem.js`), which uses web search. It checks a capped recent slice of the catalog, then the wider field.

## Tests

`npm test` runs the Node test files. They lock button labels, the No real market wording on the page, the pilot prompt phrase, the Portfolio New rules, and the Venture Readiness math. Change a visible sentence only when you also update the test that quotes it.

# Deploying the CURF Docket app for real

This folder has five pieces:

- `index.html`, the app itself (this is the file the browser loads at the site's root by default, no redirect rule needed)
- `netlify/functions/evaluate-patent.js`, the server side proxy that holds the Anthropic API key
- `netlify/functions/fetch-clemson-patents.js`, the server side proxy that queries the USPTO PatentsView API for real Clemson assigned patents
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
3. Request a free PatentsView API key (see the comments at the top of `netlify/functions/fetch-clemson-patents.js` for the current process) and set it as a second Netlify environment variable, `PATENTSVIEW_API_KEY`. This one is not privacy sensitive, PatentsView is public government data, but it still should not be hardcoded into a file.
4. Deploy the site.
5. Open `index.html`, find the line `const USE_BACKEND_PROXY = false;`, and change it to `true`. Redeploy.
6. Confirm the app is now calling `/api/evaluate-patent` (same origin, no CORS issue) instead of calling Anthropic directly from the browser. The Clemson Registry tab calls `/api/clemson-patents` automatically, no toggle needed there, it simply will not return results until the function and its key are live.

## What this does and does not solve

This proxy keeps the API key out of the browser and makes the traffic eligible to sit behind a Zero Data Retention arrangement. It does not, by itself, grant that arrangement, redact sensitive fields, or make the decision about which patents are sensitive enough to withhold from the pipeline entirely. Those are policy decisions for CURF, not something this file can decide for you.

// netlify/functions/fetch-clemson-patents.js
//
// Pulls US patents and published applications naming Clemson as an
// assignee from Google's "Google Patents Public Data" dataset on
// BigQuery, sorted most recent first. This is a comprehensive,
// continuously updated historical dataset, not a hand curated snapshot,
// so it does not have the "only 20 patents" ceiling the earlier version
// of this file had.
//
// WHY BIGQUERY INSTEAD OF SCRAPING GOOGLE PATENTS DIRECTLY: same reason
// as before, no public bulk query API on patents.google.com itself, a
// browser call to it would be blocked by CORS, and scraping it at
// volume sits outside Google's terms of service. This dataset is
// Google's own sanctioned, structured export of the same underlying
// data, published specifically for this kind of programmatic query,
// documented at https://github.com/google/patents-public-data.
//
// EVERY FIELD NAME AND ENDPOINT BELOW WAS CHECKED AGAINST GOOGLE'S
// CURRENT OFFICIAL DOCUMENTATION before writing this, not guessed:
//   - Table and field names (title_localized, abstract_localized,
//     assignee_harmonized, inventor_harmonized, cpc, publication_date,
//     filing_date) come from the dataset's own schema documentation and
//     IFI CLAIMS' published usage examples.
//   - The query endpoint (POST .../bigquery/v2/projects/{id}/queries)
//     and its response shape come from Google Cloud's own current API
//     reference for jobs.query.
// What was NOT independently verified end to end: an actual live test
// call. If BigQuery rejects a field name that has since changed, the
// error response passed through below will name it directly, check
// that field against the schema tab for patents-public-data.patents
// .publications in the BigQuery console before assuming the query
// logic itself is wrong.
//
// SETUP REQUIRED (see DEPLOYMENT.md for the full walkthrough):
//   1. A Google Cloud project with the BigQuery API enabled and a
//      billing account attached. Querying this public dataset is
//      typically covered by BigQuery's free monthly processing tier,
//      but a project still needs to exist and have billing enabled to
//      run any query at all, that is a Google requirement, not a cost
//      Clemson is likely to actually incur.
//   2. A service account in that project with the "BigQuery Job User"
//      role, and a downloaded JSON key for it.
//   3. That JSON key's file contents, base64 encoded, set as the
//      GCP_SERVICE_ACCOUNT_KEY_BASE64 environment variable in Netlify.
//   4. The Google Cloud project ID set as GCP_PROJECT_ID in Netlify.
//
// This deliberately uses only Node's built in crypto module for the
// service account JWT signing, rather than adding an npm dependency
// like google-auth-library. A drag and drop Netlify deploy (as this
// project has been using) does not run npm install, so an added
// dependency would not be present in node_modules and the function
// would fail to bundle. Built in modules avoid that failure mode
// entirely.

import { createSign } from "crypto";

const BIGQUERY_SQL = `
SELECT
  p.publication_number AS publication_number,
  p.country_code AS country_code,
  p.kind_code AS kind_code,
  CAST(p.publication_date AS STRING) AS publication_date,
  CAST(p.filing_date AS STRING) AS filing_date,
  (SELECT text FROM UNNEST(p.title_localized) WHERE language = 'en' LIMIT 1) AS title,
  (SELECT text FROM UNNEST(p.abstract_localized) WHERE language = 'en' LIMIT 1) AS abstract,
  ARRAY(SELECT name FROM UNNEST(p.assignee_harmonized)) AS assignees,
  ARRAY(SELECT name FROM UNNEST(p.inventor_harmonized)) AS inventors,
  ARRAY(SELECT code FROM UNNEST(p.cpc)) AS cpc_codes,
  CAST(p.family_id AS STRING) AS family_id,
  ARRAY_LENGTH(p.citation) AS backward_citation_count
FROM \`patents-public-data.patents.publications\` AS p,
UNNEST(p.assignee_harmonized) AS a
WHERE LOWER(a.name) LIKE '%clemson%'
  AND p.country_code = 'US'
ORDER BY p.publication_date DESC
LIMIT 300
`;

function base64url(input){
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function signServiceAccountJwt(clientEmail, privateKey){
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/bigquery.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };
  const signingInput = base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(claims));
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey);
  const encodedSignature = signature.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return signingInput + "." + encodedSignature;
}

async function getAccessToken(clientEmail, privateKey){
  const jwt = signServiceAccountJwt(clientEmail, privateKey);
  const body = "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + encodeURIComponent(jwt);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body
  });
  const data = await res.json();
  if(!res.ok || !data.access_token){
    throw { step: "token_exchange", status: res.status, body: data };
  }
  return data.access_token;
}

function parseBigQueryRows(result){
  const fields = (result.schema && result.schema.fields) || [];
  const rows = result.rows || [];
  return rows.map(row => {
    const obj = {};
    (row.f || []).forEach((cell, i) => {
      const field = fields[i] || {};
      if(field.mode === "REPEATED"){
        obj[field.name] = (cell.v || []).map(item => item.v);
      } else {
        obj[field.name] = cell.v;
      }
    });
    return obj;
  });
}

export default async (req, context) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  const projectId = process.env.GCP_PROJECT_ID;
  const keyBase64 = process.env.GCP_SERVICE_ACCOUNT_KEY_BASE64;

  if (!projectId || !keyBase64) {
    return new Response(JSON.stringify({
      error: "Server is missing GCP_PROJECT_ID and/or GCP_SERVICE_ACCOUNT_KEY_BASE64. See the comments at the top of this file and DEPLOYMENT.md for setup steps, then set both in Netlify site environment variables."
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  let serviceAccount;
  try {
    const decoded = Buffer.from(keyBase64, "base64").toString("utf-8");
    serviceAccount = JSON.parse(decoded);
  } catch (err) {
    return new Response(JSON.stringify({
      error: "GCP_SERVICE_ACCOUNT_KEY_BASE64 could not be decoded as base64 JSON. Re-check how it was encoded."
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  try {
    const accessToken = await getAccessToken(serviceAccount.client_email, serviceAccount.private_key);

    const bqRes = await fetch("https://bigquery.googleapis.com/bigquery/v2/projects/" + encodeURIComponent(projectId) + "/queries", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + accessToken
      },
      body: JSON.stringify({
        query: BIGQUERY_SQL,
        useLegacySql: false,
        timeoutMs: 30000
      })
    });
    const bqData = await bqRes.json();

    if (!bqRes.ok) {
      return new Response(JSON.stringify({
        error: "BigQuery rejected the query. See raw_response for exactly what it said, that will name the specific field or permission problem rather than requiring another guess.",
        raw_response: bqData
      }), { status: bqRes.status, headers: { "Content-Type": "application/json" } });
    }

    const rows = parseBigQueryRows(bqData);
    const patents = rows.map(r => ({
      patent_id: r.publication_number,
      title: r.title || "Untitled",
      date: formatBqDate(r.publication_date),
      filing_date: formatBqDate(r.filing_date),
      kind_code: r.kind_code || "",
      abstract: r.abstract || "",
      assignees: r.assignees || [],
      inventors: r.inventors || [],
      cpc_codes: r.cpc_codes || [],
      family_id: r.family_id || null,
      backward_citation_count: (typeof r.backward_citation_count === "number") ? r.backward_citation_count : (r.backward_citation_count ? Number(r.backward_citation_count) : null),
      record_type: (r.kind_code || "").startsWith("A") ? "Application" : "Grant",
      google_patents_url: r.publication_number ? ("https://patents.google.com/patent/" + r.publication_number.replace(/-/g, "")) : null
    }));

    return new Response(JSON.stringify({
      patents: patents,
      source: "Google Patents Public Data (BigQuery)",
      total_rows_in_full_result: bqData.totalRows,
      queried_at: new Date().toISOString()
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    if (err && err.step === "token_exchange") {
      return new Response(JSON.stringify({
        error: "Could not exchange the service account key for a Google access token. This usually means the service account key or its permissions are wrong, not a bug in this function's query logic.",
        raw_response: err.body
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "Unexpected error contacting BigQuery", detail: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
};

function formatBqDate(yyyymmdd){
  if(!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd || "";
  return yyyymmdd.slice(0,4) + "-" + yyyymmdd.slice(4,6) + "-" + yyyymmdd.slice(6,8);
}

// NOTE: deliberately not using `export const config = { path: ... }` here,
// see the comment in evaluate-patent.js for why. This function relies on
// Netlify's default URL, /.netlify/functions/fetch-clemson-patents,
// mapped to /api/clemson-patents by a plain redirect in netlify.toml.

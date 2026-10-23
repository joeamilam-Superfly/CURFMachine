// Discover Clemson patents from Google Patents Public Data and the
// USPTO Open Data Portal, then store one row per document.
//
// The same publication found in both sources keeps one patent_key and
// records both names in sources. An application and its later grant
// stay separate, because they are different documents.
//
// USPTO_ODP_API_KEY is optional. When it is missing, the Google scan
// still runs and the scan row says USPTO was skipped.

import { createSign } from "crypto";

const TABLE = "discovered_patents";
const RUNS = "discovery_scan_runs";
const MAX_GOOGLE_ROWS = 8000;
const MAX_USPTO_ROWS = 2000;
const USPTO_PAGE = 100;

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
  ARRAY(SELECT code FROM UNNEST(p.cpc) LIMIT 12) AS cpc_codes,
  CAST(p.family_id AS STRING) AS family_id,
  ARRAY_LENGTH(p.citation) AS backward_citation_count
FROM \`patents-public-data.patents.publications\` AS p,
UNNEST(p.assignee_harmonized) AS a
WHERE LOWER(a.name) LIKE '%clemson%'
  AND p.country_code = 'US'
ORDER BY p.publication_date DESC
`;

export function normalizePatentKey(id){
  if(!id) return "";
  let s = String(id).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if(s.startsWith("us")) s = s.slice(2);
  const stripped = s.replace(/[abpseh]\d?$/, "");
  if(stripped !== s && /\d/.test(stripped)) s = stripped;
  return s;
}

function clip(value, max){
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function headers(apiKey){
  return {
    apikey: apiKey,
    Authorization: "Bearer " + apiKey,
    "Content-Type": "application/json"
  };
}

async function supabaseFetch(supabaseUrl, supabaseKey, path, options){
  const res = await fetch(supabaseUrl + "/rest/v1/" + path, {
    ...options,
    headers: { ...headers(supabaseKey), ...(options && options.headers) }
  });
  const text = await res.text();
  let data = null;
  if(text){
    try { data = JSON.parse(text); }
    catch (err) { data = { message: text.slice(0, 300) }; }
  }
  return { ok: res.ok, status: res.status, data, text };
}

function missingTable(result, name){
  const blob = (result.text || "") + JSON.stringify(result.data || {});
  return blob.indexOf(name) !== -1 || (result.data && result.data.code === "PGRST205");
}

function base64url(input){
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
    body
  });
  const data = await res.json();
  if(!res.ok || !data.access_token) throw { step: "token_exchange", status: res.status, body: data };
  return data.access_token;
}

function parseBigQueryRows(result){
  const fields = (result.schema && result.schema.fields) || [];
  const rows = result.rows || [];
  return rows.map(row => {
    const obj = {};
    (row.f || []).forEach((cell, i) => {
      const field = fields[i] || {};
      if(field.mode === "REPEATED") obj[field.name] = (cell.v || []).map(item => item.v);
      else obj[field.name] = cell.v;
    });
    return obj;
  });
}

function formatBqDate(yyyymmdd){
  if(!yyyymmdd || String(yyyymmdd).length !== 8) return yyyymmdd || null;
  const value = String(yyyymmdd);
  return value.slice(0, 4) + "-" + value.slice(4, 6) + "-" + value.slice(6, 8);
}

function fromGoogle(row){
  const patentId = row.publication_number || "";
  const key = normalizePatentKey(patentId);
  if(!key) return null;
  const kind = row.kind_code || "";
  return {
    patent_key: key,
    patent_id: patentId,
    title: clip(row.title || "Untitled", 500),
    abstract: clip(row.abstract || "", 1500),
    publication_date: formatBqDate(row.publication_date),
    filing_date: formatBqDate(row.filing_date),
    kind_code: kind || null,
    record_type: kind.startsWith("A") ? "Application" : "Grant",
    assignees: Array.isArray(row.assignees) ? row.assignees.filter(Boolean).slice(0, 8) : [],
    inventors: Array.isArray(row.inventors) ? row.inventors.filter(Boolean).slice(0, 12) : [],
    cpc_codes: Array.isArray(row.cpc_codes) ? row.cpc_codes.filter(Boolean).slice(0, 12) : [],
    family_id: row.family_id || null,
    backward_citation_count: row.backward_citation_count == null || row.backward_citation_count === "" ? null : Number(row.backward_citation_count),
    sources: ["google_patents"],
    google_patents_url: "https://patents.google.com/patent/" + String(patentId).replace(/-/g, ""),
    uspto_url: null
  };
}

async function fetchGoogle(projectId, keyBase64){
  const decoded = Buffer.from(keyBase64, "base64").toString("utf-8");
  const serviceAccount = JSON.parse(decoded);
  const accessToken = await getAccessToken(serviceAccount.client_email, serviceAccount.private_key);
  const queryUrl = "https://bigquery.googleapis.com/bigquery/v2/projects/" + encodeURIComponent(projectId) + "/queries";
  let res = await fetch(queryUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
    body: JSON.stringify({ query: BIGQUERY_SQL, useLegacySql: false, timeoutMs: 55000, maxResults: 1000 })
  });
  let data = await res.json();
  if(!res.ok) throw { step: "bigquery", status: res.status, body: data };
  const jobId = data.jobReference && data.jobReference.jobId;
  const location = data.jobReference && data.jobReference.location;
  const rows = [];
  let guard = 0;
  while(guard < 20 && rows.length < MAX_GOOGLE_ROWS){
    guard += 1;
    if(data.jobComplete === false){
      await new Promise(resolve => setTimeout(resolve, 2000));
      const pollUrl = queryUrl + "/" + encodeURIComponent(jobId) + "?timeoutMs=20000&maxResults=1000" + (location ? "&location=" + encodeURIComponent(location) : "");
      res = await fetch(pollUrl, { headers: { Authorization: "Bearer " + accessToken } });
      data = await res.json();
      if(!res.ok) throw { step: "bigquery_poll", status: res.status, body: data };
      continue;
    }
    rows.push(...parseBigQueryRows(data));
    if(!data.pageToken || rows.length >= MAX_GOOGLE_ROWS) break;
    const pageUrl = queryUrl + "/" + encodeURIComponent(jobId) + "?maxResults=1000&pageToken=" + encodeURIComponent(data.pageToken) + (location ? "&location=" + encodeURIComponent(location) : "");
    res = await fetch(pageUrl, { headers: { Authorization: "Bearer " + accessToken } });
    data = await res.json();
    if(!res.ok) throw { step: "bigquery_page", status: res.status, body: data };
  }
  const hits = [];
  const seen = new Set();
  rows.slice(0, MAX_GOOGLE_ROWS).forEach(row => {
    const hit = fromGoogle(row);
    if(!hit || seen.has(hit.patent_key)) return;
    seen.add(hit.patent_key);
    hits.push(hit);
  });
  return hits;
}

function namesFromUspto(meta){
  const assignees = [];
  (meta.assigneeBag || []).forEach(item => {
    if(item && item.assigneeNameText) assignees.push(item.assigneeNameText);
  });
  (meta.applicantBag || []).forEach(item => {
    if(item && item.applicantNameText) assignees.push(item.applicantNameText);
  });
  if(meta.firstApplicantName) assignees.push(meta.firstApplicantName);
  return Array.from(new Set(assignees)).slice(0, 8);
}

function fromUspto(wrapper){
  const meta = (wrapper && wrapper.applicationMetaData) || wrapper || {};
  const applicationNumber = wrapper.applicationNumberText || meta.applicationNumberText || "";
  const patentNumber = meta.patentNumber || "";
  const publicationNumber = meta.earliestPublicationNumber || "";
  const displayId = patentNumber || publicationNumber || applicationNumber;
  const key = normalizePatentKey(patentNumber || publicationNumber || applicationNumber);
  if(!key) return null;
  const inventors = (meta.inventorBag || []).map(item => item && (item.inventorNameText || [item.firstName, item.lastName].filter(Boolean).join(" "))).filter(Boolean).slice(0, 12);
  return {
    patent_key: key,
    patent_id: displayId,
    title: clip(meta.inventionTitle || "Untitled", 500),
    abstract: "",
    publication_date: meta.grantDate || meta.earliestPublicationDate || null,
    filing_date: meta.filingDate || null,
    kind_code: patentNumber ? "B" : "A",
    record_type: patentNumber ? "Grant" : "Application",
    assignees: namesFromUspto(meta),
    inventors,
    cpc_codes: [],
    family_id: null,
    backward_citation_count: null,
    sources: ["uspto"],
    google_patents_url: displayId ? ("https://patents.google.com/patent/US" + String(displayId).replace(/[^0-9A-Za-z]/g, "")) : null,
    uspto_url: applicationNumber ? ("https://patentcenter.uspto.gov/applications/" + applicationNumber) : null
  };
}

function mentionsClemson(hit){
  const blob = [hit.title].concat(hit.assignees || []).join(" ").toLowerCase();
  return blob.indexOf("clemson") !== -1;
}

async function fetchUspto(apiKey){
  const hits = [];
  const seen = new Set();
  let offset = 0;
  let total = null;
  const queries = [
    "applicationMetaData.firstApplicantName:*Clemson* OR applicationMetaData.assigneeBag.assigneeNameText:*Clemson*",
    "applicationMetaData.firstApplicantName:*Clemson*"
  ];
  let lastError = null;
  for(const q of queries){
    hits.length = 0;
    seen.clear();
    offset = 0;
    total = null;
    lastError = null;
    let pages = 0;
    while(hits.length < MAX_USPTO_ROWS && pages < 25){
      pages += 1;
      const res = await fetch("https://api.uspto.gov/api/v1/patent/applications/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-API-KEY": apiKey },
        body: JSON.stringify({ q, pagination: { offset, limit: USPTO_PAGE } })
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok){
        lastError = "USPTO search returned " + res.status + ".";
        break;
      }
      const bag = Array.isArray(data.patentFileWrapperDataBag) ? data.patentFileWrapperDataBag : [];
      if(total == null && typeof data.count === "number") total = data.count;
      bag.forEach(wrapper => {
        const hit = fromUspto(wrapper);
        if(!hit || seen.has(hit.patent_key)) return;
        seen.add(hit.patent_key);
        hits.push(hit);
      });
      if(bag.length < USPTO_PAGE) break;
      offset += USPTO_PAGE;
      if(total != null && offset >= total) break;
    }
    if(!lastError && hits.length) break;
  }
  if(hits.length === 0) throw new Error(lastError || "USPTO search returned no Clemson records.");
  const sample = hits.slice(0, 8);
  if(sample.length && !sample.some(mentionsClemson)){
    throw new Error("USPTO returned records that do not name Clemson. Those rows were not stored.");
  }
  return hits.filter(mentionsClemson);
}

function mergeHit(prev, next){
  const base = prev || {};
  const longerAbstract = (next.abstract || "").length > (base.abstract || "").length ? next.abstract : (base.abstract || next.abstract || "");
  const sources = Array.from(new Set([].concat(base.sources || [], next.sources || [])));
  return {
    patent_key: next.patent_key || base.patent_key,
    patent_id: next.patent_id || base.patent_id,
    title: next.title || base.title || "Untitled",
    abstract: longerAbstract,
    publication_date: next.publication_date || base.publication_date || null,
    filing_date: next.filing_date || base.filing_date || null,
    kind_code: next.kind_code || base.kind_code || null,
    record_type: next.record_type || base.record_type || null,
    assignees: (next.assignees && next.assignees.length) ? next.assignees : (base.assignees || []),
    inventors: (next.inventors && next.inventors.length) ? next.inventors : (base.inventors || []),
    cpc_codes: (next.cpc_codes && next.cpc_codes.length) ? next.cpc_codes : (base.cpc_codes || []),
    family_id: next.family_id || base.family_id || null,
    backward_citation_count: next.backward_citation_count != null ? next.backward_citation_count : (base.backward_citation_count ?? null),
    sources,
    google_patents_url: next.google_patents_url || base.google_patents_url || null,
    uspto_url: next.uspto_url || base.uspto_url || null,
    first_seen_at: base.first_seen_at || new Date().toISOString(),
    last_seen_at: new Date().toISOString()
  };
}

async function readExisting(supabaseUrl, supabaseKey){
  const map = new Map();
  let offset = 0;
  while(offset < 8000){
    const result = await supabaseFetch(
      supabaseUrl,
      supabaseKey,
      TABLE + "?select=patent_key,patent_id,title,abstract,publication_date,filing_date,kind_code,record_type,assignees,inventors,cpc_codes,family_id,backward_citation_count,sources,google_patents_url,uspto_url,first_seen_at&order=patent_key.asc&limit=1000&offset=" + offset,
      { method: "GET" }
    );
    if(!result.ok){
      if(missingTable(result, TABLE)) throw { missing: true };
      throw new Error("Could not read discovered_patents (" + result.status + ").");
    }
    const rows = Array.isArray(result.data) ? result.data : [];
    rows.forEach(row => { if(row && row.patent_key) map.set(row.patent_key, row); });
    if(rows.length < 1000) break;
    offset += 1000;
  }
  return map;
}

async function upsertBatches(supabaseUrl, supabaseKey, rows){
  for(let i = 0; i < rows.length; i += 200){
    const batch = rows.slice(i, i + 200);
    const result = await supabaseFetch(supabaseUrl, supabaseKey, TABLE, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(batch)
    });
    if(!result.ok){
      if(missingTable(result, TABLE)) throw { missing: true };
      throw new Error("Could not store discovered patents (" + result.status + ").");
    }
  }
}

async function insertRun(supabaseUrl, supabaseKey){
  const result = await supabaseFetch(supabaseUrl, supabaseKey, RUNS, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{ status: "running" }])
  });
  if(!result.ok){
    if(missingTable(result, RUNS)) throw { missing: true };
    throw new Error("Could not start a discovery scan row (" + result.status + ").");
  }
  const created = Array.isArray(result.data) ? result.data[0] : null;
  return created && created.id;
}

async function finishRun(supabaseUrl, supabaseKey, id, fields){
  if(!id) return;
  await supabaseFetch(supabaseUrl, supabaseKey, RUNS + "?id=eq." + encodeURIComponent(id), {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...fields, finished_at: new Date().toISOString() })
  });
}

export async function runDiscoveryScan(){
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if(!supabaseUrl || !supabaseKey){
    console.log("discover-patents: SUPABASE_URL or SUPABASE_SERVICE_KEY is not set");
    return { ok: false, error: "SUPABASE_URL or SUPABASE_SERVICE_KEY is not set." };
  }
  let runId = null;
  try {
    runId = await insertRun(supabaseUrl, supabaseKey);
  } catch (err) {
    if(err && err.missing){
      console.log("discover-patents: run supabase-workflow.sql");
      return { ok: false, error: "Run supabase-workflow.sql in the Supabase SQL editor before scanning." };
    }
    throw err;
  }

  const detail = { google_error: null, uspto_error: null };
  let googleHits = [];
  let usptoHits = [];
  const projectId = process.env.GCP_PROJECT_ID;
  const keyBase64 = process.env.GCP_SERVICE_ACCOUNT_KEY_BASE64;
  if(!projectId || !keyBase64){
    detail.google_error = "GCP_PROJECT_ID or GCP_SERVICE_ACCOUNT_KEY_BASE64 is not set.";
  } else {
    try {
      googleHits = await fetchGoogle(projectId, keyBase64);
    } catch (err) {
      detail.google_error = err && err.step === "token_exchange"
        ? "Google credentials were rejected."
        : clip((err && err.message) || JSON.stringify(err && err.body ? err.body : err), 300);
    }
  }

  const usptoKey = process.env.USPTO_ODP_API_KEY;
  if(!usptoKey){
    detail.uspto_error = "USPTO_ODP_API_KEY is not set. Google Patents results are still stored.";
  } else {
    try {
      usptoHits = await fetchUspto(usptoKey);
    } catch (err) {
      detail.uspto_error = clip(err && err.message ? err.message : String(err), 300);
    }
  }

  try {
    const existing = await readExisting(supabaseUrl, supabaseKey);
    const merged = new Map();
    googleHits.concat(usptoHits).forEach(hit => {
      const prev = merged.get(hit.patent_key) || existing.get(hit.patent_key) || null;
      merged.set(hit.patent_key, mergeHit(prev, hit));
    });
    const rows = Array.from(merged.values());
    await upsertBatches(supabaseUrl, supabaseKey, rows);
    const bothFailed = googleHits.length === 0 && usptoHits.length === 0;
    const partial = !!(detail.google_error || detail.uspto_error);
    const status = bothFailed ? "error" : (partial ? "partial" : "ok");
    const error = bothFailed
      ? [detail.google_error, detail.uspto_error].filter(Boolean).join(" ")
      : null;
    await finishRun(supabaseUrl, supabaseKey, runId, {
      status,
      google_count: googleHits.length,
      uspto_count: usptoHits.length,
      stored_count: rows.length,
      error,
      detail
    });
    console.log("discover-patents stored " + rows.length + " status " + status);
    return { ok: status !== "error", stored: rows.length, status };
  } catch (err) {
    const message = err && err.missing
      ? "Run supabase-workflow.sql in the Supabase SQL editor before scanning."
      : clip(err && err.message ? err.message : String(err), 400);
    await finishRun(supabaseUrl, supabaseKey, runId, {
      status: "error",
      google_count: googleHits.length,
      uspto_count: usptoHits.length,
      stored_count: 0,
      error: message,
      detail
    });
    console.log("discover-patents failed " + message);
    return { ok: false, error: message };
  }
}

function toClientPatent(row){
  const sources = Array.isArray(row.sources) ? row.sources : [];
  return {
    patent_id: row.patent_id,
    patent_key: row.patent_key,
    title: row.title || "Untitled",
    abstract: row.abstract || "",
    date: row.publication_date || "",
    filing_date: row.filing_date || null,
    kind_code: row.kind_code || "",
    record_type: row.record_type || "",
    assignees: Array.isArray(row.assignees) ? row.assignees : [],
    inventors: Array.isArray(row.inventors) ? row.inventors : [],
    cpc_codes: Array.isArray(row.cpc_codes) ? row.cpc_codes : [],
    family_id: row.family_id || null,
    backward_citation_count: row.backward_citation_count,
    sources,
    google_patents_url: row.google_patents_url || null,
    uspto_url: row.uspto_url || null,
    first_seen_at: row.first_seen_at || null
  };
}

export async function readDiscoveredPatents(supabaseUrl, supabaseKey){
  const patents = [];
  let offset = 0;
  while(offset < 8000){
    const result = await supabaseFetch(
      supabaseUrl,
      supabaseKey,
      TABLE + "?select=*&order=publication_date.desc.nullslast&limit=1000&offset=" + offset,
      { method: "GET" }
    );
    if(!result.ok){
      if(missingTable(result, TABLE)){
        return {
          configured: true,
          patents: [],
          last_scan: null,
          error: "Run supabase-workflow.sql in the Supabase SQL editor. It creates the discovery tables and does not change evaluations already stored."
        };
      }
      return { configured: true, patents: [], last_scan: null, error: "Could not read discovered patents.", detail: result.data };
    }
    const rows = Array.isArray(result.data) ? result.data : [];
    rows.forEach(row => patents.push(toClientPatent(row)));
    if(rows.length < 1000) break;
    offset += 1000;
  }
  const scanResult = await supabaseFetch(
    supabaseUrl,
    supabaseKey,
    RUNS + "?select=*&order=started_at.desc&limit=1",
    { method: "GET" }
  );
  let lastScan = null;
  let scanLogError = null;
  if(scanResult.ok) lastScan = Array.isArray(scanResult.data) && scanResult.data[0] ? scanResult.data[0] : null;
  else if(missingTable(scanResult, RUNS)) scanLogError = "Scan history needs supabase-workflow.sql. Stored patents can still be read.";
  return { configured: true, patents, last_scan: lastScan, scan_log_error: scanLogError, error: null };
}

// Shared Publication Watch pipeline.
//
// Discovery is deterministic: Clemson news RSS, PubMed (affiliation
// Clemson), OpenAlex (Clemson University ROR 037s24f05), and arXiv.
// The model only scores commercial relevance. If scoring fails, the
// rows are still stored as UNSCORED.
//
// Crossref is not used to discover papers. Its affiliation search is a
// loose text match. It is used only to read a publication date for a
// DOI that another source already found.

const FINDINGS = "publication_watch";
const RUNS = "publication_scan_runs";
const TRIAGE_MODEL = "claude-haiku-5-5";
const ALERT_THRESHOLD = "HIGH";
const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeScanWindow(value){
  const key = String(value == null ? "" : value).trim().toLowerCase();
  if(key === "2" || key === "2y" || key === "two") return "2";
  if(key === "5" || key === "5y" || key === "five") return "5";
  if(key === "all" || key === "any") return "all";
  return "1";
}

function utcDay(value){
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function yearsBefore(day, years){
  return new Date(Date.UTC(day.getUTCFullYear() - years, day.getUTCMonth(), day.getUTCDate()));
}

export function isoDay(date){
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return date.getUTCFullYear() + "-" + month + "-" + day;
}

function slashDay(date){
  return isoDay(date).replace(/-/g, "/");
}

function arxivStamp(date){
  return isoDay(date).replace(/-/g, "") + "0000";
}

export function scanWindowStart(windowId, now){
  const id = normalizeScanWindow(windowId);
  const today = utcDay(now || new Date());
  if(id === "all") return { id, since: null };
  const years = id === "5" ? 5 : (id === "2" ? 2 : 1);
  return { id, since: yearsBefore(today, years) };
}

// Last 1 year is the recent band only. A longer choice also asks for a
// short list of papers older than 1 year, so the choice changes the
// results instead of repeating the newest page.
export function scanBands(windowId, now, options){
  const weekly = !!(options && options.weekly);
  const window = scanWindowStart(windowId, now);
  const oneYear = scanWindowStart("1", now).since;
  const recentLimit = weekly ? 12 : (window.id === "1" ? 25 : 15);
  const bands = [{ from: oneYear, to: null, limit: recentLimit }];
  if(!weekly && window.id !== "1"){
    const olderEnd = new Date(oneYear.getTime() - DAY_MS);
    bands.push({ from: window.since, to: olderEnd, limit: 10 });
  }
  return {
    id: window.id,
    since: window.since,
    newsLimit: 12,
    arxivRecent: weekly ? 8 : 12,
    bands
  };
}

export const WRONG_KEY_MESSAGE = "SUPABASE_SERVICE_KEY is not the service_role key. Reads then look empty and writes are rejected by row level security (Postgres 42501). In Supabase open Project Settings, API, and copy the service_role key, not the anon key, into that Netlify variable, then redeploy.";

const NEWS_KEEP = /research|professor|study|laboratory|\blab\b|scientist|patent|chemist|discovery|journal/i;
const NEWS_DROP = /voluntary separation|compliance and ethics|football|required training|training deadline/i;

export function jwtRole(apiKey){
  const parts = String(apiKey || "").split(".");
  if(parts.length < 2) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return json && json.role ? String(json.role) : null;
  } catch (err) {
    return null;
  }
}

function headers(apiKey){
  return { "apikey": apiKey, "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" };
}

function log(step, detail){
  const text = detail === undefined ? "" : (typeof detail === "string" ? detail : JSON.stringify(detail));
  console.log("publication-scan " + step + (text ? " " + text.slice(0, 700) : ""));
}

function clip(value, max){
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function decodeXml(value){
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tagText(block, name){
  const match = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
  return match ? decodeXml(match[1]) : "";
}

function withinWindow(dateValue, since){
  if(!since) return true;
  if(!dateValue) return true;
  const parsed = new Date(dateValue);
  if(Number.isNaN(parsed.getTime())) return true;
  return parsed >= since;
}

export function extractDoi(value){
  const match = String(value || "").match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  if(!match) return "";
  return match[0].replace(/[.)\],;]+$/, "");
}

function validIso(year, month, day){
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if(!y || !m || !d) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if(date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return isoDay(date);
}

export function fullCalendarDate(value){
  const text = String(value || "").trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if(match) return validIso(match[1], match[2], match[3]);
  match = /^(\d{4})[\/ ](\d{1,2})[\/ ](\d{1,2})\b/.exec(text);
  if(match) return validIso(match[1], match[2], match[3]);
  return null;
}

function datePartsToIso(block){
  const parts = block && Array.isArray(block["date-parts"]) ? block["date-parts"][0] : null;
  if(!Array.isArray(parts) || parts.length < 3) return null;
  return validIso(parts[0], parts[1], parts[2]);
}

export function earliestCrossrefDate(message){
  const dates = ["published-online", "published-print", "published", "issued"]
    .map(key => datePartsToIso(message && message[key]))
    .filter(Boolean)
    .sort();
  return dates[0] || null;
}

export function canonicalUrl(value){
  try {
    const url = new URL(String(value).trim());
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach(key => url.searchParams.delete(key));
    let text = url.toString();
    if(text.endsWith("/")) text = text.slice(0, -1);
    return text;
  } catch (err) {
    return String(value || "").trim();
  }
}

function doiKey(doi){
  if(!doi) return "";
  return String(doi).trim().toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "");
}

async function fetchText(url, timeoutMs){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "CURF-Docket/1.0",
        "Accept": "application/json, application/xml, text/xml, application/atom+xml, */*"
      }
    });
    const text = await res.text();
    log("http", res.status + " " + text.length + " bytes " + url.slice(0, 180));
    if(!res.ok){
      throw { step: "http", status: res.status, url, detail: text.slice(0, 240) };
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function parseRss(xml){
  return xml.split(/<item[\s>]/i).slice(1).map(chunk => {
    const body = chunk.split(/<\/item>/i)[0];
    const categories = Array.from(body.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)).map(match => decodeXml(match[1]));
    return {
      title: tagText(body, "title"),
      link: tagText(body, "link"),
      summary: tagText(body, "description"),
      categories,
      published: tagText(body, "pubDate")
    };
  }).filter(item => item.title && item.link);
}

function parseAtomEntries(xml){
  return xml.split(/<entry[\s>]/).slice(1).map(chunk => {
    const body = chunk.split(/<\/entry>/)[0];
    const affiliations = Array.from(body.matchAll(/<(?:arxiv:)?affiliation(?:\s[^>]*)?>([\s\S]*?)<\/(?:arxiv:)?affiliation>/gi)).map(match => decodeXml(match[1]));
    const authors = Array.from(body.matchAll(/<author>([\s\S]*?)<\/author>/gi)).map(match => tagText(match[1], "name")).filter(Boolean);
    const id = tagText(body, "id");
    const link = (body.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i) || [])[1]
      || (body.match(/<link[^>]*href="([^"]+)"/i) || [])[1]
      || id;
    return {
      title: tagText(body, "title"),
      link,
      summary: tagText(body, "summary"),
      authors,
      affiliations,
      published: tagText(body, "published") || tagText(body, "updated")
    };
  }).filter(item => item.title && item.link);
}

async function collectNews(since, limit){
  const xml = await fetchText("https://news.clemson.edu/feed/", 8000);
  const items = parseRss(xml).filter(item => {
    const blob = item.title + " " + item.summary + " " + item.categories.join(" ");
    if(NEWS_DROP.test(blob)) return false;
    if(item.categories.some(cat => /research/i.test(cat))) return true;
    return NEWS_KEEP.test(item.title + " " + item.summary);
  }).filter(item => withinWindow(item.published, since)).slice(0, limit || 12);
  return items.map(item => ({
    title: clip(item.title, 300),
    source_url: canonicalUrl(item.link),
    authors: "Clemson News",
    summary: clip(item.summary, 700),
    source_name: "Clemson News",
    published: item.published || null
  }));
}

async function collectPubMed(band){
  if(!band || !band.limit) return [];
  const maxdate = band.to ? slashDay(band.to) : slashDay(utcDay(new Date()));
  let searchUrl = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=" + band.limit
    + "&sort=pub_date&datetype=pdat&maxdate=" + maxdate
    + "&term=" + encodeURIComponent("Clemson[Affiliation]")
    + "&tool=curf-docket";
  if(band.from) searchUrl += "&mindate=" + slashDay(band.from);
  const search = JSON.parse(await fetchText(searchUrl, 8000));
  const ids = (search.esearchresult && search.esearchresult.idlist) || [];
  log("pubmed-search", "count " + ((search.esearchresult && search.esearchresult.count) || 0) + " ids " + ids.length);
  if(ids.length === 0) return [];
  const xml = await fetchText(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=xml&tool=curf-docket&id=" + ids.join(","),
    8000
  );
  return xml.split(/<PubmedArticle[\s>]/).slice(1).map(chunk => {
    const body = chunk.split(/<\/PubmedArticle>/)[0];
    const pmid = tagText(body, "PMID");
    const abstract = Array.from(body.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/gi)).map(match => decodeXml(match[1])).join(" ");
    const authors = Array.from(body.matchAll(/<Author[\s>][\s\S]*?<\/Author>/gi)).map(match => {
      const block = match[0];
      return [tagText(block, "LastName"), tagText(block, "Initials")].filter(Boolean).join(" ");
    }).filter(Boolean).slice(0, 8);
    const doi = decodeXml((body.match(/<ArticleId IdType="doi">([\s\S]*?)<\/ArticleId>/i) || [])[1] || "");
    return {
      title: clip(tagText(body, "ArticleTitle"), 300),
      source_url: pmid ? ("https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/") : "",
      authors: authors.join(", "),
      summary: clip(abstract || tagText(body, "ArticleTitle"), 700),
      source_name: "PubMed",
      doi,
      published: pubmedDate(body) || tagText(body, "ArticleDate") || tagText(body, "PubDate") || null
    };
  }).filter(item => item.title && item.source_url);
}

function openAlexAbstract(inverted){
  if(!inverted || typeof inverted !== "object") return "";
  const words = [];
  Object.keys(inverted).forEach(word => {
    (inverted[word] || []).forEach(pos => { words.push([pos, word]); });
  });
  words.sort((a, b) => a[0] - b[0]);
  return words.map(pair => pair[1]).join(" ");
}

function pubmedDate(body){
  const block = (body.match(/<ArticleDate[\s>][\s\S]*?<\/ArticleDate>/i) || [])[0]
    || (body.match(/<PubDate[\s>][\s\S]*?<\/PubDate>/i) || [])[0]
    || "";
  if(!block) return "";
  const year = tagText(block, "Year");
  const month = tagText(block, "Month");
  const day = tagText(block, "Day");
  return validIso(year, month, day) || "";
}

async function collectOpenAlex(band){
  if(!band || !band.limit) return [];
  const filters = ["authorships.institutions.ror:https://ror.org/037s24f05"];
  if(band.from) filters.push("from_publication_date:" + isoDay(band.from));
  if(band.to) filters.push("to_publication_date:" + isoDay(band.to));
  const url = "https://api.openalex.org/works?per-page=" + band.limit + "&sort=publication_date:desc"
    + "&filter=" + encodeURIComponent(filters.join(","))
    + "&select=id,display_name,publication_date,doi,authorships,abstract_inverted_index";
  const data = JSON.parse(await fetchText(url, 8000));
  const results = Array.isArray(data.results) ? data.results : [];
  log("openalex", "count " + ((data.meta && data.meta.count) || results.length));
  return results.map(work => {
    const authors = (work.authorships || []).map(row => row.author && row.author.display_name).filter(Boolean).slice(0, 8);
    return {
      title: clip(work.display_name, 300),
      source_url: work.doi || work.id,
      authors: authors.join(", "),
      summary: clip(openAlexAbstract(work.abstract_inverted_index) || work.display_name, 700),
      source_name: "OpenAlex",
      doi: work.doi || "",
      published: work.publication_date || null
    };
  }).filter(item => item.title && item.source_url);
}

async function collectArxiv(band){
  if(!band || !band.limit) return [];
  let search = "all:\"Clemson University\"";
  if(band.from || band.to){
    const start = band.from ? arxivStamp(band.from) : "199108140000";
    const end = band.to ? arxivStamp(band.to) : arxivStamp(utcDay(new Date()));
    search += " AND submittedDate:[" + start + " TO " + end + "]";
  }
  const url = "https://export.arxiv.org/api/query?search_query=" + encodeURIComponent(search)
    + "&sortBy=submittedDate&sortOrder=descending&max_results=" + band.limit;
  const xml = await fetchText(url, 8000);
  return parseAtomEntries(xml).filter(entry => {
    const blob = entry.title + " " + entry.summary + " " + entry.affiliations.join(" ") + " " + entry.authors.join(" ");
    return /clemson/i.test(blob) && withinWindow(entry.published, band.from);
  }).slice(0, band.limit).map(entry => ({
    title: clip(entry.title, 300),
    source_url: canonicalUrl(entry.link),
    authors: entry.authors.join(", "),
    summary: clip(entry.summary, 700),
    source_name: "arXiv",
    published: entry.published || null
  }));
}

export async function collectPublications(options){
  const plan = scanBands(options && options.windowId, options && options.now, { weekly: !!(options && options.weekly) });
  const jobs = [["Clemson News", () => collectNews(plan.since, plan.newsLimit)]];
  plan.bands.forEach((band, index) => {
    const label = plan.bands.length > 1 ? (index === 0 ? " recent" : " older") : "";
    jobs.push(["PubMed" + label, () => collectPubMed(band)]);
    jobs.push(["OpenAlex" + label, () => collectOpenAlex(band)]);
    jobs.push(["arXiv" + label, () => collectArxiv(Object.assign({}, band, { limit: index === 0 ? plan.arxivRecent : band.limit }))]);
  });
  const settled = await Promise.all(jobs.map(async ([name, fn]) => {
    try {
      const items = await fn();
      log("source-ok", name + " " + items.length);
      return { name, items, error: null };
    } catch (err) {
      const message = err && err.name === "AbortError" ? "timed out" : (err && err.detail ? (err.status + " " + err.detail) : (err && err.message ? err.message : String(err)));
      log("source-failed", name + " " + message);
      return { name, items: [], error: clip(message, 240) };
    }
  }));
  const merged = [];
  const seen = new Set();
  settled.forEach(source => {
    source.items.forEach(item => {
      const key = doiKey(item.doi) || canonicalUrl(item.source_url);
      if(!key || seen.has(key)) return;
      seen.add(key);
      merged.push(item);
    });
  });
  const sources = [];
  settled.forEach(source => {
    const name = source.name.replace(/ (recent|older)$/, "");
    let row = sources.find(item => item.name === name);
    if(!row){
      row = { name, fetched: 0, error: null };
      sources.push(row);
    }
    row.fetched += source.items.length;
    if(source.error) row.error = row.error ? (row.error + "; " + source.error) : source.error;
  });
  return {
    items: merged.slice(0, 80),
    sources
  };
}

async function supabaseFetch(supabaseUrl, supabaseKey, path, options){
  const res = await fetch(supabaseUrl.replace(/\/$/, "") + "/rest/v1/" + path, {
    ...options,
    headers: { ...headers(supabaseKey), ...(options && options.headers ? options.headers : {}) }
  });
  const text = await res.text();
  log("supabase " + (options && options.method ? options.method : "GET") + " " + res.status, path.split("?")[0] + " " + text.slice(0, 280));
  let data = null;
  if(text){
    try { data = JSON.parse(text); } catch (err) { data = text; }
  }
  return { ok: res.ok, status: res.status, data, text };
}

function isRlsRejection(result){
  const blob = typeof result.data === "string" ? result.data : JSON.stringify(result.data || {});
  return result.status === 401 || result.status === 403 || blob.indexOf("42501") !== -1 || blob.indexOf("row-level security") !== -1;
}

export async function assertCanWrite(supabaseUrl, supabaseKey){
  const role = jwtRole(supabaseKey);
  if(role && role !== "service_role"){
    throw { step: "write_probe", wrongKey: true, detail: WRONG_KEY_MESSAGE };
  }
  const probe = await supabaseFetch(supabaseUrl, supabaseKey, FINDINGS, {
    method: "POST",
    headers: { "Prefer": "return=minimal" },
    body: JSON.stringify({})
  });
  if(isRlsRejection(probe)){
    throw { step: "write_probe", wrongKey: true, status: probe.status, detail: WRONG_KEY_MESSAGE };
  }
  if(probe.status === 400 || probe.status === 422) return;
  if(!probe.ok){
    throw { step: "write_probe", status: probe.status, detail: clip(probe.text, 300) };
  }
}

async function fetchExistingUrls(supabaseUrl, supabaseKey){
  const result = await supabaseFetch(supabaseUrl, supabaseKey, FINDINGS + "?select=source_url&limit=1000", { method: "GET" });
  if(!result.ok){
    throw { step: "supabase_read", status: result.status, detail: clip(result.text, 300), wrongKey: isRlsRejection(result) };
  }
  return new Set((Array.isArray(result.data) ? result.data : []).map(row => row.source_url).filter(Boolean));
}

function missingPublishedColumn(result){
  const blob = (result.text || "") + (typeof result.data === "string" ? result.data : JSON.stringify(result.data || {}));
  return blob.indexOf("published_on") !== -1;
}

async function storeFindings(supabaseUrl, supabaseKey, rows){
  if(rows.length === 0) return 0;
  let stored = 0;
  let dropDate = false;
  for(let offset = 0; offset < rows.length; offset += 20){
    const chunk = rows.slice(offset, offset + 20).map(row => {
      if(!dropDate) return row;
      const copy = Object.assign({}, row);
      delete copy.published_on;
      return copy;
    });
    let result = await supabaseFetch(supabaseUrl, supabaseKey, FINDINGS, {
      method: "POST",
      headers: { "Prefer": "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(chunk)
    });
    if(!result.ok && missingPublishedColumn(result)){
      dropDate = true;
      const slim = chunk.map(row => {
        const copy = Object.assign({}, row);
        delete copy.published_on;
        return copy;
      });
      result = await supabaseFetch(supabaseUrl, supabaseKey, FINDINGS, {
        method: "POST",
        headers: { "Prefer": "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify(slim)
      });
    }
    if(!result.ok){
      throw { step: "supabase_store", status: result.status, detail: clip(result.text, 400), wrongKey: isRlsRejection(result) };
    }
    stored += Array.isArray(result.data) ? result.data.length : chunk.length;
  }
  return stored;
}

export async function lookupCrossrefDate(doi){
  const id = extractDoi(doi);
  if(!id) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch("https://api.crossref.org/works/" + encodeURIComponent(id), {
      signal: controller.signal,
      headers: {
        "User-Agent": "CURF-Docket/1.0 (https://curfpatentmachine.netlify.app)",
        "Accept": "application/json"
      }
    });
    if(!res.ok) return null;
    const data = await res.json();
    return earliestCrossrefDate(data && data.message);
  } catch (err) {
    log("crossref-failed", id + " " + (err && err.name === "AbortError" ? "timed out" : (err && err.message ? err.message : String(err))));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function attachCrossrefDates(items, limit){
  const queue = (items || []).filter(item => extractDoi(item.doi || item.source_url)).slice(0, limit || 40);
  async function worker(){
    while(queue.length){
      const item = queue.shift();
      const date = await lookupCrossrefDate(item.doi || item.source_url);
      if(date) item.published_on = date;
    }
  }
  const workers = Math.min(4, queue.length);
  await Promise.all(Array.from({ length: workers }, worker));
  (items || []).forEach(item => {
    if(!item.published_on) item.published_on = fullCalendarDate(item.published);
  });
}

async function fillMissingPublicationDates(supabaseUrl, supabaseKey, limit){
  const result = await supabaseFetch(
    supabaseUrl,
    supabaseKey,
    FINDINGS + "?select=id,source_url,summary&published_on=is.null&order=found_at.desc&limit=" + (limit || 40),
    { method: "GET" }
  );
  if(!result.ok){
    if(missingPublishedColumn(result)) return 0;
    log("date-backfill-read", result.status + " " + result.text.slice(0, 180));
    return 0;
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  let updated = 0;
  for(const row of rows){
    const doi = extractDoi(row.source_url) || extractDoi(row.summary);
    if(!doi) continue;
    const date = await lookupCrossrefDate(doi);
    if(!date) continue;
    const patched = await supabaseFetch(supabaseUrl, supabaseKey, FINDINGS + "?id=eq." + row.id, {
      method: "PATCH",
      headers: { "Prefer": "return=minimal" },
      body: JSON.stringify({ published_on: date })
    });
    if(patched.ok) updated += 1;
    else log("date-backfill-write", patched.status + " " + patched.text.slice(0, 180));
  }
  return updated;
}

function extractJsonObject(text){
  const start = String(text || "").indexOf("{");
  if(start === -1) return null;
  let depth = 0;
  for(let i = start; i < text.length; i++){
    if(text[i] === "{") depth++;
    else if(text[i] === "}"){
      depth--;
      if(depth === 0){
        try { return JSON.parse(text.slice(start, i + 1)); }
        catch (err) { return null; }
      }
    }
  }
  return null;
}

async function scoreBatch(apiKey, items, attempt){
  const body = {
    model: TRIAGE_MODEL,
    max_tokens: attempt === 0 ? 900 : 1800,
    system: "Score each item for commercial relevance to a university technology transfer office. Use only the title and summary given. Do not invent products, companies, or market sizes. HIGH means a company might plausibly pay to use or license the underlying work. MODERATE means a possible fit that still needs a person. LOW means campus news, a narrow academic result, or no evident buyer. Respond with ONLY JSON: {\"scores\":[{\"n\":number,\"commercial_relevance\":\"LOW|MODERATE|HIGH\",\"commercial_rationale\":string}]}. One rationale sentence under 20 words. Include every n from the input.",
    messages: [{ role: "user", content: JSON.stringify(items.map((item, index) => ({
      n: index + 1,
      title: item.title,
      summary: clip(item.summary, 400),
      source: item.source_name
    }))) }],
    output_config: { effort: "low" }
  };
  if(attempt === 0) body.thinking = { type: "disabled" };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(attempt === 0 ? 20000 : 25000)
  });
  const text = await res.text();
  log("anthropic", res.status + " " + text.slice(0, 240));
  if(res.status === 400 && attempt === 0) return scoreBatch(apiKey, items, 1);
  if(!res.ok) throw { step: "score", status: res.status, detail: text.slice(0, 300) };
  const data = JSON.parse(text);
  const blocks = (data.content || []).filter(block => block.type === "text");
  const parsed = extractJsonObject(blocks.length ? blocks[blocks.length - 1].text : "");
  return parsed && Array.isArray(parsed.scores) ? parsed.scores : [];
}

async function patchFinding(supabaseUrl, supabaseKey, sourceUrl, fields){
  const result = await supabaseFetch(
    supabaseUrl,
    supabaseKey,
    FINDINGS + "?source_url=eq." + encodeURIComponent(sourceUrl),
    { method: "PATCH", headers: { "Prefer": "return=minimal" }, body: JSON.stringify(fields) }
  );
  if(!result.ok) throw { step: "supabase_patch", status: result.status, detail: clip(result.text, 240) };
}

async function scoreUnscored(supabaseUrl, supabaseKey, apiKey, limit){
  const result = await supabaseFetch(
    supabaseUrl,
    supabaseKey,
    FINDINGS + "?select=source_url,title,summary&commercial_relevance_score=eq.UNSCORED&order=found_at.desc&limit=" + limit,
    { method: "GET" }
  );
  if(!result.ok) throw { step: "score_read", status: result.status, detail: clip(result.text, 240) };
  const rows = Array.isArray(result.data) ? result.data : [];
  if(rows.length === 0) return 0;
  const scores = await scoreBatch(apiKey, rows.map(row => ({
    title: row.title,
    summary: row.summary,
    source_name: ""
  })), 0);
  let updated = 0;
  for(const score of scores){
    const index = Number(score.n) - 1;
    const row = rows[index];
    if(!row) continue;
    const relevance = /high/i.test(score.commercial_relevance) ? "HIGH"
      : (/moderate/i.test(score.commercial_relevance) ? "MODERATE" : "LOW");
    await patchFinding(supabaseUrl, supabaseKey, row.source_url, {
      commercial_relevance_score: relevance,
      commercial_rationale: clip(score.commercial_rationale || "Scored from the public title and summary.", 240)
    });
    updated++;
  }
  return updated;
}

function escapeHtml(value){
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendAlerts(supabaseUrl, supabaseKey){
  const resendKey = process.env.RESEND_API_KEY;
  const alertTo = process.env.CURF_ALERT_EMAIL;
  if(!resendKey || !alertTo){
    log("alert-skipped", "RESEND_API_KEY or CURF_ALERT_EMAIL is not set");
    return 0;
  }
  const pending = await supabaseFetch(
    supabaseUrl,
    supabaseKey,
    FINDINGS + "?select=id,title,source_url,commercial_rationale&commercial_relevance_score=eq." + ALERT_THRESHOLD + "&alerted=eq.false&limit=10",
    { method: "GET" }
  );
  if(!pending.ok) throw { step: "alert_read", status: pending.status, detail: clip(pending.text, 240) };
  const rows = Array.isArray(pending.data) ? pending.data : [];
  if(rows.length === 0) return 0;
  const listHtml = rows.map(row => "<li><a href=\"" + escapeHtml(row.source_url) + "\">" + escapeHtml(row.title) + "</a>, " + escapeHtml(row.commercial_rationale || "") + "</li>").join("");
  const fromAddress = process.env.RESEND_FROM_EMAIL || "CURF Docket <onboarding@resend.dev>";
  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + resendKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromAddress,
      to: [alertTo],
      subject: "CURF Docket: " + rows.length + " new high relevance Clemson publication(s)",
      html: "<p>Publication Watch scored the following new public items HIGH for commercial relevance:</p><ul>" + listHtml + "</ul><p>Review each one before acting. This is not a legal or market opinion.</p>"
    })
  });
  const emailText = await emailRes.text();
  log("resend", emailRes.status + " " + emailText.slice(0, 240));
  if(!emailRes.ok) throw { step: "resend", status: emailRes.status, detail: emailText.slice(0, 240) };
  for(const row of rows){
    const patched = await supabaseFetch(supabaseUrl, supabaseKey, FINDINGS + "?id=eq." + row.id, {
      method: "PATCH",
      headers: { "Prefer": "return=minimal" },
      body: JSON.stringify({ alerted: true })
    });
    if(!patched.ok) log("alert-flag-failed", patched.status + " " + patched.text.slice(0, 180));
  }
  return rows.length;
}

async function startRun(supabaseUrl, supabaseKey, trigger){
  const result = await supabaseFetch(supabaseUrl, supabaseKey, RUNS, {
    method: "POST",
    headers: { "Prefer": "return=representation" },
    body: JSON.stringify({ trigger, status: "running" })
  });
  if(!result.ok){
    log("scan-log-unavailable", result.status + " " + result.text.slice(0, 240));
    return null;
  }
  return Array.isArray(result.data) && result.data[0] ? result.data[0].id : null;
}

async function finishRun(supabaseUrl, supabaseKey, id, fields){
  if(!id) return;
  const result = await supabaseFetch(supabaseUrl, supabaseKey, RUNS + "?id=eq." + id, {
    method: "PATCH",
    headers: { "Prefer": "return=minimal" },
    body: JSON.stringify({ ...fields, finished_at: new Date().toISOString() })
  });
  if(!result.ok) log("scan-log-update-failed", result.status + " " + result.text.slice(0, 240));
}

export async function runPublicationScan({ trigger, scoreLimit, windowId }){
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const window = normalizeScanWindow(windowId);
  const weekly = trigger === "weekly";
  if(!supabaseUrl || !supabaseKey){
    log("abort", trigger + " missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    return { ok: false, error: "Supabase is not configured" };
  }

  let runId = null;
  try {
    await assertCanWrite(supabaseUrl, supabaseKey);
    runId = await startRun(supabaseUrl, supabaseKey, trigger);
    const collected = await collectPublications({ windowId: window, weekly });
    try {
      await attachCrossrefDates(collected.items, weekly ? 8 : 40);
    } catch (err) {
      log("crossref-batch-failed", err && err.message ? err.message : String(err));
    }
    const sourceErrors = collected.sources.filter(source => source.error);
    if(collected.items.length === 0 && sourceErrors.length === collected.sources.length){
      const error = "Every source failed. " + sourceErrors.map(source => source.name + ": " + source.error).join(" | ");
      await finishRun(supabaseUrl, supabaseKey, runId, {
        status: "error", found_count: 0, stored_count: 0, scored_count: 0,
        error: clip(error, 500), detail: { sources: collected.sources, window }
      });
      return { ok: false, error };
    }

    const existing = await fetchExistingUrls(supabaseUrl, supabaseKey);
    const fresh = collected.items.filter(item => item.source_url && !existing.has(item.source_url));
    const rows = fresh.map(item => ({
      title: item.title,
      source_url: item.source_url,
      authors: clip(item.authors, 300),
      summary: clip((item.source_name ? item.source_name + ": " : "") + (item.summary || item.title), 900),
      commercial_relevance_score: "UNSCORED",
      commercial_rationale: "Collected from " + item.source_name + ". Relevance scoring has not run yet.",
      alerted: false,
      published_on: item.published_on || null
    }));
    const stored = await storeFindings(supabaseUrl, supabaseKey, rows);

    let scored = 0;
    let scoreError = "";
    if(!anthropicKey){
      scoreError = "Items are stored. ANTHROPIC_API_KEY is not set, so relevance was not scored.";
    } else {
      try {
        scored = await scoreUnscored(supabaseUrl, supabaseKey, anthropicKey, scoreLimit || 12);
      } catch (err) {
        scoreError = clip((err && err.detail) || (err && err.message) || String(err), 400);
        log("score-failed", scoreError);
      }
    }

    let alertError = "";
    try {
      await sendAlerts(supabaseUrl, supabaseKey);
    } catch (err) {
      alertError = clip((err && err.detail) || String(err), 240);
      log("alert-failed", alertError);
    }

    if(!weekly){
      try {
        await fillMissingPublicationDates(supabaseUrl, supabaseKey, 40);
      } catch (err) {
        log("date-backfill-failed", err && err.message ? err.message : String(err));
      }
    }

    const error = [scoreError, alertError].filter(Boolean).join(" ");
    await finishRun(supabaseUrl, supabaseKey, runId, {
      status: error ? "partial" : "ok",
      found_count: collected.items.length,
      stored_count: stored,
      scored_count: scored,
      error: error || null,
      detail: { sources: collected.sources, window }
    });
    log("done", trigger + " found " + collected.items.length + " stored " + stored + " scored " + scored);
    return { ok: true, found: collected.items.length, stored, scored, error: error || null };
  } catch (err) {
    const wrongKey = !!(err && err.wrongKey);
    const message = wrongKey ? WRONG_KEY_MESSAGE : clip((err && err.detail) || (err && err.message) || String(err), 500);
    log("failed", trigger + " " + message);
    await finishRun(supabaseUrl, supabaseKey, runId, {
      status: "error", error: message, found_count: 0, stored_count: 0, scored_count: 0
    });
    return { ok: false, error: message, wrongKey };
  }
}

export async function readPublicationWatch(supabaseUrl, supabaseKey){
  const findingsResult = await supabaseFetch(
    supabaseUrl,
    supabaseKey,
    FINDINGS + "?select=*&order=found_at.desc&limit=200",
    { method: "GET" }
  );
  if(!findingsResult.ok){
    return {
      configured: true,
      findings: [],
      last_scan: null,
      error: isRlsRejection(findingsResult) ? WRONG_KEY_MESSAGE : "Supabase rejected the publication_watch read.",
      detail: findingsResult.data
    };
  }
  const scanResult = await supabaseFetch(
    supabaseUrl,
    supabaseKey,
    RUNS + "?select=*&order=started_at.desc&limit=1",
    { method: "GET" }
  );
  let lastScan = null;
  let scanLogError = null;
  if(scanResult.ok){
    lastScan = Array.isArray(scanResult.data) && scanResult.data[0] ? scanResult.data[0] : null;
  } else {
    const blob = scanResult.text || "";
    scanLogError = blob.indexOf("publication_scan_runs") !== -1 || (scanResult.data && scanResult.data.code === "PGRST205")
      ? "Scan history is not available until supabase-publication-scan.sql is run. Findings can still be saved."
      : "Could not read scan history.";
    log("scan-log-read", scanResult.status + " " + blob.slice(0, 200));
  }
  return {
    configured: true,
    findings: Array.isArray(findingsResult.data) ? findingsResult.data : [],
    last_scan: lastScan,
    scan_log_error: scanLogError,
    error: null
  };
}

// Deeper read of publications that are already stored. One row per
// source_url. A stored review is returned as-is unless force is set.
// The model sees only the title and summary already in publication_watch.
// It does not search again.

import { jwtRole, WRONG_KEY_MESSAGE } from "./publication-watch-lib.js";

const FINDINGS = "publication_watch";
const MODEL = "claude-haiku-5-5";

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

function clip(value, max){
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max) : text;
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

async function askModel(apiKey, row){
  const body = {
    model: MODEL,
    max_tokens: 700,
    system: "You help a university technology transfer office decide whether a public Clemson paper deserves a closer look. Use only the title and summary given. Do not invent companies, dollar amounts, or claims that the paper demonstrated a product. Respond with ONLY JSON: {\"opportunity\":string,\"licensee_types\":[string],\"next_step\":string,\"confidence\":\"low|medium|high\"}. opportunity is one sentence. licensee_types has at most three short labels such as medical device company. next_step is one sentence a staff member can do this week.",
    messages: [{ role: "user", content: JSON.stringify({
      title: clip(row.title, 300),
      summary: clip(row.summary, 700),
      quick_score: row.commercial_relevance_score || ""
    }) }],
    output_config: { effort: "low" },
    thinking: { type: "disabled" }
  };
  let res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body)
  });
  if(res.status === 400){
    delete body.thinking;
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body)
    });
  }
  const text = await res.text();
  if(!res.ok) throw new Error("The review model returned " + res.status + ".");
  const data = JSON.parse(text);
  const blocks = (data.content || []).filter(block => block.type === "text");
  const parsed = extractJsonObject(blocks.length ? blocks[blocks.length - 1].text : "");
  if(!parsed) throw new Error("The review model did not return JSON.");
  const confidence = /high/i.test(parsed.confidence) ? "high" : (/low/i.test(parsed.confidence) ? "low" : "medium");
  return {
    opportunity: clip(parsed.opportunity || "", 400),
    licensee_types: Array.isArray(parsed.licensee_types) ? parsed.licensee_types.map(item => clip(item, 80)).filter(Boolean).slice(0, 3) : [],
    next_step: clip(parsed.next_step || "", 300),
    confidence,
    model: MODEL
  };
}

export async function reviewSelectedPublications(sourceUrls, options){
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const force = !!(options && options.force);
  if(!supabaseUrl || !supabaseKey){
    return { configured: false, reviews: [], error: "SUPABASE_URL or SUPABASE_SERVICE_KEY is not set." };
  }
  const role = jwtRole(supabaseKey);
  if(role && role !== "service_role"){
    return { configured: true, reviews: [], error: WRONG_KEY_MESSAGE };
  }
  const urls = Array.from(new Set((sourceUrls || []).map(url => String(url || "").trim()).filter(Boolean))).slice(0, 5);
  if(urls.length === 0) return { configured: true, reviews: [], error: "Select at least one publication." };

  const byUrl = new Map();
  for(const url of urls){
    const read = await supabaseFetch(
      supabaseUrl,
      supabaseKey,
      FINDINGS + "?select=source_url,title,summary,commercial_relevance_score,review_json,reviewed_at&source_url=eq." + encodeURIComponent(url) + "&limit=1",
      { method: "GET" }
    );
    if(!read.ok){
      const blob = read.text || "";
      const missingColumn = blob.indexOf("review_json") !== -1;
      return {
        configured: true,
        reviews: [],
        error: missingColumn
          ? "Run supabase-workflow.sql so a deeper review can be stored on publication_watch. Existing rows are not changed until then."
          : "Could not read the selected publications."
      };
    }
    const rows = Array.isArray(read.data) ? read.data : [];
    if(rows[0]) byUrl.set(rows[0].source_url, rows[0]);
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const reviews = [];
  for(const url of urls){
    const row = byUrl.get(url);
    if(!row){
      reviews.push({ source_url: url, error: "That publication is not in the stored list." });
      continue;
    }
    if(row.review_json && !force){
      reviews.push({ source_url: url, cached: true, review: row.review_json, reviewed_at: row.reviewed_at });
      continue;
    }
    if(!apiKey){
      reviews.push({ source_url: url, error: "ANTHROPIC_API_KEY is not set." });
      continue;
    }
    try {
      const review = await askModel(apiKey, row);
      const reviewedAt = new Date().toISOString();
      const patched = await supabaseFetch(
        supabaseUrl,
        supabaseKey,
        FINDINGS + "?source_url=eq." + encodeURIComponent(url),
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ review_json: review, reviewed_at: reviewedAt })
        }
      );
      if(!patched.ok){
        const blob = patched.text || "";
        reviews.push({
          source_url: url,
          error: blob.indexOf("review_json") !== -1
            ? "Run supabase-workflow.sql before storing a deeper review."
            : "Supabase rejected the review write."
        });
        continue;
      }
      reviews.push({ source_url: url, cached: false, review, reviewed_at: reviewedAt });
    } catch (err) {
      reviews.push({ source_url: url, error: err.message || "The review failed." });
    }
  }
  return { configured: true, reviews, error: null };
}

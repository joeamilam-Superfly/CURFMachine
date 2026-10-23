// netlify/functions/triage-patents-background.js
//
// Background rank of Clemson patents for licensing potential.
// The client already fetched the registry and POSTs a compact list.
// This function does not call BigQuery again.
//
// Cost control, using Anthropic's published starting rates for
// claude-haiku-5-5 ($0.10 / million input tokens, $0.50 / million
// output tokens):
//   - No web search. Search is $10 / 1,000 searches and is the
//     expensive part of a full evaluation.
//   - effort "low", and thinking disabled on the first attempt.
//     Thinking tokens are output tokens. If the API rejects a
//     disabled thinking block, one retry keeps low effort and a
//     larger max_tokens.
//   - About 250 input tokens and 60 output tokens per patent when
//     thinking stays off. 300 patents is about 75,000 input tokens
//     ($0.008) and 18,000 output tokens ($0.009), a few cents.
//   - If low-effort thinking still adds ~150 tokens per patent, 300
//     patents land around $0.03 to $0.15. Plan on under $0.30.
//   - Cached patent_id rows are skipped, so a second click is free.
//
// Runtime: batches of 12, one batch at a time. 300 patents is 25
// calls. At a few seconds each, expect about 2 to 4 minutes, and
// allow up to 8 if a batch is slow. The 15 minute background budget
// covers that. A synchronous function would not.
//
// The client gets HTTP 202 immediately and polls GET
// /api/triage-patents. Nothing returned here reaches the browser.

import { applyAlignmentToTier, listGroupNames, scoreAlignment } from "./sc-investment.js";
import { applyTermOverride, buildTriageSignals } from "./triage-signals.js";

const TABLE = "patent_triage";
const TRIAGE_MODEL = "claude-haiku-5-5";
const BATCH_SIZE = 12;

const SYSTEM_PROMPT = [
  "You are doing a cheap first-pass licensing screen for a university technology transfer office.",
  "You are not producing a valuation in dollars, a legal opinion, or a freedom-to-operate view.",
  "Use ONLY the fields supplied for each patent. Do not invent forward citations, maintenance payments, claim text, market sizes, licensees, or products.",
  "Claims text is not in this pull. CPC codes and the abstract are the technical scope you have.",
  "Backward citation counts are prior art the patent cites, not later patents that cite it. Do not treat them as evidence of commercial impact.",
  "Family size is only within this pull, not the worldwide family.",
  "Remaining term and maintenance notes are estimates, not USPTO status.",
  "Tier each patent as exactly one of: High, Medium, Low, Needs work.",
  "High means a technology transfer officer could plausibly open a licensing or startup conversation from the title and abstract, with term left and a recognizable industry.",
  "Medium means a possible fit that still needs a human read before anyone spends real outreach time.",
  "Low means a long shot: a narrow academic tool, a tiny buyer set, a design or plant right with little industry pull, or little term left.",
  "Needs work means the record is too thin, the estimated term has run out, or judging it would take substantial staff time or money before a licensing read means anything.",
  "reason is one sentence under 25 words. confidence is low, medium, or high. Low confidence when the abstract is thin or the term estimate is missing.",
  "Also set industry_group to exactly one name from this closed list, or Unmatched if none fit: " + listGroupNames().join("; ") + ".",
  "industry_group is a technology classification only. Do not name investors, funds, check sizes, or dollar amounts, and do not invent a group that is not in the list.",
  "Respond with ONLY valid JSON, no markdown: {\"results\":[{\"patent_id\":string,\"tier\":\"High|Medium|Low|Needs work\",\"reason\":string,\"confidence\":\"low|medium|high\",\"industry_group\":string}]}.",
  "Include every patent_id from the input exactly once."
].join(" ");

function supabaseHeaders(apiKey){
  return {
    "apikey": apiKey,
    "Authorization": "Bearer " + apiKey,
    "Content-Type": "application/json"
  };
}

function jwtRole(apiKey){
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

async function readCachedIds(supabaseUrl, supabaseKey){
  const res = await fetch(supabaseUrl + "/rest/v1/" + TABLE + "?select=patent_id&limit=1000", {
    headers: supabaseHeaders(supabaseKey)
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok){
    const code = data && data.code;
    const message = data && data.message ? String(data.message) : "";
    if(code === "42501" || message.indexOf("row-level security") !== -1){
      throw { step: "supabase_read", wrongKey: true, detail: data };
    }
    throw { step: "supabase_read", status: res.status, detail: data };
  }
  const rows = Array.isArray(data) ? data : [];
  return new Set(rows.map(row => row.patent_id).filter(Boolean));
}

async function storeRows(supabaseUrl, supabaseKey, rows){
  if(rows.length === 0) return;
  const res = await fetch(supabaseUrl + "/rest/v1/" + TABLE, {
    method: "POST",
    headers: { ...supabaseHeaders(supabaseKey), "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify(rows)
  });
  if(!res.ok){
    const detail = await res.text();
    throw { step: "supabase_store", status: res.status, detail };
  }
}

function extractJsonObject(text){
  const trimmed = String(text || "").trim();
  const start = trimmed.indexOf("{");
  if(start === -1) return null;
  let depth = 0;
  for(let i = start; i < trimmed.length; i++){
    if(trimmed[i] === "{") depth++;
    else if(trimmed[i] === "}"){
      depth--;
      if(depth === 0){
        try { return JSON.parse(trimmed.slice(start, i + 1)); }
        catch (err) { return null; }
      }
    }
  }
  return null;
}

async function rankBatch(apiKey, batch, attempt){
  const body = {
    model: TRIAGE_MODEL,
    max_tokens: attempt === 0 ? 1800 : 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: JSON.stringify(batch) }],
    output_config: { effort: "low" }
  };
  if(attempt === 0) body.thinking = { type: "disabled" };
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });
  const data = await upstream.json().catch(() => ({}));
  if(upstream.status === 400 && attempt === 0){
    console.log("triage-patents-background: retrying batch without thinking disabled: " + JSON.stringify(data && data.error ? data.error : data).slice(0, 400));
    return rankBatch(apiKey, batch, 1);
  }
  if(!upstream.ok){
    throw { step: "anthropic", status: upstream.status, detail: data && data.error ? data.error : data };
  }
  const textBlocks = (data.content || []).filter(block => block.type === "text");
  const textBlock = textBlocks[textBlocks.length - 1];
  if(!textBlock) throw { step: "anthropic", detail: "No text response" };
  const parsed = extractJsonObject(textBlock.text);
  const results = parsed && Array.isArray(parsed.results) ? parsed.results : [];
  return { results, usage: data.usage || null };
}

function compactForModel(patent){
  const signals = buildTriageSignals(patent);
  return {
    patent_id: patent.patent_id,
    title: String(patent.title || "").slice(0, 300),
    abstract: String(patent.abstract || "").slice(0, 700),
    kind: signals.kind,
    cpc_codes: (Array.isArray(patent.cpc_codes) ? patent.cpc_codes : []).slice(0, 6),
    signals
  };
}

export default async (req) => {
  if(req.method !== "POST"){
    console.log("triage-patents-background: ignored non-POST");
    return;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if(!anthropicKey || !supabaseUrl || !supabaseKey){
    console.log("triage-patents-background: missing ANTHROPIC_API_KEY, SUPABASE_URL, or SUPABASE_SERVICE_KEY. Nothing ranked.");
    return;
  }
  const role = jwtRole(supabaseKey);
  if(role && role !== "service_role"){
    console.log("triage-patents-background: SUPABASE_SERVICE_KEY is not service_role. Aborting before any model call.");
    return;
  }

  let body;
  try { body = await req.json(); }
  catch (err) {
    console.log("triage-patents-background: body was not JSON");
    return;
  }
  const incoming = Array.isArray(body && body.patents) ? body.patents : [];
  const patents = incoming.filter(p => p && p.patent_id).slice(0, 400);
  if(patents.length === 0){
    console.log("triage-patents-background: no patents in the request");
    return;
  }

  let cached;
  try {
    cached = await readCachedIds(supabaseUrl, supabaseKey);
  } catch (err) {
    console.log("triage-patents-background: cache read failed, no model call: " + JSON.stringify(err).slice(0, 500));
    return;
  }

  const todo = patents.filter(p => !cached.has(p.patent_id));
  console.log("triage-patents-background: received " + patents.length + ", already cached " + (patents.length - todo.length) + ", to rank " + todo.length);
  let inputTokens = 0;
  let outputTokens = 0;
  let stored = 0;

  for(let offset = 0; offset < todo.length; offset += BATCH_SIZE){
    const slice = todo.slice(offset, offset + BATCH_SIZE);
    const packed = slice.map(compactForModel);
    const byId = new Map(packed.map(item => [item.patent_id, item]));
    try {
      const ranked = await rankBatch(anthropicKey, packed.map(item => ({
        patent_id: item.patent_id,
        title: item.title,
        abstract: item.abstract,
        kind: item.kind,
        cpc_codes: item.cpc_codes,
        signals: item.signals
      })), 0);
      if(ranked.usage){
        inputTokens += Number(ranked.usage.input_tokens || 0);
        outputTokens += Number(ranked.usage.output_tokens || 0);
      }
      const seen = new Set();
      const rows = [];
      ranked.results.forEach(result => {
        const source = byId.get(result && result.patent_id);
        if(!source || seen.has(source.patent_id)) return;
        seen.add(source.patent_id);
        const judged = applyTermOverride(result, source.signals);
        const alignment = scoreAlignment({
          title: source.title,
          text: source.abstract,
          cpc_codes: source.cpc_codes,
          chosen_group: result && result.industry_group
        });
        const withAlign = applyAlignmentToTier(judged, alignment, source.signals);
        rows.push({
          patent_id: source.patent_id,
          tier: withAlign.tier,
          reason: withAlign.reason,
          confidence: withAlign.confidence,
          signals: Object.assign({}, source.signals, { sc_alignment: alignment }),
          model: TRIAGE_MODEL,
          screened_at: new Date().toISOString(),
          sc_industry_group: alignment.industry_group,
          sc_focus_area: alignment.focus_area,
          sc_alignment_score: alignment.alignment_score,
          sc_alignment_note: alignment.short,
          sc_alignment_source: alignment.source
        });
      });
      await storeRows(supabaseUrl, supabaseKey, rows);
      stored += rows.length;
      console.log("triage-patents-background: batch " + (offset / BATCH_SIZE + 1) + " stored " + rows.length + " of " + slice.length);
    } catch (err) {
      console.log("triage-patents-background: batch failed, continuing: " + JSON.stringify(err).slice(0, 500));
    }
  }

  console.log("triage-patents-background: stored " + stored + " of " + todo.length + ". input_tokens " + inputTokens + " output_tokens " + outputTokens);
};

export const config = { background: true };

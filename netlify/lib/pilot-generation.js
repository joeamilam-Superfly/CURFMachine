// Shared storage and search for pilot targets.
//
// The synchronous /api/generate-pilot-targets endpoint only reads or
// marks a job. The web search runs in generate-pilot-targets-background,
// which has a 15 minute limit. Status lives in record_json.evaluation.pilot_job
// ({ status, started_at, error }). Pending and error writes do not change
// pilot_targets or any other evaluation field.

import { randomUUID } from "node:crypto";

import {
  applyPilotFields,
  buildPilotSearchRequest,
  countVerifiedPilots,
  isPilotHardPass,
  pilotNotRecommendedSection,
  pilotSearchInputFromRecord,
  readPilotSection
} from "./pilot-targets.js";

export const PILOT_JOB_STALE_MS = 15 * 60 * 1000;
export const PILOT_SEARCH_ATTEMPTS = 3;
const TABLE = "evaluated_patents";

export function readPilotJob(record){
  const job = record && record.evaluation && record.evaluation.pilot_job;
  if(!job || typeof job !== "object" || Array.isArray(job)) return null;
  return job;
}

export function pilotJobIsActive(job, now){
  if(!job) return false;
  if(job.status !== "pending" && job.status !== "running") return false;
  const started = Date.parse(job.started_at || "");
  if(!Number.isFinite(started)) return false;
  return (now == null ? Date.now() : now) - started < PILOT_JOB_STALE_MS;
}

export function storedPilotSection(record){
  const ev = record && record.evaluation;
  if(!ev || !Array.isArray(ev.pilot_targets)) return null;
  return {
    pilot_targets: ev.pilot_targets,
    biggest_proof_gap: ev.biggest_proof_gap || "",
    suggested_next_step: ev.suggested_next_step || "",
    pilot_recommendation: ev.pilot_recommendation || "",
    pilot_search_error: ev.pilot_search_error || ""
  };
}

export function withPilotJob(record, job){
  const copy = JSON.parse(JSON.stringify(record && typeof record === "object" ? record : {}));
  if(!copy.evaluation || typeof copy.evaluation !== "object" || Array.isArray(copy.evaluation)){
    copy.evaluation = {};
  }
  const next = {
    status: job.status,
    started_at: job.started_at,
    error: String(job.error || "").slice(0, 500)
  };
  if(job.claim) next.claim = String(job.claim);
  if(job.claimed_at) next.claimed_at = job.claimed_at;
  copy.evaluation.pilot_job = next;
  return copy;
}

export function pilotStatusBody(patentId, record, extras){
  const options = extras && typeof extras === "object" ? extras : {};
  const section = storedPilotSection(record);
  const job = readPilotJob(record);
  const pending = Object.prototype.hasOwnProperty.call(options, "pending") ? !!options.pending : pilotJobIsActive(job);
  const targets = section ? section.pilot_targets : null;
  const body = {
    ok: true,
    patent_id: patentId,
    saved: options.saved != null ? !!options.saved : true,
    hard_pass: options.hardPass != null ? !!options.hardPass : isPilotHardPass(record),
    pending,
    dispatched: options.dispatched !== false,
    job_status: options.job_status || (job && job.status) || (section ? "done" : ""),
    started_at: options.started_at || (job && job.started_at) || "",
    job_error: options.job_error != null ? options.job_error : (job && job.error) || "",
    verified_count: targets ? countVerifiedPilots(targets) : 0,
    unverified_count: targets ? targets.length - countVerifiedPilots(targets) : 0
  };
  if(section){
    body.pilot_targets = section.pilot_targets;
    body.biggest_proof_gap = section.biggest_proof_gap || "";
    body.suggested_next_step = section.suggested_next_step || "";
    body.pilot_recommendation = section.pilot_recommendation || "";
    body.pilot_search_error = section.pilot_search_error || "";
  }
  return body;
}

function supabaseHeaders(apiKey){
  return {
    apikey: apiKey,
    Authorization: "Bearer " + apiKey,
    "Content-Type": "application/json"
  };
}

export function pilotStoreConfig(){
  const supabaseUrl = process.env.SUPABASE_URL;
  const apiKey = process.env.SUPABASE_SERVICE_KEY;
  if(!supabaseUrl || !apiKey) return null;
  return { supabaseUrl, apiKey };
}

export async function readStoredRecord(supabaseUrl, apiKey, patentId){
  const url = supabaseUrl.replace(/\/$/, "") + "/rest/v1/" + TABLE + "?patent_id=eq." + encodeURIComponent(patentId) + "&select=patent_id,record_json";
  const res = await fetch(url, { headers: supabaseHeaders(apiKey) });
  const data = await res.json().catch(() => null);
  if(!res.ok){
    const error = new Error("Could not read the stored evaluation");
    error.status = res.status;
    error.detail = data;
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : null;
  if(!row || !row.record_json || typeof row.record_json !== "object") return null;
  return row.record_json;
}

export async function writeStoredRecord(supabaseUrl, apiKey, patentId, record){
  const url = supabaseUrl.replace(/\/$/, "") + "/rest/v1/" + TABLE + "?patent_id=eq." + encodeURIComponent(patentId);
  const res = await fetch(url, {
    method: "PATCH",
    headers: { ...supabaseHeaders(apiKey), Prefer: "return=representation" },
    body: JSON.stringify({ record_json: record })
  });
  const data = await res.json().catch(() => null);
  if(!res.ok){
    const error = new Error("Could not save pilot targets");
    error.status = res.status;
    error.detail = data;
    throw error;
  }
  if(!Array.isArray(data) || !data.length){
    throw new Error("The stored evaluation was not updated");
  }
  return data[0].record_json || record;
}

export function backgroundEndpoint(){
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || "";
  if(!base) return "";
  return base.replace(/\/$/, "") + "/.netlify/functions/generate-pilot-targets-background";
}

export function isRetryablePilotError(err){
  const status = err && err.status;
  if(status === 429 || status === 529) return true;
  if(typeof status === "number" && status >= 500 && status <= 599) return true;
  const message = String(err && err.message || "");
  if(/paused before it finished/i.test(message)) return true;
  if(!status && (err instanceof TypeError || /network|fetch failed|ECONN|ETIMEDOUT|socket|timed out/i.test(message))) return true;
  return false;
}

function retryDelay(attempt){
  const override = Number(process.env.PILOT_RETRY_SLEEP_MS);
  const ms = Number.isFinite(override) && override >= 0 ? override : attempt * 1000;
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function searchPilotSection(record){
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if(!apiKey){
    const error = new Error("Server is missing ANTHROPIC_API_KEY");
    error.status = 500;
    throw error;
  }
  const built = buildPilotSearchRequest(pilotSearchInputFromRecord(record));
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: built.max_tokens,
      system: built.system,
      messages: built.messages,
      tools: built.tools
    })
  });
  const data = await res.json().catch(() => ({}));
  if(!res.ok){
    const message = data && data.error && data.error.message ? data.error.message : "Pilot target search failed";
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  if(data.stop_reason === "max_tokens"){
    throw new Error("The model response was cut off before finishing");
  }
  if(data.stop_reason === "pause_turn"){
    throw new Error("The web search was paused before it finished");
  }
  return readPilotSection(data);
}

export async function searchPilotSectionWithRetries(record){
  let lastError = null;
  for(let attempt = 1; attempt <= PILOT_SEARCH_ATTEMPTS; attempt++){
    try {
      return await searchPilotSection(record);
    } catch (err) {
      lastError = err;
      if(attempt === PILOT_SEARCH_ATTEMPTS || !isRetryablePilotError(err)) throw err;
      console.log("pilot search retry " + attempt + " after " + (err.status || "network"));
      await retryDelay(attempt);
    }
  }
  throw lastError || new Error("Pilot target search failed");
}

export async function dispatchPilotJob(patentId, startedAt){
  const endpoint = backgroundEndpoint();
  if(!endpoint) return { ok: false, uncertain: false, error: "Pilot generation is not configured with a site URL" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patent_id: patentId, started_at: startedAt }),
      signal: controller.signal
    });
    if(res.status === 202 || res.ok) return { ok: true };
    return { ok: false, uncertain: false, error: "Pilot generation could not be started (" + res.status + ")" };
  } catch (err) {
    const aborted = !!(err && (err.name === "AbortError" || /aborted|abort/i.test(err.message || "")));
    return {
      ok: false,
      uncertain: aborted,
      error: aborted ? "Pilot generation was slow to start" : (err.message || "Pilot generation could not be started")
    };
  } finally {
    clearTimeout(timer);
  }
}

function sameClaim(job, startedAt, claim){
  return !!(job && job.started_at === startedAt && job.claim === claim);
}

export async function runPilotGenerationJob({ patentId, startedAt, claim }){
  const store = pilotStoreConfig();
  if(!store) return { ok: false, reason: "unconfigured" };
  if(!patentId || !startedAt) return { ok: false, reason: "missing-input" };
  const token = claim || randomUUID();
  const record = await readStoredRecord(store.supabaseUrl, store.apiKey, patentId);
  if(!record) return { ok: false, reason: "missing" };
  const job = readPilotJob(record);
  if(!job || job.started_at !== startedAt) return { ok: false, reason: "superseded" };
  if(job.status === "done" || job.status === "error") return { ok: true, reason: "finished" };
  if(job.status === "running" && job.claim && job.claim !== token){
    const claimed = Date.parse(job.claimed_at || "");
    if(Number.isFinite(claimed) && Date.now() - claimed < PILOT_JOB_STALE_MS){
      return { ok: true, reason: "already-running" };
    }
  }
  if(job.status !== "pending" && job.status !== "running") return { ok: false, reason: "not-pending" };

  const claimedAt = new Date().toISOString();
  await writeStoredRecord(store.supabaseUrl, store.apiKey, patentId, withPilotJob(record, {
    status: "running",
    started_at: startedAt,
    error: "",
    claim: token,
    claimed_at: claimedAt
  }));
  const claimed = await readStoredRecord(store.supabaseUrl, store.apiKey, patentId);
  if(!sameClaim(readPilotJob(claimed), startedAt, token)) return { ok: false, reason: "superseded" };

  try {
    const section = isPilotHardPass(claimed) ? pilotNotRecommendedSection() : await searchPilotSectionWithRetries(claimed);
    const latest = await readStoredRecord(store.supabaseUrl, store.apiKey, patentId);
    const current = readPilotJob(latest);
    if(!sameClaim(current, startedAt, token)) return { ok: false, reason: "superseded" };
    await writeStoredRecord(store.supabaseUrl, store.apiKey, patentId, withPilotJob(applyPilotFields(latest, section), {
      status: "done",
      started_at: startedAt,
      error: "",
      claim: token,
      claimed_at: current.claimed_at || claimedAt
    }));
    return { ok: true, reason: "done" };
  } catch (err) {
    const latest = await readStoredRecord(store.supabaseUrl, store.apiKey, patentId);
    const current = readPilotJob(latest);
    if(!sameClaim(current, startedAt, token)) return { ok: false, reason: "superseded" };
    await writeStoredRecord(store.supabaseUrl, store.apiKey, patentId, withPilotJob(latest, {
      status: "error",
      started_at: startedAt,
      error: err && err.message ? err.message : "Pilot target search failed",
      claim: token,
      claimed_at: current.claimed_at || claimedAt
    }));
    return { ok: false, reason: "error", error: err && err.message ? err.message : "Pilot target search failed" };
  }
}

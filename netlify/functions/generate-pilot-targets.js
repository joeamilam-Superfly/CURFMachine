// netlify/functions/generate-pilot-targets.js
//
// Starts or reports a pilot-target job. It does not call the model.
// A hard pass is saved here as "not recommended". Every other search
// is marked pending in record_json.evaluation.pilot_job and handed to
// generate-pilot-targets-background, which can run for 15 minutes.
// The page polls GET /api/generate-pilot-targets?patent_id= for
// pending, done, or error. Pending and error never clear pilot_targets.

import {
  dispatchPilotJob,
  pilotJobIsActive,
  pilotStatusBody,
  pilotStoreConfig,
  readPilotJob,
  readStoredRecord,
  storedPilotSection,
  withPilotJob,
  writeStoredRecord
} from "../lib/pilot-generation.js";
import { applyPilotFields, isPilotHardPass, pilotNotRecommendedSection } from "../lib/pilot-targets.js";

function json(body, status){
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

function recordFromClient(body){
  const record = body && body.record;
  if(!record || typeof record !== "object" || Array.isArray(record)) return null;
  if(!record.evaluation || typeof record.evaluation !== "object") return null;
  return record;
}

function rejectRecord(record){
  if(!record) return json({ error: "No stored evaluation was found for that patent" }, 404);
  if(record.status && record.status !== "evaluated"){
    return json({ error: "Pilot targets are only added to an evaluated patent" }, 400);
  }
  if(record.evaluation && record.evaluation.cached_only){
    return json({ error: "The full evaluation is not stored for this patent" }, 400);
  }
  return null;
}

async function loadRecord(patentId, body){
  const store = pilotStoreConfig();
  if(!store) return { record: recordFromClient(body), stored: false, store: null };
  const record = await readStoredRecord(store.supabaseUrl, store.apiKey, patentId);
  if(record) return { record, stored: true, store };
  return { record: recordFromClient(body), stored: false, store };
}

export default async (req) => {
  const url = new URL(req.url);

  if(req.method === "GET"){
    const patentId = (url.searchParams.get("patent_id") || "").trim();
    if(!patentId) return json({ error: "Request must include a patent_id string" }, 400);
    const store = pilotStoreConfig();
    if(!store) return json({ error: "Shared storage is not configured" }, 503);
    try {
      const record = await readStoredRecord(store.supabaseUrl, store.apiKey, patentId);
      const rejected = rejectRecord(record);
      if(rejected) return rejected;
      const job = readPilotJob(record);
      return json(pilotStatusBody(patentId, record, {
        saved: true,
        pending: pilotJobIsActive(job),
        dispatched: !pilotJobIsActive(job)
      }));
    } catch (err) {
      return json({ error: err.message || "Could not read pilot targets", detail: err.detail || null }, err.status || 502);
    }
  }

  if(req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); }
  catch (err) { return json({ error: "Request body was not valid JSON" }, 400); }

  const patentId = body && typeof body.patent_id === "string" ? body.patent_id.trim() : "";
  if(!patentId) return json({ error: "Request must include a patent_id string" }, 400);

  try {
    const loaded = await loadRecord(patentId, body);
    const rejected = rejectRecord(loaded.record);
    if(rejected) return rejected;
    let record = loaded.record;
    const store = loaded.store;
    const stored = loaded.stored;

    const force = body.force === true;
    let job = readPilotJob(record);
    if(pilotJobIsActive(job)){
      return json(pilotStatusBody(patentId, record, { saved: stored, pending: true, dispatched: false }), 202);
    }

    if(!force && storedPilotSection(record)){
      return json(pilotStatusBody(patentId, record, { saved: stored, pending: false }));
    }

    if(!stored || !store){
      return json({ error: "Save the evaluation before adding pilot targets" }, 409);
    }

    const latest = await readStoredRecord(store.supabaseUrl, store.apiKey, patentId);
    if(latest) record = latest;
    job = readPilotJob(record);
    if(pilotJobIsActive(job)){
      return json(pilotStatusBody(patentId, record, { saved: true, pending: true, dispatched: false }), 202);
    }

    if(isPilotHardPass(record)){
      const section = pilotNotRecommendedSection();
      const startedAt = new Date().toISOString();
      const next = withPilotJob(applyPilotFields(record, section), { status: "done", started_at: startedAt, error: "" });
      await writeStoredRecord(store.supabaseUrl, store.apiKey, patentId, next);
      return json(pilotStatusBody(patentId, next, { saved: true, pending: false, hardPass: true }));
    }

    const startedAt = new Date().toISOString();
    const pendingRecord = withPilotJob(record, { status: "pending", started_at: startedAt, error: "" });
    await writeStoredRecord(store.supabaseUrl, store.apiKey, patentId, pendingRecord);
    const dispatched = await dispatchPilotJob(patentId, startedAt);
    if(dispatched.ok){
      return json(pilotStatusBody(patentId, pendingRecord, { saved: true, pending: true, dispatched: true }), 202);
    }
    if(dispatched.uncertain){
      return json(pilotStatusBody(patentId, pendingRecord, {
        saved: true,
        pending: true,
        dispatched: false,
        job_error: dispatched.error
      }), 202);
    }

    const after = await readStoredRecord(store.supabaseUrl, store.apiKey, patentId);
    const current = after || pendingRecord;
    const currentJob = readPilotJob(current);
    if(currentJob && currentJob.started_at === startedAt && currentJob.status === "pending"){
      const failed = withPilotJob(current, { status: "error", started_at: startedAt, error: dispatched.error });
      await writeStoredRecord(store.supabaseUrl, store.apiKey, patentId, failed);
      return json(Object.assign(pilotStatusBody(patentId, failed, { saved: true, pending: false, dispatched: false }), {
        error: dispatched.error
      }), 502);
    }
    return json(Object.assign(pilotStatusBody(patentId, current, { saved: true, pending: pilotJobIsActive(currentJob), dispatched: false }), {
      error: dispatched.error
    }), 502);
  } catch (err) {
    return json({ error: err.message || "Pilot target search failed", detail: err.detail || null }, err.status || 502);
  }
};

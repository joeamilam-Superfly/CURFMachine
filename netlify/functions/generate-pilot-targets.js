// netlify/functions/generate-pilot-targets.js
//
// Fills only the Pilot & proof-of-concept section on an evaluation that
// already exists. It reads evaluated_patents.record_json, and it writes
// back that same object with five evaluation fields changed:
// pilot_targets, biggest_proof_gap, suggested_next_step,
// pilot_recommendation, and pilot_search_error. Licensing targets,
// scores, path, and the rest of the record are not rebuilt.
//
// A hard pass (no demand, or a licensing search that already found
// fewer than 3 destinations) is stored as "not recommended" and does
// not call the model. Every other evaluated patent gets one web search,
// max_uses 3, under the same proof-link rules as the full evaluation.

import {
  applyPilotFields,
  buildPilotSearchRequest,
  countVerifiedPilots,
  isPilotHardPass,
  pilotNotRecommendedSection,
  pilotSearchInputFromRecord,
  readPilotSection
} from "../lib/pilot-targets.js";

const TABLE = "evaluated_patents";

function json(body, status){
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  });
}

function supabaseHeaders(apiKey){
  return {
    apikey: apiKey,
    Authorization: "Bearer " + apiKey,
    "Content-Type": "application/json"
  };
}

function recordFromClient(body){
  const record = body && body.record;
  if(!record || typeof record !== "object" || Array.isArray(record)) return null;
  if(!record.evaluation || typeof record.evaluation !== "object") return null;
  return record;
}

async function readStoredRecord(supabaseUrl, apiKey, patentId){
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

async function writeStoredRecord(supabaseUrl, apiKey, patentId, record){
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
}

async function searchPilotSection(record){
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

function storedPilotSection(record){
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

function sectionResponse(patentId, section, saved, hardPass){
  const targets = Array.isArray(section.pilot_targets) ? section.pilot_targets : [];
  return {
    ok: true,
    patent_id: patentId,
    saved: !!saved,
    hard_pass: !!hardPass,
    pilot_targets: targets,
    biggest_proof_gap: section.biggest_proof_gap || "",
    suggested_next_step: section.suggested_next_step || "",
    pilot_recommendation: section.pilot_recommendation || "",
    pilot_search_error: section.pilot_search_error || "",
    verified_count: countVerifiedPilots(targets),
    unverified_count: targets.length - countVerifiedPilots(targets)
  };
}

export default async (req) => {
  if(req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); }
  catch (err) { return json({ error: "Request body was not valid JSON" }, 400); }

  const patentId = body && typeof body.patent_id === "string" ? body.patent_id.trim() : "";
  if(!patentId) return json({ error: "Request must include a patent_id string" }, 400);

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const configured = !!(supabaseUrl && supabaseKey);

  try {
    let record = null;
    let stored = false;
    if(configured){
      record = await readStoredRecord(supabaseUrl, supabaseKey, patentId);
      stored = !!record;
    }
    if(!record) record = recordFromClient(body);
    if(!record) return json({ error: "No stored evaluation was found for that patent" }, 404);
    if(record.status && record.status !== "evaluated"){
      return json({ error: "Pilot targets are only added to an evaluated patent" }, 400);
    }
    if(record.evaluation && record.evaluation.cached_only){
      return json({ error: "The full evaluation is not stored for this patent" }, 400);
    }

    const force = body.force === true;
    if(!force){
      const existing = storedPilotSection(record);
      if(existing) return json(sectionResponse(patentId, existing, stored, isPilotHardPass(record)));
    }

    const hardPass = isPilotHardPass(record);
    const section = hardPass ? pilotNotRecommendedSection() : await searchPilotSection(record);

    let saved = false;
    if(stored){
      const latest = await readStoredRecord(supabaseUrl, supabaseKey, patentId);
      const base = latest || record;
      await writeStoredRecord(supabaseUrl, supabaseKey, patentId, applyPilotFields(base, section));
      saved = true;
    }

    return json(sectionResponse(patentId, section, saved, hardPass));
  } catch (err) {
    return json({ error: err.message || "Pilot target search failed", detail: err.detail || null }, err.status || 502);
  }
};

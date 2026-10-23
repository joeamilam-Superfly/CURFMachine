// Searches for pilot targets after the synchronous endpoint has marked
// the evaluation pending. Netlify returns 202 as soon as this starts
// and allows it to run for 15 minutes. Results, or an error that leaves
// the previous targets in place, are written to record_json.

import { runPilotGenerationJob } from "../lib/pilot-generation.js";

export default async (req) => {
  if(req.method !== "POST"){
    console.log("pilot background ignored non-POST");
    return;
  }
  let body;
  try { body = await req.json(); }
  catch (err) {
    console.log("pilot background body was not JSON");
    return;
  }
  const patentId = body && typeof body.patent_id === "string" ? body.patent_id.trim() : "";
  const startedAt = body && typeof body.started_at === "string" ? body.started_at.trim() : "";
  if(!patentId || !startedAt){
    console.log("pilot background missing patent_id or started_at");
    return;
  }
  try {
    const result = await runPilotGenerationJob({ patentId, startedAt });
    console.log("pilot background finished " + JSON.stringify({ patent_id: patentId, reason: result.reason, ok: result.ok }));
  } catch (err) {
    console.log("pilot background failed " + String(err && err.message || err).slice(0, 300));
  }
};

export const config = { background: true };

// GET /api/run-publication-scan
//
// Lists stored findings and the latest scan run. It does not search.
// A background function's return value never reaches the browser, so
// this is the only place the page can learn whether the last scan
// stored rows, failed to score them, or was rejected by Supabase.

import { jwtRole, readPublicationWatch, WRONG_KEY_MESSAGE } from "./publication-watch-lib.js";

export default async (req) => {
  if(req.method !== "GET"){
    return new Response(JSON.stringify({ error: "Method not allowed. Run a scan through /api/run-publication-scan-background." }), {
      status: 405, headers: { "Content-Type": "application/json" }
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if(!supabaseUrl || !supabaseKey){
    return new Response(JSON.stringify({ configured: false, findings: [], last_scan: null }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  const role = jwtRole(supabaseKey);
  if(role && role !== "service_role"){
    return new Response(JSON.stringify({
      configured: true,
      findings: [],
      last_scan: null,
      error: WRONG_KEY_MESSAGE
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  try {
    const payload = await readPublicationWatch(supabaseUrl, supabaseKey);
    return new Response(JSON.stringify(payload), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      configured: true, findings: [], last_scan: null,
      error: "Could not reach Supabase", detail: String(err)
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
};

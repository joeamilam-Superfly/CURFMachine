// GET /api/discover-patents
//
// Returns the stored Clemson catalog and the latest discovery scan.
// It does not call Google or the USPTO. The scan is
// POST /api/discover-patents-background.

import { jwtRole, WRONG_KEY_MESSAGE } from "../lib/publication-watch-lib.js";
import { readDiscoveredPatents } from "../lib/discover-patents.js";

export default async (req) => {
  if(req.method !== "GET"){
    return new Response(JSON.stringify({ error: "Method not allowed. Start a scan with POST /api/discover-patents-background." }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if(!supabaseUrl || !supabaseKey){
    return new Response(JSON.stringify({ configured: false, patents: [], last_scan: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  const role = jwtRole(supabaseKey);
  if(role && role !== "service_role"){
    return new Response(JSON.stringify({
      configured: true,
      patents: [],
      last_scan: null,
      error: WRONG_KEY_MESSAGE
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  try {
    const payload = await readDiscoveredPatents(supabaseUrl, supabaseKey);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      configured: true,
      patents: [],
      last_scan: null,
      error: "Could not reach Supabase",
      detail: String(err)
    }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
};

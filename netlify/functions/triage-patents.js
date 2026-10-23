// GET /api/triage-patents
//
// Reads the cached licensing triage. The background ranker writes the
// rows. This function never calls the model, so opening the registry
// does not spend Anthropic tokens.
//
// Same key rule as evaluated-patents.js: SUPABASE_SERVICE_KEY must be
// the service_role key. An anon key with RLS and no policies looks like
// an empty cache.

const TABLE = "patent_triage";

const WRONG_KEY_MESSAGE = "SUPABASE_SERVICE_KEY is not the service_role key. Reads then look empty and writes are rejected by row level security (Postgres 42501). In Supabase open Project Settings, API, and copy the service_role key, not the anon key, into that Netlify variable, then redeploy. Also run supabase-triage.sql if patent_triage does not exist yet.";

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

function supabaseHeaders(apiKey){
  return {
    "apikey": apiKey,
    "Authorization": "Bearer " + apiKey,
    "Content-Type": "application/json"
  };
}

export default async (req) => {
  if(req.method !== "GET"){
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if(!supabaseUrl || !supabaseKey){
    return new Response(JSON.stringify({ configured: false, records: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  const role = jwtRole(supabaseKey);
  if(role && role !== "service_role"){
    return new Response(JSON.stringify({ configured: true, records: [], error: WRONG_KEY_MESSAGE }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const res = await fetch(supabaseUrl + "/rest/v1/" + TABLE + "?select=patent_id,tier,reason,confidence,signals,model,screened_at,sc_industry_group,sc_focus_area,sc_alignment_score,sc_alignment_note,sc_alignment_source&limit=1000", {
      headers: supabaseHeaders(supabaseKey)
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok){
      const missing = data && (data.code === "PGRST205" || data.code === "42P01" || (data.message && String(data.message).indexOf("patent_triage") !== -1));
      return new Response(JSON.stringify({
        configured: true,
        records: [],
        error: missing
          ? "The patent_triage table is missing. Run supabase-triage.sql in the Supabase SQL editor. It creates the table and the service_role grants."
          : "Supabase rejected the triage read. Check that supabase-triage.sql has been run and SUPABASE_SERVICE_KEY is the service_role key.",
        detail: data
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ configured: true, records: Array.isArray(data) ? data : [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ configured: true, records: [], error: "Could not reach Supabase", detail: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
};

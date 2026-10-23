// netlify/functions/evaluated-patents.js
//
// Shared, cross-device storage of FULL patent evaluation records, not
// just a "was it evaluated" flag. Backed by Supabase's plain REST API
// (PostgREST), not the Supabase JS SDK. That's a deliberate choice:
// this deployment goes out via drag-and-drop, which does not run npm
// install, so any function that needs an npm package would fail to
// bundle (this bit the earlier Netlify Blobs option, which requires
// @netlify/blobs as a dependency). Supabase's REST API needs nothing
// but fetch and an API key, so it carries none of that risk.
//
// WHY THE FULL RECORD, NOT JUST AN ID: opening a patent evaluated
// tonight from a different browser, or three months from now, must
// return the exact same stored breakdown, not silently re-run the
// evaluation or recompute anything under whatever the current logic
// happens to be by then. Storing only an ID would have satisfied
// "don't re-evaluate the same patent" but not "show me the same
// result later," which is the actual requirement here.
//
// This function DEGRADES GRACEFULLY when not configured: it returns a
// normal 200 response with configured: false rather than an error, so
// the app falls back to browser localStorage only (which already works
// today) instead of breaking. Setting this up is an upgrade, not a
// requirement.
//
// SETUP (see DEPLOYMENT.md for the full walkthrough):
//   1. In Supabase (a new or existing project), run supabase-setup.sql
//      from this same deploy folder.
//   2. Set two Netlify environment variables: SUPABASE_URL (your
//      project's URL, like https://xxxx.supabase.co) and
//      SUPABASE_SERVICE_KEY (the service_role key, from Supabase's API
//      settings, NOT the anon key, since this bypasses row level
//      security and is only ever used server side here, never exposed
//      to the browser, the same pattern as ANTHROPIC_API_KEY).

const TABLE = "evaluated_patents";

const WRONG_KEY_MESSAGE = "SUPABASE_SERVICE_KEY is not the service_role key. Reads then look empty and writes are rejected by row level security (Postgres 42501). In Supabase open Project Settings, API, and copy the service_role key, not the anon key, into that Netlify variable, then redeploy.";

// The service_role JWT is the only key that bypasses RLS. The anon key
// is a JWT whose role claim is "anon". A non-JWT secret (newer sb_secret
// keys) returns null here and is left for the request itself to accept
// or reject.
function jwtRole(apiKey){
  const parts = String(apiKey || "").split(".");
  if (parts.length < 2) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return json && json.role ? String(json.role) : null;
  } catch (err) {
    return null;
  }
}

function wrongKeyResponse(){
  return new Response(JSON.stringify({
    configured: true,
    patent_ids: [],
    records: [],
    error: WRONG_KEY_MESSAGE
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function supabaseHeaders(apiKey){
  return {
    "apikey": apiKey,
    "Authorization": "Bearer " + apiKey,
    "Content-Type": "application/json"
  };
}

export default async (req, context) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // Not configured. Not an error, a normal 200 so the client falls
    // back to localStorage only without showing anything alarming.
    return new Response(JSON.stringify({ configured: false, patent_ids: [], records: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  const role = jwtRole(supabaseKey);
  if (role && role !== "service_role") {
    return wrongKeyResponse();
  }

  if (req.method === "GET") {
    try {
      const res = await fetch(supabaseUrl + "/rest/v1/" + TABLE + "?select=patent_id,evaluated_at,record_json", {
        headers: supabaseHeaders(supabaseKey)
      });
      const data = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ configured: true, error: "Supabase rejected the request, check the table exists and the key is a service_role key.", detail: data }), {
          status: res.status, headers: { "Content-Type": "application/json" }
        });
      }
      const rows = Array.isArray(data) ? data : [];
      const patentIds = rows.map(row => row.patent_id).filter(Boolean);
      const records = rows
        .filter(row => row.record_json)
        .map(row => ({ patent_id: row.patent_id, evaluated_at: row.evaluated_at, record: row.record_json }));
      return new Response(JSON.stringify({ configured: true, patent_ids: patentIds, records: records }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ configured: true, error: "Could not reach Supabase", detail: String(err) }), {
        status: 502, headers: { "Content-Type": "application/json" }
      });
    }
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); }
    catch (err) {
      return new Response(JSON.stringify({ error: "Request body was not valid JSON" }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }
    const patentId = body && body.patent_id;
    if (!patentId || typeof patentId !== "string") {
      return new Response(JSON.stringify({ error: "Request must include a patent_id string" }), {
        status: 400, headers: { "Content-Type": "application/json" }
      });
    }
    const row = { patent_id: patentId };
    if (body.record !== undefined) row.record_json = body.record;
    try {
      const res = await fetch(supabaseUrl + "/rest/v1/" + TABLE, {
        method: "POST",
        headers: { ...supabaseHeaders(supabaseKey), "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify([row])
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const rlsRejected = data && (data.code === "42501" || (data.message && String(data.message).indexOf("row-level security") !== -1));
        return new Response(JSON.stringify({
          configured: true,
          error: rlsRejected ? WRONG_KEY_MESSAGE : "Supabase rejected the write",
          detail: data
        }), {
          status: res.status, headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ configured: true, ok: true }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    } catch (err) {
      return new Response(JSON.stringify({ configured: true, error: "Could not reach Supabase", detail: String(err) }), {
        status: 502, headers: { "Content-Type": "application/json" }
      });
    }
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405, headers: { "Content-Type": "application/json" }
  });
};

// NOTE: deliberately not using `export const config = { path: ... }`,
// same reason as the other functions, see evaluate-patent.js. This
// relies on Netlify's default URL,
// /.netlify/functions/evaluated-patents, mapped to
// /api/evaluated-patents by a plain redirect in netlify.toml.

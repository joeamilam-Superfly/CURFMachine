// netlify/functions/run-publication-scan.js
//
// GET only: lists previously found publications from Supabase.
//
// This USED to also handle POST, running a scan synchronously and
// returning the results directly. That was removed: publication
// discovery is a genuinely open-ended search task (finding "whatever
// is new" across several source types, not searching for one specific
// thing), and it kept exceeding Netlify's fixed synchronous execution
// limits even after reducing the search budget twice. Triggering a
// scan now goes through run-publication-scan-background.js instead,
// a genuine Background Function with a 15 minute budget, invoked from
// the "Run scan now" button, which then polls this GET endpoint for
// results once the background run has had time to finish, since a
// background function's own return value is discarded and never
// reaches whatever triggered it.

const TABLE = "publication_watch";

function supabaseHeaders(apiKey){
  return { "apikey": apiKey, "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" };
}

export default async (req, context) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed. Triggering a scan now goes through run-publication-scan-background.js instead of this endpoint." }), {
      status: 405, headers: { "Content-Type": "application/json" }
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ configured: false, findings: [] }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const res = await fetch(supabaseUrl + "/rest/v1/" + TABLE + "?select=*&order=found_at.desc&limit=50", { headers: supabaseHeaders(supabaseKey) });
    const data = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ configured: true, error: "Supabase rejected the request, has publication_watch been created? See supabase-setup.sql.", detail: data }), {
        status: res.status, headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ configured: true, findings: Array.isArray(data) ? data : [] }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ configured: true, error: "Could not reach Supabase", detail: String(err) }), {
      status: 502, headers: { "Content-Type": "application/json" }
    });
  }
};

// NOTE: deliberately not using `export const config = { path: ... }`,
// same reason as the other functions, see evaluate-patent.js. This
// relies on Netlify's default URL, /.netlify/functions/run-publication-scan,
// mapped to /api/run-publication-scan by a plain redirect in netlify.toml.

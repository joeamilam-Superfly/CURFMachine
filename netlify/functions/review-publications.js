// POST /api/review-publications
//
// Body: { source_urls: string[], force?: boolean }
// At most five URLs. A publication that already has review_json is
// returned from the database unless force is true.

import { reviewSelectedPublications } from "../lib/publication-review.js";

export default async (req) => {
  if(req.method !== "POST"){
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }
  let body;
  try { body = await req.json(); }
  catch (err) {
    return new Response(JSON.stringify({ error: "Request body was not valid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
  const urls = Array.isArray(body && body.source_urls) ? body.source_urls : [];
  try {
    const result = await reviewSelectedPublications(urls, { force: body && body.force === true });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Could not review the selected publications", detail: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
};

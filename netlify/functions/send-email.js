// netlify/functions/send-email.js
//
// Generic email sending proxy, backed by Resend's REST API, no SDK, no
// npm dependency, same reasoning as everywhere else in this deploy:
// drag-and-drop deploys don't run npm install, so anything requiring a
// package would fail to bundle. Resend's API needs nothing but fetch
// and an API key.
//
// The route is public, so it only delivers to CURF_ALERT_EMAIL. It is
// not an open relay. Publication scans send through Resend directly
// and do not call this function.
//
// SETUP:
//   1. Create a free account at resend.com.
//   2. Get an API key from the Resend dashboard.
//   3. Set it as the RESEND_API_KEY environment variable in Netlify.
//   4. The FROM address below defaults to onboarding@resend.dev,
//      Resend's own sandbox sender that works without verifying a
//      domain, useful for testing. For real production use, verify
//      your own sending domain in Resend and set RESEND_FROM_EMAIL to
//      an address on it, sandbox senders are commonly restricted in
//      who they can actually deliver to once past initial testing.

export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { "Content-Type": "application/json" }
    });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Server is missing RESEND_API_KEY. Set it in Netlify site environment variables." }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  let body;
  try { body = await req.json(); }
  catch (err) {
    return new Response(JSON.stringify({ error: "Request body was not valid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  const { to, subject, html, text } = body || {};
  if (!to || !subject || (!html && !text)) {
    return new Response(JSON.stringify({ error: "Request must include to, subject, and either html or text" }), {
      status: 400, headers: { "Content-Type": "application/json" }
    });
  }

  // This URL is public. It must not be an open relay: the only address
  // it will send to is the one configured for CURF alerts. Publication
  // scans call Resend directly and do not depend on this restriction.
  const alertTo = (process.env.CURF_ALERT_EMAIL || "").trim().toLowerCase();
  if (!alertTo) {
    return new Response(JSON.stringify({ error: "Server is missing CURF_ALERT_EMAIL. This endpoint only sends to that address." }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
  const recipients = (Array.isArray(to) ? to : [to]).map(addr => String(addr || "").trim().toLowerCase());
  if (recipients.length !== 1 || recipients[0] !== alertTo) {
    return new Response(JSON.stringify({ error: "This endpoint only sends to the configured CURF_ALERT_EMAIL." }), {
      status: 403, headers: { "Content-Type": "application/json" }
    });
  }

  const fromAddress = process.env.RESEND_FROM_EMAIL || "CURF Docket <onboarding@resend.dev>";

  try {
    const resendPayload = { from: fromAddress, to: [alertTo], subject };
    if (html) resendPayload.html = html;
    if (text) resendPayload.text = text;

    const upstream = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(resendPayload)
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: "Resend rejected the request", detail: data }), {
        status: upstream.status, headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ ok: true, id: data.id }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Could not reach Resend", detail: String(err) }), {
      status: 502, headers: { "Content-Type": "application/json" }
    });
  }
};

// NOTE: deliberately not using `export const config = { path: ... }`,
// same reason as the other functions, see evaluate-patent.js. This
// relies on Netlify's default URL, /.netlify/functions/send-email,
// mapped to /api/send-email by a plain redirect in netlify.toml.

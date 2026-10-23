// netlify/functions/solve-problem.js
//
// Server side proxy shared by two features: Problem Match (matching an
// enterprise's described problem to Clemson IP) and the Patentability &
// Landscape screen (checking a specific patent against similar existing
// IP and competing products). Both need the same thing, a search
// enabled Claude call, so they share this one function rather than
// duplicating the proxy security pattern a third time. Same security
// shape as evaluate-patent.js: holds the Anthropic API key server side,
// the browser never sees it, and the model, token limit, and tools are
// hardcoded here rather than accepted from the client, so the client
// cannot expand what this is allowed to do.
//
// PRIVACY NOTE: whatever text is sent in here is sent to Anthropic's
// model and, through web search, out to public search infrastructure.
// If that text came from a real enterprise's confidential problem
// statement, or from a pending unpublished disclosure, treat this the
// same as any other confidential information needing consent before
// being run through it. See SECURITY-AND-PRIVACY.md.

// LATENCY: Netlify's synchronous function execution limit is 60
// seconds and is NOT configurable through any plan or support request,
// see the detailed note in evaluate-patent.js. This function is at
// even more risk of hitting that ceiling than the patent evaluation
// one, since it also sends the full known Clemson patent corpus as
// context on every call. max_uses is kept low for this reason.

export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Server is missing ANTHROPIC_API_KEY. Set it in Netlify site environment variables." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: "Request body was not valid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { system, messages } = body || {};
  if (!system || !messages) {
    return new Response(JSON.stringify({ error: "Request must include system and messages" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: system,
        messages: messages,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }]
      })
    });

    const data = await upstream.json();
    return new Response(JSON.stringify(data), {
      status: upstream.status,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Could not reach Anthropic's API" }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
};

// NOTE: deliberately not using `export const config = { path: ... }`,
// same reason as the other two functions, see evaluate-patent.js. This
// relies on Netlify's default URL, /.netlify/functions/solve-problem,
// mapped to /api/solve-problem by a plain redirect in netlify.toml.

// netlify/functions/evaluate-patent.js
//
// Server side proxy for the CURF Docket app. The browser never sees an
// Anthropic API key. This function holds it as an environment variable
// (ANTHROPIC_API_KEY, set in Netlify site settings, never committed to
// the repo) and forwards only the system prompt and messages the app
// already builds client side.
//
// This is also the piece that lets a Zero Data Retention arrangement
// actually apply: ZDR does not support browser based CORS calls direct
// to api.anthropic.com, so the request has to originate from a server,
// which is exactly what this function is.
//
// WEB SEARCH, ADDED FOR NAMED ACQUIRER TARGETS: the client can request
// web search with a boolean enableSearch flag in the request body, but
// everything about HOW search is configured (which tool version,
// max_uses, and the token budget) stays hardcoded here, the client
// cannot expand or reconfigure it, only ask for it to be on or off.
//
// LICENSING TARGETS: a request with task "licensing_targets" asks who
// the patent could be sold or licensed to. The prompt and the
// licensing_targets output schema live in netlify/lib/licensing-targets.js.
// That task turns search on itself (max_uses 3). The model JSON is
// normalized before it is returned: entries need a real name, a type,
// and a reason, and fewer than 3 credible destinations becomes a hard
// pass. The list is not padded. The same normalizer runs when any
// other call already returned licensing_targets or the older
// top_acquirer_targets list. A core evaluation that leaves the list
// empty is not rewritten. The fields travel inside the evaluation
// object stored in evaluated_patents.record_json. No new table.
// When on, this uses Anthropic's server side web search tool
// (web_search_20250305, the basic non-agentic version, confirmed
// current against Anthropic's own tool reference docs) so the model
// can look up real, currently operating companies rather than
// inventing plausible sounding names from training data. max_uses is
// capped at 2, both to bound latency and because web search is billed
// separately from token usage ($10 per 1,000 searches per Anthropic's
// current pricing, on top of standard token costs).
//
// PRIVACY IMPLICATION, READ THIS BEFORE POINTING THIS AT REAL
// DISCLOSURES: enabling web search means a search query built from the
// patent's title and abstract is sent out to live web search
// infrastructure, not just processed by Anthropic's model. For already
// published patents this changes nothing, the content is already
// public. It is exactly why pending, unpublished disclosures must
// never be run through this evaluation path (see
// SECURITY-AND-PRIVACY.md): a search query built from confidential
// text would push that content out to a public search engine, which is
// a meaningfully different exposure than Anthropic's model alone
// processing it.
//
// LATENCY, READ THIS IF EVALUATIONS ARE TIMING OUT: Netlify's
// synchronous function execution limit is 60 seconds and is NOT
// configurable, not through a plan upgrade, not through a support
// request. Older advice describing a 10 second default with a paid
// bump to 26 seconds is now out of date, current as of Netlify's own
// docs checked when this was written. A web search heavy call that
// runs the full allowed searches plus model reasoning can
// realistically approach or exceed that ceiling, especially on a
// niche technical topic that takes the model longer to research. This
// is exactly why the client now splits patent evaluation into two
// separate calls: a fast, search free core evaluation every patent
// needs, and a separate licensing-target search (max_uses 3) for any
// patent that is not already a no-demand hard pass. If timeouts persist even with that split, lowering
// max_uses further, or moving the acquirer search specifically to a
// genuinely asynchronous background function with a polling endpoint,
// a real architecture change, are the only remaining paths. Asking
// Netlify for more time is not one of them.

import { buildLicensingSearchRequest, rewriteLicensingInResponse } from "../lib/licensing-targets.js";

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

  const { system, messages, enableSearch, task } = body || {};
  const licensingTask = task === "licensing_targets";
  let systemPrompt = system;
  let messageList = messages;
  let searchOn = enableSearch === true;
  let maxTokens = searchOn ? 2500 : 2000;
  let tools;

  if (licensingTask) {
    const built = buildLicensingSearchRequest(body.patent);
    systemPrompt = built.system;
    messageList = built.messages;
    searchOn = true;
    maxTokens = built.max_tokens;
    tools = built.tools;
  } else if (searchOn) {
    tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }];
  }

  if (!systemPrompt || !messageList) {
    return new Response(JSON.stringify({ error: "Request must include system and messages" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const requestBody = {
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: messageList
  };
  if (tools) requestBody.tools = tools;

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(requestBody)
    });

    const data = await upstream.json();
    const payload = upstream.ok ? rewriteLicensingInResponse(data, { enforce: licensingTask }) : data;
    return new Response(JSON.stringify(payload), {
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

// NOTE: deliberately not using `export const config = { path: ... }` here.
// That custom-path routing feature has a confirmed open bug in some Netlify
// build environments where it silently does nothing, leaving the route
// returning 404 with no error explaining why. This function instead relies
// on Netlify's default, unconditional function URL,
// /.netlify/functions/evaluate-patent, and netlify.toml maps the friendlier
// /api/evaluate-patent path to it with a plain redirect. That mechanism has
// been stable for years and doesn't depend on this newer feature working.

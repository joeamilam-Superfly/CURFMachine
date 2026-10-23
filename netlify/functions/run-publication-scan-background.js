// netlify/functions/run-publication-scan-background.js
//
// A Netlify Background Function (config.background = true below), which
// gets a 15 minute execution budget, a completely different mechanism
// from both the 60 second synchronous limit and the even shorter 30
// second scheduled function limit, confirmed against Netlify's own
// current function configuration reference when this was written. This
// is the actual fix for this specific feature, not another search
// count reduction: publication discovery is a genuinely more
// open-ended, exploratory search task than anything else in this app
// (finding "whatever is new" across several source types, rather than
// searching for one specific, well-scoped thing), and kept exceeding
// even a reduced synchronous budget.
//
// HOW THIS ACTUALLY WORKS FROM THE CLIENT'S SIDE: a background function
// returns an HTTP 202 almost immediately, before the real work is done,
// and whatever it eventually returns is discarded, nobody is listening
// for it. The client cannot get scan results back from this call
// directly. It has to trigger this, then separately poll
// run-publication-scan.js's GET endpoint (which just reads whatever is
// already stored in Supabase) until new results show up. See the
// "Run scan now" handler in index.html for that polling logic.
//
// This function is named with a "-background" suffix in addition to
// using the modern config export, matching both the older
// naming-convention based mechanism and the current explicit config
// property, as a deliberate hedge, not a requirement confirmed either
// way, but a hedge that costs nothing.

const TABLE = "publication_watch";
const ALERT_THRESHOLD = "HIGH";

function supabaseHeaders(apiKey){
  return { "apikey": apiKey, "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" };
}

async function fetchExistingUrls(supabaseUrl, supabaseKey){
  const res = await fetch(supabaseUrl + "/rest/v1/" + TABLE + "?select=source_url", { headers: supabaseHeaders(supabaseKey) });
  if(!res.ok) return [];
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data.map(r => r.source_url) : [];
}

function escapeHtml(value){
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function storeFindings(supabaseUrl, supabaseKey, findings){
  if(findings.length === 0) return;
  const res = await fetch(supabaseUrl + "/rest/v1/" + TABLE, {
    method: "POST",
    headers: { ...supabaseHeaders(supabaseKey), "Prefer": "resolution=ignore-duplicates" },
    body: JSON.stringify(findings)
  });
  if(!res.ok){
    const detail = await res.text();
    throw { step: "supabase_store", status: res.status, detail };
  }
}

async function searchForPublications(anthropicKey){
  const systemPrompt = "Search the public web for new Clemson University research publications, findings, or announced research from roughly the last one to two weeks. Use sources like Clemson University's own news and research announcements, press releases, PubMed abstracts, arXiv, or other publicly indexed research summaries. You cannot access paywalled full text of academic journals, work only from what is publicly available: titles, abstracts, press releases, and summaries. Use at most 2 searches. For each publication you find that is specific and real and verifiable via search, with a real source URL, do a quick commercial relevance read based only on the publicly available summary, not the full paper: rate commercial_relevance as LOW, MODERATE, or HIGH, and give a one sentence rationale. Never invent a publication, an author, or a URL, if search does not turn up anything specific and real, return an empty list rather than padding it. Respond with ONLY valid JSON as your final message, no markdown fences, no commentary: {\"publications\": [{\"title\": string, \"authors\": string, \"source_url\": string, \"summary\": string, \"commercial_relevance\": \"LOW|MODERATE|HIGH\", \"commercial_rationale\": string}]}.";

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      system: systemPrompt,
      messages: [{ role: "user", content: "Run the search now." }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }]
    })
  });
  if(!upstream.ok){
    const detail = await upstream.json().catch(() => ({}));
    throw { step: "anthropic", status: upstream.status, detail };
  }
  const data = await upstream.json();
  const textBlocks = (data.content || []).filter(b => b.type === "text");
  const textBlock = textBlocks[textBlocks.length - 1];
  if(!textBlock) throw { step: "anthropic", detail: "No text response" };
  const trimmed = textBlock.text.trim();
  const start = trimmed.indexOf("{");
  if(start === -1) throw { step: "parse", detail: "No JSON object found in response" };
  let depth = 0, end = -1;
  for(let i = start; i < trimmed.length; i++){
    if(trimmed[i] === "{") depth++;
    else if(trimmed[i] === "}"){ depth--; if(depth === 0){ end = i; break; } }
  }
  if(end === -1) throw { step: "parse", detail: "Truncated or unbalanced JSON" };
  const parsed = JSON.parse(trimmed.slice(start, end + 1));
  return Array.isArray(parsed.publications) ? parsed.publications : [];
}

async function sendAlertEmail(resendKey, fromAddress, toAddress, newHighFindings){
  const listHtml = newHighFindings.map(f =>
    "<li><a href=\"" + escapeHtml(f.source_url) + "\">" + escapeHtml(f.title) + "</a>, " + escapeHtml(f.commercial_rationale) + "</li>"
  ).join("");
  const payload = {
    from: fromAddress,
    to: [toAddress],
    subject: "CURF Docket: " + newHighFindings.length + " new high relevance Clemson publication(s)",
    html: "<p>The publication scan found the following new items scored HIGH for commercial relevance:</p><ul>" + listHtml + "</ul><p>This is an automated screen based on public search only, review each one directly before acting.</p>"
  };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + resendKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return res.ok;
}

export default async (req, context) => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  // Nothing returned from here reaches any waiting client, this is a
  // background function, but returning informative values still helps
  // when reading this run's entry in Netlify's function logs.
  if (!anthropicKey || !supabaseUrl || !supabaseKey) {
    console.log("run-publication-scan-background: missing required env vars, aborting.");
    return;
  }

  try {
    const publications = await searchForPublications(anthropicKey);
    const existingUrls = await fetchExistingUrls(supabaseUrl, supabaseKey);
    const newOnes = publications.filter(p => p.source_url && !existingUrls.includes(p.source_url));

    const rows = newOnes.map(p => ({
      title: p.title, source_url: p.source_url, authors: p.authors || "",
      summary: p.summary || "", commercial_relevance_score: p.commercial_relevance || "LOW",
      commercial_rationale: p.commercial_rationale || "", alerted: false
    }));
    await storeFindings(supabaseUrl, supabaseKey, rows);

    const highFindings = newOnes.filter(p => p.commercial_relevance === ALERT_THRESHOLD);
    const resendKey = process.env.RESEND_API_KEY;
    const alertTo = process.env.CURF_ALERT_EMAIL;
    if (highFindings.length > 0 && resendKey && alertTo) {
      const fromAddress = process.env.RESEND_FROM_EMAIL || "CURF Docket <onboarding@resend.dev>";
      await sendAlertEmail(resendKey, fromAddress, alertTo, highFindings);
    }

    console.log("run-publication-scan-background: found " + publications.length + ", new " + newOnes.length + ", high relevance " + highFindings.length);
  } catch (err) {
    console.log("run-publication-scan-background failed: " + JSON.stringify(err));
  }
};

export const config = { background: true };

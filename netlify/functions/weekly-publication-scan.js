// netlify/functions/weekly-publication-scan.js
//
// Runs automatically once a week (Sunday, per the @weekly cron alias).
//
// IMPORTANT, CONFIRMED AGAINST NETLIFY'S OWN CURRENT CONFIGURATION
// REFERENCE WHEN THIS WAS WRITTEN: scheduled functions get a 30 second
// execution limit, not 60. That is HALF of the synchronous function
// limit the rest of this app has been tuned around, and it is even
// less forgiving of an open-ended search task like this one. Given
// that, this scheduled version deliberately uses only 1 search and a
// tighter prompt, a real, honest trade-off: the automatic weekly run
// covers less ground than a manually triggered scan does. For full
// coverage, use the "Run scan now" button in the app, which invokes
// run-publication-scan-background.js, a genuine Background Function
// with a 15 minute budget, a completely different mechanism than
// what a scheduled function gets.
//
// This cannot be tested by visiting a URL, Netlify does not allow
// scheduled functions to be invoked directly that way. Use "Run scan
// now" (which calls the background function above, not this one) to
// verify the underlying search and storage logic works, then trust
// this scheduled copy to run on its own reduced budget.

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
  const systemPrompt = "Search the public web for new Clemson University research publications from roughly the last one to two weeks. Use Clemson University's own news and research announcements as the primary source. You cannot access paywalled full text of academic journals, work only from what is publicly available: titles, abstracts, and press releases. Use exactly 1 search, this runs under a very strict time limit and cannot afford more. For each publication you find that is specific and real and verifiable via search, with a real source URL, do a quick commercial relevance read based only on the publicly available summary: rate commercial_relevance as LOW, MODERATE, or HIGH, and give a one sentence rationale. Never invent a publication, an author, or a URL, if search does not turn up anything specific and real, return an empty list. Respond with ONLY valid JSON as your final message, no markdown fences, no commentary: {\"publications\": [{\"title\": string, \"authors\": string, \"source_url\": string, \"summary\": string, \"commercial_relevance\": \"LOW|MODERATE|HIGH\", \"commercial_rationale\": string}]}.";

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: "Run the search now." }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }]
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
    html: "<p>The weekly publication scan found the following new items scored HIGH for commercial relevance:</p><ul>" + listHtml + "</ul><p>This is an automated screen based on public search only, review each one directly before acting.</p>"
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
  if (!anthropicKey || !supabaseUrl || !supabaseKey) {
    console.log("weekly-publication-scan: missing required env vars, skipping this run.");
    return new Response("Missing required environment variables, skipped.", { status: 200 });
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

    console.log("weekly-publication-scan: found " + publications.length + ", new " + newOnes.length + ", high relevance " + highFindings.length);
    return new Response("Scan complete.", { status: 200 });
  } catch (err) {
    console.log("weekly-publication-scan failed: " + JSON.stringify(err));
    return new Response("Scan failed, see function logs.", { status: 200 });
  }
};

export const config = { schedule: "@weekly" };

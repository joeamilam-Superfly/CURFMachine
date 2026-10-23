// Who to sell or license a patent to.
//
// August 2026 kept this inside the main evaluation as top_acquirer_targets:
// three sector archetypes, not named companies, for LICENSE and MATURE.
// The live evaluation then moved named companies into a second web search
// and only ran that search when the path was LICENSE, capped at exactly
// three. This module restores the list on the evaluation itself and
// asks for as many real destinations as a search can support.
//
// Storage stays on the existing evaluated_patents.record_json blob.
// Nothing here adds a table or a column.

export const MIN_CREDIBLE_LICENSING_TARGETS = 3;

export const LICENSING_TARGET_TYPES = [
  "licensee",
  "acquirer",
  "strategic partner",
  "startup/spinout vehicle",
  "investor"
];

export const LICENSING_OUTPUT_SHAPE = "{\"licensing_targets\":[{\"name\":\"string\",\"type\":\"licensee|acquirer|strategic partner|startup/spinout vehicle|investor\",\"why_it_fits\":\"string\",\"sc_connection\":\"string\",\"source\":\"string\"}],\"licensing_recommendation\":\"pursue|hard pass\",\"hard_pass_reason\":\"string\"}";

const TYPE_ALIASES = {
  licensee: "licensee",
  license: "licensee",
  licensing: "licensee",
  acquirer: "acquirer",
  buyer: "acquirer",
  acquisition: "acquirer",
  "strategic partner": "strategic partner",
  partner: "strategic partner",
  strategic_partner: "strategic partner",
  "startup/spinout vehicle": "startup/spinout vehicle",
  startup: "startup/spinout vehicle",
  spinout: "startup/spinout vehicle",
  "spin-out": "startup/spinout vehicle",
  "spin out": "startup/spinout vehicle",
  "spinout vehicle": "startup/spinout vehicle",
  "startup/spinout": "startup/spinout vehicle",
  investor: "investor",
  vc: "investor",
  "venture investor": "investor"
};

const EMPTY_NAME = new Set(["unknown", "n/a", "na", "none", "tbd", "not found", "unspecified"]);

function clean(value, max){
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

export function extractJsonObject(text){
  const trimmed = String(text || "").trim();
  const start = trimmed.indexOf("{");
  if(start === -1) return null;
  let depth = 0;
  for(let i = start; i < trimmed.length; i++){
    if(trimmed[i] === "{") depth++;
    else if(trimmed[i] === "}"){
      depth--;
      if(depth === 0){
        try { return JSON.parse(trimmed.slice(start, i + 1)); }
        catch (err) { return null; }
      }
    }
  }
  return null;
}

function mapType(value){
  const key = clean(value, 80).toLowerCase();
  return TYPE_ALIASES[key] || "";
}

export function coerceLicensingTarget(raw){
  if(!raw || typeof raw !== "object") return null;
  const name = clean(raw.name || raw.company_name || raw.organization || raw.company, 160);
  if(name.length < 2 || EMPTY_NAME.has(name.toLowerCase())) return null;
  let type = mapType(raw.type || raw.role);
  // Older acquirer-search rows named a company and a sector, not a type.
  // Those rows were explicitly buyer targets, so the role is acquirer.
  if(!type && raw.company_name && raw.type == null && raw.role == null) type = "acquirer";
  if(!LICENSING_TARGET_TYPES.includes(type)) return null;
  const why = clean(raw.why_it_fits || raw.why || raw.rationale || raw.pitch_angle || raw.fit, 400);
  if(!why) return null;
  return {
    name,
    type,
    why_it_fits: why,
    sc_connection: clean(raw.sc_connection || raw.southeast_connection || raw.sc_southeast || raw.regional_connection, 240),
    source: clean(raw.source || raw.source_url || raw.evidence || raw.url, 400)
  };
}

function uniqueTargets(list){
  const seen = new Set();
  const out = [];
  list.forEach(item => {
    const target = coerceLicensingTarget(item);
    if(!target) return;
    const key = target.name.toLowerCase();
    if(seen.has(key)) return;
    seen.add(key);
    out.push(target);
  });
  return out;
}

function hardPassReason(parsed, count){
  const modelReason = clean(parsed && parsed.hard_pass_reason, 500);
  const saidPass = clean(parsed && parsed.licensing_recommendation, 40).toLowerCase() === "hard pass";
  const lead = "Hard pass: no viable market.";
  const countLine = count === 0
    ? "Fewer than 3 credible licensees, buyers, or partners could be named, so there is nothing marketable to pursue."
    : "Only " + count + " credible destination" + (count === 1 ? "" : "s") + " could be supported. A marketable patent needs at least 3, and this list was not padded.";
  if(saidPass && modelReason){
    if(modelReason.toLowerCase().indexOf("no viable market") !== -1){
      return modelReason.toLowerCase().indexOf("hard pass") === 0 ? modelReason : lead + " " + modelReason;
    }
    return lead + " " + modelReason;
  }
  return lead + " " + countLine;
}

// Returns a new object with licensing_targets normalized, or null when
// this payload is not a licensing result and the caller did not force
// one. A core evaluation that leaves the list empty is left alone so
// the later search can fill it. Fewer than 3 credible names becomes a
// hard pass. The list is never padded with invented destinations.
export function normalizeLicensingPayload(parsed, options){
  const force = !!(options && options.enforce);
  if(!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const fromNew = Array.isArray(parsed.licensing_targets) ? parsed.licensing_targets : null;
  const fromOld = Array.isArray(parsed.top_acquirer_targets) ? parsed.top_acquirer_targets : null;
  const targets = uniqueTargets(fromNew || fromOld || []);
  const recommendation = clean(parsed.licensing_recommendation, 40);
  const corePlaceholder = !force && parsed.recommended_path && targets.length === 0 && !recommendation;
  if(corePlaceholder) return null;

  const looksLicensing = force || fromNew || fromOld || recommendation || clean(parsed.hard_pass_reason, 20);
  if(!looksLicensing) return null;

  const marketable = targets.length >= MIN_CREDIBLE_LICENSING_TARGETS;
  const next = Object.assign({}, parsed, {
    licensing_targets: targets,
    licensing_recommendation: marketable ? "pursue" : "hard pass",
    hard_pass_reason: marketable ? "" : hardPassReason(parsed, targets.length)
  });
  return next;
}

export function finalTextBlock(content){
  const blocks = (content || []).filter(block => block && block.type === "text" && typeof block.text === "string");
  return blocks.length ? blocks[blocks.length - 1] : null;
}

// Rewrites the last text block when it holds a licensing JSON object.
// Other Anthropic responses (outreach drafts, patentability, a core
// evaluation that left the list empty) pass through unchanged.
export function rewriteLicensingInResponse(data, options){
  if(!data || !Array.isArray(data.content)) return data;
  const block = finalTextBlock(data.content);
  if(!block) return data;
  const parsed = extractJsonObject(block.text);
  const normalized = normalizeLicensingPayload(parsed, options);
  if(!normalized) return data;
  const copy = Object.assign({}, data, { content: data.content.map(item => Object.assign({}, item)) });
  const rewritten = finalTextBlock(copy.content);
  rewritten.text = JSON.stringify(normalized);
  return copy;
}

export function buildLicensingSearchRequest(patent){
  const input = patent && typeof patent === "object" ? patent : {};
  const title = clean(input.title, 300) || "Untitled";
  const dept = clean(input.dept, 160) || "Unspecified";
  const text = clean(input.text || input.abstract, 4000);
  const contacts = clean(input.industryContacts, 500);
  const group = clean(input.sc_industry_group, 120);
  const system = [
    "You are researching real organizations a university technology transfer office could sell a patent to, license it to, partner with, or use as a spinout or investor path.",
    "The office is the Clemson University Research Foundation (CURF) in South Carolina.",
    "Use the web_search tool. Name as many credible destinations as the search supports. Aim past three when the pages support more real organizations. A marketable patent needs at least 3. Do not pad the list to reach 3.",
    "For each licensing_targets entry use only an organization this search actually found.",
    "name is the organization. Never a generic label such as a large chemical company.",
    "type is exactly one of: licensee, acquirer, strategic partner, startup/spinout vehicle, investor.",
    "why_it_fits is one sentence on product or technology overlap, or a prior license or acquisition, and only what the search supports.",
    "sc_connection is a South Carolina or Southeast connection when the search shows one: headquarters, plant, office, university tie, or regional customer. Use an empty string when search does not show one. Do not guess a location.",
    "source is the page URL, or one short evidence line naming that page. If you cannot point at a source, drop the entry. Do not invent a URL.",
    "Do not invent organizations, products, deals, locations, or URLs. Do not fill a slot with a sector archetype or a company recalled from memory without a page from this search.",
    "If fewer than 3 credible destinations can be supported, set licensing_recommendation to \"hard pass\" and write hard_pass_reason so it clearly says there is no viable market and why the list is short.",
    "If 3 or more can be supported, set licensing_recommendation to \"pursue\" and hard_pass_reason to an empty string.",
    "Use at most 3 searches. Work quickly, this runs under a fixed time limit.",
    "Respond with ONLY valid JSON as your final message, no markdown fences, no commentary, matching exactly this shape: " + LICENSING_OUTPUT_SHAPE + "."
  ].join(" ");
  const lines = [
    "Department: " + dept,
    "Title: " + title
  ];
  if(group) lines.push("Technology industry group already assigned, for context only. Do not treat it as a list of buyers: " + group);
  if(contacts) lines.push("Staff-reported industry contacts. Self-reported, not verified. Include a contact only if search confirms the organization is real and a fit: " + contacts);
  lines.push("Disclosure or abstract text:");
  lines.push(text || "No disclosure text was provided.");
  return {
    system,
    messages: [{ role: "user", content: lines.join("\n") }],
    max_tokens: 4000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]
  };
}

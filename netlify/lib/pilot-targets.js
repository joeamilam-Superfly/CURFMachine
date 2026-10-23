// Pilot and proof-of-concept targets for a patent that already has a
// market. Storage stays inside evaluated_patents.record_json, next to
// licensing_targets. Nothing here adds a table or a column.
//
// A target is verified only when search produced an http(s) source for
// previous work in this technical area: a prior pilot, paper, grant,
// program page, patent, press release, or case study. Targets without
// that link are kept, flagged unverified, and sorted last. They are
// not recommendations. Prior pilots without a link are dropped, and
// the note is exactly "No verified prior pilot found".

export const NO_VERIFIED_PRIOR_PILOT = "No verified prior pilot found";

export const PILOT_TARGET_TYPES = [
  "industry pilot partner",
  "end-user site",
  "test lab/standards body",
  "Clemson/SC research center or facility",
  "federal program",
  "SC program"
];

export const PILOT_EFFORT_LEVELS = ["low", "medium", "high"];

export const PILOT_OUTPUT_SHAPE = "{\"pilot_targets\":[{\"name\":\"string\",\"type\":\"industry pilot partner|end-user site|test lab/standards body|Clemson/SC research center or facility|federal program|SC program\",\"what_it_proves\":\"string\",\"why_it_fits\":\"string\",\"sc_connection\":\"string\",\"effort\":\"low|medium|high\",\"source\":\"string\",\"prior_pilots\":[{\"name\":\"string\",\"year\":\"string\",\"what_it_tested\":\"string\",\"alignment\":\"string\",\"source\":\"string\"}],\"prior_pilot_note\":\"string\"}],\"biggest_proof_gap\":\"string\",\"suggested_next_step\":\"string\",\"pilot_recommendation\":\"pursue|not recommended\"}";

const TYPE_ALIASES = {
  "industry pilot partner": "industry pilot partner",
  "pilot partner": "industry pilot partner",
  "industry partner": "industry pilot partner",
  "corporate pilot": "industry pilot partner",
  "end-user site": "end-user site",
  "end user site": "end-user site",
  "end-user": "end-user site",
  "end user": "end-user site",
  "customer site": "end-user site",
  "field site": "end-user site",
  "test lab/standards body": "test lab/standards body",
  "test lab": "test lab/standards body",
  "standards body": "test lab/standards body",
  "testing lab": "test lab/standards body",
  "clemson/sc research center or facility": "Clemson/SC research center or facility",
  "research center": "Clemson/SC research center or facility",
  "clemson facility": "Clemson/SC research center or facility",
  "federal program": "federal program",
  sbir: "federal program",
  sttr: "federal program",
  "sbir/sttr": "federal program",
  nsf: "federal program",
  "nsf pfi": "federal program",
  "i-corps": "federal program",
  icorps: "federal program",
  doe: "federal program",
  nih: "federal program",
  "sc program": "SC program",
  scra: "SC program",
  "sc launch": "SC program",
  scri: "SC program"
};

const EFFORT_ALIASES = {
  low: "low",
  small: "low",
  modest: "low",
  medium: "medium",
  moderate: "medium",
  mid: "medium",
  high: "high",
  large: "high"
};

const EMPTY_NAME = new Set(["unknown", "n/a", "na", "none", "tbd", "not found", "unspecified", "unverified"]);

function clean(value, max){
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

export function pilotProofUrl(value){
  const match = String(value || "").match(/https?:\/\/[^\s)]+/i);
  if(!match) return "";
  return match[0].replace(/[.,;]+$/, "");
}

function mapType(value){
  const key = clean(value, 80).toLowerCase();
  return TYPE_ALIASES[key] || "";
}

function mapEffort(value){
  const key = clean(value, 40).toLowerCase().replace(/\s*(effort|cost)(\s*\/\s*(effort|cost))?$/, "").trim();
  return EFFORT_ALIASES[key] || "";
}

function coercePriorPilot(raw){
  if(!raw || typeof raw !== "object") return null;
  const name = clean(raw.name || raw.program || raw.study || raw.title, 180);
  if(name.length < 2 || EMPTY_NAME.has(name.toLowerCase())) return null;
  if(/no verified prior pilot/i.test(name)) return null;
  const source = pilotProofUrl(raw.source || raw.source_url || raw.url || raw.link);
  if(!source) return null;
  const yearMatch = clean(raw.year || raw.date, 24).match(/\d{4}(?:\s*[-–]\s*\d{4})?/);
  const year = yearMatch ? yearMatch[0].replace(/\s+/g, "") : "";
  return {
    name,
    year,
    what_it_tested: clean(raw.what_it_tested || raw.tested || raw.summary || raw.result, 300),
    alignment: clean(raw.alignment || raw.how_it_aligns || raw.relevance || raw.why_it_aligns, 300),
    source
  };
}

export function coercePilotTarget(raw){
  if(!raw || typeof raw !== "object") return null;
  const name = clean(raw.name || raw.organization || raw.program || raw.org, 180);
  if(name.length < 2 || EMPTY_NAME.has(name.toLowerCase())) return null;
  const type = mapType(raw.type || raw.kind);
  if(!PILOT_TARGET_TYPES.includes(type)) return null;
  const what = clean(raw.what_it_proves || raw.proves || raw.milestone || raw.proof, 400);
  const why = clean(raw.why_it_fits || raw.why || raw.fit, 400);
  if(!what || !why) return null;
  const prior = [];
  const seenPilots = new Set();
  (Array.isArray(raw.prior_pilots) ? raw.prior_pilots : []).forEach(item => {
    const pilot = coercePriorPilot(item);
    if(!pilot) return;
    const key = pilot.name.toLowerCase() + "|" + pilot.source.toLowerCase();
    if(seenPilots.has(key)) return;
    seenPilots.add(key);
    prior.push(pilot);
  });
  const ownSource = pilotProofUrl(raw.source || raw.source_url || raw.url || raw.proof_source);
  const source = ownSource || (prior[0] ? prior[0].source : "");
  const verified = prior.length > 0 || !!ownSource;
  return {
    name,
    type,
    what_it_proves: what,
    why_it_fits: why,
    sc_connection: clean(raw.sc_connection || raw.southeast_connection || raw.regional_connection, 240),
    effort: mapEffort(raw.effort || raw.effort_cost || raw.cost),
    source,
    prior_pilots: prior,
    prior_pilot_note: prior.length ? "" : NO_VERIFIED_PRIOR_PILOT,
    verified
  };
}

function uniqueTargets(list){
  const seen = new Set();
  const out = [];
  list.forEach(item => {
    const target = coercePilotTarget(item);
    if(!target) return;
    const key = target.name.toLowerCase();
    if(seen.has(key)) return;
    seen.add(key);
    out.push(target);
  });
  return out;
}

function rankTargets(list){
  return list
    .map((target, index) => ({ target, index }))
    .sort((a, b) => {
      const group = item => {
        if(!item.target.verified) return 2;
        if(item.target.prior_pilots.length) return 0;
        return 1;
      };
      const byGroup = group(a) - group(b);
      if(byGroup) return byGroup;
      const byPilots = b.target.prior_pilots.length - a.target.prior_pilots.length;
      if(byPilots) return byPilots;
      return a.index - b.index;
    })
    .map(item => item.target);
}

export function normalizePilotPayload(parsed, options){
  const force = !!(options && options.enforce);
  if(!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const fromList = Array.isArray(parsed.pilot_targets) ? parsed.pilot_targets : null;
  const recommendation = clean(parsed.pilot_recommendation, 40).toLowerCase();
  const gapText = clean(parsed.biggest_proof_gap, 20);
  const stepText = clean(parsed.suggested_next_step, 20);
  const corePlaceholder = !force && parsed.recommended_path && (!fromList || fromList.length === 0) && !gapText && !stepText && recommendation !== "pursue" && recommendation !== "not recommended";
  if(corePlaceholder) return null;

  const looksPilot = force || fromList || recommendation === "pursue" || recommendation === "not recommended" || gapText || stepText;
  if(!looksPilot) return null;

  const targets = rankTargets(uniqueTargets(fromList || []));
  const verifiedCount = targets.filter(target => target.verified).length;
  const saidSkip = recommendation === "not recommended";
  const notRecommended = saidSkip && verifiedCount === 0 && targets.length === 0;
  const gap = clean(parsed.biggest_proof_gap, 280) || (notRecommended
    ? "Pilots aren't recommended. No marketable destination was found."
    : (verifiedCount ? "" : "No verified proof of prior work in this technical area was found."));
  const step = clean(parsed.suggested_next_step, 280) || (notRecommended
    ? "Do not start a pilot. Pilots aren't recommended until a real buyer or licensee exists."
    : (verifiedCount ? "" : "Look for a partner with a public pilot, paper, grant, or program page in this technology before committing staff time."));

  return Object.assign({}, parsed, {
    pilot_targets: notRecommended ? [] : targets,
    biggest_proof_gap: gap,
    suggested_next_step: step,
    pilot_recommendation: notRecommended ? "not recommended" : "pursue"
  });
}

function finalTextBlock(content){
  const blocks = (content || []).filter(block => block && block.type === "text" && typeof block.text === "string");
  return blocks.length ? blocks[blocks.length - 1] : null;
}

export function rewritePilotInResponse(data, options){
  if(!data || !Array.isArray(data.content)) return data;
  const block = finalTextBlock(data.content);
  if(!block) return data;
  const start = String(block.text || "").indexOf("{");
  if(start === -1) return data;
  let depth = 0;
  let parsed = null;
  const text = String(block.text || "");
  for(let i = start; i < text.length; i++){
    if(text[i] === "{") depth++;
    else if(text[i] === "}"){
      depth--;
      if(depth === 0){
        try { parsed = JSON.parse(text.slice(start, i + 1)); }
        catch (err) { parsed = null; }
        break;
      }
    }
  }
  const normalized = normalizePilotPayload(parsed, options);
  if(!normalized) return data;
  const copy = Object.assign({}, data, { content: data.content.map(item => Object.assign({}, item)) });
  const rewritten = finalTextBlock(copy.content);
  rewritten.text = JSON.stringify(normalized);
  return copy;
}

export const PILOT_EVALUATION_KEYS = [
  "pilot_targets",
  "biggest_proof_gap",
  "suggested_next_step",
  "pilot_recommendation",
  "pilot_search_error"
];

export function isPilotHardPass(record){
  const ev = record && record.evaluation && typeof record.evaluation === "object" ? record.evaluation : {};
  const path = clean(ev.recommended_path, 40).toUpperCase();
  const demand = clean(ev.market_demand_verdict, 40).toUpperCase();
  if(path === "NO_DEMAND" || demand === "NONE" || demand === "WEAK") return true;
  if(clean(ev.licensing_recommendation, 40).toLowerCase() === "hard pass") return true;
  if(Array.isArray(ev.licensing_targets) && ev.licensing_targets.length < 3) return true;
  return false;
}

export function pilotNotRecommendedSection(){
  return {
    pilot_targets: [],
    pilot_recommendation: "not recommended",
    biggest_proof_gap: "Pilots aren't recommended. This is a hard pass with no marketable destination.",
    suggested_next_step: "Do not recruit a pilot partner. Pilots aren't recommended until a real buyer or licensee exists.",
    pilot_search_error: ""
  };
}

export function pilotSearchInputFromRecord(record){
  const source = record && typeof record === "object" ? record : {};
  const ev = source.evaluation && typeof source.evaluation === "object" ? source.evaluation : {};
  const licensing = Array.isArray(ev.licensing_targets) ? ev.licensing_targets : (Array.isArray(source.licensing_targets) ? source.licensing_targets : []);
  return {
    title: source.title || "",
    dept: source.dept || "",
    text: source.text || ev.marketing_abstract || "",
    abstract: ev.marketing_abstract || source.abstract || "",
    claims_summary: ev.unsupported_claims || source.claims_summary || "",
    recommended_path: ev.recommended_path || source.recommended_path || "",
    market_demand_rationale: ev.market_demand_rationale || source.market_demand_rationale || "",
    trl_rationale: ev.trl_rationale || source.trl_rationale || "",
    unsupported_claims: ev.unsupported_claims || source.unsupported_claims || "",
    sc_industry_group: ev.sc_industry_group || source.sc_industry_group || "",
    licensing_targets: licensing.map(item => ({
      name: item && (item.name || item.company_name) || "",
      type: item && (item.type || item.sector) || "",
      why_it_fits: item && (item.why_it_fits || item.rationale) || ""
    })).filter(item => item.name)
  };
}

export function readPilotSection(data){
  const rewritten = rewritePilotInResponse(data, { enforce: true });
  const blocks = (rewritten && rewritten.content || []).filter(block => block && block.type === "text" && typeof block.text === "string");
  const text = blocks.length ? blocks[blocks.length - 1].text : "";
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (err) { parsed = null; }
  if(!parsed || !Array.isArray(parsed.pilot_targets)){
    throw new Error("Pilot target search did not return targets");
  }
  return {
    pilot_targets: parsed.pilot_targets,
    biggest_proof_gap: parsed.biggest_proof_gap || "",
    suggested_next_step: parsed.suggested_next_step || "",
    pilot_recommendation: parsed.pilot_recommendation === "not recommended" && !parsed.pilot_targets.length ? "not recommended" : "pursue",
    pilot_search_error: ""
  };
}

export function applyPilotFields(record, fields){
  const copy = JSON.parse(JSON.stringify(record && typeof record === "object" ? record : {}));
  if(!copy.evaluation || typeof copy.evaluation !== "object" || Array.isArray(copy.evaluation)){
    copy.evaluation = {};
  }
  const patch = fields && typeof fields === "object" ? fields : {};
  PILOT_EVALUATION_KEYS.forEach(key => {
    if(Object.prototype.hasOwnProperty.call(patch, key)) copy.evaluation[key] = patch[key];
  });
  return copy;
}

export function countVerifiedPilots(targets){
  return (Array.isArray(targets) ? targets : []).filter(target => target && target.verified).length;
}

export function buildPilotSearchRequest(patent){
  const input = patent && typeof patent === "object" ? patent : {};
  const title = clean(input.title, 300) || "Untitled";
  const dept = clean(input.dept, 160) || "Unspecified";
  const text = clean(input.text || input.abstract, 4000);
  const path = clean(input.recommended_path, 40);
  const demand = clean(input.market_demand_rationale, 300);
  const trl = clean(input.trl_rationale, 240);
  const claims = clean(input.claims_summary || input.unsupported_claims, 400);
  const summary = clean(input.abstract, 600);
  const group = clean(input.sc_industry_group, 120);
  const licensing = (Array.isArray(input.licensing_targets) ? input.licensing_targets : [])
    .map(item => ({
      name: clean(item && (item.name || item.company_name), 180),
      type: clean(item && item.type, 80),
      why: clean(item && (item.why_it_fits || item.rationale), 240)
    }))
    .filter(item => item.name)
    .slice(0, 8);
  const system = [
    "You are finding real places a university technology transfer office could pilot, validate, or prove a Clemson patent so a later license is easier.",
    "The office is the Clemson University Research Foundation (CURF) in South Carolina.",
    "Use the web_search tool. This requirement is strict: every pilot_targets entry you return must include at least one http or https source proving that organization or program has already done work in this technical area.",
    "Acceptable proof is a press release, paper, grant award, program page, patent, or case study. The source field, or a prior_pilots source, must be that page's URL. A name with no URL is not proof.",
    "Relevant prior pilots are the point of the search. For each organization, find previous pilots, validation programs, or studies it actually ran that align with this specific patent.",
    "Each prior_pilots entry needs the program or study name, the year, what it tested, how that lines up with this patent, and the source URL.",
    "Rank the array with organizations that have verified, closely aligned prior pilots first. A close technical match outranks a famous name with an unrelated program.",
    "Never fabricate a pilot, a year, a partner, a result, or a URL. If you cannot find a verifiable prior pilot, do not describe one. Set prior_pilots to an empty array and set prior_pilot_note to exactly: " + NO_VERIFIED_PRIOR_PILOT + ".",
    "If you cannot find any URL proving prior work in this technical area, omit that organization. Do not invent a source to keep it. Do not pad the list.",
    "Aim for at least 3 organizations when the pages support that many. Fewer is acceptable. More is fine when each one has its own proof link.",
    "name is the organization or program. Never a generic label such as a large chemical company.",
    "type is exactly one of: industry pilot partner, end-user site, test lab/standards body, Clemson/SC research center or facility, federal program, SC program.",
    "Federal programs include SBIR, STTR, NSF PFI, I-Corps, DOE, and NIH. South Carolina programs include SCRA and SC Launch. Use those types only when the page is that program.",
    "what_it_proves is the specific milestone or data a licensee would want from the pilot, one sentence.",
    "why_it_fits is one sentence on the technical fit. sc_connection is a South Carolina or Southeast tie when the page shows one: plant, lab, campus, or program office. Use an empty string when it does not. Do not guess a location.",
    "effort is exactly low, medium, or high, a rough staff-time and cost read, not a dollar quote.",
    "biggest_proof_gap is one line on the evidence this patent still lacks, such as no prototype, no field data, or no scale-up.",
    "suggested_next_step is one line naming the first pilot to pursue.",
    "Set pilot_recommendation to \"pursue\" when you name any sourced target. Do not use this search to declare a hard pass. A hard pass is decided before this search runs.",
    "Use at most 3 searches. Work quickly, this runs under a fixed time limit.",
    "Respond with ONLY valid JSON as your final message, no markdown fences, no commentary, matching exactly this shape: " + PILOT_OUTPUT_SHAPE + "."
  ].join(" ");
  const lines = [
    "Department: " + dept,
    "Title: " + title
  ];
  if(path) lines.push("Commercial path already assigned: " + path + ". Suggest pilots that would make that path easier to license. Do not repeat a buyer list.");
  if(group) lines.push("Technology industry group, for context only: " + group);
  if(demand) lines.push("Demand note from the evaluation: " + demand);
  if(trl) lines.push("Readiness note: " + trl);
  if(claims) lines.push("Claims summary: " + claims);
  if(summary && summary !== text) lines.push("Plain-language summary: " + summary);
  if(licensing.length){
    lines.push("Licensing destinations already stored. Use them only as context for fit. Name one as a pilot target only when a page shows that organization has already done work in this technical area. Do not copy the list to fill empty slots.");
    licensing.forEach(item => {
      lines.push("- " + item.name + (item.type ? " (" + item.type + ")" : "") + (item.why ? ": " + item.why : ""));
    });
  }
  lines.push("Abstract or disclosure text:");
  lines.push(text || "No disclosure text was provided.");
  return {
    system,
    messages: [{ role: "user", content: lines.join("\n") }],
    max_tokens: 4000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]
  };
}

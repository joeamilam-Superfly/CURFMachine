/* Generated from netlify/lib/venture-readiness.js. Do not edit this copy. */
(function(root){
root.CURF_VENTURE = (function(){
// Venture readiness for publications.
//
// The model only extracts evidence from the abstract or paper text.
// Points, the band, the recommended path, the disclosure flag, and the
// advice line are computed here. A model-supplied point total is ignored.
// Patents do not use this rubric.

const PUBLICATION_SCHEMA_VERSION = "publication-venture-v1";

const CAVEAT = "This is not legal advice. Check with CURF or a patent lawyer.";

const BANDS = [
  { id: "venture_ready", label: "Ready to pursue", min: 75 },
  { id: "promising", label: "Promising, lower the risk first", min: 55 },
  { id: "early", label: "Early research", min: 35 },
  { id: "not_commercial", label: "Not ready to sell", min: 0 }
];

const PATHS = [
  { id: "file_disclosure", label: "File with CURF now" },
  { id: "explore_startup", label: "Look at a startup" },
  { id: "gap_funding", label: "Ask for early funding" },
  { id: "sponsored_research", label: "Find a company partner" },
  { id: "license_knowhow", label: "License the know-how" },
  { id: "not_ready", label: "Check back later" }
];

const NOVELTY = {
  incremental: "incremental",
  "clear improvement": "clear_improvement",
  clear_improvement: "clear_improvement",
  improvement: "clear_improvement",
  "step change": "step_change",
  "step-change": "step_change",
  step_change: "step_change"
};

const MARKET = {
  none: "none",
  "no market": "none",
  "none named": "none",
  plausible: "plausible_sector",
  plausible_sector: "plausible_sector",
  sector: "plausible_sector",
  "plausible sector": "plausible_sector",
  specific_buyer: "specific_buyer",
  "specific buyer": "specific_buyer",
  buyer: "specific_buyer"
};

const PATH_LEVEL = {
  none: "none",
  sketched: "sketched",
  sketch: "sketched",
  concrete: "concrete"
};

const ASSET = {
  invention: "invention",
  patent: "invention",
  software: "software",
  materials: "materials",
  material: "materials",
  know_how: "know_how",
  "know-how": "know_how",
  knowhow: "know_how",
  none: "none"
};

const TEAM = {
  industry_coauthor: "industry_coauthor",
  "industry co-author": "industry_coauthor",
  "industry coauthor": "industry_coauthor",
  coauthor: "industry_coauthor",
  prior_patent: "prior_patent",
  "prior patent": "prior_patent",
  patent: "prior_patent",
  prior_startup: "prior_startup",
  "prior startup": "prior_startup",
  startup: "prior_startup",
  sbir: "sbir"
};

const EVIDENCE_SHAPE = "{\"publication_date\":\"YYYY-MM-DD or null\",\"disclosure_state\":\"pre_publication|published|unknown\",\"novelty\":\"incremental|clear_improvement|step_change\",\"novelty_quantified\":false,\"novelty_evidence\":\"string\",\"trl\":1,\"trl_evidence\":\"string\",\"claimable\":false,\"ip_filed\":false,\"protectability_evidence\":\"string\",\"market\":\"none|plausible_sector|specific_buyer\",\"market_evidence\":\"string\",\"path\":\"none|sketched|concrete\",\"path_evidence\":\"string\",\"asset_form\":\"invention|software|materials|know_how|none\",\"team_signals\":[\"industry_coauthor|prior_patent|prior_startup|sbir\"],\"team_evidence\":\"string\",\"sc_industry_group\":\"string\"}";

function clean(value, max){
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function lookup(table, value, fallback){
  const key = clean(value, 80).toLowerCase();
  return table[key] || fallback;
}

function asBool(value){
  if(value === true || value === 1) return true;
  const text = clean(value, 20).toLowerCase();
  return text === "true" || text === "yes";
}

function parseISODate(value){
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(value, 20));
  if(!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if(date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function isoDate(date){
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return date.getUTCFullYear() + "-" + month + "-" + day;
}

function asOfDate(value){
  if(value instanceof Date && !Number.isNaN(value.getTime())){
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  return parseISODate(value) || parseISODate(new Date().toISOString().slice(0, 10));
}

function addYears(date, years){
  return new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate()));
}

function daysBetween(from, to){
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function clipSignals(value){
  const list = Array.isArray(value) ? value : String(value || "").split(/[,;/]/);
  const found = [];
  list.forEach(item => {
    const signal = TEAM[clean(item, 80).toLowerCase()];
    if(signal && found.indexOf(signal) === -1) found.push(signal);
  });
  return found;
}

function normalizePublicationEvidence(raw){
  const source = raw && typeof raw === "object" ? raw : {};
  const trl = Math.round(Number(source.trl));
  return {
    publication_date: parseISODate(source.publication_date) ? isoDate(parseISODate(source.publication_date)) : null,
    disclosure_state: lookup({ pre_publication: "pre_publication", "pre-publication": "pre_publication", unpublished: "pre_publication", published: "published", unknown: "unknown" }, source.disclosure_state, "unknown"),
    novelty: lookup(NOVELTY, source.novelty, "incremental"),
    novelty_quantified: asBool(source.novelty_quantified),
    novelty_evidence: clean(source.novelty_evidence, 280),
    trl: trl >= 1 && trl <= 9 ? trl : 1,
    trl_evidence: clean(source.trl_evidence, 280),
    claimable: asBool(source.claimable),
    ip_filed: asBool(source.ip_filed),
    protectability_evidence: clean(source.protectability_evidence, 280),
    market: lookup(MARKET, source.market, "none"),
    market_evidence: clean(source.market_evidence, 280),
    path: lookup(PATH_LEVEL, source.path, "none"),
    path_evidence: clean(source.path_evidence, 280),
    asset_form: lookup(ASSET, source.asset_form, "none"),
    team_signals: clipSignals(source.team_signals),
    team_evidence: clean(source.team_evidence, 280),
    sc_industry_group: clean(source.sc_industry_group, 120)
  };
}

function clock(evidence, asOf){
  const today = asOfDate(asOf);
  const published = parseISODate(evidence.publication_date);
  if(evidence.disclosure_state === "pre_publication" && !published){
    return { state: "pre_publication", barDate: null, daysLeft: null };
  }
  if(published && published.getTime() > today.getTime()){
    return { state: "pre_publication", barDate: null, daysLeft: null };
  }
  if(!published) return { state: "unknown", barDate: null, daysLeft: null };
  const bar = addYears(published, 1);
  const daysLeft = daysBetween(today, bar);
  if(daysLeft < 0) return { state: "bar_passed", barDate: isoDate(bar), daysLeft };
  return { state: "grace", barDate: isoDate(bar), daysLeft };
}

function disclosureFlag(evidence, asOf){
  const timing = clock(evidence || {}, asOf);
  if(timing.state === "pre_publication"){
    return { level: "green", label: "Not published yet", detail: "This work is not public yet.", barDate: null, daysLeft: null, caveat: CAVEAT };
  }
  if(timing.state === "unknown"){
    return { level: "unknown", label: "Publication date unknown", detail: "We need a publication date before we can count the US filing window.", barDate: null, daysLeft: null, caveat: CAVEAT };
  }
  if(timing.state === "bar_passed"){
    return { level: "red", label: "Too late to file in the US", detail: "The one-year US filing window ended on " + timing.barDate + ".", barDate: timing.barDate, daysLeft: timing.daysLeft, caveat: CAVEAT };
  }
  const dayWord = timing.daysLeft === 1 ? "day" : "days";
  return {
    level: "amber",
    label: "US filing window only. Other countries are likely closed.",
    detail: "You can still file in the US until " + timing.barDate + ". " + timing.daysLeft + " " + dayWord + " left.",
    barDate: timing.barDate,
    daysLeft: timing.daysLeft,
    caveat: CAVEAT
  };
}

function noveltyPoints(evidence){
  if(evidence.novelty === "step_change" && evidence.novelty_quantified) return 20;
  if(evidence.novelty === "step_change" || evidence.novelty === "clear_improvement") return 10;
  return 0;
}

function trlPoints(trl){
  if(trl >= 5) return 15;
  if(trl >= 3) return 8;
  return 3;
}

function protectabilityPoints(evidence, timing){
  if(!evidence.claimable && !evidence.ip_filed) return 0;
  if(evidence.ip_filed) return 20;
  if(!evidence.claimable) return 0;
  if(timing.state === "bar_passed") return 0;
  if(timing.state === "grace" || timing.state === "pre_publication") return 20;
  return 10;
}

function marketPoints(market){
  if(market === "specific_buyer") return 20;
  if(market === "plausible_sector") return 10;
  return 0;
}

function pathPoints(path){
  if(path === "concrete") return 10;
  if(path === "sketched") return 5;
  return 0;
}

function teamPoints(signals){
  const count = (signals || []).length;
  if(count >= 2) return 10;
  if(count === 1) return 5;
  return 0;
}

function scPoints(alignmentScore){
  const score = Number(alignmentScore) || 0;
  if(score >= 70) return 5;
  if(score >= 55) return 3;
  if(score > 0) return 1;
  return 0;
}

function bandFor(total){
  if(total >= 75) return BANDS[0];
  if(total >= 55) return BANDS[1];
  if(total >= 35) return BANDS[2];
  return BANDS[3];
}

function pathById(id){
  return PATHS.find(path => path.id === id);
}

function evidenceLine(text, fallback){
  return text || fallback;
}

function adviceFor(primary, evidence, flag, trl){
  if(primary.id === "file_disclosure"){
    if(flag.level === "green"){
      return "File with CURF before you publish. After you publish, you have one year to file in the US. Rights in other countries are usually lost. " + CAVEAT;
    }
    return "File with CURF now. " + flag.detail + " Rights in other countries are likely already lost. " + CAVEAT;
  }
  if(primary.id === "explore_startup"){
    return "Talk with CURF about a startup. Start with NSF I-Corps to test the buyer named in the paper. Then look at SCRA or SC Launch if a South Carolina company is the right next step.";
  }
  if(primary.id === "gap_funding"){
    return "The paper shows a measured step past earlier work, and it is still early (level " + trl + "). Ask CURF about early funding before you look for a company.";
  }
  if(primary.id === "sponsored_research"){
    return "A specific buyer has a costly problem, and this paper is a weak patent. Ask CURF about a research contract or a company partner.";
  }
  if(primary.id === "license_knowhow"){
    const asset = evidence.asset_form === "software" ? "software" : (evidence.asset_form === "materials" ? "materials" : "know-how");
    return "The useful piece is " + asset + ". Ask CURF about licensing that directly to a partner.";
  }
  return "This is not ready to sell on what we have now. " + (primary.detail || "Check again when a buyer, a prototype, or a filing plan is written down.");
}

function scoreVentureReadiness(raw, options){
  const evidence = normalizePublicationEvidence(raw && raw.evidence ? raw.evidence : raw);
  const settings = options || {};
  const timing = clock(evidence, settings.asOf);
  const flag = disclosureFlag(evidence, settings.asOf);
  const novelty = noveltyPoints(evidence);
  const maturity = trlPoints(evidence.trl);
  const protectability = protectabilityPoints(evidence, timing);
  const market = marketPoints(evidence.market);
  const route = pathPoints(evidence.path);
  const team = teamPoints(evidence.team_signals);
  const fit = scPoints(settings.alignmentScore);
  const criteria = [
    { id: "novelty", label: "What is new", points: novelty, max: 20, evidence: evidenceLine(evidence.novelty_evidence, novelty === 20 ? "The text shows a measured leap." : "The text does not show a measured leap.") },
    { id: "trl", label: "How far along it is", points: maturity, max: 15, evidence: evidenceLine(evidence.trl_evidence, "How far along: level " + evidence.trl + ".") },
    { id: "protectability", label: "Can it be protected", points: protectability, max: 20, evidence: evidenceLine(evidence.protectability_evidence, protectability === 0 ? "Nothing that can be claimed is filed, or the US filing window has closed." : "A claim is still possible, or a filing already exists.") },
    { id: "market", label: "Who needs this", points: market, max: 20, evidence: evidenceLine(evidence.market_evidence, market === 0 ? "No buyer or industry is named." : "The text names a market.") },
    { id: "path", label: "Path to a product", points: route, max: 10, evidence: evidenceLine(evidence.path_evidence, route === 0 ? "No product path is described." : "A product path is described.") },
    { id: "team", label: "Signs of a founding team", points: team, max: 10, evidence: evidenceLine(evidence.team_evidence, team === 0 ? "No industry co-author, earlier patent, startup, or SBIR award is in the text." : "The text names a founder signal.") },
    { id: "sc_fit", label: "Fit with South Carolina", points: fit, max: 5, evidence: settings.industryGroup ? ("South Carolina fit is " + settings.industryGroup + (settings.alignmentScore ? ", score " + settings.alignmentScore : "") + ".") : "No South Carolina industry group matched." }
  ];
  const total = criteria.reduce((sum, row) => sum + row.points, 0);
  const band = bandFor(total);
  const matches = [];

  const withinWindow = timing.state === "grace" || timing.state === "pre_publication";
  if(protectability >= 10 && evidence.claimable && !evidence.ip_filed && withinWindow){
    const file = pathById("file_disclosure");
    matches.push({ id: file.id, label: file.label, detail: flag.level === "green" ? "File before you publish. There is no US deadline yet." : flag.detail });
  }
  if(total >= 65 && market >= 15 && route >= 7){
    const startup = pathById("explore_startup");
    matches.push({ id: startup.id, label: startup.label, detail: "NSF I-Corps, then SCRA or SC Launch." });
  }
  if(novelty >= 15 && evidence.trl >= 3 && evidence.trl <= 4){
    const gap = pathById("gap_funding");
    matches.push({ id: gap.id, label: gap.label, detail: "The work shows a measured leap and is still early (level " + evidence.trl + ")." });
  }
  if(market >= 15 && protectability === 0){
    const sponsored = pathById("sponsored_research");
    matches.push({ id: sponsored.id, label: sponsored.label, detail: "A specific buyer has a costly problem, and a patent is a weak fit." });
  }
  if((evidence.asset_form === "software" || evidence.asset_form === "materials" || evidence.asset_form === "know_how") && market >= 10){
    const license = pathById("license_knowhow");
    matches.push({ id: license.id, label: license.label, detail: "What a partner could take is " + (evidence.asset_form === "know_how" ? "know-how" : evidence.asset_form) + ", not a patent." });
  }
  const basicOnly = evidence.trl <= 2 && market === 0;
  if(total < 35 || basicOnly){
    const monitor = pathById("not_ready");
    const detail = basicOnly
      ? "Check again when there is a prototype or a named use."
      : "Check again when the work names a buyer or moves past an idea.";
    matches.push({ id: monitor.id, label: monitor.label, detail });
  }
  if(!matches.length){
    const monitor = pathById("not_ready");
    matches.push({ id: monitor.id, label: monitor.label, detail: "Check again when a buyer, a prototype, or a filing plan is written down." });
  }
  const primary = matches[0];
  const secondary = matches[1] || null;
  return {
    total,
    max: 100,
    band: band.id,
    bandLabel: band.label,
    criteria,
    paths: { primary, secondary },
    advice: adviceFor(primary, evidence, flag, evidence.trl),
    flag,
    caveat: CAVEAT,
    evidence
  };
}

function extractJsonObject(text){
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

function finalTextBlock(content){
  const blocks = (content || []).filter(block => block && block.type === "text" && typeof block.text === "string");
  return blocks.length ? blocks[blocks.length - 1] : null;
}

function buildPublicationEvidenceRequest(publication, groupNames){
  const input = publication && typeof publication === "object" ? publication : {};
  const groups = Array.isArray(groupNames) ? groupNames.filter(Boolean) : [];
  const system = [
    "You extract evidence for a university venture screen of one research publication.",
    "Use only the title, authors, date, and text in the user message. Do not search the web. Do not recall facts that are not in that text.",
    "Do not invent a publication date, a buyer, a company, a patent, a startup, an SBIR award, a co-author's employer, or a number.",
    "publication_date is YYYY-MM-DD only when that exact calendar date is written in the text. Otherwise null.",
    "disclosure_state is pre_publication only when the text says the work is not yet public. published when a publication date or a published venue is in the text. Otherwise unknown.",
    "novelty is incremental when the text describes a small or routine change, clear_improvement when it describes a real improvement without a measured step-change, and step_change only when the text describes a different way of doing something.",
    "novelty_quantified is true only when the text states a measured delta, percent, fold-change, or other number for that advantage. A qualitative claim is false.",
    "trl is the NASA technology readiness level from 1 to 9 supported by the text. A concept or review with no method in use is 1 or 2. A lab method is 3 or 4. A relevant environment or prototype is 5 or higher. Do not score a paper above the evidence.",
    "claimable is true only when the text describes a method, device, material, or software a patent claim could cover. A commentary, policy note, or observational association is false.",
    "ip_filed is true only when the text says a patent application or invention disclosure has been filed.",
    "market is none when no user or sector is named, plausible_sector when a sector is named without a specific buyer in pain, and specific_buyer only when a specific kind of buyer and a costly problem are both in the text.",
    "path is none, sketched when a product form is named, or concrete when the text also says who would build or buy it.",
    "asset_form is software, materials, know_how, invention, or none. Use software, materials, or know_how only when that is what a partner could take. Use invention for a patentable method or device. Use none when the text is commentary.",
    "team_signals may include industry_coauthor, prior_patent, prior_startup, and sbir, and only when the text says so. Otherwise an empty array.",
    "Each evidence string is one sentence under 30 words, quoting the support in the text. If the support is missing, say what is missing.",
    groups.length ? "sc_industry_group is exactly one of these PitchBook industry group names, or Unmatched: " + groups.join("; ") + ". Classify the work only. Do not name investors or dollars." : "sc_industry_group is Unmatched.",
    "Do not return points, a total, a band, or a recommended path.",
    "Respond with ONLY valid JSON as your final message, no markdown fences, no commentary, matching exactly this shape: " + EVIDENCE_SHAPE + "."
  ].join(" ");
  const lines = [
    "Title: " + (clean(input.title, 300) || "Untitled"),
    "Authors: " + (clean(input.authors, 400) || "Not stated"),
    "Publication date already on the record, use it only if you would also accept it from the text: " + (parseISODate(input.published) ? isoDate(parseISODate(input.published)) : "none"),
    "Text:",
    clean(input.text, 6000) || "No abstract or paper text was provided."
  ];
  return {
    system,
    messages: [{ role: "user", content: lines.join("\n") }],
    max_tokens: 1600
  };
}

function rewritePublicationEvidence(data){
  if(!data || !Array.isArray(data.content)) return data;
  const block = finalTextBlock(data.content);
  if(!block) return data;
  const parsed = extractJsonObject(block.text);
  if(!parsed || typeof parsed !== "object") return data;
  const evidence = normalizePublicationEvidence(parsed.evidence || parsed);
  const copy = Object.assign({}, data, { content: data.content.map(item => Object.assign({}, item)) });
  const rewritten = finalTextBlock(copy.content);
  rewritten.text = JSON.stringify({ evidence });
  return copy;
}

return { scoreVentureReadiness, normalizePublicationEvidence, disclosureFlag, buildPublicationEvidenceRequest, rewritePublicationEvidence, PATHS, BANDS, PUBLICATION_SCHEMA_VERSION, CAVEAT };
})();
})(typeof window !== "undefined" ? window : globalThis);

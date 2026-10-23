// Cheap, deterministic signals for the Clemson licensing triage.
// Computed from fields the BigQuery pull already returns. Nothing here
// calls a model. The same rules are duplicated in index.html so the
// registry can show a signal read before the background rank returns.
// If you change a rule, change it in both places.

const CPC_SECTION = {
  A: "Human necessities",
  B: "Operations and transport",
  C: "Chemistry and metallurgy",
  D: "Textiles and paper",
  E: "Fixed constructions",
  F: "Mechanical engineering",
  G: "Physics",
  H: "Electricity",
  Y: "Emerging cross-section"
};

const CPC_MARKET = {
  A61: "Medical or veterinary",
  A01: "Agriculture",
  C12: "Biotech and enzymes",
  C07: "Organic chemistry",
  C08: "Polymers",
  H01: "Electrical elements",
  H04: "Communications",
  G06: "Computing",
  G01: "Measuring and testing",
  B60: "Vehicles",
  B01: "Physical or chemical processes",
  A23: "Foods"
};

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

export function parseIsoDate(value){
  if(!value) return null;
  const text = String(value).trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!match) match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if(!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if(month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function yearsBetween(earlier, later){
  return (later.getTime() - earlier.getTime()) / MS_PER_YEAR;
}

function round1(value){
  return Math.round(value * 10) / 10;
}

export function classifyKind(patent){
  const kind = String(patent.kind_code || "").toUpperCase();
  const recordType = String(patent.record_type || "");
  const raw = String(patent.patent_id || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const number = raw.startsWith("US") ? raw.slice(2) : raw;
  if(kind.startsWith("S") || number.startsWith("D")) return "design";
  if(kind.startsWith("P") || number.startsWith("PP")) return "plant";
  if(kind.startsWith("A") || recordType === "Application") return "application";
  if(kind.startsWith("B") || recordType === "Grant") return "utility";
  return "unknown";
}

export function buildTriageSignals(patent, now = new Date()){
  const kind = classifyKind(patent);
  const filed = parseIsoDate(patent.filing_date);
  const published = parseIsoDate(patent.publication_date || patent.date);
  const today = now instanceof Date ? now : new Date(now);

  let remaining = null;
  let termBasis = "Not enough dates in this pull to estimate remaining term.";
  let expired = false;

  if(kind === "design" && published){
    remaining = 15 - yearsBetween(published, today);
    termBasis = "Design term estimated as 15 years from the grant publication. Patents issuing from applications filed before 13 May 2015 were 14 years from grant. This is not an official expiry date.";
    expired = remaining <= 0;
  } else if(filed && kind !== "design"){
    remaining = 20 - yearsBetween(filed, today);
    termBasis = "Term estimated as 20 years from filing, ignoring patent term adjustment and terminal disclaimers.";
    if(kind === "application") termBasis += " This record is still an application, so there is no granted patent yet.";
    expired = remaining <= 0;
  } else if(published && yearsBetween(published, today) > 20){
    expired = true;
    termBasis = "Publication is more than 20 years ago. A US utility or plant right would be expired even if it had been filed on the publication date, and filing is earlier than publication. Official lapse was not checked.";
  } else if(published && kind === "utility"){
    termBasis = "Filing date was not in this pull, so remaining term is not estimated from the grant date alone.";
  }

  const ageYears = published ? yearsBetween(published, today) : null;
  let maintenance = "Maintenance-fee status was not in this pull. This note is not a lapse determination.";
  if(kind === "utility" && ageYears !== null && ageYears > 12){
    maintenance = "The grant is old enough that a 3.5, 7.5, or 11.5 year maintenance window has passed. Whether the fee was paid was not checked.";
  } else if(kind === "utility" && ageYears !== null && ageYears > 4){
    maintenance = "At least one utility maintenance window may have opened. Payment was not checked.";
  } else if(kind === "application"){
    maintenance = "Published applications do not owe utility maintenance fees until grant.";
  } else if(kind === "design" || kind === "plant"){
    maintenance = "Design and plant patents are not on the utility maintenance-fee schedule. Official status was not checked.";
  }

  const assignees = Array.isArray(patent.assignees) ? patent.assignees : [];
  const coAssignees = assignees.filter(name => name && !/clemson/i.test(String(name)));
  const cpc = (Array.isArray(patent.cpc_codes) ? patent.cpc_codes : []).map(code => String(code || "").trim()).filter(Boolean);
  const sectionLetter = cpc.length ? cpc[0].charAt(0).toUpperCase() : "";
  const prefix = cpc.length ? cpc[0].replace(/\s/g, "").slice(0, 3).toUpperCase() : "";
  const backward = patent.backward_citation_count === null || patent.backward_citation_count === undefined || patent.backward_citation_count === ""
    ? null
    : Number(patent.backward_citation_count);
  const familySize = patent.family_size_in_pull === null || patent.family_size_in_pull === undefined || patent.family_size_in_pull === ""
    ? null
    : Number(patent.family_size_in_pull);

  return {
    kind,
    filing_date: filed ? filed.toISOString().slice(0, 10) : null,
    publication_date: published ? published.toISOString().slice(0, 10) : null,
    age_years: ageYears === null ? null : round1(ageYears),
    remaining_term_years: remaining === null ? null : round1(remaining),
    term_basis: termBasis,
    term_expired_estimate: expired,
    maintenance_note: maintenance,
    backward_citations: Number.isFinite(backward) ? backward : null,
    family_size_in_pull: Number.isFinite(familySize) ? familySize : null,
    family_note: Number.isFinite(familySize)
      ? "Family size counts only records in this pull that share a family id, not the worldwide family."
      : "No family id was available in this pull.",
    co_assignees: coAssignees,
    cpc_section: CPC_SECTION[sectionLetter] || null,
    cpc_market_hint: CPC_MARKET[prefix] || null,
    has_abstract: !!(patent.abstract && String(patent.abstract).trim().length > 40)
  };
}

export function normalizeTier(value){
  const text = String(value || "").toLowerCase();
  if(text.startsWith("high")) return "High";
  if(text.startsWith("med")) return "Medium";
  if(text.startsWith("low")) return "Low";
  if(text.indexOf("need") !== -1 || text.indexOf("work") !== -1) return "Needs work";
  return "Needs work";
}

export function normalizeConfidence(value){
  const text = String(value || "").toLowerCase();
  if(text.startsWith("h")) return "high";
  if(text.startsWith("m")) return "medium";
  return "low";
}

export function applyTermOverride(row, signals){
  const tier = normalizeTier(row && row.tier);
  let confidence = normalizeConfidence(row && row.confidence);
  let reason = String((row && row.reason) || "").replace(/\s+/g, " ").trim().slice(0, 280);
  if(!reason) reason = "No reason returned.";
  if(signals && signals.term_expired_estimate){
    if(confidence === "high") confidence = "medium";
    return {
      tier: "Needs work",
      confidence,
      reason: ("Estimated statutory term has run out, and lapse was not checked against USPTO fees. " + reason).slice(0, 320)
    };
  }
  if(signals && signals.has_abstract === false && tier === "High"){
    return {
      tier: "Needs work",
      confidence: "low",
      reason: ("No usable abstract was in this pull, so a high licensing read is not supported. " + reason).slice(0, 320)
    };
  }
  return { tier, confidence, reason };
}

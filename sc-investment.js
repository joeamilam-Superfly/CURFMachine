/* Generated from netlify/functions/sc-investment.js. Do not edit this copy. */
window.CURF_SC = (function(){
// South Carolina investment alignment.
//
// Aggregates only. Built from the PitchBook industry-group pivot
// (completed South Carolina deals, 2023 through 2026 YTD, as of
// 7 Oct 2026) and the focus-area labels on that sheet. Investor names,
// investor descriptions, and the investor-level sheet are not in this
// file and must not be added to a model prompt.
//
// median_capital_musd is a deal-weighted average of the yearly medians
// PitchBook reported. It is a typical check size. It is not the sum of
// dollars invested. Years with no reported median are left out of that
// average and still count in the deal totals.
//
// The same aggregates are seeded by supabase-sc-investment.sql. This
// module is what the app actually scores with, so a rank or an
// evaluation does not need a database round trip. The browser copy is
// sc-investment.js and must be regenerated from this file.

const AS_OF = "2026-10-07";
const VOLUME_ANCHOR = 522;
const FOCUS_BONUS = 40;

const GROUPS = [
  {
    "industry_group": "Other Business Products and Services",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 521,
    "deals_2023": 159,
    "deals_2024": 163,
    "deals_2025": 146,
    "deals_2026_ytd": 53,
    "recent_deals": 199,
    "median_capital_musd": 5.7978,
    "deals_with_median": 521
  },
  {
    "industry_group": "Commercial Services",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 468,
    "deals_2023": 114,
    "deals_2024": 149,
    "deals_2025": 128,
    "deals_2026_ytd": 77,
    "recent_deals": 205,
    "median_capital_musd": 2.833,
    "deals_with_median": 468
  },
  {
    "industry_group": "Software",
    "focus_area": "Software & IT (AI / quantum proxy)",
    "is_focus": true,
    "deal_count": 250,
    "deals_2023": 71,
    "deals_2024": 72,
    "deals_2025": 63,
    "deals_2026_ytd": 44,
    "recent_deals": 107,
    "median_capital_musd": 0.4613,
    "deals_with_median": 250
  },
  {
    "industry_group": "Services (Non-Financial)",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 208,
    "deals_2023": 46,
    "deals_2024": 62,
    "deals_2025": 84,
    "deals_2026_ytd": 16,
    "recent_deals": 100,
    "median_capital_musd": 0.6731,
    "deals_with_median": 208
  },
  {
    "industry_group": "Commercial Products",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 207,
    "deals_2023": 58,
    "deals_2024": 50,
    "deals_2025": 54,
    "deals_2026_ytd": 45,
    "recent_deals": 99,
    "median_capital_musd": 1.4184,
    "deals_with_median": 207
  },
  {
    "industry_group": "Healthcare Services",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 175,
    "deals_2023": 36,
    "deals_2024": 48,
    "deals_2025": 64,
    "deals_2026_ytd": 27,
    "recent_deals": 91,
    "median_capital_musd": 15.0212,
    "deals_with_median": 175
  },
  {
    "industry_group": "Restaurants, Hotels and Leisure",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 137,
    "deals_2023": 35,
    "deals_2024": 41,
    "deals_2025": 44,
    "deals_2026_ytd": 17,
    "recent_deals": 61,
    "median_capital_musd": 39.3112,
    "deals_with_median": 137
  },
  {
    "industry_group": "Consumer Non-Durables",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 68,
    "deals_2023": 19,
    "deals_2024": 20,
    "deals_2025": 22,
    "deals_2026_ytd": 7,
    "recent_deals": 29,
    "median_capital_musd": 0.9374,
    "deals_with_median": 68
  },
  {
    "industry_group": "Transportation",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 68,
    "deals_2023": 19,
    "deals_2024": 22,
    "deals_2025": 14,
    "deals_2026_ytd": 13,
    "recent_deals": 27,
    "median_capital_musd": 293.6716,
    "deals_with_median": 68
  },
  {
    "industry_group": "Other Financial Services",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 59,
    "deals_2023": 10,
    "deals_2024": 27,
    "deals_2025": 15,
    "deals_2026_ytd": 7,
    "recent_deals": 22,
    "median_capital_musd": 148.828,
    "deals_with_median": 59
  },
  {
    "industry_group": "Healthcare Technology Systems",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 58,
    "deals_2023": 21,
    "deals_2024": 13,
    "deals_2025": 18,
    "deals_2026_ytd": 6,
    "recent_deals": 24,
    "median_capital_musd": 1.2238,
    "deals_with_median": 58
  },
  {
    "industry_group": "Healthcare Devices and Supplies",
    "focus_area": "Medical Devices",
    "is_focus": true,
    "deal_count": 53,
    "deals_2023": 21,
    "deals_2024": 11,
    "deals_2025": 15,
    "deals_2026_ytd": 6,
    "recent_deals": 21,
    "median_capital_musd": 1.0147,
    "deals_with_median": 53
  },
  {
    "industry_group": "IT Services",
    "focus_area": "Software & IT (AI / quantum proxy)",
    "is_focus": true,
    "deal_count": 47,
    "deals_2023": 15,
    "deals_2024": 13,
    "deals_2025": 9,
    "deals_2026_ytd": 10,
    "recent_deals": 19,
    "median_capital_musd": 16.2011,
    "deals_with_median": 47
  },
  {
    "industry_group": "Pharmaceuticals and Biotechnology",
    "focus_area": "Life Sciences / Drug Delivery (proxy)",
    "is_focus": true,
    "deal_count": 47,
    "deals_2023": 14,
    "deals_2024": 9,
    "deals_2025": 18,
    "deals_2026_ytd": 6,
    "recent_deals": 24,
    "median_capital_musd": 8.2738,
    "deals_with_median": 47
  },
  {
    "industry_group": "Consumer Durables",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 39,
    "deals_2023": 14,
    "deals_2024": 7,
    "deals_2025": 17,
    "deals_2026_ytd": 1,
    "recent_deals": 18,
    "median_capital_musd": 2.5967,
    "deals_with_median": 39
  },
  {
    "industry_group": "Insurance",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 39,
    "deals_2023": 10,
    "deals_2024": 10,
    "deals_2025": 13,
    "deals_2026_ytd": 6,
    "recent_deals": 19,
    "median_capital_musd": 1.7713,
    "deals_with_median": 39
  },
  {
    "industry_group": "Retail",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 38,
    "deals_2023": 12,
    "deals_2024": 11,
    "deals_2025": 10,
    "deals_2026_ytd": 5,
    "recent_deals": 15,
    "median_capital_musd": 0.5364,
    "deals_with_median": 33
  },
  {
    "industry_group": "Computer Hardware",
    "focus_area": "Software & IT (AI / quantum proxy)",
    "is_focus": true,
    "deal_count": 36,
    "deals_2023": 10,
    "deals_2024": 11,
    "deals_2025": 7,
    "deals_2026_ytd": 8,
    "recent_deals": 15,
    "median_capital_musd": 0.2619,
    "deals_with_median": 36
  },
  {
    "industry_group": "Chemicals and Gases",
    "focus_area": "Advanced Materials (proxy)",
    "is_focus": true,
    "deal_count": 23,
    "deals_2023": 6,
    "deals_2024": 6,
    "deals_2025": 8,
    "deals_2026_ytd": 3,
    "recent_deals": 11,
    "median_capital_musd": 99.5948,
    "deals_with_median": 23
  },
  {
    "industry_group": "Apparel and Accessories",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 17,
    "deals_2023": 3,
    "deals_2024": 2,
    "deals_2025": 9,
    "deals_2026_ytd": 3,
    "recent_deals": 12,
    "median_capital_musd": 1.178,
    "deals_with_median": 15
  },
  {
    "industry_group": "Media",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 17,
    "deals_2023": 5,
    "deals_2024": 4,
    "deals_2025": 7,
    "deals_2026_ytd": 1,
    "recent_deals": 8,
    "median_capital_musd": 2.7588,
    "deals_with_median": 17
  },
  {
    "industry_group": "Containers and Packaging",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 14,
    "deals_2023": 2,
    "deals_2024": 8,
    "deals_2025": 2,
    "deals_2026_ytd": 2,
    "recent_deals": 4,
    "median_capital_musd": 55.1867,
    "deals_with_median": 12
  },
  {
    "industry_group": "Commercial Transportation",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 13,
    "deals_2023": 5,
    "deals_2024": 3,
    "deals_2025": 2,
    "deals_2026_ytd": 3,
    "recent_deals": 5,
    "median_capital_musd": 0.29,
    "deals_with_median": 13
  },
  {
    "industry_group": "Capital Markets/Institutions",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 12,
    "deals_2023": 1,
    "deals_2024": 3,
    "deals_2025": 3,
    "deals_2026_ytd": 5,
    "recent_deals": 8,
    "median_capital_musd": 74.75,
    "deals_with_median": 3
  },
  {
    "industry_group": "Communications and Networking",
    "focus_area": "Software & IT (AI / quantum proxy)",
    "is_focus": true,
    "deal_count": 11,
    "deals_2023": 4,
    "deals_2024": 2,
    "deals_2025": 5,
    "deals_2026_ytd": 0,
    "recent_deals": 5,
    "median_capital_musd": 254.5327,
    "deals_with_median": 11
  },
  {
    "industry_group": "Agriculture",
    "focus_area": "Agriculture",
    "is_focus": true,
    "deal_count": 10,
    "deals_2023": 1,
    "deals_2024": 4,
    "deals_2025": 4,
    "deals_2026_ytd": 1,
    "recent_deals": 5,
    "median_capital_musd": 0.48,
    "deals_with_median": 8
  },
  {
    "industry_group": "Commercial Banks",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 9,
    "deals_2023": 2,
    "deals_2024": 2,
    "deals_2025": 3,
    "deals_2026_ytd": 2,
    "recent_deals": 5,
    "median_capital_musd": 80.2244,
    "deals_with_median": 9
  },
  {
    "industry_group": "Energy Equipment",
    "focus_area": "Energy & Grid (proxy)",
    "is_focus": true,
    "deal_count": 9,
    "deals_2023": 2,
    "deals_2024": 4,
    "deals_2025": 2,
    "deals_2026_ytd": 1,
    "recent_deals": 3,
    "median_capital_musd": 20.9967,
    "deals_with_median": 6
  },
  {
    "industry_group": "Exploration, Production and Refining",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 9,
    "deals_2023": 2,
    "deals_2024": 3,
    "deals_2025": 2,
    "deals_2026_ytd": 2,
    "recent_deals": 4,
    "median_capital_musd": 5.5443,
    "deals_with_median": 7
  },
  {
    "industry_group": "Other / Unknown",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 8,
    "deals_2023": 2,
    "deals_2024": 3,
    "deals_2025": 3,
    "deals_2026_ytd": 0,
    "recent_deals": 3,
    "median_capital_musd": 0.1913,
    "deals_with_median": 8
  },
  {
    "industry_group": "Energy Services",
    "focus_area": "Energy & Grid (proxy)",
    "is_focus": true,
    "deal_count": 7,
    "deals_2023": 3,
    "deals_2024": 3,
    "deals_2025": 1,
    "deals_2026_ytd": 0,
    "recent_deals": 1,
    "median_capital_musd": 38.77,
    "deals_with_median": 7
  },
  {
    "industry_group": "Textiles",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 6,
    "deals_2023": 0,
    "deals_2024": 2,
    "deals_2025": 4,
    "deals_2026_ytd": 0,
    "recent_deals": 4,
    "median_capital_musd": null,
    "deals_with_median": 0
  },
  {
    "industry_group": "Utilities",
    "focus_area": "Energy & Grid (proxy)",
    "is_focus": true,
    "deal_count": 6,
    "deals_2023": 1,
    "deals_2024": 1,
    "deals_2025": 3,
    "deals_2026_ytd": 1,
    "recent_deals": 4,
    "median_capital_musd": 143.19,
    "deals_with_median": 5
  },
  {
    "industry_group": "Forestry",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 5,
    "deals_2023": 2,
    "deals_2024": 1,
    "deals_2025": 2,
    "deals_2026_ytd": 0,
    "recent_deals": 2,
    "median_capital_musd": 798.0,
    "deals_with_median": 5
  },
  {
    "industry_group": "Metals, Minerals and Mining",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 4,
    "deals_2023": 1,
    "deals_2024": 0,
    "deals_2025": 2,
    "deals_2026_ytd": 1,
    "recent_deals": 3,
    "median_capital_musd": 235.0,
    "deals_with_median": 3
  },
  {
    "industry_group": "Other Consumer Products and Services",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 4,
    "deals_2023": 0,
    "deals_2024": 3,
    "deals_2025": 1,
    "deals_2026_ytd": 0,
    "recent_deals": 1,
    "median_capital_musd": 0.5375,
    "deals_with_median": 4
  },
  {
    "industry_group": "Construction (Non-Wood)",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 3,
    "deals_2023": 0,
    "deals_2024": 0,
    "deals_2025": 1,
    "deals_2026_ytd": 2,
    "recent_deals": 3,
    "median_capital_musd": null,
    "deals_with_median": 0
  },
  {
    "industry_group": "Other Energy",
    "focus_area": "Energy & Grid (proxy)",
    "is_focus": true,
    "deal_count": 1,
    "deals_2023": 0,
    "deals_2024": 1,
    "deals_2025": 0,
    "deals_2026_ytd": 0,
    "recent_deals": 0,
    "median_capital_musd": null,
    "deals_with_median": 0
  },
  {
    "industry_group": "Other Healthcare",
    "focus_area": "Other (not a stated focus)",
    "is_focus": false,
    "deal_count": 1,
    "deals_2023": 0,
    "deals_2024": 1,
    "deals_2025": 0,
    "deals_2026_ytd": 0,
    "recent_deals": 0,
    "median_capital_musd": null,
    "deals_with_median": 0
  },
  {
    "industry_group": "Other Materials",
    "focus_area": "Advanced Materials (proxy)",
    "is_focus": true,
    "deal_count": 1,
    "deals_2023": 0,
    "deals_2024": 0,
    "deals_2025": 0,
    "deals_2026_ytd": 1,
    "recent_deals": 1,
    "median_capital_musd": null,
    "deals_with_median": 0
  }
];

const GROUP_BY_NAME = new Map();

function indexGroups(){
  GROUP_BY_NAME.clear();
  GROUPS.forEach(group => {
    GROUP_BY_NAME.set(group.industry_group.toLowerCase(), group);
  });
}

indexGroups();

const CPC_RULES = [
  ["A61K", "Pharmaceuticals and Biotechnology"],
  ["A61P", "Pharmaceuticals and Biotechnology"],
  ["C07K", "Pharmaceuticals and Biotechnology"],
  ["C07D", "Pharmaceuticals and Biotechnology"],
  ["C07H", "Pharmaceuticals and Biotechnology"],
  ["C12N", "Pharmaceuticals and Biotechnology"],
  ["C12P", "Pharmaceuticals and Biotechnology"],
  ["C12Q", "Pharmaceuticals and Biotechnology"],
  ["A61B", "Healthcare Devices and Supplies"],
  ["A61F", "Healthcare Devices and Supplies"],
  ["A61M", "Healthcare Devices and Supplies"],
  ["A61N", "Healthcare Devices and Supplies"],
  ["A61L", "Healthcare Devices and Supplies"],
  ["G16H", "Healthcare Technology Systems"],
  ["A01", "Agriculture"],
  ["G06N", "Software"],
  ["G06F", "Software"],
  ["G06Q", "Software"],
  ["H04L", "Communications and Networking"],
  ["H04W", "Communications and Networking"],
  ["H01M", "Energy Equipment"],
  ["H02J", "Energy Equipment"],
  ["H02S", "Energy Equipment"],
  ["Y02E", "Energy Equipment"],
  ["B60L", "Energy Equipment"],
  ["B60K", "Energy Equipment"],
  ["C08", "Chemicals and Gases"],
  ["C01B", "Chemicals and Gases"],
  ["C07C", "Chemicals and Gases"],
  ["C04", "Other Materials"],
  ["C22", "Metals, Minerals and Mining"],
  ["B60", "Transportation"],
  ["B62", "Transportation"],
  ["H01L", "Computer Hardware"],
  ["D01", "Textiles"],
  ["D03", "Textiles"],
  ["D04", "Textiles"]
];

const KEYWORD_RULES = [
  { group: "Pharmaceuticals and Biotechnology", strong: ["mrna", "antibody", "vaccine", "crispr", "gene therapy", "gene transfer", "polynucleotide", "monoclonal", "t cell", "car t"], normal: ["peptide", "enzyme"] },
  { group: "Healthcare Devices and Supplies", strong: ["medical device", "temporomandibular", "bite force", "wearable sensor", "catheter", "prosthesis"], normal: ["implant", "implanted", "surgical", "diagnostic"] },
  { group: "Agriculture", strong: ["cultivar", "peach", "irrigation", "plant transformation", "soil sensor"], normal: ["crop", "greenhouse", "farm"] },
  { group: "Software", strong: ["machine learning", "language model", "blockchain", "graphical user interface", "social media"], normal: ["algorithm", "software", "user interface", "gui", "mixed reality", "virtual reality"] },
  { group: "Energy Equipment", strong: ["hydrogen", "fuel cell", "powertrain", "proton conducting", "photovoltaic"], normal: ["battery", "solar cell", "electric motor"] },
  { group: "Other Materials", strong: ["carbon fiber", "nanostructured", "nanomaterial"], normal: ["ceramic", "composite", "porous silicon"] },
  { group: "Chemicals and Gases", strong: ["bioremediation", "eutectic"], normal: ["catalyst", "polymer", "chlorinated", "solvent"] },
  { group: "Communications and Networking", strong: ["wireless network"], normal: ["antenna", "5g"] },
  { group: "Computer Hardware", strong: ["semiconductor", "integrated circuit"], normal: ["transistor"] },
  { group: "Transportation", strong: [], normal: ["tracked vehicle", "automotive", "vehicle"] },
  { group: "Healthcare Technology Systems", strong: ["electronic health record"], normal: ["clinical decision"] },
  { group: "Containers and Packaging", strong: ["packaging film"], normal: ["packaging"] }
];

function listGroupNames(){
  return GROUPS.map(group => group.industry_group).slice().sort((a, b) => a.localeCompare(b));
}

function focusAreaNames(){
  const names = [];
  GROUPS.forEach(group => {
    if(group.is_focus && names.indexOf(group.focus_area) === -1) names.push(group.focus_area);
  });
  return names.sort((a, b) => a.localeCompare(b));
}

function lookupGroup(name){
  if(!name) return null;
  const text = String(name).trim().toLowerCase();
  if(!text || text === "unmatched") return null;
  return GROUP_BY_NAME.get(text) || null;
}

function hasTerm(text, term){
  const forms = [term];
  if(!/s$/i.test(term)) forms.push(term + "s");
  return forms.some(form => {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(?:^|[^a-z0-9])" + escaped + "(?:[^a-z0-9]|$)", "i").test(text);
  });
}

function cpcGroup(code){
  const compact = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  let best = null;
  CPC_RULES.forEach(rule => {
    if(compact.indexOf(rule[0]) === 0 && (!best || rule[0].length > best[0].length)) best = rule;
  });
  return best ? best[1] : null;
}

function keywordScores(text){
  const totals = new Map();
  KEYWORD_RULES.forEach(rule => {
    let score = 0;
    rule.strong.forEach(term => { if(hasTerm(text, term)) score += 3; });
    rule.normal.forEach(term => { if(hasTerm(text, term)) score += 2; });
    if(score > 0) totals.set(rule.group, score);
  });
  return totals;
}

function preferTied(text, left, right){
  const plant = /cultivar|peach|irrigation|\bcrop\b|\bfarm\b|plant transformation/i.test(text);
  const pair = [left, right];
  if(plant && pair.indexOf("Agriculture") !== -1 && (pair.indexOf("Pharmaceuticals and Biotechnology") !== -1 || pair.indexOf("Software") !== -1)){
    return "Agriculture";
  }
  const energyWord = /hydrogen|fuel cell|powertrain|battery|photovoltaic/i.test(text);
  if(energyWord && pair.indexOf("Energy Equipment") !== -1){
    const other = left === "Energy Equipment" ? right : left;
    if(other === "Other Materials" || other === "Transportation" || other === "Chemicals and Gases") return "Energy Equipment";
  }
  if(/language model|machine learning|blockchain|social media|graphical user interface/i.test(text) && pair.indexOf("Software") !== -1){
    return "Software";
  }
  return null;
}

function bestKeyword(text){
  const totals = keywordScores(text);
  let bestName = null;
  let bestScore = 0;
  let tied = false;
  totals.forEach((score, name) => {
    if(score > bestScore){
      bestName = name;
      bestScore = score;
      tied = false;
      return;
    }
    if(score === bestScore && bestName){
      tied = true;
      const preferred = preferTied(text, bestName, name);
      if(preferred) bestName = preferred;
      else {
        const current = lookupGroup(bestName);
        const challenger = lookupGroup(name);
        const currentFocus = current && current.is_focus ? 1 : 0;
        const challengerFocus = challenger && challenger.is_focus ? 1 : 0;
        if(challengerFocus > currentFocus) bestName = name;
        else if(challengerFocus === currentFocus && challenger && current && challenger.deal_count > current.deal_count) bestName = name;
      }
    }
  });
  return bestName ? { group: bestName, score: bestScore, tied: tied } : null;
}

function dominantCpc(codes){
  const counts = new Map();
  (codes || []).forEach(code => {
    const group = cpcGroup(code);
    if(!group) return;
    counts.set(group, (counts.get(group) || 0) + 1);
  });
  let best = null;
  let bestCount = 0;
  counts.forEach((count, group) => {
    if(count > bestCount){
      best = group;
      bestCount = count;
    }
  });
  return best;
}

function formatMillions(value){
  if(value === null || value === undefined || Number.isNaN(Number(value))) return null;
  const amount = Number(value);
  if(amount >= 100) return "$" + Math.round(amount).toLocaleString("en-US") + " million";
  if(amount >= 10) return "$" + (Math.round(amount * 10) / 10).toFixed(1) + " million";
  return "$" + (Math.round(amount * 100) / 100).toFixed(2) + " million";
}

function groupAlignmentScore(group){
  const deals = group && group.deal_count ? group.deal_count : 0;
  if(!deals) return 0;
  const volume = Math.min(40, 40 * Math.log10(deals + 1) / Math.log10(VOLUME_ANCHOR));
  const recency = Math.min(25, 25 * ((group.recent_deals || 0) / deals));
  const focus = group.is_focus ? FOCUS_BONUS : 0;
  return Math.max(0, Math.min(100, Math.round(volume + recency + focus)));
}

function explain(group){
  const where = group.is_focus
    ? group.focus_area + ", a stated CURF focus area"
    : "outside the stated CURF focus areas";
  const dealLabel = group.deal_count === 1 ? "1 completed South Carolina deal" : group.deal_count + " completed South Carolina deals";
  const recentLabel = group.recent_deals === 1 ? "1 of them" : group.recent_deals + " of them";
  const money = group.median_capital_musd === null || group.median_capital_musd === undefined
    ? "PitchBook did not report a median capital invested for these deals."
    : "The typical PitchBook median check is about " + formatMillions(group.median_capital_musd) + ". That is a typical check size, not the sum of dollars invested.";
  const note = "Aligns with " + group.industry_group + " (" + where + "). " +
    dealLabel + " since 2023, " + recentLabel + " in 2025 or 2026 YTD. " + money;
  const dollars = formatMillions(group.median_capital_musd);
  const countLabel = group.deal_count === 1 ? "1 SC deal" : group.deal_count + " SC deals";
  const short = dollars
    ? "Aligns with a typical check of about " + dollars + " across " + countLabel + " in " + group.industry_group + " since 2023."
    : "Aligns with " + countLabel + " in " + group.industry_group + " since 2023. No median check size was reported.";
  return { note, short };
}

function resultFromGroup(group, source, confidence){
  const score = groupAlignmentScore(group);
  const text = explain(group);
  return {
    industry_group: group.industry_group,
    focus_area: group.focus_area,
    is_focus: !!group.is_focus,
    alignment_score: score,
    value_points: valuePointsForAlignment(score),
    deal_count: group.deal_count,
    recent_deals: group.recent_deals,
    median_capital_musd: group.median_capital_musd,
    note: text.note,
    short: text.short,
    source: source,
    confidence: confidence,
    as_of: AS_OF
  };
}

function unmatched(confidence){
  return {
    industry_group: "Unmatched",
    focus_area: null,
    is_focus: false,
    alignment_score: 0,
    value_points: 0,
    deal_count: 0,
    recent_deals: 0,
    median_capital_musd: null,
    note: "No PitchBook industry group matched. SC investment alignment is 0.",
    short: "No SC industry match.",
    source: "unmatched",
    confidence: confidence || "none",
    as_of: AS_OF
  };
}

function valuePointsForAlignment(score){
  const value = Number(score) || 0;
  if(value >= 70) return 2;
  if(value >= 55) return 1;
  return 0;
}

function scoreAlignment(input){
  const source = input || {};
  const text = ((source.title || "") + "\n" + (source.text || source.abstract || "")).toLowerCase();
  const codes = Array.isArray(source.cpc_codes) ? source.cpc_codes : [];
  const fromCpc = dominantCpc(codes);
  const fromWords = bestKeyword(text);
  let groupName = null;
  let confidence = "none";
  let matchedBy = "unmatched";

  if(fromCpc && (!fromWords || fromWords.group === fromCpc || fromWords.score < 5)){
    groupName = fromCpc;
    confidence = "high";
    matchedBy = "cpc";
  } else if(fromCpc && fromWords && fromWords.group !== fromCpc && fromWords.score >= 5){
    groupName = fromWords.group;
    confidence = "medium";
    matchedBy = "keyword";
  } else if(fromWords && fromWords.score >= 3 && !fromWords.tied){
    groupName = fromWords.group;
    confidence = "high";
    matchedBy = "keyword";
  } else if(fromWords && fromWords.score >= 2){
    groupName = fromWords.group;
    confidence = "medium";
    matchedBy = "keyword";
  } else if(fromWords){
    groupName = fromWords.group;
    confidence = "low";
    matchedBy = "keyword";
  }

  const requested = lookupGroup(source.chosen_group);
  if(requested && confidence !== "high"){
    groupName = requested.industry_group;
    matchedBy = "model";
    confidence = confidence === "none" ? "low" : confidence;
  }

  const group = lookupGroup(groupName);
  if(!group) return unmatched(confidence);
  return resultFromGroup(group, matchedBy, confidence);
}

function applyAlignmentToTier(row, alignment, signals){
  const current = row || {};
  let tier = current.tier || "Needs work";
  let reason = String(current.reason || "").replace(/\s+/g, " ").trim();
  const score = alignment && alignment.alignment_score ? alignment.alignment_score : 0;
  const blocked = !!(signals && (signals.term_expired_estimate || signals.has_abstract === false));
  const named = alignment && alignment.industry_group && alignment.industry_group !== "Unmatched";
  if(!blocked && named){
    if(score >= 80 && tier === "Medium") tier = "High";
    else if(score >= 75 && (tier === "Low" || tier === "Needs work")) tier = "Medium";
  }
  if(named && score >= 55 && alignment.short){
    const extra = alignment.short;
    if(reason.indexOf(extra) === -1) reason = (reason + " " + extra).trim();
  }
  return {
    tier: tier,
    confidence: current.confidence,
    reason: reason.slice(0, 360)
  };
}

return { AS_OF, VOLUME_ANCHOR, FOCUS_BONUS, GROUPS, listGroupNames, focusAreaNames, lookupGroup, groupAlignmentScore, scoreAlignment, valuePointsForAlignment, applyAlignmentToTier };
})();

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";
import "../../public/value-score-copy.js";

const { buildValueScoreCopy } = globalThis.CURF_VALUE;

const REAL_BREAKDOWN = [
  { max: 6, label: "Market demand (MODERATE)", points: 4 },
  { max: 2, label: "Technology readiness (TRL 3)", points: 0 },
  { max: 2, label: "Adoption risk, lower risk scores higher", points: 1.5 },
  { max: 1, label: "Clear monetization path (MATURE)", points: 0 },
  { max: 1, label: "A real licensee or buyer named with a source, not just a sector guess", points: 1 },
  { max: 1, label: "Confirmed inventor or industry engagement", points: 0 },
  { max: 2, label: "SC investment alignment (Software, score 86)", points: 2 }
];

function licensee(name){
  return {
    name,
    type: "licensee",
    why_it_fits: "Sells into this application.",
    source: "https://example.com/" + name.toLowerCase().replace(/\s+/g, "-")
  };
}

function realCase(){
  return {
    id: 3,
    title: "Multiplier-efficient number theoretic transform",
    dept: "Electrical Engineering",
    sourcePatentId: "US-2025190519-A1",
    filingDate: "2023-12-07",
    kindCode: "A1",
    status: "evaluated",
    recordType: "Application",
    evaluation: {
      market_demand_verdict: "MODERATE",
      recommended_path: "MATURE",
      trl: 3,
      trl_rationale: "Circuit described analytically with component counts but no prototype, fabrication, or simulation results reported.",
      licensing_recommendation: "pursue",
      licensing_targets: [licensee("Alpha"), licensee("Beta"), licensee("Gamma"), licensee("Delta")],
      pilot_recommendation: "pursue",
      pilot_targets: [{ name: "Clemson lab", source: "https://example.com/lab" }],
      sc_alignment: { industry_group: "Software", alignment_score: 86, value_points: 2 },
      value_score_snapshot: { totalPoints: 8.5, maxPoints: 15, tier: "B", breakdown: REAL_BREAKDOWN }
    }
  };
}

function peer(id, points, extra){
  const demand = (extra && extra.demand) || "MODERATE";
  return {
    id,
    archived: !!(extra && extra.archived),
    skipRemoteSave: false,
    status: "evaluated",
    recordType: (extra && extra.recordType) || null,
    totalPoints: points,
    demand,
    path: (extra && extra.path) || (demand === "WEAK" || demand === "NONE" ? "NO_DEMAND" : "MATURE"),
    cachedOnly: !!(extra && extra.cachedOnly)
  };
}

// Two patents sit above 8.5, and two others tie it. Ten sit below.
const VIABLE_SCORES = [9.3, 9.3, 8.5, 8.5, 7, 6.8, 6.8, 6.3, 6.3, 6, 5.5, 5, 4.5, 4.5];

function portfolioAroundRealCase(){
  const peers = VIABLE_SCORES.map((points, index) => peer(index + 10, points));
  peers.push(peer(3, 8.5));
  peers.push(peer(90, 4.5, { demand: "WEAK", path: "NO_DEMAND" }));
  peers.push(peer(91, 12, { archived: true }));
  peers.push(peer(92, 9.9, { recordType: "publication" }));
  peers.push(peer(93, 1, { cachedOnly: true }));
  return peers;
}

test("a real 8.5 case gets specific copy, rank, and a pilot lever", () => {
  const patent = realCase();
  const copy = buildValueScoreCopy(patent, patent.evaluation.value_score_snapshot, portfolioAroundRealCase(), { asOf: "2026-10-23" });
  assert.equal(copy.headline, "8.5 / 15: moderate market pull and 4 named licensees, held back by no prototype and demand short of strong.");
  assert.equal(copy.rank, "Tied for 3rd of 15 patents with real demand. Ahead of 67%.");
  assert.equal(copy.earned, "Market interest is MODERATE (4 of 6). South Carolina fit is Software, score 86 (2 of 2). How hard it is to adopt scores 1.5 of 2.");
  assert.equal(copy.cost, "No prototype yet. How far along: level 3 (0 of 2). Market interest is MODERATE, 2 short of the top (4 of 6). No inventor or company contact is confirmed (0 of 1).");
  assert.equal(copy.lever, "A pilot proving this works beyond the lab would add about 2 points. See Pilot targets.");
  assert.equal(copy.seePilotTargets, true);
  assert.doesNotMatch(copy.headline, /2031|2043|expiry/);
  assert.match(copy.methodNote, /added up from the lines already on this page/);
  assert.match(copy.methodNote, /saved when this review ran/);
});

test("a near-term expiry is named only when the filing date supports it", () => {
  const patent = realCase();
  patent.filingDate = "2011-10-23";
  patent.kindCode = "B2";
  const copy = buildValueScoreCopy(patent, patent.evaluation.value_score_snapshot, [peer(3, 8.5)], { asOf: "2026-10-23" });
  assert.match(copy.headline, /held back by no prototype and a 2031 expiry/);
  assert.doesNotMatch(copy.cost, /2031/);

  patent.filingDate = null;
  const omitted = buildValueScoreCopy(patent, patent.evaluation.value_score_snapshot, [peer(3, 8.5)], { asOf: "2026-10-23" });
  assert.doesNotMatch(omitted.headline, /expiry/);
});

test("a design patent uses 15 years from grant and does not invent a filing-date term", () => {
  const patent = realCase();
  patent.filingDate = "2020-01-01";
  patent.kindCode = "S1";
  patent.publicationDate = "2016-10-23";
  patent.sourcePatentId = "US-D900000-S1";
  const copy = buildValueScoreCopy(patent, patent.evaluation.value_score_snapshot, [peer(3, 8.5)], { asOf: "2026-10-23" });
  assert.match(copy.headline, /a 2031 expiry/);
  assert.doesNotMatch(copy.headline, /2035|2040/);
});

test("an early prototype points at field performance for the one point still open", () => {
  const patent = realCase();
  patent.evaluation.value_score_snapshot = {
    totalPoints: 13,
    maxPoints: 15,
    tier: "A",
    breakdown: [
      { max: 6, label: "Market demand (STRONG)", points: 6 },
      { max: 2, label: "Technology readiness (TRL 5)", points: 1 },
      { max: 2, label: "Adoption risk, lower risk scores higher", points: 2 },
      { max: 1, label: "Clear monetization path (LICENSE)", points: 1 },
      { max: 1, label: "A real licensee or buyer named with a source, not just a sector guess", points: 1 },
      { max: 1, label: "Confirmed inventor or industry engagement", points: 1 },
      { max: 2, label: "SC investment alignment (Software, score 90)", points: 2 }
    ]
  };
  patent.evaluation.market_demand_verdict = "STRONG";
  patent.evaluation.recommended_path = "LICENSE";
  patent.evaluation.trl = 5;
  patent.staffInput = { inventorWillingness: "Willing to engage" };
  const copy = buildValueScoreCopy(patent, patent.evaluation.value_score_snapshot, [peer(3, 13, { demand: "STRONG", path: "LICENSE" })], { asOf: "2026-10-23" });
  assert.match(copy.headline, /^13 \/ 15: strong market pull and 4 named licensees, held back by an early prototype\./);
  assert.equal(copy.lever, "A pilot proving field performance would add about 1 point. See Pilot targets.");
  assert.equal(copy.seePilotTargets, true);
  assert.doesNotMatch(copy.cost, /engagement/);
});

test("a hard pass does not recommend a pilot and is left out of the viable rank", () => {
  const patent = realCase();
  patent.id = 90;
  patent.evaluation.market_demand_verdict = "WEAK";
  patent.evaluation.recommended_path = "NO_DEMAND";
  patent.evaluation.licensing_recommendation = "hard pass";
  patent.evaluation.licensing_targets = [];
  patent.evaluation.pilot_recommendation = "not recommended";
  patent.evaluation.pilot_targets = [];
  patent.evaluation.value_score_snapshot = {
    totalPoints: 4.5,
    maxPoints: 15,
    tier: "C",
    breakdown: [
      { max: 6, label: "Market demand (WEAK)", points: 2 },
      { max: 2, label: "Technology readiness (TRL 3)", points: 0 },
      { max: 2, label: "Adoption risk, lower risk scores higher", points: 1.5 },
      { max: 1, label: "Clear monetization path (NO_DEMAND)", points: 0 },
      { max: 1, label: "A real licensee or buyer named with a source, not just a sector guess", points: 0 },
      { max: 1, label: "Confirmed inventor or industry engagement", points: 0 },
      { max: 2, label: "SC investment alignment (Software, score 40)", points: 1 }
    ]
  };
  const copy = buildValueScoreCopy(patent, patent.evaluation.value_score_snapshot, portfolioAroundRealCase(), { asOf: "2026-10-23" });
  assert.equal(copy.seePilotTargets, false);
  assert.doesNotMatch(copy.lever, /Pilot targets/);
  assert.match(copy.lever, /add about 4 points/);
  assert.equal(copy.rank, "Not in the comparison (market interest is weak). 15 portfolio patents have moderate or strong market interest.");
  assert.doesNotMatch(copy.headline, /named licensee/);
});

test("an empty breakdown still narrates the stored fields and keeps the frozen total", () => {
  const patent = realCase();
  patent.evaluation.value_score_snapshot = { totalPoints: 3.5, maxPoints: 13, tier: "D", breakdown: [] };
  const copy = buildValueScoreCopy(patent, patent.evaluation.value_score_snapshot, [peer(3, 3.5)], { asOf: "2026-10-23" });
  assert.match(copy.headline, /^3\.5 \/ 13:/);
  assert.match(copy.headline, /moderate market pull/);
  assert.match(copy.headline, /4 named licensees/);
  assert.equal(copy.rank, "The only patent with real demand in the portfolio.");
});

test("publications rank among publications", () => {
  const patent = realCase();
  patent.recordType = "publication";
  patent.evaluation.value_score_snapshot.totalPoints = 6;
  const peers = [
    peer(3, 6, { recordType: "publication" }),
    peer(4, 8, { recordType: "publication", demand: "MODERATE" }),
    peer(5, 12)
  ];
  const copy = buildValueScoreCopy(patent, patent.evaluation.value_score_snapshot, peers, { asOf: "2026-10-23" });
  assert.equal(copy.rank, "Ranks 2nd of 2 publications with real demand.");
});

test("the case file replaces the repeated boilerplate with this case's copy", () => {
  const subject = realCase();
  subject.portfolioAddedAt = "2026-01-01T00:00:00.000Z";
  subject.dept = "Electrical Engineering";
  subject.text = "A stored evaluation.";
  const records = [storedRecord(subject)];
  VIABLE_SCORES.forEach((points, index) => {
    records.push(storedRecord(slimRecord(index + 10, points, "MODERATE", "MATURE")));
  });
  records.push(storedRecord(slimRecord(90, 4.5, "WEAK", "NO_DEMAND")));
  records.push(storedRecord({ ...slimRecord(91, 12, "MODERATE", "LICENSE"), archived: true }));
  records.push(storedRecord({ ...slimRecord(92, 9.9, "MODERATE", "LICENSE"), recordType: "publication", title: "A paper" }));

  const { document, errors } = loadPage(records);
  assert.deepEqual(errors, [], errors.join("\n"));
  document.querySelector('#portfolio-body [data-open-btn="3"]').click();
  const panel = document.querySelector("#value-score");
  assert.ok(panel);
  const body = panel.querySelector(".panel-body").textContent;
  assert.equal(
    panel.querySelector(".score-headline").textContent,
    "8.5 / 15: moderate market pull and 4 named licensees, held back by no prototype and demand short of strong."
  );
  assert.match(panel.querySelector(".score-rank").textContent, /Tied for 3rd of 15 patents with real demand/);
  assert.match(panel.querySelector(".score-earned").textContent, /What raised the score/);
  assert.match(panel.querySelector(".score-earned").textContent, /Software, score 86 \(2 of 2\)/);
  assert.match(panel.querySelector(".score-cost").textContent, /What lowered the score/);
  assert.match(panel.querySelector(".score-cost").textContent, /level 3 \(0 of 2\)/);
  assert.match(panel.querySelector(".score-lever").textContent, /Fastest way to raise the score/);
  assert.match(panel.querySelector(".score-lever").textContent, /would add about 2 points/);
  const pilotLink = panel.querySelector('.score-lever a[href="#pilot-targets"]');
  assert.equal(pilotLink.textContent, "Pilot targets");
  assert.doesNotMatch(body, /Computed directly from this evaluation/);
  assert.doesNotMatch(body, /Frozen at the time this evaluation ran/);
  assert.match(panel.querySelector(".score-tip").textContent, /saved when this review ran/);
  assert.match(panel.querySelector(".score-tip").textContent, /not a dollar value/);
  assert.match(body, /Market demand \(MODERATE\)/);
  assert.match(body, /4 \/ 6/);
  assert.equal(document.querySelector("#pilot-targets") != null, true);

  document.querySelector('#portfolio-body [data-open-btn="90"]').click();
  const hardPass = document.querySelector("#value-score");
  assert.match(hardPass.querySelector(".score-rank").textContent, /Not in the comparison \(market interest is weak\)/);
  assert.equal(hardPass.querySelector('.score-lever a[href="#pilot-targets"]'), null);
  assert.doesNotMatch(hardPass.querySelector(".panel-body").textContent, /Computed directly from this evaluation/);
});

function slimRecord(id, points, demand, path){
  const tier = points >= 10 ? "A" : (points >= 7 ? "B" : (points >= 4 ? "C" : "D"));
  return {
    id,
    title: "Peer " + id,
    dept: "Engineering",
    text: "Peer",
    status: "evaluated",
    portfolioAddedAt: "2026-01-01T00:00:00.000Z",
    evaluation: {
      recommended_path: path,
      market_demand_verdict: demand,
      market_demand_rationale: "Stored.",
      trl: 4,
      trl_rationale: "Early work.",
      adoption_risks: [],
      path_rationale: "Stored.",
      marketing_abstract: "Stored.",
      confidence: "medium",
      evaluated_at: "2026-09-01T00:00:00.000Z",
      licensing_recommendation: demand === "WEAK" ? "hard pass" : "pursue",
      licensing_targets: demand === "WEAK" ? [] : [licensee("One"), licensee("Two"), licensee("Three")],
      pilot_recommendation: demand === "WEAK" ? "not recommended" : "pursue",
      pilot_targets: [],
      value_score_snapshot: { totalPoints: points, maxPoints: 15, tier, breakdown: [] }
    }
  };
}

function storedRecord(record){
  return record;
}

function loadPage(records){
  const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(String(error)));
  virtualConsole.on("error", (error) => errors.push(String(error)));
  const dom = new JSDOM(html, {
    url: "http://localhost/",
    runScripts: "dangerously",
    virtualConsole,
    beforeParse(window){
      window.CURF_VALUE = globalThis.CURF_VALUE;
      window.scrollTo = () => {};
      window.fetch = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      window.localStorage.setItem("curf_docket_patent_records", JSON.stringify(records));
      window.addEventListener("error", (event) => errors.push(event.message || String(event.error)));
    }
  });
  return { document: dom.window.document, errors };
}

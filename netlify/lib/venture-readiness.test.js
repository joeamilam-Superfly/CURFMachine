import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";
import {
  buildPublicationEvidenceRequest,
  normalizePublicationEvidence,
  rewritePublicationEvidence,
  scoreVentureReadiness
} from "./venture-readiness.js";
import "../../public/venture-readiness.js";

const AS_OF = "2026-10-23";

function evidence(extra){
  return Object.assign({
    publication_date: null,
    disclosure_state: "unknown",
    novelty: "incremental",
    novelty_quantified: false,
    novelty_evidence: "",
    trl: 1,
    trl_evidence: "",
    claimable: false,
    ip_filed: false,
    protectability_evidence: "",
    market: "none",
    market_evidence: "",
    path: "none",
    path_evidence: "",
    asset_form: "none",
    team_signals: [],
    team_evidence: "",
    sc_industry_group: "Unmatched"
  }, extra || {});
}

test("the browser copy matches the scoring module", () => {
  const src = readFileSync(new URL("./venture-readiness.js", import.meta.url), "utf8").replace(/^export /gm, "");
  const pub = readFileSync(new URL("../../public/venture-readiness.js", import.meta.url), "utf8");
  assert.ok(pub.includes(src), "public/venture-readiness.js drifted from netlify/lib/venture-readiness.js");
  const sample = evidence({ novelty: "clear_improvement", trl: 3, market: "plausible_sector" });
  const a = scoreVentureReadiness(sample, { asOf: AS_OF, alignmentScore: 0 });
  const b = globalThis.CURF_VENTURE.scoreVentureReadiness(sample, { asOf: AS_OF, alignmentScore: 0 });
  assert.deepEqual(b, a);
});

test("a commentary with no buyer scores as not commercial and does not invent a filing clock", () => {
  const scored = scoreVentureReadiness(evidence({
    novelty_evidence: "The note reviews existing practice.",
    trl_evidence: "No method was tested.",
    points: 80,
    total: 100,
    band: "venture_ready"
  }), { asOf: AS_OF, alignmentScore: 0 });
  assert.equal(scored.total, 3);
  assert.equal(scored.band, "not_commercial");
  assert.equal(scored.bandLabel, "Not commercial now");
  assert.equal(scored.paths.primary.id, "not_ready");
  assert.match(scored.paths.primary.detail, /prototype or a named application/);
  assert.equal(scored.flag.level, "unknown");
  assert.equal(scored.flag.label, "Publication date unknown");
  assert.match(scored.advice, /not a commercial project/);
  assert.match(scored.caveat, /Not legal advice/);
});

test("a quantified lab method inside the US grace period files first and can still explore a startup", () => {
  const scored = scoreVentureReadiness(evidence({
    publication_date: "2026-07-01",
    disclosure_state: "published",
    novelty: "step_change",
    novelty_quantified: true,
    novelty_evidence: "Yield rose 40 percent against the prior reactor.",
    trl: 4,
    trl_evidence: "The method has run in the lab only.",
    claimable: true,
    ip_filed: false,
    protectability_evidence: "The paper describes a method a claim could cover.",
    market: "specific_buyer",
    market_evidence: "Municipal wastewater plants pay for aeration energy.",
    path: "concrete",
    path_evidence: "A sensor company could build the controller for those plants.",
    asset_form: "invention",
    team_signals: ["industry co-author", "SBIR"],
    team_evidence: "An industry co-author and an SBIR award are named.",
    sc_industry_group: "Software"
  }), { asOf: AS_OF, alignmentScore: 86, industryGroup: "Software" });
  assert.equal(scored.total, 93);
  assert.equal(scored.band, "venture_ready");
  assert.equal(scored.paths.primary.id, "file_disclosure");
  assert.equal(scored.paths.primary.label, "File invention disclosure now");
  assert.match(scored.paths.primary.detail, /US bar date 2027-07-01, 251 days left/);
  assert.equal(scored.paths.secondary.id, "explore_startup");
  assert.match(scored.paths.secondary.detail, /NSF I-Corps/);
  assert.equal(scored.flag.level, "amber");
  assert.equal(scored.flag.label, "US grace period only, foreign rights likely lost");
  assert.match(scored.advice, /File an invention disclosure with CURF now/);
  assert.match(scored.advice, /Not legal advice/);
  assert.equal(scored.criteria.find(row => row.id === "novelty").evidence, "Yield rose 40 percent against the prior reactor.");
});

test("an unquantified step-change cannot take the 20 point novelty mark", () => {
  const scored = scoreVentureReadiness(evidence({
    novelty: "step_change",
    novelty_quantified: false,
    trl: 6,
    claimable: true,
    publication_date: "2026-09-01",
    disclosure_state: "published"
  }), { asOf: AS_OF });
  assert.equal(scored.criteria.find(row => row.id === "novelty").points, 10);
  assert.equal(scored.criteria.find(row => row.id === "trl").points, 15);
});

test("a passed US bar date is red and blocks a new filing unless something is already filed", () => {
  const open = scoreVentureReadiness(evidence({
    publication_date: "2024-01-01",
    disclosure_state: "published",
    claimable: true,
    ip_filed: false,
    market: "specific_buyer",
    path: "concrete",
    novelty: "clear_improvement",
    trl: 5
  }), { asOf: AS_OF });
  assert.equal(open.flag.level, "red");
  assert.equal(open.flag.label, "US bar date passed");
  assert.equal(open.criteria.find(row => row.id === "protectability").points, 0);
  assert.equal(open.paths.primary.id, "sponsored_research");
  assert.notEqual(open.paths.primary.id, "file_disclosure");

  const filed = scoreVentureReadiness(evidence({
    publication_date: "2024-01-01",
    disclosure_state: "published",
    claimable: true,
    ip_filed: true,
    market: "specific_buyer",
    path: "concrete",
    trl: 6
  }), { asOf: AS_OF, alignmentScore: 80 });
  assert.equal(filed.flag.level, "red");
  assert.equal(filed.criteria.find(row => row.id === "protectability").points, 20);
  assert.notEqual(filed.paths.primary.id, "file_disclosure");
});

test("gap funding, know-how licensing, and pre-publication each follow their own trigger", () => {
  const gap = scoreVentureReadiness(evidence({
    novelty: "step_change",
    novelty_quantified: true,
    trl: 3,
    claimable: true,
    market: "plausible_sector",
    path: "sketched"
  }), { asOf: AS_OF });
  assert.equal(gap.criteria.find(row => row.id === "protectability").points, 10);
  assert.equal(gap.paths.primary.id, "gap_funding");
  assert.match(gap.advice, /gap or proof-of-concept funding/);
  assert.ok(gap.total < 65);

  const license = scoreVentureReadiness(evidence({
    asset_form: "software",
    market: "plausible_sector",
    path: "concrete",
    trl: 5,
    novelty: "clear_improvement"
  }), { asOf: AS_OF });
  assert.equal(license.paths.primary.id, "license_knowhow");
  assert.match(license.advice, /software/);

  const early = scoreVentureReadiness(evidence({
    disclosure_state: "pre_publication",
    claimable: true,
    novelty: "clear_improvement",
    trl: 2,
    market: "none"
  }), { asOf: AS_OF });
  assert.equal(early.flag.level, "green");
  assert.equal(early.flag.label, "Pre-publication");
  assert.equal(early.paths.primary.id, "file_disclosure");
  assert.match(early.advice, /before you publish/);
});

test("the anniversary day is still inside the grace period and the next day is not", () => {
  const onTheDay = scoreVentureReadiness(evidence({
    publication_date: "2025-10-23",
    disclosure_state: "published",
    claimable: true
  }), { asOf: AS_OF });
  assert.equal(onTheDay.flag.level, "amber");
  assert.equal(onTheDay.flag.daysLeft, 0);
  assert.equal(onTheDay.criteria.find(row => row.id === "protectability").points, 20);

  const nextDay = scoreVentureReadiness(evidence({
    publication_date: "2025-10-22",
    disclosure_state: "published",
    claimable: true
  }), { asOf: AS_OF });
  assert.equal(nextDay.flag.level, "red");
  assert.equal(nextDay.criteria.find(row => row.id === "protectability").points, 0);
});

test("the evidence request does not search and drops invented dates", () => {
  const built = buildPublicationEvidenceRequest({
    title: "River lipids",
    authors: "River Lab",
    published: "March 2026",
    text: "A field study."
  }, ["Software"]);
  assert.equal(built.tools, undefined);
  assert.match(built.system, /Do not search the web/);
  assert.match(built.system, /Do not invent a publication date/);
  assert.match(built.system, /Do not return points/);
  assert.match(built.messages[0].content, /Publication date already on the record.*none/);
  const normalized = normalizePublicationEvidence({
    publication_date: "March 2026",
    novelty: "step-change",
    novelty_quantified: "yes",
    trl: "4",
    claimable: "true",
    market: "specific buyer",
    team_signals: "SBIR, prior startup",
    total: 99
  });
  assert.equal(normalized.publication_date, null);
  assert.equal(normalized.novelty, "step_change");
  assert.equal(normalized.novelty_quantified, true);
  assert.equal(normalized.trl, 4);
  assert.equal(normalized.market, "specific_buyer");
  assert.deepEqual(normalized.team_signals, ["sbir", "prior_startup"]);
  assert.equal(normalized.total, undefined);
});

test("the server rewrite keeps evidence and drops a model score", () => {
  const rewritten = rewritePublicationEvidence({
    content: [
      { type: "text", text: "I will read the abstract." },
      { type: "text", text: JSON.stringify({ novelty: "incremental", trl: 2, total: 90, points: 90 }) }
    ]
  });
  const parsed = JSON.parse(rewritten.content[1].text);
  assert.equal(parsed.evidence.novelty, "incremental");
  assert.equal(parsed.evidence.trl, 2);
  assert.equal(parsed.total, undefined);
  assert.equal(parsed.evidence.total, undefined);
});

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
      window.CURF_VENTURE = globalThis.CURF_VENTURE;
      window.scrollTo = () => {};
      window.fetch = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      window.localStorage.setItem("curf_docket_patent_records", JSON.stringify(records));
      window.addEventListener("error", (event) => errors.push(event.message || String(event.error)));
    }
  });
  return { document: dom.window.document, window: dom.window, errors };
}

function publicationRecord(id, title, extraEvidence, alignmentScore){
  const raw = evidence(extraEvidence);
  return {
    id,
    title,
    dept: "Authors",
    text: title,
    status: "evaluated",
    recordType: "publication",
    sourcePatentId: "https://doi.org/example/" + id,
    portfolioAddedAt: "2026-01-01T00:00:00.000Z",
    evaluation: {
      trl: raw.trl,
      trl_rationale: raw.trl_evidence || "Stored.",
      market_demand_verdict: "WEAK",
      market_demand_rationale: raw.market_evidence || "Stored.",
      recommended_path: "NO_DEMAND",
      path_rationale: "Stored patent path that should not drive the publication.",
      marketing_abstract: "A public paper.",
      confidence: "low",
      schema_version: "publication-venture-v1",
      evaluated_at: "2026-10-23T12:00:00.000Z",
      licensing_recommendation: "informational",
      licensing_targets: [],
      hard_pass_reason: "Hard pass: no viable market.",
      pilot_recommendation: "optional",
      pilot_targets: [],
      venture_readiness: {
        evidence: raw,
        alignment_score: alignmentScore || 0,
        industry_group: alignmentScore ? "Software" : ""
      },
      value_score_snapshot: { totalPoints: 2, maxPoints: 15, tier: "D", breakdown: [] }
    }
  };
}

test("the publication portfolio sorts and filters by band and path, and the case drops the hard pass", () => {
  const ready = publicationRecord(1, "Quantified reactor paper", {
    publication_date: "2026-07-01",
    disclosure_state: "published",
    novelty: "step_change",
    novelty_quantified: true,
    novelty_evidence: "Yield rose 40 percent against the prior reactor.",
    trl: 4,
    trl_evidence: "Lab method only.",
    claimable: true,
    market: "specific_buyer",
    market_evidence: "Municipal plants pay for aeration.",
    path: "concrete",
    path_evidence: "A sensor company could build it.",
    asset_form: "invention",
    team_signals: ["industry_coauthor", "sbir"],
    team_evidence: "An industry co-author and an SBIR award are named."
  }, 86);
  const quiet = publicationRecord(2, "Ward culture commentary", {
    trl: 1,
    novelty_evidence: "The note reviews existing practice."
  });
  const patent = {
    id: 3,
    title: "A granted patent",
    dept: "Engineering",
    text: "Patent text",
    status: "evaluated",
    portfolioAddedAt: "2026-01-01T00:00:00.000Z",
    evaluation: {
      recommended_path: "LICENSE",
      market_demand_verdict: "MODERATE",
      market_demand_rationale: "A buyer asked.",
      trl: 5,
      trl_rationale: "Prototype.",
      adoption_risks: [],
      path_rationale: "License it.",
      marketing_abstract: "A patent abstract.",
      confidence: "medium",
      schema_version: "v3",
      evaluated_at: "2026-09-01T00:00:00.000Z",
      licensing_targets: [],
      licensing_recommendation: "hard pass",
      hard_pass_reason: "Hard pass: no viable market.",
      pilot_targets: [],
      pilot_recommendation: "not recommended",
      value_score_snapshot: { totalPoints: 8, maxPoints: 15, tier: "B", breakdown: [
        { label: "Market demand (MODERATE)", points: 4, max: 6 }
      ] }
    }
  };
  const { document, window, errors } = loadPage([ready, quiet, patent]);
  assert.deepEqual(errors, [], errors.join("\n"));
  document.querySelector("#portfolio-kind-publications").click();
  const filters = document.querySelector("#publication-score-filters");
  assert.equal(filters.hidden, false);
  const body = document.querySelector("#portfolio-body").textContent;
  assert.match(body, /Quantified reactor paper/);
  assert.match(body, /Venture-ready candidate/);
  assert.match(body, /File invention disclosure now/);
  assert.match(body, /US grace period only/);
  assert.match(body, /Ward culture commentary/);
  assert.match(body, /Not commercial now/);
  assert.doesNotMatch(body, /A granted patent/);
  const titles = Array.from(document.querySelectorAll("#portfolio-body .patent-title")).map(node => node.textContent);
  assert.match(titles[0], /Quantified reactor paper/);

  const band = document.querySelector("#publication-band-filter");
  band.value = "not_commercial";
  band.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.match(document.querySelector("#portfolio-body").textContent, /Ward culture commentary/);
  assert.doesNotMatch(document.querySelector("#portfolio-body").textContent, /Quantified reactor paper/);

  band.value = "all";
  band.dispatchEvent(new window.Event("change", { bubbles: true }));
  const path = document.querySelector("#publication-path-filter");
  path.value = "file_disclosure";
  path.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.match(document.querySelector("#portfolio-body").textContent, /Quantified reactor paper/);
  assert.doesNotMatch(document.querySelector("#portfolio-body").textContent, /Ward culture commentary/);

  document.querySelector('#portfolio-body [data-open-btn="1"]').click();
  const panel = document.querySelector("#venture-readiness");
  assert.ok(panel);
  assert.match(panel.textContent, /93 \/ 100/);
  assert.match(panel.textContent, /Venture-ready candidate/);
  assert.match(panel.textContent, /File invention disclosure now/);
  assert.match(panel.textContent, /Explore startup/);
  assert.match(panel.textContent, /Yield rose 40 percent/);
  assert.match(panel.textContent, /Advice for the authors/);
  assert.match(panel.textContent, /Not legal advice; confirm with CURF \/ patent counsel/);
  assert.equal(document.querySelector("#value-score"), null);
  const licensing = document.querySelector("#licensing-targets").textContent;
  assert.match(licensing, /optional/);
  assert.doesNotMatch(licensing, /Hard pass/);
  const pilots = document.querySelector("#pilot-targets").textContent;
  assert.doesNotMatch(pilots, /hard pass/i);

  document.querySelector("#portfolio-kind-patents").click();
  assert.equal(document.querySelector("#publication-score-filters").hidden, true);
  const patents = document.querySelector("#portfolio-body").textContent;
  assert.match(patents, /A granted patent/);
  assert.match(patents, /Hard pass/);
  assert.doesNotMatch(patents, /Quantified reactor paper/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";

function target(name, type, why, sc, source){
  return { name, type, why_it_fits: why, sc_connection: sc, source };
}

const records = [
  {
    id: 1,
    title: "Older packaging film",
    dept: "Packaging Science",
    text: "A stored evaluation from before licensing targets.",
    portfolioAddedAt: "2026-01-15T00:00:00.000Z",
    status: "evaluated",
    evaluation: {
      recommended_path: "LICENSE",
      market_demand_verdict: "MODERATE",
      market_demand_rationale: "A distributor already asked about shelf life.",
      trl: 5,
      trl_rationale: "Prototype film tested in a lab.",
      adoption_risks: [],
      path_rationale: "An incumbent could add this to a film line.",
      marketing_abstract: "A film that slows produce spoilage.",
      confidence: "medium",
      schema_version: "v2",
      evaluated_at: "2026-08-28T12:00:00.000Z",
      top_acquirer_targets: [
        { rank: 1, company_name: "Sealed Air", sector: "Packaging", rationale: "Sells food packaging films.", source_url: "https://example.com/sealed", pitch_angle: "Food films." }
      ],
      value_score_snapshot: { totalPoints: 8, maxPoints: 15, tier: "B", breakdown: [] }
    }
  },
  {
    id: 2,
    title: "Recycled carbon fiber panels",
    dept: "Automotive Engineering",
    text: "A new evaluation with licensing destinations.",
    portfolioAddedAt: "2026-01-15T00:00:00.000Z",
    status: "evaluated",
    evaluation: {
      recommended_path: "LICENSE",
      market_demand_verdict: "STRONG",
      market_demand_rationale: "A supplier already ran two prototype rounds.",
      trl: 6,
      trl_rationale: "Panels met an impact test.",
      adoption_risks: [{ factor: "Cost", level: "medium", note: "Reclaimed fiber still needs a price." }],
      path_rationale: "Auto suppliers already buy reinforcement mat.",
      marketing_abstract: "Reclaimed carbon fiber for body panels.",
      confidence: "high",
      schema_version: "v3",
      evaluated_at: "2026-10-23T12:00:00.000Z",
      licensing_recommendation: "pursue",
      hard_pass_reason: "",
      licensing_targets: [
        target("Milliken & Company", "licensee", "Makes performance textiles and composite materials.", "Headquarters in Spartanburg, South Carolina.", "https://example.com/milliken"),
        target("BMW Manufacturing", "acquirer", "Builds vehicles in the Upstate and specifies body panels.", "Plant in Greer, South Carolina.", "https://example.com/bmw"),
        target("Toray Composite Materials", "strategic partner", "Supplies carbon fiber to automotive programs.", "Southeast customer base.", "Toray automotive composites brief"),
        target("Innova SC", "investor", "Funds Upstate advanced manufacturing.", "Southeast regional fund.", "https://example.com/innova")
      ],
      value_score_snapshot: { totalPoints: 11, maxPoints: 15, tier: "A", breakdown: [] }
    }
  },
  {
    id: 3,
    title: "Narrow lab assay",
    dept: "Chemistry",
    text: "A hard pass evaluation.",
    portfolioAddedAt: "2026-01-15T00:00:00.000Z",
    status: "evaluated",
    evaluation: {
      recommended_path: "MATURE",
      market_demand_verdict: "MODERATE",
      market_demand_rationale: "The use case is real but narrow.",
      trl: 3,
      trl_rationale: "Bench assay only.",
      adoption_risks: [],
      path_rationale: "Too early for a licensee to adopt.",
      marketing_abstract: "An early assay.",
      confidence: "low",
      schema_version: "v3",
      evaluated_at: "2026-10-23T12:00:00.000Z",
      licensing_recommendation: "hard pass",
      hard_pass_reason: "Hard pass: no viable market. Only 1 credible destination could be supported.",
      licensing_targets: [
        target("One Diagnostics", "licensee", "Sells a related bench assay.", "", "https://example.com/one")
      ],
      value_score_snapshot: { totalPoints: 4, maxPoints: 15, tier: "C", breakdown: [] }
    }
  }
];

function openCase(document, id){
  const button = document.querySelector('#portfolio-body [data-open-btn="' + id + '"]');
  assert.ok(button, "portfolio row " + id + " should be on the page");
  button.click();
}

test("the page renders licensing targets without script errors", async () => {
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
      window.scrollTo = () => {};
      window.fetch = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      window.localStorage.setItem("curf_docket_patent_records", JSON.stringify(records));
      window.addEventListener("error", (event) => errors.push(event.message || String(event.error)));
    }
  });

  const { window } = dom;
  const { document } = window;
  assert.deepEqual(errors, [], errors.join("\n"));

  const portfolio = document.querySelector("#portfolio-body").textContent;
  assert.match(portfolio, /Licensing targets were not stored/);
  assert.match(portfolio, /Sell or license: Milliken & Company, BMW Manufacturing, Toray Composite Materials, Innova SC/);
  assert.match(portfolio, /Hard pass: no viable market/);

  openCase(document, 1);
  const oldSection = document.querySelector("#licensing-targets");
  assert.ok(oldSection);
  assert.match(oldSection.textContent, /does not include licensing targets/);
  assert.match(oldSection.textContent, /Sealed Air/);
  assert.ok(document.querySelector("[data-reevaluate]"));
  assert.ok(document.querySelector("[data-download-report]"));

  let report = "";
  window.Blob = class {
    constructor(parts){ this.parts = parts; }
    text(){ return Promise.resolve(this.parts.join("")); }
  };
  window.URL.createObjectURL = (blob) => {
    report = blob;
    return "blob:report";
  };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = () => {};
  document.querySelector("[data-download-report]").click();
  const oldReport = await report.text();
  assert.match(oldReport, /Who to sell or license this to/);
  assert.match(oldReport, /does not include licensing targets/);
  assert.match(oldReport, /Sealed Air/);

  openCase(document, 2);
  const section = document.querySelector("#licensing-targets");
  assert.match(section.textContent, /Who to sell or license this to/);
  assert.match(section.textContent, /4 destinations/);
  assert.match(section.textContent, /Milliken & Company/);
  assert.match(section.textContent, /licensee/);
  assert.match(section.textContent, /Why it fits/);
  assert.match(section.textContent, /Spartanburg, South Carolina/);
  assert.match(section.textContent, /https:\/\/example.com\/milliken/);
  assert.match(section.textContent, /Toray automotive composites brief/);
  assert.equal(document.querySelectorAll("#licensing-targets .archetype").length, 4);

  document.querySelector("[data-download-report]").click();
  const newReport = await report.text();
  assert.match(newReport, /Recommendation: pursue/);
  assert.match(newReport, /BMW Manufacturing \(acquirer\)/);
  assert.match(newReport, /South Carolina \/ Southeast: Plant in Greer, South Carolina/);

  openCase(document, 3);
  const hardPass = document.querySelector("#licensing-targets");
  assert.match(hardPass.textContent, /Hard pass/);
  assert.match(hardPass.textContent, /no viable market/);
  assert.match(hardPass.textContent, /One Diagnostics/);
  assert.equal(document.querySelectorAll("#licensing-targets .archetype").length, 1);
  document.querySelector("[data-download-report]").click();
  const passReport = await report.text();
  assert.match(passReport, /Hard pass: no viable market/);

  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(errors, [], errors.join("\n"));
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";

const PAPER = "https://doi.org/10.3390/example2406";

function buyer(name){
  return {
    name,
    type: "licensee",
    why_it_fits: "Sells a related product.",
    sc_connection: "Plant in South Carolina.",
    source: "https://example.com/" + name.toLowerCase()
  };
}

function coreEvaluation(){
  return {
    trl: 3,
    trl_rationale: "Published method.",
    market_demand_verdict: "MODERATE",
    market_demand_rationale: "A lab asked about the method.",
    unsupported_claims: "No product has been sold.",
    adoption_risks: [],
    recommended_path: "LICENSE",
    path_rationale: "A company could license the method.",
    venture_plan: { team: "", next_steps: [] },
    marketing_abstract: "A public Clemson paper on river microbes.",
    critical_challenge: "The paper may not be protectable.",
    confidence: "low",
    caveat: "This is a paper, not a patent.",
    sc_industry_group: "Unmatched",
    licensing_targets: [],
    licensing_recommendation: "",
    hard_pass_reason: "",
    pilot_targets: [],
    biggest_proof_gap: "",
    suggested_next_step: "",
    pilot_recommendation: ""
  };
}

function modelResponse(payload){
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(payload) }]
    })
  };
}

function loadPage(records, fetchImpl){
  const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  const errors = [];
  const calls = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(String(error)));
  virtualConsole.on("error", (error) => errors.push(String(error)));
  const dom = new JSDOM(html, {
    url: "http://localhost/",
    runScripts: "dangerously",
    virtualConsole,
    beforeParse(window){
      window.scrollTo = () => {};
      window.fetch = (url, options) => {
        const href = String(url);
        const method = (options && options.method) || "GET";
        let body = null;
        if(options && options.body){
          try { body = JSON.parse(options.body); }
          catch (err) { body = null; }
        }
        calls.push({ href, method, task: body && body.task || "" });
        if(fetchImpl) return fetchImpl(href, method, body);
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      };
      window.localStorage.setItem("curf_docket_patent_records", JSON.stringify(records));
      window.addEventListener("error", (event) => errors.push(event.message || String(event.error)));
    }
  });
  return { dom, errors, calls };
}

function flush(){
  return new Promise(resolve => {
    let left = 30;
    const step = () => {
      left -= 1;
      if(left <= 0) resolve();
      else setTimeout(step, 0);
    };
    setTimeout(step, 0);
  });
}

function finding(extra){
  return Object.assign({
    source_url: PAPER,
    title: "River microbe lipids",
    authors: "River Lab",
    summary: "A Clemson field study of riverbed lipids.",
    commercial_relevance_score: "UNSCORED",
    found_at: "2026-10-23T13:00:00.000Z"
  }, extra || {});
}

function installFetch(saved){
  return (href, method) => {
    if(href.includes("/api/run-publication-scan") && method === "GET"){
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ configured: true, findings: [finding()], last_scan: null })
      });
    }
    if(href.includes("/api/evaluate-patent") && method === "POST"){
      return Promise.resolve(modelResponse(saved.nextPayload()));
    }
    if(href.includes("/api/evaluated-patents") && method === "POST"){
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ configured: true, ok: true }) });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  };
}

test("reviewing a publication keeps it on the list and stores it in the portfolio", async () => {
  let step = 0;
  const saved = {
    nextPayload(){
      step += 1;
      if(step === 1) return coreEvaluation();
      if(step === 2){
        return {
          licensing_targets: [buyer("Milliken"), buyer("BMW"), buyer("Toray")],
          licensing_recommendation: "pursue",
          hard_pass_reason: ""
        };
      }
      return {
        pilot_targets: [{
          name: "Clemson River Lab",
          type: "Clemson/SC research center or facility",
          what_it_proves: "A field sample would show lipid yield.",
          why_it_fits: "The lab already samples this river.",
          effort: "low",
          source: "https://example.com/river-lab",
          prior_pilots: [],
          prior_pilot_note: "No verified prior pilot found"
        }],
        biggest_proof_gap: "No product trial.",
        suggested_next_step: "Ask the river lab.",
        pilot_recommendation: "pursue"
      };
    }
  };
  const { dom, errors, calls } = loadPage([], installFetch(saved));
  const { document } = dom.window;
  document.querySelector('.nav-item[data-view="pubwatch"]').click();
  await flush();
  const box = document.querySelector("[data-pub-select]");
  assert.ok(box, "publication checkbox");
  box.click();
  document.querySelector("#btn-review-publications").click();
  const during = document.querySelector("#pubwatch-body").textContent;
  assert.match(during, /River microbe lipids/);
  assert.match(during, /Reviewing…/);
  await flush();
  const after = document.querySelector("#pubwatch-body").textContent;
  assert.match(after, /River microbe lipids/);
  assert.match(after, /In the portfolio/);
  assert.doesNotMatch(after, /Reviewing…/);
  document.querySelector("#portfolio-kind-publications").click();
  const portfolio = document.querySelector("#portfolio-body");
  assert.match(portfolio.textContent, /River microbe lipids/);
  assert.match(portfolio.textContent, /Publication/);
  assert.match(portfolio.textContent, /New/);
  assert.match(portfolio.textContent, /Milliken/);
  assert.doesNotMatch(document.querySelector("#portfolio-kind-patents").parentElement.textContent, /0 publications/i);
  assert.equal(document.querySelector("#portfolio-publications-count").textContent, "1");
  portfolio.querySelector("[data-open-btn]").click();
  const licensing = document.querySelector("#licensing-targets");
  const pilots = document.querySelector("#pilot-targets");
  assert.match(licensing.textContent, /Milliken/);
  assert.doesNotMatch(licensing.textContent, /Hard pass/);
  assert.match(pilots.textContent, /Clemson River Lab/);
  assert.doesNotMatch(pilots.textContent, /hard pass/i);
  const modelCalls = calls.filter(call => call.href.includes("/api/evaluate-patent"));
  assert.deepEqual(modelCalls.map(call => call.task), ["publication_evidence", "licensing_targets", "pilot_targets"]);
  document.querySelector("#btn-review-publications").click();
  await flush();
  assert.equal(calls.filter(call => call.href.includes("/api/evaluate-patent")).length, modelCalls.length);
  assert.match(document.querySelector("#pubwatch-body").textContent, /In the portfolio/);
  assert.deepEqual(errors, [], errors.join("\n"));
});

test("a publication already in the portfolio is not evaluated again", async () => {
  const record = {
    id: 4,
    title: "River microbe lipids",
    dept: "River Lab",
    text: "A Clemson field study.",
    status: "evaluated",
    sourcePatentId: PAPER,
    recordType: "publication",
    portfolioAddedAt: new Date().toISOString(),
    evaluation: Object.assign(coreEvaluation(), {
      licensing_targets: [buyer("Milliken"), buyer("BMW"), buyer("Toray")],
      licensing_recommendation: "pursue",
      evaluated_at: new Date().toISOString(),
      schema_version: "v3",
      pilot_targets: [],
      pilot_recommendation: "not recommended"
    })
  };
  const { dom, errors, calls } = loadPage([record], installFetch({ nextPayload: () => coreEvaluation() }));
  const { document } = dom.window;
  document.querySelector('.nav-item[data-view="pubwatch"]').click();
  await flush();
  document.querySelector("[data-pub-select]").click();
  document.querySelector("#btn-review-publications").click();
  await flush();
  assert.equal(calls.filter(call => call.href.includes("/api/evaluate-patent")).length, 0);
  assert.match(document.querySelector("#pubwatch-body").textContent, /In the portfolio/);
  assert.match(document.querySelector("#pubwatch-body").textContent, /River microbe lipids/);
  document.querySelector("#portfolio-kind-publications").click();
  assert.match(document.querySelector("#portfolio-body").textContent, /River microbe lipids/);
  assert.equal(document.querySelector("#portfolio-publications-count").textContent, "1");
  assert.deepEqual(errors, [], errors.join("\n"));
});

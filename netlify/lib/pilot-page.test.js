import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";

function buyer(name){
  return {
    name,
    type: "licensee",
    why_it_fits: "Sells a related product.",
    sc_connection: "Plant in South Carolina.",
    source: "https://example.com/" + name.toLowerCase()
  };
}

function evaluation(extra){
  return Object.assign({
    recommended_path: "LICENSE",
    market_demand_verdict: "MODERATE",
    market_demand_rationale: "A buyer already asked.",
    trl: 5,
    trl_rationale: "Prototype.",
    adoption_risks: [],
    path_rationale: "An incumbent could add this.",
    marketing_abstract: "A short abstract.",
    confidence: "medium",
    schema_version: "v3",
    evaluated_at: "2026-10-23T12:00:00.000Z",
    licensing_recommendation: "pursue",
    licensing_targets: [buyer("Milliken"), buyer("BMW"), buyer("Toray")],
    value_score_snapshot: { totalPoints: 8, maxPoints: 15, tier: "B", breakdown: [] }
  }, extra || {});
}

function record(id, title, evaluation){
  return {
    id,
    title,
    dept: "Engineering",
    text: title,
    status: "evaluated",
    portfolioAddedAt: "2026-01-15T00:00:00.000Z",
    evaluation
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
        calls.push(String(url));
        if(fetchImpl) return fetchImpl(url, options);
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      };
      window.localStorage.setItem("curf_docket_patent_records", JSON.stringify(records));
      window.addEventListener("error", (event) => errors.push(event.message || String(event.error)));
    }
  });
  return { dom, errors, calls };
}

function settle(){
  return new Promise(resolve => setTimeout(resolve, 0));
}

function openCase(document, id){
  const button = document.querySelector('#portfolio-body [data-open-btn="' + id + '"]');
  assert.ok(button, "portfolio row " + id);
  button.click();
}

test("opening a case without pilots asks for that section and keeps the licensing list", async () => {
  const generated = {
    name: "Milliken Pilot",
    type: "industry pilot partner",
    what_it_proves: "A plant trial would produce shelf-life data.",
    why_it_fits: "Milliken already trials packaging films.",
    sc_connection: "Headquarters in Spartanburg, South Carolina.",
    effort: "medium",
    source: "https://example.com/milliken-program",
    prior_pilots: [{
      name: "Spartanburg film trial",
      year: "2023",
      what_it_tested: "Moisture barrier films for produce.",
      alignment: "Same spoilage problem this patent addresses.",
      source: "https://example.com/spartanburg-trial"
    }],
    prior_pilot_note: "",
    verified: true
  };
  const { dom, errors, calls } = loadPage([
    record(1, "Older packaging film", evaluation())
  ], (url) => {
    if(!String(url).includes("/api/generate-pilot-targets")){
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        saved: true,
        pilot_targets: [generated],
        biggest_proof_gap: "No field data.",
        suggested_next_step: "Repeat the Spartanburg film trial.",
        pilot_recommendation: "pursue",
        pilot_search_error: ""
      })
    });
  });
  const { document } = dom.window;
  openCase(document, 1);
  let pilots = document.querySelector("#pilot-targets");
  assert.match(pilots.textContent, /Looking for pilot sites…/);
  assert.match(pilots.textContent, /Add pilot sites/);
  assert.equal(pilots.querySelector("button").disabled, true);
  assert.doesNotMatch(document.body.textContent, /Re-evaluate to add pilot targets/);
  const licensing = document.querySelector("#licensing-targets");
  assert.match(licensing.textContent, /Who to sell or license this to/);
  assert.match(licensing.textContent, /Milliken/);
  assert.equal(licensing.querySelectorAll(".archetype").length, 3);
  await settle();
  await settle();
  pilots = document.querySelector("#pilot-targets");
  assert.match(pilots.textContent, /Refresh pilot sites/);
  assert.match(pilots.textContent, /Spartanburg film trial/);
  assert.match(pilots.textContent, /https:\/\/example.com\/milliken-program/);
  assert.equal(document.querySelector("#licensing-targets").querySelectorAll(".archetype").length, 3);
  assert.ok(calls.some(url => url.includes("/api/generate-pilot-targets")));
  assert.deepEqual(errors, [], errors.join("\n"));
});

test("a failed pilot lookup keeps the case and offers Add pilot targets", async () => {
  const { dom, errors } = loadPage([
    record(1, "Older packaging film", evaluation())
  ]);
  const { document } = dom.window;
  openCase(document, 1);
  await settle();
  await settle();
  const pilots = document.querySelector("#pilot-targets");
  assert.match(pilots.textContent, /Add pilot sites/);
  assert.match(pilots.textContent, /Pilot sites were not updated/);
  assert.equal(pilots.querySelector("button").disabled, false);
  assert.doesNotMatch(document.body.textContent, /Re-evaluate to add pilot targets/);
  assert.match(document.querySelector("#licensing-targets").textContent, /Milliken/);
  assert.deepEqual(errors, [], errors.join("\n"));
});

test("pilot targets show prior-work links first and flag unverified names last", () => {
  const sourced = {
    name: "Milliken Pilot",
    type: "industry pilot partner",
    what_it_proves: "A plant trial would produce shelf-life data.",
    why_it_fits: "Milliken already trials packaging films.",
    sc_connection: "Headquarters in Spartanburg, South Carolina.",
    effort: "medium",
    source: "https://example.com/milliken-program",
    prior_pilots: [{
      name: "Spartanburg film trial",
      year: "2023",
      what_it_tested: "Moisture barrier films for produce.",
      alignment: "Same spoilage problem this patent addresses.",
      source: "https://example.com/spartanburg-trial"
    }],
    prior_pilot_note: "",
    verified: true
  };
  const pageOnly = {
    name: "SCRA SC Launch",
    type: "SC program",
    what_it_proves: "A funded prototype would show a partner can run it.",
    why_it_fits: "SC Launch funds South Carolina proof projects.",
    sc_connection: "Statewide South Carolina program.",
    effort: "low",
    source: "https://example.com/sc-launch",
    prior_pilots: [],
    prior_pilot_note: "No verified prior pilot found",
    verified: true
  };
  const unverified = {
    name: "Mystery Lab",
    type: "test lab/standards body",
    what_it_proves: "A bench test might measure barrier rate.",
    why_it_fits: "Labs test films.",
    sc_connection: "",
    effort: "high",
    source: "",
    prior_pilots: [],
    prior_pilot_note: "No verified prior pilot found",
    verified: false
  };
  const { dom, errors, calls } = loadPage([
    record(2, "Fresh carbon panels", evaluation({
      pilot_targets: [pageOnly, unverified, sourced],
      pilot_recommendation: "pursue",
      biggest_proof_gap: "No field data.",
      suggested_next_step: "Repeat the Spartanburg film trial on this polymer."
    })),
    record(3, "Narrow lab assay", evaluation({
      licensing_recommendation: "hard pass",
      hard_pass_reason: "Hard pass: no viable market.",
      licensing_targets: [buyer("One Diagnostics")],
      pilot_targets: [],
      pilot_recommendation: "not recommended",
      biggest_proof_gap: "Pilots aren't recommended. This is a hard pass with no marketable destination.",
      suggested_next_step: "Do not recruit a pilot partner."
    }))
  ]);
  const { document } = dom.window;
  openCase(document, 2);
  const pilots = document.querySelector("#pilot-targets");
  assert.match(pilots.textContent, /Pilot sites/);
  assert.match(pilots.textContent, /Refresh pilot sites/);
  assert.equal(calls.filter(url => url.includes("/api/generate-pilot-targets")).length, 0);
  assert.match(pilots.textContent, /Biggest proof gap/);
  assert.match(pilots.textContent, /No field data/);
  assert.match(pilots.textContent, /Suggested next step/);
  assert.match(pilots.textContent, /Relevant prior pilots/);
  assert.match(pilots.textContent, /Spartanburg film trial/);
  assert.match(pilots.textContent, /2023/);
  assert.match(pilots.textContent, /No public page about an earlier pilot was found/);
  assert.match(pilots.textContent, /No proof link/);
  const links = [...pilots.querySelectorAll("a")].map(link => link.getAttribute("href"));
  assert.ok(links.includes("https://example.com/spartanburg-trial"));
  assert.ok(links.includes("https://example.com/milliken-program"));
  assert.ok(links.includes("https://example.com/sc-launch"));
  const names = [...pilots.querySelectorAll("[data-pilot-verified]")].map(row => row.getAttribute("data-pilot-verified") + " " + row.querySelector(".sector").textContent);
  assert.match(names[0], /^yes .*Milliken Pilot/);
  assert.match(names[1], /^yes .*SCRA SC Launch/);
  assert.match(names[2], /^no .*Mystery Lab/);
  const licensing = document.querySelector("#licensing-targets");
  assert.match(licensing.textContent, /Who to sell or license this to/);
  assert.match(licensing.textContent, /3 destinations/);
  assert.match(licensing.textContent, /Milliken/);

  openCase(document, 3);
  const skipped = document.querySelector("#pilot-targets");
  assert.match(skipped.textContent, /not a good next step/);
  assert.match(skipped.textContent, /Refresh pilot sites/);
  assert.equal(skipped.querySelector("[data-pilot-verified]"), null);
  const hardPass = document.querySelector("#licensing-targets");
  assert.match(hardPass.textContent, /No real market/);
  assert.match(hardPass.textContent, /One Diagnostics/);
  assert.deepEqual(errors, [], errors.join("\n"));
});

function storedPilotTarget(name, source){
  return {
    name,
    type: "test lab/standards body",
    what_it_proves: "A bench test would measure the rate.",
    why_it_fits: "The lab tests this material.",
    effort: "low",
    source,
    prior_pilots: [],
    prior_pilot_note: "No verified prior pilot found",
    verified: true
  };
}

function flush(){
  return new Promise(resolve => {
    let left = 20;
    const step = () => {
      left -= 1;
      if(left <= 0) resolve();
      else setTimeout(step, 0);
    };
    setTimeout(step, 0);
  });
}

test("refresh keeps the current pilot cards visible until the new search finishes", async () => {
  const { dom, errors, calls } = loadPage([
    record(2, "Fresh carbon panels", evaluation({
      pilot_targets: [storedPilotTarget("Stored Lab", "https://example.com/stored")],
      pilot_recommendation: "pursue",
      biggest_proof_gap: "Old gap.",
      suggested_next_step: "Ask the stored lab."
    }))
  ], (url, options) => {
    const href = String(url);
    const method = (options && options.method) || "GET";
    if(href.includes("/api/generate-pilot-targets-background")){
      return Promise.resolve({ ok: true, status: 202, json: () => Promise.resolve({}) });
    }
    if(href.includes("/api/generate-pilot-targets") && method === "POST"){
      return Promise.resolve({
        ok: true,
        status: 202,
        json: () => Promise.resolve({
          pending: true,
          dispatched: false,
          job_status: "pending",
          started_at: "2026-10-23T20:00:00.000Z"
        })
      });
    }
    if(href.includes("/api/generate-pilot-targets")){
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          pending: false,
          job_status: "done",
          started_at: "2026-10-23T20:00:00.000Z",
          pilot_targets: [storedPilotTarget("Fresh Lab", "https://example.com/fresh")],
          biggest_proof_gap: "New gap.",
          suggested_next_step: "Ask the fresh lab.",
          pilot_recommendation: "pursue",
          pilot_search_error: ""
        })
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
  dom.window.PILOT_POLL_MS = 0;
  const { document } = dom.window;
  openCase(document, 2);
  document.querySelector("[data-pilot-action]").click();
  const during = document.querySelector("#pilot-targets");
  assert.match(during.textContent, /Looking for pilot sites…/);
  assert.match(during.textContent, /Stored Lab/);
  assert.equal(during.querySelector("button").disabled, true);
  await flush();
  const after = document.querySelector("#pilot-targets");
  assert.match(after.textContent, /Fresh Lab/);
  assert.doesNotMatch(after.textContent, /Stored Lab/);
  assert.doesNotMatch(after.textContent, /Looking for pilot sites/);
  assert.equal(after.querySelector("button").disabled, false);
  assert.match(document.querySelector("#licensing-targets").textContent, /Milliken/);
  assert.ok(calls.some(url => url.includes("/api/generate-pilot-targets-background")));
  assert.deepEqual(errors, [], errors.join("\n"));
});

test("a failed refresh leaves the current pilot cards in place", async () => {
  const { dom, errors } = loadPage([
    record(2, "Fresh carbon panels", evaluation({
      pilot_targets: [storedPilotTarget("Stored Lab", "https://example.com/stored")],
      pilot_recommendation: "pursue",
      biggest_proof_gap: "Old gap.",
      suggested_next_step: "Ask the stored lab."
    }))
  ], (url, options) => {
    const href = String(url);
    const method = (options && options.method) || "GET";
    if(href.includes("/api/generate-pilot-targets") && method === "POST"){
      return Promise.resolve({
        ok: false,
        status: 502,
        json: () => Promise.resolve({ error: "Pilot generation could not be started (500)" })
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
  const { document } = dom.window;
  openCase(document, 2);
  document.querySelector("[data-pilot-action]").click();
  await flush();
  const pilots = document.querySelector("#pilot-targets");
  assert.match(pilots.textContent, /Stored Lab/);
  assert.match(pilots.textContent, /Pilot sites were not updated/);
  assert.match(pilots.textContent, /could not be started/);
  assert.equal(pilots.querySelector("button").disabled, false);
  assert.match(document.querySelector("#licensing-targets").textContent, /Milliken/);
  assert.deepEqual(errors, [], errors.join("\n"));
});

test("a finished job from an older search does not replace the cards being refreshed", async () => {
  const { dom, errors } = loadPage([
    record(2, "Fresh carbon panels", evaluation({
      pilot_targets: [storedPilotTarget("Stored Lab", "https://example.com/stored")],
      pilot_recommendation: "pursue"
    }))
  ], (url, options) => {
    const href = String(url);
    const method = (options && options.method) || "GET";
    if(href.includes("/api/generate-pilot-targets") && method === "POST"){
      return Promise.resolve({
        ok: true,
        status: 202,
        json: () => Promise.resolve({
          pending: true,
          dispatched: true,
          job_status: "pending",
          started_at: "2026-10-23T20:00:00.000Z"
        })
      });
    }
    if(href.includes("/api/generate-pilot-targets")){
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          pending: false,
          job_status: "done",
          started_at: "1999-01-01T00:00:00.000Z",
          pilot_targets: [storedPilotTarget("Wrong Lab", "https://example.com/wrong")],
          pilot_recommendation: "pursue"
        })
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
  dom.window.PILOT_POLL_MS = 0;
  dom.window.PILOT_POLL_ATTEMPTS = 2;
  const { document } = dom.window;
  openCase(document, 2);
  document.querySelector("[data-pilot-action]").click();
  await flush();
  const pilots = document.querySelector("#pilot-targets");
  assert.match(pilots.textContent, /Stored Lab/);
  assert.doesNotMatch(pilots.textContent, /Wrong Lab/);
  assert.match(pilots.textContent, /still running/);
  assert.deepEqual(errors, [], errors.join("\n"));
});

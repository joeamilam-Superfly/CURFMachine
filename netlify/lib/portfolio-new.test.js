import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";

const DAY = 24 * 60 * 60 * 1000;

function target(name){
  return {
    name,
    type: "licensee",
    why_it_fits: "Sells a related product.",
    sc_connection: "Plant in South Carolina.",
    source: "https://example.com/" + name.toLowerCase()
  };
}

function evaluated(id, title, evaluatedAt, extra){
  return {
    id,
    title,
    dept: "Engineering",
    text: title,
    status: "evaluated",
    evaluation: {
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
      evaluated_at: evaluatedAt,
      licensing_recommendation: "pursue",
      licensing_targets: [
        target("Milliken"),
        target("BMW"),
        target("Toray")
      ],
      value_score_snapshot: { totalPoints: 8, maxPoints: 15, tier: "B", breakdown: [] }
    },
    ...extra
  };
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
      window.scrollTo = () => {};
      window.fetch = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      window.localStorage.setItem("curf_docket_patent_records", JSON.stringify(records));
      window.addEventListener("error", (event) => errors.push(event.message || String(event.error)));
    }
  });
  return { dom, errors };
}

function chooseView(document, window, value){
  const select = document.querySelector("#portfolio-view-filter");
  select.value = value;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

test("portfolio marks recent unopened patents and keeps triage and licensing intact", () => {
  const now = Date.now();
  const recent = new Date(now - 2 * DAY).toISOString();
  const old = new Date(now - 10 * DAY).toISOString();
  const seenAt = new Date(now - 60 * 1000).toISOString();
  const records = [
    evaluated(1, "Older packaging film", old),
    evaluated(2, "Fresh carbon panels", recent),
    evaluated(3, "Already opened assay", recent, { portfolioSeenAt: seenAt, portfolioAddedAt: recent }),
    evaluated(4, "Second fresh patent", recent),
    evaluated(5, "Archived fresh patent", recent, { archived: true })
  ];
  records[2].evaluation.licensing_recommendation = "hard pass";
  records[2].evaluation.licensing_targets = [target("One Diagnostics")];
  records[2].evaluation.hard_pass_reason = "Hard pass: no viable market.";

  const { dom, errors } = loadPage(records);
  const { window } = dom;
  const { document } = window;
  assert.deepEqual(errors, [], errors.join("\n"));

  const triage = document.querySelector("#registry-new-filter");
  assert.ok(triage);
  assert.match(triage.textContent, /New only/);
  assert.match(triage.textContent, /All patents/);

  const view = document.querySelector("#portfolio-view-filter");
  assert.equal(view.value, "new");
  assert.match(view.querySelector('option[value="new"]').textContent, /^New \(3\)$/);
  assert.equal(view.querySelector('option[value="active"]').textContent, "Active");

  const freshBody = document.querySelector("#portfolio-body");
  assert.match(freshBody.textContent, /Fresh carbon panels/);
  assert.match(freshBody.textContent, /Second fresh patent/);
  assert.match(freshBody.textContent, /Archived fresh patent/);
  assert.doesNotMatch(freshBody.textContent, /Older packaging film/);
  assert.doesNotMatch(freshBody.textContent, /Already opened assay/);
  assert.equal(freshBody.querySelectorAll(".tag.new").length, 3);
  assert.equal(freshBody.querySelectorAll("tr.portfolio-new").length, 3);
  assert.match(freshBody.textContent, /Sell or license: Milliken, BMW, Toray/);

  chooseView(document, window, "active");
  const activeBody = document.querySelector("#portfolio-body");
  assert.match(activeBody.textContent, /Older packaging film/);
  assert.match(activeBody.textContent, /Fresh carbon panels/);
  assert.match(activeBody.textContent, /Already opened assay/);
  assert.match(activeBody.textContent, /Second fresh patent/);
  assert.doesNotMatch(activeBody.textContent, /Archived fresh patent/);
  assert.match(activeBody.textContent, /Hard pass: no viable market/);
  assert.equal(activeBody.querySelectorAll("tr.portfolio-new").length, 2);

  chooseView(document, window, "new");
  document.querySelector('#portfolio-body [data-open-btn="2"]').click();
  const section = document.querySelector("#licensing-targets");
  assert.ok(section);
  assert.match(section.textContent, /Who to sell or license this to/);
  assert.match(section.textContent, /Milliken/);
  assert.match(section.textContent, /3 destinations/);

  const afterOpen = document.querySelector("#portfolio-view-filter");
  assert.equal(afterOpen.value, "new");
  assert.match(afterOpen.querySelector('option[value="new"]').textContent, /^New \(2\)$/);
  const remaining = document.querySelector("#portfolio-body").textContent;
  assert.doesNotMatch(remaining, /Fresh carbon panels/);
  assert.match(remaining, /Second fresh patent/);

  chooseView(document, window, "active");
  const carbon = [...document.querySelectorAll("#portfolio-body tr")].find(row => /Fresh carbon panels/.test(row.textContent));
  assert.ok(carbon);
  assert.equal(carbon.querySelector(".tag.new"), null);
  assert.equal(carbon.classList.contains("portfolio-new"), false);
  const second = [...document.querySelectorAll("#portfolio-body tr")].find(row => /Second fresh patent/.test(row.textContent));
  assert.ok(second.querySelector(".tag.new"));

  document.querySelector("#btn-mark-portfolio-seen").click();
  assert.match(document.querySelector('#portfolio-view-filter option[value="new"]').textContent, /^New \(0\)$/);
  assert.equal(document.querySelector("#btn-mark-portfolio-seen").disabled, true);
  assert.equal(document.querySelectorAll("#portfolio-body .tag.new").length, 0);
  assert.equal(document.querySelector("#portfolio-view-filter").value, "active");

  const stored = JSON.parse(window.localStorage.getItem("curf_docket_patent_records"));
  const opened = stored.find(row => row.id === 2);
  const secondStored = stored.find(row => row.id === 4);
  const archivedStored = stored.find(row => row.id === 5);
  assert.ok(opened.portfolioSeenAt);
  assert.ok(secondStored.portfolioSeenAt);
  assert.ok(archivedStored.portfolioSeenAt);
  assert.equal(stored.find(row => row.id === 1).portfolioSeenAt, null);

  assert.deepEqual(errors, [], errors.join("\n"));
});

test("portfolio stays on Active when nothing was added in the last 7 days", () => {
  const old = new Date(Date.now() - 10 * DAY).toISOString();
  const { dom, errors } = loadPage([
    evaluated(1, "Older packaging film", old)
  ]);
  const view = dom.window.document.querySelector("#portfolio-view-filter");
  assert.equal(view.value, "active");
  assert.match(view.querySelector('option[value="new"]').textContent, /^New \(0\)$/);
  assert.equal(dom.window.document.querySelector("#btn-mark-portfolio-seen").disabled, true);
  assert.match(dom.window.document.querySelector("#portfolio-body").textContent, /Older packaging film/);
  assert.equal(dom.window.document.querySelectorAll("#portfolio-body .tag.new").length, 0);
  assert.deepEqual(errors, [], errors.join("\n"));
});

test("mark all seen on an untouched menu returns to Active", () => {
  const recent = new Date(Date.now() - 2 * DAY).toISOString();
  const { dom, errors } = loadPage([
    evaluated(1, "Fresh carbon panels", recent),
    evaluated(2, "Second fresh patent", recent)
  ]);
  const { document } = dom.window;
  assert.equal(document.querySelector("#portfolio-view-filter").value, "new");
  document.querySelector("#btn-mark-portfolio-seen").click();
  assert.equal(document.querySelector("#portfolio-view-filter").value, "active");
  assert.match(document.querySelector('#portfolio-view-filter option[value="new"]').textContent, /^New \(0\)$/);
  assert.match(document.querySelector("#portfolio-body").textContent, /Fresh carbon panels/);
  assert.match(document.querySelector("#portfolio-body").textContent, /Second fresh patent/);
  assert.equal(document.querySelectorAll("#portfolio-body .tag.new").length, 0);
  assert.deepEqual(errors, [], errors.join("\n"));
});

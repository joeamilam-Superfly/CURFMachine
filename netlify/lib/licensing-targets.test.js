import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import handler from "../functions/evaluate-patent.js";
import {
  LICENSING_OUTPUT_SHAPE,
  buildLicensingSearchRequest,
  normalizeLicensingPayload
} from "./licensing-targets.js";

const fourTargets = [
  { name: "Milliken & Company", type: "licensee", why_it_fits: "Produces performance textiles and films that overlap this process.", sc_connection: "Headquarters in Spartanburg, South Carolina.", source: "https://example.com/milliken" },
  { name: "BMW Manufacturing", type: "acquirer", why_it_fits: "Assembles vehicles in the Upstate and buys composite panels.", sc_connection: "Plant in Greer, South Carolina.", source: "https://example.com/bmw" },
  { name: "Clemson University Research Foundation", type: "startup/spinout vehicle", why_it_fits: "Already forms spinouts around university-owned materials IP.", sc_connection: "Based in Clemson, South Carolina.", source: "CURF spinout page" },
  { name: "Innova SC", type: "investor", why_it_fits: "Invests in Upstate advanced-manufacturing companies.", sc_connection: "Southeast regional fund.", source: "https://example.com/innova" }
];

function anthropicMessage(payload, preamble){
  const content = [];
  if(preamble) content.push({ type: "text", text: preamble });
  content.push({ type: "text", text: JSON.stringify(payload) });
  return {
    stop_reason: "end_turn",
    content
  };
}

test("prompt schema asks for licensing destinations and a hard pass", () => {
  const built = buildLicensingSearchRequest({
    title: "Moisture film",
    dept: "Packaging",
    text: "A humidity responsive produce film.",
    industryContacts: "A regional distributor",
    sc_industry_group: "Containers and Packaging"
  });
  assert.match(built.system, /licensing_targets/);
  assert.match(built.system, /no viable market/);
  assert.match(built.system, /at least 3/);
  assert.match(built.system, /Do not invent/);
  assert.match(built.system, /South Carolina or Southeast/);
  for(const field of ["name", "type", "why_it_fits", "sc_connection", "source", "licensing_recommendation", "hard_pass_reason"]){
    assert.match(LICENSING_OUTPUT_SHAPE, new RegExp(field));
    assert.match(built.system, new RegExp(field));
  }
  for(const type of ["licensee", "acquirer", "strategic partner", "startup/spinout vehicle", "investor"]){
    assert.match(built.system, new RegExp(type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(built.tools[0].max_uses, 3);
  assert.match(built.messages[0].content, /Moisture film/);
  assert.match(built.messages[0].content, /regional distributor/);
});

test("four credible destinations stay a pursue list and are not trimmed to three", () => {
  const normalized = normalizeLicensingPayload({ licensing_targets: fourTargets, licensing_recommendation: "pursue" }, { enforce: true });
  assert.equal(normalized.licensing_targets.length, 4);
  assert.equal(normalized.licensing_recommendation, "pursue");
  assert.equal(normalized.hard_pass_reason, "");
  assert.deepEqual(Object.keys(normalized.licensing_targets[0]).sort(), ["name", "sc_connection", "source", "type", "why_it_fits"]);
  assert.equal(normalized.licensing_targets[0].sc_connection, "Headquarters in Spartanburg, South Carolina.");
  assert.equal(normalized.licensing_targets[2].type, "startup/spinout vehicle");
});

test("fewer than three credible destinations is a hard pass and the list is not padded", () => {
  const normalized = normalizeLicensingPayload({
    licensing_targets: [
      fourTargets[0],
      { name: "", type: "licensee", why_it_fits: "Invented filler", source: "https://example.com/nope" },
      { name: "A large chemical company", type: "conglomerate", why_it_fits: "Vague sector guess", source: "https://example.com/vague" },
      { name: "Milliken & Company", type: "licensee", why_it_fits: "Duplicate of the first row.", source: "https://example.com/dup" }
    ]
  }, { enforce: true });
  assert.equal(normalized.licensing_targets.length, 1);
  assert.equal(normalized.licensing_targets[0].name, "Milliken & Company");
  assert.equal(normalized.licensing_recommendation, "hard pass");
  assert.match(normalized.hard_pass_reason, /no viable market/i);
  assert.match(normalized.hard_pass_reason, /not padded|Only 1/);
});

test("an older top_acquirer_targets payload maps into licensing_targets", () => {
  const normalized = normalizeLicensingPayload({
    top_acquirer_targets: [
      { rank: 1, company_name: "Sealed Air", sector: "Packaging", rationale: "Sells produce packaging films.", source_url: "https://example.com/sealed", pitch_angle: "Their food films are the overlap." },
      { rank: 2, company_name: "Amcor", sector: "Packaging", rationale: "Makes flexible packaging.", source_url: "https://example.com/amcor", pitch_angle: "Flexible films." },
      { rank: 3, company_name: "", sector: "Food retail", rationale: "Sector only.", source_url: "", pitch_angle: "" }
    ]
  });
  assert.equal(normalized.licensing_targets.length, 2);
  assert.equal(normalized.licensing_targets[0].type, "acquirer");
  assert.equal(normalized.licensing_targets[0].source, "https://example.com/sealed");
  assert.equal(normalized.licensing_recommendation, "hard pass");
});

test("a core evaluation that leaves the list empty is not turned into a hard pass", () => {
  const core = {
    recommended_path: "LICENSE",
    caveat: "LEAVE-ME",
    licensing_targets: [],
    licensing_recommendation: "",
    hard_pass_reason: ""
  };
  assert.equal(normalizeLicensingPayload(core), null);
});

test("evaluate-patent normalizes a mocked licensing model response", async () => {
  const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify(anthropicMessage({
      licensing_targets: fourTargets.slice(0, 2),
      licensing_recommendation: "pursue",
      hard_pass_reason: ""
    }, "I will search first.")), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  process.env.ANTHROPIC_API_KEY = "test-key";
  try {
    const response = await handler(new Request("http://local/api/evaluate-patent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "licensing_targets",
        enableSearch: true,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 20 }],
        patent: { title: "Moisture film", dept: "Packaging", text: "A humidity responsive film." }
      })
    }));
    assert.equal(response.status, 200);
    const data = await response.json();
    const parsed = JSON.parse(data.content[data.content.length - 1].text);
    assert.equal(parsed.licensing_targets.length, 2);
    assert.equal(parsed.licensing_recommendation, "hard pass");
    assert.match(parsed.hard_pass_reason, /no viable market/i);
    assert.equal(sent.body.tools[0].max_uses, 3);
    assert.match(sent.body.system, /licensing_targets/);
    assert.equal(sent.url, "https://api.anthropic.com/v1/messages");
  } finally {
    globalThis.fetch = original;
  }
});

test("evaluate-patent leaves a core evaluation response unchanged", async () => {
  const original = globalThis.fetch;
  const raw = JSON.stringify({
    recommended_path: "MATURE",
    caveat: "LEAVE-ME",
    licensing_targets: [],
    licensing_recommendation: "",
    hard_pass_reason: ""
  });
  globalThis.fetch = async () => new Response(JSON.stringify({
    stop_reason: "end_turn",
    content: [{ type: "text", text: raw }]
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  process.env.ANTHROPIC_API_KEY = "test-key";
  try {
    const response = await handler(new Request("http://local/api/evaluate-patent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system: "core",
        messages: [{ role: "user", content: "patent" }],
        enableSearch: false
      })
    }));
    const data = await response.json();
    assert.equal(data.content[0].text, raw);
    assert.doesNotMatch(data.content[0].text, /hard pass/);
  } finally {
    globalThis.fetch = original;
  }
});

test("the page script parses and the case file markup includes licensing targets", () => {
  const html = readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.ok(scripts.length >= 1);
  const dir = mkdtempSync(join(tmpdir(), "curf-script-"));
  scripts.forEach((source, index) => {
    const file = join(dir, "script-" + index + ".js");
    writeFileSync(file, source);
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
  assert.match(html, /id="licensing-targets"/);
  assert.match(html, /Who to sell or license this to/);
  assert.match(html, /This review does not include buyer names/);
  assert.match(html, /data-reevaluate/);
  assert.match(html, /data-download-report/);
  assert.match(html, /task: "licensing_targets"/);
});

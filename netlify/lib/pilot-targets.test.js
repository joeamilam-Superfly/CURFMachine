import assert from "node:assert/strict";
import test from "node:test";

import handler from "../functions/evaluate-patent.js";
import {
  NO_VERIFIED_PRIOR_PILOT,
  PILOT_OUTPUT_SHAPE,
  buildPilotSearchRequest,
  normalizePilotPayload
} from "./pilot-targets.js";

function target(name, extra){
  return Object.assign({
    name,
    type: "industry pilot partner",
    what_it_proves: "A field trial would show the film slows spoilage.",
    why_it_fits: "This group already runs packaging trials.",
    sc_connection: "Plant in South Carolina.",
    effort: "medium",
    source: "https://example.com/" + name.toLowerCase().replace(/\s+/g, "-"),
    prior_pilots: []
  }, extra || {});
}

function prior(name, year){
  return {
    name,
    year,
    what_it_tested: "A shelf-life film trial.",
    alignment: "Same moisture-barrier problem as this patent.",
    source: "https://example.com/pilots/" + year
  };
}

test("prompt requires a source for prior work and forbids invented pilots", () => {
  const built = buildPilotSearchRequest({
    title: "Moisture film",
    dept: "Packaging",
    text: "A humidity responsive produce film.",
    recommended_path: "LICENSE",
    claims_summary: "No field data.",
    licensing_targets: [{ name: "Milliken", type: "licensee", why_it_fits: "Runs packaging film trials." }]
  });
  assert.match(built.system, /pilot_targets/);
  assert.match(built.system, /web_search/);
  assert.match(built.system, /Never fabricate/);
  assert.match(built.system, new RegExp(NO_VERIFIED_PRIOR_PILOT.replace(/[.]/g, "\\.")));
  assert.match(built.system, /at least one http or https source/);
  assert.match(built.system, /Rank the array with organizations that have verified, closely aligned prior pilots first/);
  assert.match(built.system, /press release, paper, grant award, program page, patent, or case study/);
  assert.equal(built.tools[0].max_uses, 3);
  assert.equal(built.tools[0].type, "web_search_20250305");
  for(const field of ["what_it_proves", "why_it_fits", "sc_connection", "effort", "prior_pilots", "biggest_proof_gap", "suggested_next_step"]){
    assert.match(PILOT_OUTPUT_SHAPE, new RegExp(field));
  }
  assert.match(built.messages[0].content, /Claims summary: No field data/);
  assert.match(built.messages[0].content, /Milliken/);
  assert.match(built.messages[0].content, /Do not copy the list/);
});

test("verified prior pilots rank ahead of a sourced name and unsourced names are unverified last", () => {
  const normalized = normalizePilotPayload({
    pilot_targets: [
      target("Plain Program Page", { prior_pilots: [], source: "https://example.com/program" }),
      target("No Link Lab", { source: "mentioned in a brochure", prior_pilots: [{ name: "Invented trial", year: "2022", what_it_tested: "Something", alignment: "Maybe", source: "not a url" }] }),
      target("Milliken Pilot", { prior_pilots: [prior("Spartanburg film trial", "2023"), prior("Second film study", "2021")] })
    ],
    biggest_proof_gap: "No field data.",
    suggested_next_step: "Ask Milliken to repeat the film trial on this polymer.",
    pilot_recommendation: "pursue"
  }, { enforce: true });

  assert.equal(normalized.pilot_targets.length, 3);
  assert.equal(normalized.pilot_targets[0].name, "Milliken Pilot");
  assert.equal(normalized.pilot_targets[0].verified, true);
  assert.equal(normalized.pilot_targets[0].prior_pilots.length, 2);
  assert.equal(normalized.pilot_targets[0].prior_pilots[0].year, "2023");
  assert.match(normalized.pilot_targets[0].prior_pilots[0].source, /^https:\/\//);
  assert.equal(normalized.pilot_targets[1].name, "Plain Program Page");
  assert.equal(normalized.pilot_targets[1].verified, true);
  assert.equal(normalized.pilot_targets[1].prior_pilot_note, NO_VERIFIED_PRIOR_PILOT);
  assert.equal(normalized.pilot_targets[2].name, "No Link Lab");
  assert.equal(normalized.pilot_targets[2].verified, false);
  assert.equal(normalized.pilot_targets[2].source, "");
  assert.equal(normalized.pilot_targets[2].prior_pilots.length, 0);
  assert.equal(normalized.pilot_targets[2].prior_pilot_note, NO_VERIFIED_PRIOR_PILOT);
  assert.equal(normalized.pilot_recommendation, "pursue");
  assert.equal(normalized.biggest_proof_gap, "No field data.");
});

test("a federal program alias is kept when it has a grant link", () => {
  const normalized = normalizePilotPayload({
    pilot_targets: [
      target("NSF PFI", {
        type: "NSF PFI",
        effort: "high cost",
        source: "See the award page at https://nsf.example.edu/awards/123.",
        prior_pilots: []
      })
    ]
  }, { enforce: true });
  assert.equal(normalized.pilot_targets[0].type, "federal program");
  assert.equal(normalized.pilot_targets[0].effort, "high");
  assert.equal(normalized.pilot_targets[0].source, "https://nsf.example.edu/awards/123");
  assert.equal(normalized.pilot_targets[0].verified, true);
});

test("a core evaluation that leaves pilot fields empty is not rewritten", () => {
  const core = {
    recommended_path: "MATURE",
    caveat: "LEAVE-ME",
    pilot_targets: [],
    biggest_proof_gap: "",
    suggested_next_step: "",
    pilot_recommendation: ""
  };
  assert.equal(normalizePilotPayload(core), null);
});

test("evaluate-patent searches for pilots and flags a target with no proof link", async () => {
  const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      stop_reason: "end_turn",
      content: [
        { type: "text", text: "I will search first." },
        { type: "text", text: JSON.stringify({
          pilot_targets: [
            target("Unsourced Center", { source: "" }),
            target("Clemson Composite Center", {
              type: "Clemson/SC research center or facility",
              prior_pilots: [prior("Composite panel trial", "2024")]
            })
          ],
          biggest_proof_gap: "No scale-up.",
          suggested_next_step: "Use the Clemson center trial as the template.",
          pilot_recommendation: "pursue"
        }) }
      ]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  process.env.ANTHROPIC_API_KEY = "test-key";
  try {
    const response = await handler(new Request("http://local/api/evaluate-patent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "pilot_targets",
        enableSearch: false,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 20 }],
        patent: { title: "Carbon panels", dept: "Automotive", text: "Reclaimed fiber panels." }
      })
    }));
    assert.equal(response.status, 200);
    const data = await response.json();
    const parsed = JSON.parse(data.content[data.content.length - 1].text);
    assert.equal(parsed.pilot_targets[0].name, "Clemson Composite Center");
    assert.equal(parsed.pilot_targets[0].verified, true);
    assert.equal(parsed.pilot_targets[1].verified, false);
    assert.equal(parsed.pilot_targets[1].prior_pilot_note, NO_VERIFIED_PRIOR_PILOT);
    assert.equal(sent.body.tools[0].max_uses, 3);
    assert.match(sent.body.system, /No verified prior pilot found/);
    assert.equal(sent.url, "https://api.anthropic.com/v1/messages");
  } finally {
    globalThis.fetch = original;
  }
});

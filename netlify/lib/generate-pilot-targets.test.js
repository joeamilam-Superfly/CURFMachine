import assert from "node:assert/strict";
import test from "node:test";

import handler from "../functions/generate-pilot-targets.js";
import { applyPilotFields, isPilotHardPass } from "./pilot-targets.js";

function storedRecord(extra){
  return {
    id: 7,
    title: "Moisture film",
    dept: "Packaging",
    text: "A humidity responsive produce film.",
    status: "evaluated",
    evaluation: Object.assign({
      recommended_path: "LICENSE",
      market_demand_verdict: "MODERATE",
      market_demand_rationale: "A buyer asked.",
      unsupported_claims: "No field data.",
      marketing_abstract: "A film that slows spoilage.",
      licensing_recommendation: "pursue",
      licensing_targets: [
        { name: "Milliken", type: "licensee", why_it_fits: "Runs film trials." },
        { name: "BMW", type: "acquirer", why_it_fits: "Buys materials." },
        { name: "Toray", type: "licensee", why_it_fits: "Sells films." }
      ],
      value_score_snapshot: { totalPoints: 8, tier: "B" },
      evaluated_at: "2026-08-30T12:00:00.000Z",
      schema_version: "v3"
    }, extra || {})
  };
}

function installFetch(routes){
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const entry = { url: String(url), method: (options && options.method) || "GET", body: options && options.body ? JSON.parse(options.body) : null };
    calls.push(entry);
    const route = routes.find(item => item.match(entry));
    if(!route) return new Response(JSON.stringify({ error: "unexpected " + entry.url }), { status: 500 });
    return route.respond(entry);
  };
  return calls;
}

test("a moderate patent with no licensing list is not a hard pass, and weak demand is", () => {
  const moderate = storedRecord();
  delete moderate.evaluation.licensing_targets;
  delete moderate.evaluation.licensing_recommendation;
  assert.equal(isPilotHardPass(moderate), false);
  assert.equal(isPilotHardPass(storedRecord({ recommended_path: "NO_DEMAND", market_demand_verdict: "WEAK" })), true);
  assert.equal(isPilotHardPass(storedRecord({ licensing_recommendation: "hard pass", licensing_targets: [{ name: "One" }] })), true);
});

test("applying pilot fields leaves licensing targets and the score untouched", () => {
  const original = storedRecord();
  const patched = applyPilotFields(original, {
    pilot_targets: [{ name: "SCRA", verified: true }],
    biggest_proof_gap: "No field data.",
    suggested_next_step: "Ask SCRA.",
    pilot_recommendation: "pursue",
    pilot_search_error: "",
    licensing_targets: [{ name: "Should not stick" }],
    value_score_snapshot: { totalPoints: 0 }
  });
  assert.deepEqual(patched.evaluation.licensing_targets, original.evaluation.licensing_targets);
  assert.deepEqual(patched.evaluation.value_score_snapshot, original.evaluation.value_score_snapshot);
  assert.equal(patched.evaluation.evaluated_at, original.evaluation.evaluated_at);
  assert.equal(patched.title, "Moisture film");
  assert.equal(patched.evaluation.pilot_targets[0].name, "SCRA");
  assert.equal(original.evaluation.pilot_targets, undefined);
});

test("a hard pass is saved as not recommended and does not call the model", async () => {
  const record = storedRecord({ recommended_path: "NO_DEMAND", market_demand_verdict: "WEAK", licensing_targets: null, licensing_recommendation: "" });
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.ANTHROPIC_API_KEY = "test-key";
  let reads = 0;
  const calls = installFetch([
    {
      match: entry => entry.url.includes("/rest/v1/evaluated_patents") && entry.method === "GET",
      respond: () => {
        reads += 1;
        return new Response(JSON.stringify([{ patent_id: "11840454", record_json: record }]), { status: 200 });
      }
    },
    {
      match: entry => entry.url.includes("/rest/v1/evaluated_patents") && entry.method === "PATCH",
      respond: entry => new Response(JSON.stringify([{ patent_id: "11840454", record_json: entry.body.record_json }]), { status: 200 })
    }
  ]);
  const response = await handler(new Request("http://local/api/generate-pilot-targets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patent_id: "11840454", record: { title: "Ignore me", evaluation: { recommended_path: "LICENSE" } } })
  }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.hard_pass, true);
  assert.equal(data.saved, true);
  assert.equal(data.pilot_recommendation, "not recommended");
  assert.equal(data.verified_count, 0);
  assert.equal(calls.some(entry => entry.url.includes("anthropic.com")), false);
  const write = calls.find(entry => entry.method === "PATCH");
  assert.equal(write.body.record_json.evaluation.pilot_recommendation, "not recommended");
  assert.equal(write.body.record_json.evaluation.recommended_path, "NO_DEMAND");
  assert.deepEqual(write.body.record_json.evaluation.value_score_snapshot, record.evaluation.value_score_snapshot);
  assert.equal(write.body.portfolio_added_at, undefined);
  assert.equal(reads, 2);
});

test("a pursue patent stores only the pilot section from the search", async () => {
  const record = storedRecord();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.ANTHROPIC_API_KEY = "test-key";
  const calls = installFetch([
    {
      match: entry => entry.url.includes("/rest/v1/evaluated_patents") && entry.method === "GET",
      respond: () => new Response(JSON.stringify([{ patent_id: "US-1", record_json: record }]), { status: 200 })
    },
    {
      match: entry => entry.url.includes("api.anthropic.com"),
      respond: () => new Response(JSON.stringify({
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({
          pilot_targets: [
            {
              name: "No Link Lab",
              type: "test lab/standards body",
              what_it_proves: "A bench test would measure barrier rate.",
              why_it_fits: "Labs test films.",
              effort: "low",
              source: "a brochure",
              prior_pilots: []
            },
            {
              name: "Milliken Pilot",
              type: "industry pilot partner",
              what_it_proves: "A plant trial would produce shelf-life data.",
              why_it_fits: "Milliken already trials packaging films.",
              sc_connection: "Spartanburg, South Carolina.",
              effort: "medium",
              source: "https://example.com/milliken",
              prior_pilots: [{
                name: "Spartanburg film trial",
                year: "2023",
                what_it_tested: "Moisture barrier films.",
                alignment: "Same spoilage problem.",
                source: "https://example.com/trial"
              }]
            }
          ],
          biggest_proof_gap: "No field data.",
          suggested_next_step: "Repeat the Spartanburg trial.",
          pilot_recommendation: "pursue"
        }) }]
      }), { status: 200 })
    },
    {
      match: entry => entry.url.includes("/rest/v1/evaluated_patents") && entry.method === "PATCH",
      respond: entry => new Response(JSON.stringify([{ patent_id: "US-1", record_json: entry.body.record_json }]), { status: 200 })
    }
  ]);
  const response = await handler(new Request("http://local/api/generate-pilot-targets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patent_id: "US-1" })
  }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.saved, true);
  assert.equal(data.hard_pass, false);
  assert.equal(data.pilot_targets[0].name, "Milliken Pilot");
  assert.equal(data.pilot_targets[0].verified, true);
  assert.equal(data.pilot_targets[1].verified, false);
  assert.equal(data.verified_count, 1);
  const sent = calls.find(entry => entry.url.includes("api.anthropic.com"));
  assert.equal(sent.body.tools[0].max_uses, 3);
  assert.match(sent.body.messages[0].content, /Milliken/);
  assert.match(sent.body.messages[0].content, /Claims summary: No field data/);
  assert.match(sent.body.system, /Never fabricate/);
  const write = calls.find(entry => entry.method === "PATCH");
  assert.equal(write.body.record_json.evaluation.licensing_targets.length, 3);
  assert.equal(write.body.record_json.evaluation.licensing_targets[0].name, "Milliken");
  assert.deepEqual(write.body.record_json.evaluation.value_score_snapshot, record.evaluation.value_score_snapshot);
  assert.equal(write.body.record_json.evaluation.evaluated_at, "2026-08-30T12:00:00.000Z");
  assert.equal(write.body.record_json.title, "Moisture film");
});

test("a failed search does not write the record", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.ANTHROPIC_API_KEY = "test-key";
  const calls = installFetch([
    {
      match: entry => entry.method === "GET",
      respond: () => new Response(JSON.stringify([{ patent_id: "US-1", record_json: storedRecord() }]), { status: 200 })
    },
    {
      match: entry => entry.url.includes("api.anthropic.com"),
      respond: () => new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 529 })
    }
  ]);
  const response = await handler(new Request("http://local/api/generate-pilot-targets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patent_id: "US-1" })
  }));
  assert.equal(response.status, 529);
  assert.equal(calls.some(entry => entry.method === "PATCH"), false);
});

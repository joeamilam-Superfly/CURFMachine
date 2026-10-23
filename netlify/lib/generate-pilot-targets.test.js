import assert from "node:assert/strict";
import test from "node:test";

import handler from "../functions/generate-pilot-targets.js";
import background, { config as backgroundConfig } from "../functions/generate-pilot-targets-background.js";
import { isRetryablePilotError, runPilotGenerationJob } from "./pilot-generation.js";
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

function pilotSearchPayload(){
  return {
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
  };
}

function memoryStore(record){
  let current = JSON.parse(JSON.stringify(record));
  return {
    routes(){
      return [
        {
          match: entry => entry.url.includes("/rest/v1/evaluated_patents") && entry.method === "GET",
          respond: () => new Response(JSON.stringify([{ patent_id: "US-1", record_json: current }]), { status: 200 })
        },
        {
          match: entry => entry.url.includes("/rest/v1/evaluated_patents") && entry.method === "PATCH",
          respond: entry => {
            current = entry.body.record_json;
            return new Response(JSON.stringify([{ patent_id: "US-1", record_json: current }]), { status: 200 });
          }
        }
      ];
    },
    read: () => current
  };
}

test("a pursue patent is queued without calling the model or clearing other fields", async () => {
  const record = storedRecord();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.URL = "https://curfpatentmachine.netlify.app";
  const calls = installFetch([
    {
      match: entry => entry.url.includes("/rest/v1/evaluated_patents") && entry.method === "GET",
      respond: () => new Response(JSON.stringify([{ patent_id: "US-1", record_json: record }]), { status: 200 })
    },
    {
      match: entry => entry.url.includes("/rest/v1/evaluated_patents") && entry.method === "PATCH",
      respond: entry => new Response(JSON.stringify([{ patent_id: "US-1", record_json: entry.body.record_json }]), { status: 200 })
    },
    {
      match: entry => entry.url.includes("generate-pilot-targets-background"),
      respond: () => new Response(JSON.stringify({ ok: true }), { status: 202 })
    }
  ]);
  const response = await handler(new Request("http://local/api/generate-pilot-targets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patent_id: "US-1" })
  }));
  assert.equal(response.status, 202);
  const data = await response.json();
  assert.equal(data.pending, true);
  assert.equal(data.dispatched, true);
  assert.equal(data.job_status, "pending");
  assert.equal(data.pilot_targets, undefined);
  assert.equal(calls.some(entry => entry.url.includes("anthropic.com")), false);
  const write = calls.find(entry => entry.method === "PATCH");
  assert.equal(write.body.record_json.evaluation.pilot_job.status, "pending");
  assert.equal(write.body.record_json.evaluation.pilot_job.error, "");
  assert.equal(write.body.record_json.evaluation.pilot_targets, undefined);
  assert.equal(write.body.record_json.evaluation.licensing_targets.length, 3);
  assert.equal(write.body.record_json.evaluation.licensing_targets[0].name, "Milliken");
  assert.deepEqual(write.body.record_json.evaluation.value_score_snapshot, record.evaluation.value_score_snapshot);
  assert.equal(write.body.record_json.evaluation.evaluated_at, "2026-08-30T12:00:00.000Z");
  assert.equal(write.body.record_json.title, "Moisture film");
  const kick = calls.find(entry => entry.url.includes("generate-pilot-targets-background"));
  assert.equal(kick.body.patent_id, "US-1");
  assert.equal(kick.body.started_at, write.body.record_json.evaluation.pilot_job.started_at);
});

test("an evaluation that already has pilot targets is returned without another search", async () => {
  const record = storedRecord({
    pilot_targets: [{ name: "Stored Lab", verified: true, source: "https://example.com/stored" }],
    biggest_proof_gap: "Already stored.",
    suggested_next_step: "Use the stored lab.",
    pilot_recommendation: "pursue",
    pilot_search_error: ""
  });
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.ANTHROPIC_API_KEY = "test-key";
  const calls = installFetch([
    {
      match: entry => entry.method === "GET",
      respond: () => new Response(JSON.stringify([{ patent_id: "US-1", record_json: record }]), { status: 200 })
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
  assert.equal(data.pilot_targets[0].name, "Stored Lab");
  assert.equal(data.verified_count, 1);
  assert.equal(calls.some(entry => entry.url.includes("anthropic.com")), false);
  assert.equal(calls.some(entry => entry.method === "PATCH"), false);
});

test("refresh queues a new search and keeps the stored pilot targets", async () => {
  const record = storedRecord({
    pilot_targets: [{ name: "Stored Lab", verified: true, source: "https://example.com/stored" }],
    pilot_recommendation: "pursue",
    biggest_proof_gap: "Old gap.",
    suggested_next_step: "Old step.",
    pilot_job: { status: "done", started_at: "2026-10-23T12:00:00.000Z", error: "" }
  });
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.URL = "https://curfpatentmachine.netlify.app";
  const calls = installFetch([
    {
      match: entry => entry.method === "GET",
      respond: () => new Response(JSON.stringify([{ patent_id: "US-1", record_json: record }]), { status: 200 })
    },
    {
      match: entry => entry.method === "PATCH",
      respond: entry => new Response(JSON.stringify([{ patent_id: "US-1", record_json: entry.body.record_json }]), { status: 200 })
    },
    {
      match: entry => entry.url.includes("generate-pilot-targets-background"),
      respond: () => new Response("", { status: 202 })
    }
  ]);
  const response = await handler(new Request("http://local/api/generate-pilot-targets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patent_id: "US-1", force: true })
  }));
  assert.equal(response.status, 202);
  const data = await response.json();
  assert.equal(data.pending, true);
  assert.equal(data.pilot_targets[0].name, "Stored Lab");
  assert.equal(calls.some(entry => entry.url.includes("anthropic.com")), false);
  const write = calls.find(entry => entry.method === "PATCH");
  assert.equal(write.body.record_json.evaluation.licensing_targets.length, 3);
  assert.equal(write.body.record_json.evaluation.pilot_targets[0].name, "Stored Lab");
  assert.equal(write.body.record_json.evaluation.pilot_job.status, "pending");
  assert.equal(write.body.record_json.evaluation.biggest_proof_gap, "Old gap.");
});

test("a fresh pending job is not started a second time", async () => {
  const startedAt = new Date().toISOString();
  const record = storedRecord({
    pilot_targets: [{ name: "Stored Lab", verified: true, source: "https://example.com/stored" }],
    pilot_recommendation: "pursue",
    pilot_job: { status: "running", started_at: startedAt, error: "", claim: "existing" }
  });
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.URL = "https://curfpatentmachine.netlify.app";
  const calls = installFetch([
    {
      match: entry => entry.method === "GET",
      respond: () => new Response(JSON.stringify([{ patent_id: "US-1", record_json: record }]), { status: 200 })
    }
  ]);
  const response = await handler(new Request("http://local/api/generate-pilot-targets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patent_id: "US-1", force: true })
  }));
  assert.equal(response.status, 202);
  const data = await response.json();
  assert.equal(data.pending, true);
  assert.equal(data.dispatched, false);
  assert.equal(data.started_at, startedAt);
  assert.equal(data.pilot_targets[0].name, "Stored Lab");
  assert.equal(calls.some(entry => entry.method === "PATCH"), false);
  assert.equal(calls.some(entry => entry.url.includes("generate-pilot-targets-background")), false);
  assert.equal(calls.some(entry => entry.url.includes("anthropic.com")), false);
});

test("a failed dispatch marks the job error and leaves stored targets in place", async () => {
  const record = storedRecord({
    pilot_targets: [{ name: "Stored Lab", verified: true, source: "https://example.com/stored" }],
    pilot_recommendation: "pursue",
    biggest_proof_gap: "Old gap."
  });
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.URL = "https://curfpatentmachine.netlify.app";
  const store = memoryStore(record);
  const calls = installFetch(store.routes().concat([
    {
      match: entry => entry.url.includes("generate-pilot-targets-background"),
      respond: () => new Response(JSON.stringify({ error: "no" }), { status: 500 })
    }
  ]));
  const response = await handler(new Request("http://local/api/generate-pilot-targets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patent_id: "US-1", force: true })
  }));
  assert.equal(response.status, 502);
  const data = await response.json();
  assert.match(data.error, /could not be started/);
  assert.equal(store.read().evaluation.pilot_targets[0].name, "Stored Lab");
  assert.equal(store.read().evaluation.pilot_job.status, "error");
  assert.equal(store.read().evaluation.licensing_targets.length, 3);
  assert.equal(store.read().evaluation.biggest_proof_gap, "Old gap.");
  assert.equal(calls.some(entry => entry.url.includes("anthropic.com")), false);
});

test("status reports a pending job without searching", async () => {
  const record = storedRecord({
    pilot_targets: [{ name: "Stored Lab", verified: true, source: "https://example.com/stored" }],
    pilot_job: { status: "pending", started_at: new Date().toISOString(), error: "" }
  });
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  const calls = installFetch([
    {
      match: entry => entry.method === "GET",
      respond: () => new Response(JSON.stringify([{ patent_id: "US-1", record_json: record }]), { status: 200 })
    }
  ]);
  const response = await handler(new Request("http://local/api/generate-pilot-targets?patent_id=US-1"));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.pending, true);
  assert.equal(data.job_status, "pending");
  assert.equal(data.pilot_targets[0].name, "Stored Lab");
  assert.equal(calls.some(entry => entry.url.includes("anthropic.com")), false);
  assert.equal(calls.some(entry => entry.method === "PATCH"), false);
});

test("retryable search errors are tried again and a cutoff is not", () => {
  assert.equal(isRetryablePilotError(Object.assign(new Error("overloaded"), { status: 529 })), true);
  assert.equal(isRetryablePilotError(Object.assign(new Error("rate"), { status: 429 })), true);
  assert.equal(isRetryablePilotError(Object.assign(new Error("down"), { status: 503 })), true);
  assert.equal(isRetryablePilotError(new Error("The web search was paused before it finished")), true);
  assert.equal(isRetryablePilotError(new TypeError("fetch failed")), true);
  assert.equal(isRetryablePilotError(Object.assign(new Error("bad request"), { status: 400 })), false);
  assert.equal(isRetryablePilotError(new Error("The model response was cut off before finishing")), false);
});

test("the background search stores only the pilot section and retries a 529", async () => {
  const startedAt = "2026-10-23T20:00:00.000Z";
  const record = storedRecord({
    pilot_targets: [{ name: "Stored Lab", verified: true, source: "https://example.com/stored" }],
    biggest_proof_gap: "Old gap.",
    pilot_recommendation: "pursue",
    pilot_job: { status: "pending", started_at: startedAt, error: "" }
  });
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.PILOT_RETRY_SLEEP_MS = "0";
  const store = memoryStore(record);
  let searches = 0;
  const calls = installFetch(store.routes().concat([
    {
      match: entry => entry.url.includes("api.anthropic.com"),
      respond: () => {
        searches += 1;
        if(searches === 1) return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 529 });
        return new Response(JSON.stringify(pilotSearchPayload()), { status: 200 });
      }
    }
  ]));
  const result = await runPilotGenerationJob({ patentId: "US-1", startedAt });
  assert.equal(result.reason, "done");
  assert.equal(searches, 2);
  const saved = store.read();
  assert.equal(saved.evaluation.pilot_targets[0].name, "Milliken Pilot");
  assert.equal(saved.evaluation.pilot_targets[0].verified, true);
  assert.equal(saved.evaluation.pilot_targets[1].verified, false);
  assert.equal(saved.evaluation.pilot_job.status, "done");
  assert.equal(saved.evaluation.pilot_job.started_at, startedAt);
  assert.equal(saved.evaluation.licensing_targets.length, 3);
  assert.equal(saved.evaluation.licensing_targets[0].name, "Milliken");
  assert.deepEqual(saved.evaluation.value_score_snapshot, record.evaluation.value_score_snapshot);
  assert.equal(saved.evaluation.evaluated_at, "2026-08-30T12:00:00.000Z");
  assert.equal(saved.title, "Moisture film");
  const sent = calls.find(entry => entry.url.includes("api.anthropic.com"));
  assert.equal(sent.body.tools[0].max_uses, 3);
  assert.match(sent.body.messages[0].content, /Milliken/);
  assert.match(sent.body.messages[0].content, /Claims summary: No field data/);
  assert.match(sent.body.system, /Never fabricate/);
  delete process.env.PILOT_RETRY_SLEEP_MS;
});

test("a failed background search keeps the previous pilot targets", async () => {
  const startedAt = "2026-10-23T20:00:00.000Z";
  const record = storedRecord({
    pilot_targets: [{ name: "Stored Lab", verified: true, source: "https://example.com/stored" }],
    biggest_proof_gap: "Old gap.",
    suggested_next_step: "Old step.",
    pilot_recommendation: "pursue",
    pilot_job: { status: "pending", started_at: startedAt, error: "" }
  });
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.PILOT_RETRY_SLEEP_MS = "0";
  const store = memoryStore(record);
  let searches = 0;
  installFetch(store.routes().concat([
    {
      match: entry => entry.url.includes("api.anthropic.com"),
      respond: () => {
        searches += 1;
        return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 529 });
      }
    }
  ]));
  const result = await runPilotGenerationJob({ patentId: "US-1", startedAt });
  assert.equal(result.reason, "error");
  assert.equal(searches, 3);
  const saved = store.read();
  assert.equal(saved.evaluation.pilot_targets[0].name, "Stored Lab");
  assert.equal(saved.evaluation.biggest_proof_gap, "Old gap.");
  assert.equal(saved.evaluation.suggested_next_step, "Old step.");
  assert.equal(saved.evaluation.pilot_recommendation, "pursue");
  assert.equal(saved.evaluation.pilot_job.status, "error");
  assert.match(saved.evaluation.pilot_job.error, /overloaded/);
  assert.equal(saved.evaluation.licensing_targets[0].name, "Milliken");
  assert.equal(saved.evaluation.evaluated_at, "2026-08-30T12:00:00.000Z");
  delete process.env.PILOT_RETRY_SLEEP_MS;
});

test("a background job does not write when a newer job has taken the record", async () => {
  const startedAt = "2026-10-23T20:00:00.000Z";
  const record = storedRecord({
    pilot_targets: [{ name: "Stored Lab", verified: true, source: "https://example.com/stored" }],
    pilot_job: { status: "pending", started_at: startedAt, error: "" }
  });
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.ANTHROPIC_API_KEY = "test-key";
  const store = memoryStore(record);
  const calls = installFetch(store.routes().map(route => {
    if(!route.match({ url: "https://example.supabase.co/rest/v1/evaluated_patents", method: "PATCH" })) return route;
    return {
      match: route.match,
      respond: entry => {
        const saved = entry.body.record_json;
        saved.evaluation.pilot_job.started_at = "2026-10-23T21:00:00.000Z";
        saved.evaluation.pilot_job.claim = "newer";
        return route.respond(entry);
      }
    };
  }).concat([
    {
      match: entry => entry.url.includes("api.anthropic.com"),
      respond: () => new Response(JSON.stringify(pilotSearchPayload()), { status: 200 })
    }
  ]));
  const result = await runPilotGenerationJob({ patentId: "US-1", startedAt, claim: "ours" });
  assert.equal(result.reason, "superseded");
  assert.equal(store.read().evaluation.pilot_targets[0].name, "Stored Lab");
  assert.equal(store.read().evaluation.pilot_job.claim, "newer");
  assert.equal(calls.some(entry => entry.url.includes("anthropic.com")), false);
});

test("an in-flight claim is left running", async () => {
  const startedAt = new Date().toISOString();
  const record = storedRecord({
    pilot_job: {
      status: "running",
      started_at: startedAt,
      error: "",
      claim: "other-worker",
      claimed_at: new Date().toISOString()
    }
  });
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.ANTHROPIC_API_KEY = "test-key";
  const calls = installFetch([
    {
      match: entry => entry.method === "GET",
      respond: () => new Response(JSON.stringify([{ patent_id: "US-1", record_json: record }]), { status: 200 })
    }
  ]);
  const result = await runPilotGenerationJob({ patentId: "US-1", startedAt, claim: "this-worker" });
  assert.equal(result.reason, "already-running");
  assert.equal(calls.some(entry => entry.method === "PATCH"), false);
  assert.equal(calls.some(entry => entry.url.includes("anthropic.com")), false);
});

test("the background function runs the claimed job", async () => {
  assert.equal(backgroundConfig.background, true);
  const startedAt = "2026-10-23T20:00:00.000Z";
  const record = storedRecord({
    pilot_job: { status: "pending", started_at: startedAt, error: "" }
  });
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.PILOT_RETRY_SLEEP_MS = "0";
  const store = memoryStore(record);
  installFetch(store.routes().concat([
    {
      match: entry => entry.url.includes("api.anthropic.com"),
      respond: () => new Response(JSON.stringify(pilotSearchPayload()), { status: 200 })
    }
  ]));
  await background(new Request("http://local/.netlify/functions/generate-pilot-targets-background", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patent_id: "US-1", started_at: startedAt })
  }));
  assert.equal(store.read().evaluation.pilot_job.status, "done");
  assert.equal(store.read().evaluation.pilot_targets[0].name, "Milliken Pilot");
  assert.equal(store.read().evaluation.licensing_targets.length, 3);
  delete process.env.PILOT_RETRY_SLEEP_MS;
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  earliestCrossrefDate,
  extractDoi,
  fullCalendarDate,
  normalizeScanWindow,
  scanBands,
  scanWindowStart
} from "./publication-watch-lib.js";

const NOW = new Date("2026-10-24T15:00:00Z");

test("the scan window defaults to one year and names the longer choices", () => {
  assert.equal(normalizeScanWindow(undefined), "1");
  assert.equal(normalizeScanWindow(""), "1");
  assert.equal(normalizeScanWindow("nope"), "1");
  assert.equal(normalizeScanWindow("2"), "2");
  assert.equal(normalizeScanWindow("5"), "5");
  assert.equal(normalizeScanWindow("all"), "all");
  assert.equal(scanWindowStart("1", NOW).since.toISOString().slice(0, 10), "2025-10-24");
  assert.equal(scanWindowStart("2", NOW).since.toISOString().slice(0, 10), "2024-10-24");
  assert.equal(scanWindowStart("5", NOW).since.toISOString().slice(0, 10), "2021-10-24");
  assert.equal(scanWindowStart("all", NOW).since, null);
});

test("a longer range adds an older band and the weekly scan does not", () => {
  const year = scanBands("1", NOW);
  assert.equal(year.bands.length, 1);
  assert.equal(year.bands[0].from.toISOString().slice(0, 10), "2025-10-24");
  assert.equal(year.bands[0].to, null);
  assert.equal(year.bands[0].limit, 25);

  const five = scanBands("5", NOW);
  assert.equal(five.bands.length, 2);
  assert.equal(five.bands[1].from.toISOString().slice(0, 10), "2021-10-24");
  assert.equal(five.bands[1].to.toISOString().slice(0, 10), "2025-10-23");
  assert.equal(five.bands[1].limit, 10);

  const all = scanBands("all", NOW);
  assert.equal(all.bands[1].from, null);
  assert.equal(all.bands[1].to.toISOString().slice(0, 10), "2025-10-23");

  const weekly = scanBands("5", NOW, { weekly: true });
  assert.equal(weekly.bands.length, 1);
  assert.equal(weekly.bands[0].limit, 12);
});

test("a Crossref date needs a full day and ignores the deposit timestamp", () => {
  assert.equal(earliestCrossrefDate({
    "published-online": { "date-parts": [[2026, 10, 22]] },
    issued: { "date-parts": [[2026, 10, 21]] },
    created: { "date-parts": [[2020, 1, 1]] }
  }), "2026-10-21");
  assert.equal(earliestCrossrefDate({
    published: { "date-parts": [[2026, 10]] },
    issued: { "date-parts": [[2026]] }
  }), null);
  assert.equal(fullCalendarDate("2026-10-22T17:20:13Z"), "2026-10-22");
  assert.equal(fullCalendarDate("2026 10 21"), "2026-10-21");
  assert.equal(fullCalendarDate("2026"), null);
  assert.equal(fullCalendarDate("October 2026"), null);
  assert.equal(extractDoi("https://doi.org/10.3390/microorganisms14102406"), "10.3390/microorganisms14102406");
  assert.equal(extractDoi("no doi here"), "");
});

test("the publications page offers the year choices and sends the choice", () => {
  const html = fs.readFileSync(new URL("../../public/index.html", import.meta.url), "utf8");
  assert.match(html, /Last 1 year \(default\)/);
  assert.match(html, /Last 2 years/);
  assert.match(html, /Last 5 years/);
  assert.match(html, /<option value="all">All<\/option>/);
  assert.match(html, /JSON\.stringify\(\{ window: windowValue \}\)/);
});

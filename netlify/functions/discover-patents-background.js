// Button-triggered discovery scan. Netlify returns 202 immediately.
// The Discover page polls GET /api/discover-patents for the stored
// catalog and the latest discovery_scan_runs row.

import { runDiscoveryScan } from "../lib/discover-patents.js";

export default async (req) => {
  if(req.method !== "POST"){
    console.log("discover-patents background ignored non-POST");
    return;
  }
  const result = await runDiscoveryScan();
  console.log("discover-patents background finished " + JSON.stringify(result));
};

export const config = { background: true };

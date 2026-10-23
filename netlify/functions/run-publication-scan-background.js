// Button-triggered Publication Watch. Netlify returns 202 immediately
// and discards this function's return value. The page polls
// GET /api/run-publication-scan for findings and publication_scan_runs.
//
// Discovery does not use web search. Public RSS, PubMed, OpenAlex, and
// arXiv supply the rows. Haiku only scores them, and a scoring failure
// still leaves the rows stored.

import { runPublicationScan } from "../lib/publication-watch-lib.js";

export default async (req) => {
  if(req.method !== "POST"){
    console.log("publication-scan background ignored non-POST");
    return;
  }
  const result = await runPublicationScan({ trigger: "background", scoreLimit: 24 });
  console.log("publication-scan background finished " + JSON.stringify(result));
};

export const config = { background: true };

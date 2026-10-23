// Scheduled Publication Watch. Same sources as the button, with a
// smaller scoring batch so it can finish inside the 30 second
// scheduled-function limit. Rows are stored before scoring. If scoring
// does not finish, they stay UNSCORED and a later button run scores them.
//
// Netlify does not allow this function to be called by URL.

import { runPublicationScan } from "../lib/publication-watch-lib.js";

export default async () => {
  const result = await runPublicationScan({ trigger: "weekly", scoreLimit: 8 });
  console.log("publication-scan weekly finished " + JSON.stringify(result));
  if(!result.ok){
    return new Response(result.error || "Scan failed", { status: 500 });
  }
  return new Response("Scan complete", { status: 200 });
};

export const config = { schedule: "@weekly" };

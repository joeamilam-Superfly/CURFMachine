# CURF Docket: Data Security and Privacy Approach

Prepared for internal CURF review. This document exists to answer the question Clemson's IT security office and general counsel will ask before any real, unpublished IP data touches this tool: where does the data go, and how do we know it stays there.

## The short answer

Patent text sent to this tool for AI evaluation is processed by Anthropic's Claude API. Under Anthropic's published commercial terms, that data is not used to train Anthropic's models without express permission, and conversation content is not retained by default. For a contractual guarantee beyond that default, Clemson or CURF can request a Zero Data Retention arrangement directly from Anthropic, which removes storage of prompts and responses at rest entirely. That arrangement is a business agreement, not a setting in this app, and it has not been put in place yet. Real IP data should not go through this tool until it has.

## What Anthropic's own terms currently say

Anthropic's published API and data retention documentation states that retained data is never used for model training without express permission, and that conversation content, meaning prompts and the model's outputs, is not retained by default on the standard commercial API. A small number of specific newer models require thirty day retention regardless; this app does not use any of those models.

Beyond that default, Anthropic offers a Zero Data Retention arrangement, enabled per organization through Anthropic's sales team, under which prompts and responses are not stored at rest after the response is returned. This is the arrangement CURF should request before real data flows through this tool.

Two limits worth stating plainly rather than glossing over. First, even under a Zero Data Retention arrangement, content flagged by Anthropic's automated trust and safety systems may still be retained for up to two years, the same carve out that applies to essentially every major API provider's equivalent policy. Second, Zero Data Retention does not support cross origin browser calls, so a Zero Data Retention arrangement only actually protects this tool once requests are routed through a server side proxy rather than called directly from the browser. Both points are addressed in the architecture below, not hidden from it.

## Architecture built to support that

The current build is a two piece system, not a single browser app calling Anthropic directly.

- The app itself runs in the browser and never holds an API key.
- A small server side function, included in this deployment as `netlify/functions/evaluate-patent.js`, holds the Anthropic API key as an environment variable and is the only thing that actually talks to Anthropic. The browser talks to this function, not to Anthropic directly.

This split exists specifically because Zero Data Retention requires it, and because an API key should never sit in code a browser downloads. The current build keeps `USE_BACKEND_PROXY` true, so the browser calls `/api/evaluate-patent` and the other server routes. It does not call Anthropic from the browser. Zero Data Retention still has to be in place on the Anthropic organization whose key is in Netlify before real unpublished IP is sent. Sample or already published data is the right material until that agreement exists.

## Data minimization independent of any vendor agreement

Two decisions worth making regardless of what Anthropic's contract says.

**Published versus pending disclosures.** An issued United States patent is already public record through the USPTO, so routing it through any processor carries little additional exposure. An unfiled, pending invention disclosure is a different category entirely: public exposure before filing can itself jeopardize patentability under public disclosure rules, independent of who processes it or what their privacy policy says. CURF should decide, as policy, whether pending disclosures are permitted through this pipeline at all before a Zero Data Retention arrangement is active, and treat that as the higher bar case even after one is.

**Minimum necessary content.** The app should send only what the evaluation needs: abstract, claims, and technical description. Inventor contact information, internal financial or licensing terms, and anything not required for a technology readiness and market fit assessment should be stripped before submission, not sent because it happened to be in the same file.

## Web search adds a second data path, not just Anthropic's model

As of the current build, a full patent review uses Anthropic's web search tool to identify real, named organizations that could buy or license the patent, rather than inventing plausible sounding ones. This changes the data flow in a way worth stating plainly: a search query built from each patent's title and abstract is sent out to live web search infrastructure, in addition to being processed by Anthropic's model. For an already published patent this adds no new exposure, the content is public regardless. For a pending, unfiled disclosure, it is a materially different risk than model processing alone: a search query built from confidential text is pushed out to a public search engine, not held inside a single vendor's processing boundary. The published versus pending policy above should be read as covering this explicitly, not as a detail that predates it.

## The problem match on the Tools page introduces a third party's confidential information, not Clemson's

The problem box on Tools takes a free text description of a problem an enterprise has, checks it against Clemson's known patents, then uses web search to see whether the problem is already solved elsewhere. Unlike the rest of this tool, the sensitive input here does not belong to Clemson at all, it potentially belongs to whatever outside company's problem got typed in. If that description came from a real conversation with a real company, it needs to be treated as that company's confidential information: sent to Anthropic's model, and out to public search infrastructure, the same exposure already described above, just carrying someone else's confidential material instead of Clemson's own. Do not use this feature with a real enterprise's problem statement without their consent to have it processed this way. Hypothetical or already public problem statements, published RFPs, public industry pain points, carry no such issue.

## What already exists carries the same exposure as the buyer search

Running **What already exists** on a case sends the disclosure text to Anthropic and, through web search, out to public search infrastructure, the same category of exposure already described above for the buyer and licensee search. Pilot site lookup uses that same web search path. This reinforces rather than changes the published versus pending policy: these searches should only ever be run on already published patents, never on a pending, unfiled disclosure, since doing so would push that confidential technical content out to a public search engine before it has any patent protection at all. The outreach draft, by contrast, uses no web search and only writes from facts the buyer search already found, so it does not add a new exposure of its own. The quick rank on Triage and the first read of a patent also use no web search. The buyer list, the pilot sites, What already exists, and the Tools problem match are the steps that do.

## Publication Watch sends an internal CURF email address to a third party mail provider

If email alerts are configured, the recipient address (`CURF_ALERT_EMAIL`) and the content of each alert, publication titles and summaries pulled from public sources, are sent through Resend to deliver the email. None of that content is Clemson's confidential IP. It is drawn from the Clemson news feed, PubMed, OpenAlex, and arXiv. The recipient address itself is still something to be deliberate about. Don't point this at a personal inbox or a list broader than intended without thinking it through the same way you would for any other institutional mailing. A paper scored High is emailed once. A later scan does not send a second email for the same row. When a paper has a DOI, the scan also asks the Crossref API for that DOI's publication date. The request is the DOI only. The paper text is not sent.

## One question outside Anthropic's control entirely

If any portion of Clemson's portfolio involves export controlled research, ITAR or EAR, sending that technical data to any outside cloud processor can itself constitute a controlled export, regardless of that processor's privacy or retention policy. This is a question for CURF's export control office to answer for its own portfolio, not something this document or this tool can resolve. It is raised here so it is asked once, deliberately, rather than discovered later.

## What is settled and what still requires action

Settled by this build:
- The app does not hold or expose an API key in the browser.
- The architecture supports Zero Data Retention once it is contractually in place, through the included proxy function.
- The browser does not call Anthropic directly. Requests go through the server functions.

Still requires action outside this codebase:
- CURF or Clemson procurement requesting and executing a Zero Data Retention arrangement with Anthropic.
- CURF's IT security office reviewing this proxy pattern under its normal third party vendor process.
- CURF deciding, as policy, whether pending unfiled disclosures are in scope for this tool at all, separate from already published patents. This decision now also covers whether web search queries derived from a disclosure are acceptable, not just model processing.
- Confirming with Clemson's export control office whether any portion of the portfolio is subject to ITAR or EAR restrictions that would affect this regardless of Anthropic's own terms.
- Confirming web search is enabled (or intentionally left enabled) on the Anthropic organization this uses; it is on by default unless an administrator has turned it off in the Anthropic Console, and turning it off there would make the buyer search, the pilot site search, What already exists, and the Tools problem match fail outright rather than silently degrade. The quick rank and the first read of a patent do not use web search.

## Sources

- Anthropic, API and data retention documentation: https://platform.claude.com/docs/en/manage-claude/api-and-data-retention
- Anthropic, contact for Zero Data Retention and enterprise agreements: https://claude.com/contact-sales
- Anthropic, web search tool documentation (data flow, pricing, organization level enablement): https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool

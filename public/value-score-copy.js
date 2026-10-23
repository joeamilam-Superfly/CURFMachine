// Deterministic value-score narrative. Reads the frozen snapshot and
// the evaluation fields already stored on the case. No model call.
(function(root, factory){
  root.CURF_VALUE = factory();
})(typeof window !== "undefined" ? window : globalThis, function(){

  const METHOD_NOTE = "This score is added up from the lines already on this page. It is not a second guess by the AI. It was saved when this review ran, so it stays the same even if the formula changes later. Use it to compare patents in this list. It is not a dollar value. Letter grades stay at 10, 7, and 4 out of 15. The dollar figure in the South Carolina note is a typical deal size, not the value of this patent.";

  const ACTION_ORDER = ["trl", "licensee", "engagement", "path", "demand", "adoption", "alignment", "other"];

  function formatPts(n){
    const num = Number(n);
    if(!Number.isFinite(num)) return "0";
    const rounded = Math.round(num * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  function gapOf(component){
    return Math.round((Number(component.max) - Number(component.points)) * 10) / 10;
  }

  function actionIndex(key){
    const index = ACTION_ORDER.indexOf(key);
    return index === -1 ? ACTION_ORDER.length : index;
  }

  function byGap(a, b){
    const diff = gapOf(b) - gapOf(a);
    if(diff) return diff;
    return actionIndex(a.key) - actionIndex(b.key);
  }

  function byPoints(a, b){
    const diff = Number(b.points) - Number(a.points);
    if(diff) return diff;
    const maxDiff = Number(b.max) - Number(a.max);
    if(maxDiff) return maxDiff;
    return actionIndex(a.key) - actionIndex(b.key);
  }

  function joinAnd(items){
    if(items.length <= 1) return items[0] || "";
    if(items.length === 2) return items[0] + " and " + items[1];
    return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
  }

  function ordinal(n){
    const mod100 = n % 100;
    if(mod100 >= 11 && mod100 <= 13) return n + "th";
    const mod10 = n % 10;
    if(mod10 === 1) return n + "st";
    if(mod10 === 2) return n + "nd";
    if(mod10 === 3) return n + "rd";
    return n + "th";
  }

  function componentKey(label){
    const text = String(label || "");
    if(/^Market demand/i.test(text)) return "demand";
    if(/^Technology readiness/i.test(text)) return "trl";
    if(/^Adoption risk/i.test(text)) return "adoption";
    if(/^Clear monetization path/i.test(text)) return "path";
    if(/licensee or buyer|acquirer confirmed/i.test(text)) return "licensee";
    if(/^Confirmed inventor/i.test(text)) return "engagement";
    if(/^SC investment alignment/i.test(text)) return "alignment";
    return "other";
  }

  function paren(label){
    const match = /\(([^)]*)\)\s*$/.exec(String(label || ""));
    return match ? match[1].trim() : "";
  }

  function parseDate(value){
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || "").trim());
    if(!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if(date.getUTCFullYear() !== Number(match[1])) return null;
    return date;
  }

  function addYears(date, years){
    return new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate()));
  }

  function isDesignPatent(patent){
    const kind = String(patent.kindCode || "").toUpperCase();
    const id = String(patent.sourcePatentId || patent.patent_id || patent.id || "");
    return kind.charAt(0) === "S" || /(?:^|[^A-Z])D\d/i.test(id);
  }

  function patentExpiry(patent){
    if(isDesignPatent(patent)){
      const grant = parseDate(patent.publicationDate);
      return grant ? addYears(grant, 15) : null;
    }
    const filing = parseDate(patent.filingDate);
    return filing ? addYears(filing, 20) : null;
  }

  function expiryPhrase(patent, asOf){
    const expiry = patentExpiry(patent);
    if(!expiry) return "";
    const today = parseDate(asOf) || new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const years = (expiry.getTime() - todayUtc) / (365.25 * 24 * 60 * 60 * 1000);
    if(years > 8) return "";
    return "a " + expiry.getUTCFullYear() + " expiry";
  }

  function sourcedLicenseeCount(ev){
    if(!ev) return null;
    if(Array.isArray(ev.licensing_targets)){
      return ev.licensing_targets.filter(target => target && String(target.name || "").trim() && String(target.source || "").trim()).length;
    }
    if(Array.isArray(ev.top_acquirer_targets)){
      return ev.top_acquirer_targets.filter(target => target && String(target.company_name || target.name || "").trim()).length;
    }
    return null;
  }

  function pilotsRecommended(ev){
    if(!ev || ev.pilot_recommendation === "not recommended") return false;
    const demand = String(ev.market_demand_verdict || "").toUpperCase();
    if(demand !== "STRONG" && demand !== "MODERATE") return false;
    if(String(ev.recommended_path || "").toUpperCase() === "NO_DEMAND") return false;
    if(String(ev.licensing_recommendation || "").toLowerCase() === "hard pass") return false;
    if(Array.isArray(ev.licensing_targets) && ev.licensing_targets.length < 3) return false;
    return true;
  }

  function isPublication(record){
    return String((record && record.recordType) || "").toLowerCase() === "publication";
  }

  function synthesizeComponents(ev, patent){
    const demand = String(ev.market_demand_verdict || "").toUpperCase();
    const demandPoints = { STRONG: 6, MODERATE: 4, WEAK: 2, NONE: 0 }[demand];
    const trl = Number(ev.trl) || 0;
    const trlPoints = trl >= 7 ? 2 : (trl >= 4 ? 1 : 0);
    const risks = Array.isArray(ev.adoption_risks) ? ev.adoption_risks : [];
    let riskPoints = 1;
    if(risks.length){
      const levelPoints = { low: 2, medium: 1, high: 0 };
      const sum = risks.reduce((total, risk) => {
        const level = String((risk && risk.level) || "").toLowerCase();
        return total + (levelPoints[level] !== undefined ? levelPoints[level] : 1);
      }, 0);
      riskPoints = Math.round((sum / risks.length) * 10) / 10;
    }
    const path = String(ev.recommended_path || "").toUpperCase();
    const pathPoints = (path === "LICENSE" || path === "VENTURE") ? 1 : 0;
    const named = sourcedLicenseeCount(ev);
    const licenseePoints = named > 0 ? 1 : 0;
    const staff = patent.staffInput || {};
    const engagementPoints = ((staff.industryContacts && String(staff.industryContacts).trim()) || staff.inventorWillingness === "Willing to engage") ? 1 : 0;
    const align = ev.sc_alignment || {};
    const alignPoints = typeof align.value_points === "number" ? align.value_points : 0;
    return [
      { label: "Market demand (" + (demand || "unspecified") + ")", points: demandPoints !== undefined ? demandPoints : 0, max: 6 },
      { label: "Technology readiness (TRL " + trl + ")", points: trlPoints, max: 2 },
      { label: "Adoption risk, lower risk scores higher", points: riskPoints, max: 2 },
      { label: "Clear monetization path (" + (path || "none") + ")", points: pathPoints, max: 1 },
      { label: "A real licensee or buyer named with a source, not just a sector guess", points: licenseePoints, max: 1 },
      { label: "Confirmed inventor or industry engagement", points: engagementPoints, max: 1 },
      { label: "SC investment alignment (" + (align.industry_group || "not classified") + (typeof align.alignment_score === "number" ? ", score " + align.alignment_score : "") + ")", points: alignPoints, max: 2 }
    ];
  }

  function enrich(row, ev, patent){
    const label = String(row.label || "");
    const key = componentKey(label);
    const inside = paren(label);
    const component = {
      key: key,
      label: label,
      points: Number(row.points) || 0,
      max: Number(row.max) || 0,
      verdict: "",
      trl: null,
      path: "",
      group: "",
      alignScore: null,
      count: sourcedLicenseeCount(ev)
    };
    if(key === "demand") component.verdict = (inside || ev.market_demand_verdict || "").toUpperCase();
    if(key === "trl"){
      const fromLabel = /TRL\s+(\d+)/i.exec(inside);
      component.trl = fromLabel ? Number(fromLabel[1]) : (Number.isFinite(Number(ev.trl)) ? Number(ev.trl) : null);
    }
    if(key === "path") component.path = (inside || ev.recommended_path || "").toUpperCase();
    if(key === "alignment"){
      const match = /^(.*?)(?:,\s*score\s+(\d+))?$/.exec(inside);
      component.group = match && match[1] ? match[1] : (ev.sc_alignment && ev.sc_alignment.industry_group) || "";
      component.alignScore = match && match[2] ? Number(match[2]) : (ev.sc_alignment && typeof ev.sc_alignment.alignment_score === "number" ? ev.sc_alignment.alignment_score : null);
    }
    if(key === "engagement") component.staff = patent.staffInput || {};
    return component;
  }

  function componentsFor(patent, score){
    const ev = (patent && patent.evaluation) || {};
    const rows = score && Array.isArray(score.breakdown) && score.breakdown.length
      ? score.breakdown
      : synthesizeComponents(ev, patent || {});
    return rows.map(row => enrich(row, ev, patent || {}));
  }

  function pointsOf(component){
    return formatPts(component.points) + " of " + formatPts(component.max);
  }

  function earnedSentence(component){
    if(component.key === "demand") return "Market interest is " + (component.verdict || "unspecified") + " (" + pointsOf(component) + ").";
    if(component.key === "trl") return "How far along: level " + (component.trl == null ? "unspecified" : component.trl) + " (" + pointsOf(component) + ").";
    if(component.key === "adoption") return "How hard it is to adopt scores " + pointsOf(component) + ".";
    if(component.key === "path") return "The path to money is " + (component.path || "unspecified") + " (" + pointsOf(component) + ").";
    if(component.key === "licensee"){
      if(component.count === 1) return "1 named licensee with a source (" + pointsOf(component) + ").";
      if(typeof component.count === "number" && component.count > 1) return component.count + " named licensees with a source (" + pointsOf(component) + ").";
      return "A licensee or buyer is named with a source (" + pointsOf(component) + ").";
    }
    if(component.key === "engagement"){
      const staff = component.staff || {};
      if(staff.inventorWillingness === "Willing to engage" && !(staff.industryContacts && String(staff.industryContacts).trim())){
        return "The inventor is willing to engage (" + pointsOf(component) + ").";
      }
      if(staff.industryContacts && String(staff.industryContacts).trim()) return "Industry contacts are on file (" + pointsOf(component) + ").";
      return "Inventor or industry engagement is confirmed (" + pointsOf(component) + ").";
    }
    if(component.key === "alignment"){
      const group = component.group || "not classified";
      const score = component.alignScore == null ? "" : ", score " + component.alignScore;
      return "South Carolina fit is " + group + score + " (" + pointsOf(component) + ").";
    }
    return (component.label || "A scored component") + " (" + pointsOf(component) + ").";
  }

  function costSentence(component){
    const gap = formatPts(gapOf(component));
    if(component.key === "trl"){
      const trl = component.trl == null ? "" : " level " + component.trl;
      if(component.points <= 0) return "No prototype yet. How far along:" + trl + " (" + pointsOf(component) + ").";
      return "Still early. How far along:" + trl + " (" + pointsOf(component) + ").";
    }
    if(component.key === "demand") return "Market interest is " + (component.verdict || "unspecified") + ", " + gap + " short of the top (" + pointsOf(component) + ").";
    if(component.key === "path") return "The path to money is " + (component.path || "unspecified") + " (" + pointsOf(component) + ").";
    if(component.key === "licensee") return "No buyer is named with a source (" + pointsOf(component) + ").";
    if(component.key === "engagement") return "No inventor or company contact is confirmed (" + pointsOf(component) + ").";
    if(component.key === "adoption") return "Adoption risk leaves " + gap + " points unused (" + pointsOf(component) + ").";
    if(component.key === "alignment") return "South Carolina fit is " + (component.group || "not classified") + " (" + pointsOf(component) + ").";
    return (component.label || "A scored part") + " leaves " + gap + " (" + pointsOf(component) + ").";
  }

  function headlineEarned(components){
    const phrases = [];
    const demand = components.find(component => component.key === "demand");
    if(demand && demand.points >= 4){
      phrases.push(demand.verdict === "STRONG" || demand.points >= 6 ? "strong market pull" : "moderate market pull");
    }
    const licensee = components.find(component => component.key === "licensee");
    if(licensee && licensee.points > 0){
      if(licensee.count === 1) phrases.push("1 named licensee");
      else if(typeof licensee.count === "number" && licensee.count > 1) phrases.push(licensee.count + " named licensees");
      else phrases.push("a named licensee");
    }
    const trl = components.find(component => component.key === "trl");
    if(phrases.length < 2 && trl && trl.points >= 2) phrases.push("a working prototype");
    const alignment = components.find(component => component.key === "alignment");
    if(phrases.length < 2 && alignment && alignment.points >= 2) phrases.push("a strong South Carolina fit");
    const path = components.find(component => component.key === "path");
    if(phrases.length < 2 && path && path.points > 0 && path.path === "LICENSE") phrases.push("a license path");
    if(phrases.length < 2 && path && path.points > 0 && path.path === "VENTURE") phrases.push("a venture path");
    const engagement = components.find(component => component.key === "engagement");
    if(phrases.length < 2 && engagement && engagement.points > 0) phrases.push("confirmed engagement");
    const adoption = components.find(component => component.key === "adoption");
    if(phrases.length < 2 && adoption && adoption.points >= 1.5) phrases.push("low adoption risk");
    return phrases.slice(0, 2);
  }

  function holdbackPhrase(component){
    if(component.key === "trl") return component.points <= 0 ? "no prototype" : "an early prototype";
    if(component.key === "demand"){
      if(component.verdict === "NONE" || component.points <= 0) return "no market pull";
      if(component.verdict === "WEAK") return "weak market pull";
      if(component.verdict === "MODERATE") return "demand short of strong";
      return "market demand short of the top";
    }
    if(component.key === "path") return "no clear path to money";
    if(component.key === "licensee") return "no named buyer";
    if(component.key === "engagement") return "no confirmed contact";
    if(component.key === "adoption") return "adoption risk";
    if(component.key === "alignment") return "a weak South Carolina fit";
    return "";
  }

  function headlineHoldbacks(components, patent, asOf){
    const phrases = components.filter(component => gapOf(component) > 0).sort(byGap).map(holdbackPhrase).filter(Boolean);
    const expiry = expiryPhrase(patent, asOf);
    if(!expiry) return phrases.slice(0, 2);
    return phrases.slice(0, 1).concat(expiry).slice(0, 2);
  }

  function addPts(gap){
    const text = formatPts(gap);
    return "about " + text + (text === "1" ? " point" : " points");
  }

  function leverFor(components, ev){
    const gaps = components.filter(component => gapOf(component) > 0).sort(byGap);
    if(!gaps.length) return { text: "Every part of the score is already as high as it can go.", seePilotTargets: false };
    const top = gaps[0];
    const add = addPts(gapOf(top));
    if(top.key === "trl"){
      if(pilotsRecommended(ev)){
        const proving = top.points <= 0 ? "this works beyond the lab" : "field performance";
        return { text: "A pilot proving " + proving + " would add " + add + ". See Pilot targets.", seePilotTargets: true };
      }
      const from = top.trl == null ? "" : " from level " + top.trl;
      return { text: "A working prototype" + from + " would add " + add + ".", seePilotTargets: false };
    }
    if(top.key === "demand"){
      const aim = top.max === 6 ? "Proof that would make market interest strong would add " : "Stronger market interest would add ";
      return { text: aim + add + ".", seePilotTargets: false };
    }
    if(top.key === "licensee") return { text: "Naming a buyer with a source would add " + add + ".", seePilotTargets: false };
    if(top.key === "engagement") return { text: "A willing inventor or a company contact would add " + add + ".", seePilotTargets: false };
    if(top.key === "path") return { text: "A license or startup path would add " + add + ".", seePilotTargets: false };
    if(top.key === "adoption") return { text: "Lower adoption risk would add " + add + ".", seePilotTargets: false };
    if(top.key === "alignment") return { text: "A closer South Carolina fit would add " + add + ".", seePilotTargets: false };
    return { text: "Closing the largest gap would add " + add + ".", seePilotTargets: false };
  }

  function peerIsViable(peer){
    if(!peer || peer.archived || peer.skipRemoteSave || peer.cachedOnly) return false;
    if(peer.status && peer.status !== "evaluated") return false;
    const demand = String(peer.demand || "").toUpperCase();
    if(demand !== "STRONG" && demand !== "MODERATE") return false;
    if(String(peer.path || "").toUpperCase() === "NO_DEMAND") return false;
    return typeof peer.totalPoints === "number" && Number.isFinite(peer.totalPoints);
  }

  function subjectPeer(patent, score){
    const ev = (patent && patent.evaluation) || {};
    return {
      id: patent && patent.id,
      archived: !!(patent && patent.archived),
      skipRemoteSave: !!(patent && patent.skipRemoteSave),
      status: (patent && patent.status) || "evaluated",
      recordType: (patent && (patent.recordType || patent.portfolioKind)) || null,
      totalPoints: Number(score.totalPoints),
      demand: ev.market_demand_verdict || null,
      path: ev.recommended_path || null,
      cachedOnly: !!ev.cached_only
    };
  }

  function viableWhy(subject){
    if(subject.archived) return "it is archived";
    if(subject.cachedOnly) return "only the id was saved";
    const demand = String(subject.demand || "").toUpperCase();
    if(demand !== "STRONG" && demand !== "MODERATE") return "market interest is " + (demand || "unspecified").toLowerCase();
    if(String(subject.path || "").toUpperCase() === "NO_DEMAND") return "there is no real market";
    if(subject.status !== "evaluated") return "the review is not finished";
    return "it is outside the comparison";
  }

  function rankCopy(patent, score, peers){
    const subject = subjectPeer(patent, score);
    const publication = isPublication(subject);
    const noun = publication ? "publication" : "patent";
    const plural = noun + "s";
    const sameKind = (peers || [])
      .filter(peer => isPublication(peer) === publication)
      .map(peer => String(peer.id) === String(subject.id) ? subject : peer);
    if(!sameKind.some(peer => String(peer.id) === String(subject.id))) sameKind.push(subject);
    const viable = sameKind.filter(peerIsViable);
    if(!peerIsViable(subject)){
      const why = viableWhy(subject);
      if(!viable.length) return "Not in the comparison (" + why + "). No " + plural + " with real demand are in the portfolio.";
      const word = viable.length === 1 ? noun : plural;
      const verb = viable.length === 1 ? "has" : "have";
      return "Not in the comparison (" + why + "). " + viable.length + " portfolio " + word + " " + verb + " moderate or strong market interest.";
    }
    if(viable.length === 1) return "The only " + noun + " with real demand in the portfolio.";
    const mine = Number(subject.totalPoints);
    const above = viable.filter(peer => Number(peer.totalPoints) > mine).length;
    const equal = viable.filter(peer => Number(peer.totalPoints) === mine).length;
    const below = viable.length - above - equal;
    const lead = (equal > 1 ? "Tied for " : "Ranks ") + ordinal(above + 1);
    let sentence = lead + " of " + viable.length + " " + (viable.length === 1 ? noun : plural) + " with real demand.";
    if(below > 0){
      const pct = Math.round((100 * below) / viable.length);
      sentence += " Ahead of " + pct + "%.";
    }
    return sentence;
  }

  function buildValueScoreCopy(patent, score, peers, options){
    const asOf = options && options.asOf;
    const components = componentsFor(patent || {}, score || {});
    const ev = (patent && patent.evaluation) || {};
    const total = formatPts(score && score.totalPoints);
    const max = formatPts(score && score.maxPoints);
    const earnedBits = headlineEarned(components);
    const heldBits = headlineHoldbacks(components, patent || {}, asOf);
    let headline = total + " / " + max;
    if(earnedBits.length && heldBits.length) headline += ": " + joinAnd(earnedBits) + ", held back by " + joinAnd(heldBits) + ".";
    else if(earnedBits.length) headline += ": " + joinAnd(earnedBits) + ".";
    else if(heldBits.length) headline += ": held back by " + joinAnd(heldBits) + ".";
    else headline += ".";

    const earnedRows = components.filter(component => component.points > 0).sort(byPoints).slice(0, 3);
    const costRows = components.filter(component => gapOf(component) > 0).sort(byGap).slice(0, 3);
    const lever = leverFor(components, ev);
    return {
      headline: headline,
      rank: rankCopy(patent || {}, score || {}, peers || []),
      earned: earnedRows.length ? earnedRows.map(earnedSentence).join(" ") : "None of the scored parts earned points.",
      cost: costRows.length ? costRows.map(costSentence).join(" ") : "Nothing in the score was left unused.",
      lever: lever.text,
      seePilotTargets: lever.seePilotTargets,
      methodNote: METHOD_NOTE
    };
  }

  return {
    buildValueScoreCopy: buildValueScoreCopy,
    METHOD_NOTE: METHOD_NOTE
  };
});

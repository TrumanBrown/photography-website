// Names the hiring system or job board behind a referrer host, so a visit from
// a recruiter's applicant tracking system reads "Greenhouse" rather than
// "boards.greenhouse.io". Display only: the stored referrer stays the host.

const SYSTEMS = [
  ["greenhouse.io", "Greenhouse"],
  ["lever.co", "Lever"],
  ["myworkdayjobs.com", "Workday"],
  ["myworkday.com", "Workday"],
  ["workday.com", "Workday"],
  ["ashbyhq.com", "Ashby"],
  ["smartrecruiters.com", "SmartRecruiters"],
  ["icims.com", "iCIMS"],
  ["jobvite.com", "Jobvite"],
  ["taleo.net", "Taleo"],
  ["successfactors.com", "SuccessFactors"],
  ["successfactors.eu", "SuccessFactors"],
  ["sapsf.com", "SuccessFactors"],
  ["bamboohr.com", "BambooHR"],
  ["workable.com", "Workable"],
  ["teamtailor.com", "Teamtailor"],
  ["recruitee.com", "Recruitee"],
  ["breezy.hr", "Breezy HR"],
  ["applytojob.com", "JazzHR"],
  ["jazzhr.com", "JazzHR"],
  ["gem.com", "Gem"],
  ["eightfold.ai", "Eightfold"],
  ["phenompeople.com", "Phenom"],
  ["rippling.com", "Rippling"],
  ["paylocity.com", "Paylocity"],
  ["ultipro.com", "UKG"],
  ["ukg.com", "UKG"],
  ["oraclecloud.com", "Oracle Recruiting"],
  ["dover.com", "Dover"],
  ["pinpointhq.com", "Pinpoint"],
  ["comeet.com", "Comeet"],
  ["personio.de", "Personio"],
  ["personio.com", "Personio"],
  ["indeed.com", "Indeed"],
  ["glassdoor.com", "Glassdoor"],
  ["wellfound.com", "Wellfound"],
  ["builtin.com", "Built In"],
  ["dice.com", "Dice"],
  ["ziprecruiter.com", "ZipRecruiter"],
  ["handshake.com", "Handshake"],
  ["joinhandshake.com", "Handshake"],
  ["ycombinator.com", "Y Combinator"],
  ["linkedin.com", "LinkedIn"],
  ["lnkd.in", "LinkedIn"],
];

/** "Greenhouse" for boards.greenhouse.io, or "" when the host isn't one. */
function hiringSystem(host) {
  const value = typeof host === "string" ? host.toLowerCase() : "";
  if (!value) return "";
  for (const [domain, name] of SYSTEMS) {
    if (value === domain || value.endsWith(`.${domain}`)) return name;
  }
  return "";
}

/** What the panel shows for a referrer host: a hiring system's name or the host. */
function sourceName(host) {
  return hiringSystem(host) || host || "";
}

module.exports = { hiringSystem, sourceName };

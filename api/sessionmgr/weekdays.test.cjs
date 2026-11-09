const { buildAnalytics, isLikelyScanner } = require("./analytics");

const DAY = "2026-11-09";
const T0 = Date.UTC(2026, 10, 9, 17, 0, 0);
const dayKeys = {
  current: ["2026-11-08", DAY],
  previous: ["2026-11-06", "2026-11-07"],
};

function key(ms, suffix) {
  return `${String(9999999999999 - ms).padStart(13, "0")}-${suffix}`;
}
function pv(ms, sid, pvid, values = {}) {
  return {
    partitionKey: `pv-${DAY}`,
    rowKey: key(ms, `${pvid}-pv`),
    type: "pv",
    sid,
    pvid,
    path: "/",
    ref: "",
    vh: sid,
    ...values,
  };
}
function ev(ms, sid, pvid, events) {
  return {
    partitionKey: `pv-${DAY}`,
    rowKey: key(ms, `${pvid}-ev-x`),
    type: "ev",
    sid,
    pvid,
    evs: JSON.stringify(events),
  };
}

const company = {
  org: "Contoso Ltd",
  orgKind: "org",
  city: "Redmond",
  region: "Washington",
  country: "US",
  device: "desktop",
  os: "Windows",
  browser: "Edge",
};

describe("Weekdays visits", () => {
  const entities = [
    // A recruiter from the resume: reads two jobs, copies a line, opens the PDF, then Photographs.
    pv(T0, "s1", "p1", { via: "resume", ...company }),
    ev(T0 + 3000, "s1", "p1", [
      { k: "show", t: 50 },
      { k: "reach", v: "intro", n: 0, t: 60 },
      { k: "reach", v: "job:contoso-pm", n: 2, t: 20000 },
      { k: "reach", v: "summary", n: 1, t: 70 },
    ]),
    ev(T0 + 40000, "s1", "p1", [
      { k: "copy", v: "Led migration work", s: "job:contoso-pm", t: 30000 },
      { k: "click", v: "resume-pdf", t: 35000 },
      { k: "wd", v: 30000, t: 35000 },
    ]),
    ev(T0 + 41000, "s1", "p1", [{ k: "wd", v: 41000, t: 41000 }]),
    pv(T0 + 42000, "s1", "p2", { path: "/photographs/", ...company }),
    // A resume click that stayed on Weekends and opened Things to try.
    pv(T0 + 100000, "s2", "p3", {
      via: "resume",
      org: "Comcast Cable Communications, LLC",
      orgKind: "home",
      device: "phone",
    }),
    pv(T0 + 130000, "s2", "p4", { path: "/hobbies/" }),
    // Safe Links opening the resume link from Microsoft's network.
    pv(T0 + 200000, "s3", "p5", {
      via: "resume",
      org: "Microsoft Corporation",
      orgKind: "mixed",
    }),
    ev(T0 + 200500, "s3", "p5", [
      { k: "show", t: 10 },
      { k: "wd", v: 900, t: 910 },
    ]),
    // Someone typing the address and switching to Weekdays, then leaving.
    pv(T0 + 300000, "s4", "p6", { org: "Fabrikam Inc", orgKind: "org" }),
    ev(T0 + 320000, "s4", "p6", [
      { k: "show", t: 15000 },
      { k: "hide", t: 25000 },
      { k: "wd", v: 10000, t: 25000 },
    ]),
    // A visit that never saw Weekdays and wasn't tagged: not a row.
    pv(T0 + 400000, "s5", "p7", { path: "/photographs/" }),
  ];
  const { weekdays } = buildAnalytics(entities, {
    dayKeys,
    ownHost: "trumanbrown.com",
  });
  const bySource = (n) => weekdays.visits[n];

  it("makes one row per Weekdays or tagged visit, newest first", () => {
    expect(weekdays.visits.map((visit) => visit.pages)).toEqual([
      ["/"],
      ["/"],
      ["/", "/hobbies/"],
      ["/", "/photographs/"],
    ]);
  });

  it("keeps who, where, how long and what they did", () => {
    const recruiter = bySource(3);
    expect(recruiter).toMatchObject({
      via: "resume",
      source: "resume",
      org: "Contoso Ltd",
      orgKind: "org",
      city: "Redmond",
      device: "desktop",
      weekdays: true,
      weekdaysMs: 41000,
      furthest: "job:contoso-pm",
      clicks: ["resume-pdf"],
      copies: [{ section: "job:contoso-pm", text: "Led migration work" }],
      next: "/photographs/",
      scanner: false,
    });
    expect(recruiter.steps.map((step) => step.kind)).toEqual([
      "page",
      "show",
      "reach",
      "reach",
      "reach",
      "copy",
      "click",
      "page",
    ]);
    expect(recruiter.steps.at(-1)).toEqual({
      at: 42000,
      kind: "page",
      value: "/photographs/",
    });
  });

  it("keeps resume visits that stayed on Weekends", () => {
    expect(bySource(2)).toMatchObject({
      via: "resume",
      weekdays: false,
      next: "",
      pages: ["/", "/hobbies/"],
    });
  });

  it("marks a quick, idle visit from a mixed network as a link scanner", () => {
    expect(bySource(1)).toMatchObject({
      org: "Microsoft Corporation",
      scanner: true,
    });
  });

  it("says when someone left from Weekdays", () => {
    expect(bySource(0)).toMatchObject({
      source: "",
      weekdays: true,
      weekdaysMs: 10000,
      next: "",
    });
  });

  it("adds up totals without the scanner", () => {
    expect(weekdays.totals).toEqual({
      weekdaysVisits: 2,
      resumeVisits: 2,
      scannerVisits: 1,
      medianWeekdaysMs: 25500,
      pdfClicks: 1,
      copyVisits: 1,
    });
    expect(weekdays.owners).toEqual([
      { org: "Comcast Cable Communications, LLC", orgKind: "home", visits: 1 },
      { org: "Contoso Ltd", orgKind: "org", visits: 1 },
      { org: "Fabrikam Inc", orgKind: "org", visits: 1 },
    ]);
  });

  it("doesn't count event rows as pageviews", () => {
    const result = buildAnalytics(entities, {
      dayKeys,
      ownHost: "trumanbrown.com",
    });
    expect(result.totalPageviews).toBe(7);
  });

  it("ignores a broken event row", () => {
    const result = buildAnalytics(
      [pv(T0, "s9", "p9"), { ...ev(T0, "s9", "p9", []), evs: "{not json" }],
      { dayKeys, ownHost: "trumanbrown.com" },
    );
    expect(result.weekdays.visits).toEqual([]);
  });
});

describe("isLikelyScanner", () => {
  const base = {
    orgKind: "cloud",
    clicks: [],
    copies: [],
    pages: ["/"],
    weekdaysMs: 0,
  };
  it("flags mail security owners whatever they did", () => {
    expect(
      isLikelyScanner({ ...base, orgKind: "scanner", clicks: ["resume-pdf"] }),
    ).toBe(true);
  });
  it("lets a person on a cloud network through once they act or stay", () => {
    expect(isLikelyScanner(base)).toBe(true);
    expect(isLikelyScanner({ ...base, clicks: ["linkedin"] })).toBe(false);
    expect(isLikelyScanner({ ...base, weekdaysMs: 8000 })).toBe(false);
    expect(isLikelyScanner({ ...base, pages: ["/", "/photographs/"] })).toBe(
      false,
    );
  });
  it("never flags home internet or a company network", () => {
    expect(isLikelyScanner({ ...base, orgKind: "home" })).toBe(false);
    expect(isLikelyScanner({ ...base, orgKind: "org" })).toBe(false);
  });
});

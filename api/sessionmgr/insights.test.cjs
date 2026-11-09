const { buildAnalytics } = require("./analytics");
const { isPdfScanner, p75, pageGroup, rating } = require("./insights");

const DAY = "2026-11-09";
const T0 = Date.UTC(2026, 10, 9, 17, 0, 0);
const dayKeys = {
  current: ["2026-11-08", DAY],
  previous: ["2026-11-06", "2026-11-07"],
};

function key(ms, suffix) {
  return `${String(9999999999999 - ms).padStart(13, "0")}-${suffix}`;
}
function pv(ms, sid, pvid, values = {}, day = DAY) {
  return {
    partitionKey: `pv-${day}`,
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
function dur(ms, pvid, value) {
  return {
    partitionKey: `pv-${DAY}`,
    rowKey: key(ms, `${pvid}-dur`),
    type: "dur",
    pvid,
    dur: value,
  };
}
function row(ms, type, values) {
  return {
    partitionKey: `pv-${DAY}`,
    rowKey: key(ms, `r${ms}-${type}`),
    type,
    ...values,
  };
}

const contoso = {
  org: "Contoso Ltd",
  orgKind: "org",
  city: "Redmond",
  region: "Washington",
  country: "US",
  device: "desktop",
  browser: "Edge",
};

const entities = [
  // Contoso twice, on two days, once from the resume and reading two jobs.
  pv(
    T0 - 86400000,
    "c1",
    "c1a",
    { ...contoso, theme: "light", themeFrom: "device", vw: "1440+" },
    "2026-11-08",
  ),
  pv(T0, "c2", "c2a", {
    ...contoso,
    via: "resume",
    theme: "dark",
    themeFrom: "choice",
    vw: "1440+",
  }),
  ev(T0 + 1000, "c2", "c2a", [
    { k: "show", t: 10 },
    { k: "dwell", v: "job:contoso-pm", d: 20000, t: 30000 },
    { k: "dwell", v: "summary", d: 4000, t: 30000 },
    { k: "wd", v: 30000, t: 30000 },
  ]),
  ev(T0 + 60000, "c2", "c2a", [
    { k: "dwell", v: "job:contoso-pm", d: 26000, t: 60000 },
  ]),
  // A Comcast visitor on a phone: not a company.
  pv(T0 + 1000, "h1", "h1a", {
    org: "Comcast",
    orgKind: "home",
    device: "phone",
    theme: "light",
    themeFrom: "device",
    vw: "<480",
  }),
  ev(T0 + 2000, "h1", "h1a", [
    { k: "vital", v: "LCP", d: 3100, t: 5000 },
    { k: "vital", v: "CLS", d: 0.02, t: 5000 },
    {
      k: "err",
      v: "TypeError: x is undefined",
      s: "/_astro/globe.js",
      l: 4,
      t: 900,
    },
  ]),
  // Desktop speed and the same error again.
  ev(T0 + 3000, "c2", "c2a", [
    { k: "vital", v: "LCP", d: 1200, t: 4000 },
    { k: "vital", v: "INP", d: 80, t: 4000 },
    {
      k: "err",
      v: "TypeError: x is undefined",
      s: "/_astro/globe.js",
      l: 4,
      t: 1200,
    },
    { k: "theme", v: "light", t: 50000 },
  ]),
  // Photos and hobbies.
  pv(T0 + 5000, "p1", "p1a", { path: "/sessions/mt-baker-fall-2026/" }),
  ev(T0 + 9000, "p1", "p1a", [
    { k: "photo", v: "mt-baker-fall-2026/DSC1.jpg", d: 8000, z: true, t: 100 },
    {
      k: "photo",
      v: "mt-baker-fall-2026/DSC2.jpg",
      d: 2000,
      z: false,
      t: 8100,
    },
    {
      k: "photo",
      v: "mt-baker-fall-2026/DSC1.jpg",
      d: 4000,
      z: false,
      t: 10100,
    },
  ]),
  pv(T0 + 20000, "p1", "p1b", { path: "/hobbies/narrow-nature/" }),
  ev(T0 + 80000, "p1", "p1b", [
    { k: "toy", v: "narrow-nature", t: 3000 },
    { k: "nn", v: "daily", d: 4200, t: 60000 },
    { k: "nn", v: "more", t: 61000 },
    { k: "nn", v: "extra", d: 1800, t: 90000 },
  ]),
  dur(T0 + 120000, "p1b", 100000),
  pv(T0 + 30000, "t1", "t1a", { path: "/hobbies/tide-pooling/" }),
  dur(T0 + 40000, "t1a", 9000),
  // Shares and PDF opens.
  row(T0 + 100, "share", { app: "Slack", page: "/" }),
  row(T0 + 200, "share", { app: "LinkedIn", page: "/Truman-Brown-Resume.pdf" }),
  row(T0 + 300, "share", { app: "Search engine", page: "/" }),
  row(T0 + 400, "pdf", {
    ref: "boards.greenhouse.io",
    fromSite: false,
    ...contoso,
  }),
  row(T0 + 500, "pdf", {
    ref: "trumanbrown.com",
    fromSite: true,
    org: "Comcast",
    orgKind: "home",
  }),
  row(T0 + 600, "pdf", {
    ref: "",
    fromSite: false,
    org: "Microsoft Corporation",
    orgKind: "mixed",
  }),
];

const result = buildAnalytics(entities, {
  dayKeys,
  ownHost: "trumanbrown.com",
});

describe("Job hunt sections", () => {
  it("lists companies with how often they came back", () => {
    expect(result.weekdays.companies).toEqual([
      {
        org: "Contoso Ltd",
        orgKind: "org",
        visits: 2,
        days: 2,
        resumeVisits: 1,
        weekdaysMs: 30000,
        lastSeen: new Date(T0).toISOString(),
        place: "Redmond, Washington",
      },
    ]);
  });

  it("sums what gets read, using the last total per pageview", () => {
    expect(result.weekdays.read).toEqual([
      { name: "job:contoso-pm", visits: 1, totalMs: 26000, medianMs: 26000 },
      { name: "summary", visits: 1, totalMs: 4000, medianMs: 4000 },
    ]);
    const visit = result.weekdays.visits.find((v) => v.via === "resume");
    expect(visit.read).toEqual([
      { name: "job:contoso-pm", ms: 26000 },
      { name: "summary", ms: 4000 },
    ]);
  });

  it("counts shares by app, apart from search engines", () => {
    expect(result.shares.total).toBe(2);
    expect(result.shares.searchFetches).toBe(1);
    expect(result.shares.byApp).toEqual([
      { app: "LinkedIn", count: 1 },
      { app: "Slack", count: 1 },
    ]);
    expect(result.shares.rows[0]).toMatchObject({
      app: "LinkedIn",
      page: "/Truman-Brown-Resume.pdf",
    });
  });

  it("lists PDF opens with hiring systems named and scanners marked", () => {
    expect(result.pdf.totals).toEqual({
      opens: 2,
      outside: 1,
      fromSite: 1,
      scanners: 1,
    });
    expect(result.pdf.rows.map((r) => [r.sourceName, r.scanner])).toEqual([
      ["", true],
      ["This site", false],
      ["Greenhouse", false],
    ]);
  });

  it("names hiring systems in acquisition too", () => {
    expect(result.referrers.every((r) => typeof r.name === "string")).toBe(
      true,
    );
  });
});

describe("Site health sections", () => {
  it("reports the 75th percentile by page group and device", () => {
    const all = result.health.vitals.filter((v) => v.group === "All pages");
    expect(all.map((v) => v.device)).toEqual(["Desktop", "Phone"]);
    expect(all[0].metrics.LCP).toEqual({
      p75: 1200,
      samples: 1,
      rating: "good",
    });
    expect(all[1].metrics.LCP).toEqual({
      p75: 3100,
      samples: 1,
      rating: "needs-improvement",
    });
    expect(all[1].metrics.INP).toEqual({ p75: null, samples: 0, rating: "" });
    expect(result.health.vitals.some((v) => v.group === "Front door")).toBe(
      true,
    );
  });

  it("groups errors", () => {
    expect(result.health.errors).toEqual([
      expect.objectContaining({
        message: "TypeError: x is undefined",
        source: "/_astro/globe.js",
        line: 4,
        count: 2,
        pages: ["/"],
        browsers: ["Edge"],
      }),
    ]);
  });

  it("counts theme and screens by visit", () => {
    expect(result.health.looks).toEqual({
      visits: 3,
      theme: { light: 2, dark: 1 },
      from: { device: 2, choice: 1 },
      toggles: { light: 1, dark: 0 },
      viewports: [
        { band: "<480", visits: 1 },
        { band: "480-767", visits: 0 },
        { band: "768-1023", visits: 0 },
        { band: "1024-1439", visits: 0 },
        { band: "1440+", visits: 2 },
      ],
    });
  });
});

describe("Photos and hobbies", () => {
  it("counts photo opens, time and zooms", () => {
    expect(result.play.photos[0]).toEqual({
      key: "mt-baker-fall-2026/DSC1.jpg",
      opens: 2,
      totalMs: 12000,
      zooms: 1,
    });
    expect(result.play.galleries).toEqual([
      { page: "mt-baker-fall-2026", opens: 3, photos: 2, totalMs: 14000 },
    ]);
  });

  it("follows Narrow nature rounds", () => {
    expect(result.play.narrowNature).toEqual({
      visits: 1,
      played: 1,
      dailyFinished: 1,
      extraFinished: 1,
      averageScore: 3000,
      moreLists: 1,
    });
  });

  it("shows how many played each hobby", () => {
    expect(result.play.hobbies).toEqual(
      expect.arrayContaining([
        {
          slug: "narrow-nature",
          visits: 1,
          played: 1,
          medianMs: 100000,
          medianPlayedMs: 100000,
        },
        {
          slug: "tide-pooling",
          visits: 1,
          played: 0,
          medianMs: 9000,
          medianPlayedMs: 0,
        },
      ]),
    );
  });
});

describe("helpers", () => {
  it("rates Core Web Vitals on Google's thresholds", () => {
    expect(rating("LCP", 2500)).toBe("good");
    expect(rating("LCP", 2501)).toBe("needs-improvement");
    expect(rating("CLS", 0.3)).toBe("poor");
    expect(rating("INP", null)).toBe("");
  });
  it("takes the 75th percentile", () => {
    expect(p75([1, 2, 3, 4])).toBe(3);
    expect(p75([5])).toBe(5);
    expect(p75([])).toBeNull();
  });
  it("groups pages", () => {
    expect(pageGroup("/")).toBe("Front door");
    expect(pageGroup("/sessions/x/")).toBe("Sessions");
    expect(pageGroup("/hobbies/narrow-nature/")).toBe("Narrow nature");
    expect(pageGroup("/hobbies/")).toBe("Things to try");
    expect(pageGroup("/privacy/")).toBe("Other");
  });
  it("marks PDF scanners", () => {
    expect(isPdfScanner({ orgKind: "scanner", fromSite: true })).toBe(true);
    expect(isPdfScanner({ orgKind: "cloud", ref: "" })).toBe(true);
    expect(isPdfScanner({ orgKind: "mixed", ref: "linkedin.com" })).toBe(false);
    expect(isPdfScanner({ orgKind: "mixed", fromSite: true })).toBe(false);
  });
});

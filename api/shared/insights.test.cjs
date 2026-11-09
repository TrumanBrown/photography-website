// Run by Vitest with globals enabled (see vitest.config.ts).
const { shareApp } = require("./share-app");
const { hiringSystem, sourceName } = require("./hiring-system");
const {
  alertKey,
  buildAlert,
  claimSlot,
  engagement,
  shouldAlert,
} = require("./alert");
const { isOwnHost } = require("./own-host");
const { cleanPage } = require("./rows");
const { blobHostFrom, imageTarget } = require("../og/target");
const { cleanEvents, cleanError, cleanViewport } = require("../track/payload");

describe("shareApp", () => {
  it.each([
    ["Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", "Slack"],
    [
      "Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5",
      "Teams",
    ],
    [
      "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
      "LinkedIn",
    ],
    [
      "Mozilla/5.0 (Macintosh) facebookexternalhit/1.1 Facebot Twitterbot/1.0",
      "iMessage",
    ],
    [
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Facebook",
    ],
    ["WhatsApp/2.23.20.0", "WhatsApp"],
    [
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      "Discord",
    ],
    ["Twitterbot/1.0", "X"],
    [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Search engine",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36 Edg/131.0",
      "",
    ],
    ["Mozilla/5.0 (iPhone) Mobile/15E148 Teams/1.0", ""],
  ])("%s is %s", (ua, app) => {
    expect(shareApp(ua)).toBe(app);
  });
});

describe("hiringSystem", () => {
  it("names hiring systems and job boards by any subdomain", () => {
    expect(hiringSystem("boards.greenhouse.io")).toBe("Greenhouse");
    expect(hiringSystem("jobs.lever.co")).toBe("Lever");
    expect(hiringSystem("contoso.wd5.myworkdayjobs.com")).toBe("Workday");
    expect(hiringSystem("jobs.ashbyhq.com")).toBe("Ashby");
    expect(hiringSystem("linkedin.com")).toBe("LinkedIn");
  });
  it("leaves other hosts alone", () => {
    expect(hiringSystem("google.com")).toBe("");
    expect(hiringSystem("notgreenhouse.io")).toBe("");
    expect(sourceName("google.com")).toBe("google.com");
    expect(sourceName("")).toBe("");
  });
});

describe("resume alerts", () => {
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
  const reading = [{ k: "wd", v: 16000, t: 16000 }];

  it("needs real reading", () => {
    expect(shouldAlert(company, [{ k: "wd", v: 9000, t: 9000 }])).toBe(false);
    expect(shouldAlert(company, reading)).toBe(true);
    expect(shouldAlert(company, [{ k: "click", v: "resume-pdf", t: 1 }])).toBe(
      true,
    );
    expect(
      shouldAlert(company, [{ k: "copy", v: "x", s: "summary", t: 1 }]),
    ).toBe(true);
  });

  it("counts any network from the resume, except mail scanners", () => {
    expect(shouldAlert({ via: "resume", orgKind: "home" }, reading)).toBe(true);
    expect(shouldAlert({ via: "resume", orgKind: "mixed" }, reading)).toBe(
      true,
    );
    expect(shouldAlert({ via: "resume", orgKind: "" }, reading)).toBe(true);
    expect(shouldAlert({ via: "resume", orgKind: "scanner" }, reading)).toBe(
      false,
    );
  });

  it("without the resume tag, only a company's own network", () => {
    expect(
      shouldAlert({ orgKind: "mixed", org: "Microsoft Corporation" }, reading),
    ).toBe(false);
    expect(shouldAlert({ orgKind: "home" }, reading)).toBe(false);
    expect(shouldAlert({ orgKind: "proxy" }, reading)).toBe(false);
    expect(shouldAlert(null, reading)).toBe(false);
  });

  it("keys one email per network and city", () => {
    expect(alertKey(company)).toBe("Contoso Ltd|Redmond");
    expect(alertKey({})).toBe("unknown network|");
  });

  it("writes a plain email with what they've done", () => {
    const email = buildAlert(
      { ...company, via: "resume" },
      [
        ...reading,
        { k: "click", v: "resume-pdf", t: 2 },
        { k: "copy", v: "Grew migrations", t: 3 },
      ],
      { from: "DoNotReply@example.net", to: "me@example.com" },
    );
    expect(email.content.subject).toBe(
      "Someone at Contoso Ltd is reading your resume",
    );
    expect(email.content.plainText).toContain("From: a link in your resume");
    expect(email.content.plainText).toContain(
      "Network: Contoso Ltd (company network)",
    );
    expect(email.content.plainText).toContain("Place: Redmond, Washington, US");
    expect(email.content.plainText).toContain(
      'So far: 16s on Weekdays, clicked Resume (PDF), copied "Grew migrations"',
    );
    expect(email.content.plainText).not.toMatch(/\n\n\n/);
    expect(email.recipients.to[0].address).toBe("me@example.com");
  });

  it("says less when the network isn't a company's", () => {
    const email = buildAlert(
      { via: "resume", org: "Comcast", orgKind: "home", city: "Seattle" },
      reading,
      { from: "a", to: "b" },
    );
    expect(email.content.subject).toBe(
      "Someone from your resume is reading it in Seattle",
    );
  });

  it("reads engagement from a batch", () => {
    expect(
      engagement([
        { k: "wd", v: 5 },
        { k: "wd", v: 9 },
        { k: "click", v: "x" },
      ]),
    ).toEqual({ weekdaysMs: 9, clicks: ["x"], copies: [] });
  });

  it("claims one slot per key a day and stops at the caps", async () => {
    const rows = new Map();
    const table = {
      async createEntity(entity) {
        const key = `${entity.partitionKey}/${entity.rowKey}`;
        if (rows.has(key))
          throw Object.assign(new Error("exists"), { statusCode: 409 });
        rows.set(key, { ...entity, etag: "1" });
      },
      async getEntity(pk, rk) {
        const row = rows.get(`${pk}/${rk}`);
        if (!row)
          throw Object.assign(new Error("missing"), { statusCode: 404 });
        return row;
      },
      async updateEntity(entity) {
        rows.set(`${entity.partitionKey}/${entity.rowKey}`, {
          ...entity,
          etag: String(Number(entity.etag) + 1),
        });
      },
    };
    const now = new Date("2026-11-09T18:00:00Z");
    expect(await claimSlot(table, "Contoso|Redmond", now)).toBe(true);
    expect(await claimSlot(table, "Contoso|Redmond", now)).toBe(false);
    for (const n of [1, 2, 3])
      expect(await claimSlot(table, `Org ${n}|x`, now)).toBe(true);
    expect(await claimSlot(table, "Org 4|x", now)).toBe(false);
    expect(rows.get("2026-11-09T18/notify-all").count).toBe(4);
  });
});

describe("own host and pages", () => {
  it("knows the site's own referrers", () => {
    expect(isOwnHost("https://trumanbrown.com/", { headers: {} })).toBe(true);
    expect(
      isOwnHost("https://www.trumanbrown.com/#weekdays", { headers: {} }),
    ).toBe(true);
    expect(isOwnHost("https://linkedin.com/", { headers: {} })).toBe(false);
    expect(isOwnHost("", { headers: {} })).toBe(false);
  });
  it("cleans page paths", () => {
    expect(cleanPage("/hobbies/fishing/?x=1#y")).toBe("/hobbies/fishing/");
    expect(cleanPage("//evil.example")).toBe("/");
    expect(cleanPage(undefined)).toBe("/");
  });
});

describe("og image target", () => {
  const host = blobHostFrom(
    "DefaultEndpointsProtocol=https;AccountName=stexample1;AccountKey=abc==;EndpointSuffix=core.windows.net",
  );
  it("reads the Blob host from the connection string", () => {
    expect(host).toBe("stexample1.blob.core.windows.net");
  });
  it("allows the site's own images and its Blob", () => {
    expect(imageTarget("/_astro/plate.Ab12.jpg", host)).toBe(
      "/_astro/plate.Ab12.jpg",
    );
    expect(
      imageTarget(
        "https://stexample1.blob.core.windows.net/originals/a/b.jpg",
        host,
      ),
    ).toBe("https://stexample1.blob.core.windows.net/originals/a/b.jpg");
  });
  it("refuses anything else", () => {
    expect(imageTarget("https://evil.example/a.jpg", host)).toBeNull();
    expect(imageTarget("//evil.example/a.jpg", host)).toBeNull();
    expect(imageTarget("/../secret.jpg", host)).toBeNull();
    expect(imageTarget("/page/", host)).toBeNull();
    expect(
      imageTarget("http://stexample1.blob.core.windows.net/a.jpg", host),
    ).toBeNull();
    expect(imageTarget(undefined, host)).toBeNull();
  });
});

describe("new event kinds", () => {
  it("keeps each in its shape", () => {
    expect(
      cleanEvents([
        { k: "dwell", v: "job:contoso-pm", d: 12000.4, t: 1 },
        { k: "vital", v: "LCP", d: 1834.6, t: 2 },
        { k: "vital", v: "CLS", d: 0.04567, t: 3 },
        { k: "theme", v: "dark", t: 4 },
        {
          k: "photo",
          v: "mt-baker-fall-2026/DSC02763.jpg",
          d: 8000,
          z: true,
          t: 5,
        },
        { k: "nn", v: "daily", d: 4200, t: 6 },
        { k: "nn", v: "more", t: 7 },
        { k: "toy", v: "tide-pooling", t: 8 },
        {
          k: "err",
          v: "TypeError: x is undefined",
          s: "/_astro/app.js?v=2",
          l: 10,
          c: 4,
          t: 9,
        },
      ]),
    ).toEqual([
      { k: "dwell", v: "job:contoso-pm", d: 12000, t: 1 },
      { k: "vital", v: "LCP", d: 1835, t: 2 },
      { k: "vital", v: "CLS", d: 0.046, t: 3 },
      { k: "theme", v: "dark", t: 4 },
      {
        k: "photo",
        v: "mt-baker-fall-2026/DSC02763.jpg",
        d: 8000,
        z: true,
        t: 5,
      },
      { k: "nn", v: "daily", d: 4200, t: 6 },
      { k: "nn", v: "more", t: 7 },
      { k: "toy", v: "tide-pooling", t: 8 },
      {
        k: "err",
        v: "TypeError: x is undefined",
        s: "/_astro/app.js",
        l: 10,
        c: 4,
        t: 9,
      },
    ]);
  });
  it("drops bad values", () => {
    expect(
      cleanEvents([
        { k: "vital", v: "FID", d: 10, t: 1 },
        { k: "vital", v: "LCP", d: -1, t: 1 },
        { k: "theme", v: "sepia", t: 1 },
        { k: "photo", v: "../etc/passwd", d: 1, t: 1 },
        { k: "nn", v: "daily", d: 1.5, t: 1 },
        { k: "err", v: "", t: 1 },
        { k: "dwell", v: "Job X", d: 1, t: 1 },
      ]),
    ).toEqual([]);
  });
  it("keeps addresses in errors down to their path", () => {
    expect(
      cleanError("Failed to fetch https://example.com/api/x?token=abc"),
    ).toBe("Failed to fetch /api/x");
  });
  it("knows the viewport bands", () => {
    expect(cleanViewport("1440+")).toBe("1440+");
    expect(cleanViewport("2000")).toBe("");
  });
});

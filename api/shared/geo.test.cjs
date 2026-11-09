// Run by Vitest with globals enabled (see vitest.config.ts).
const { orgKind } = require("./org-kind");
const { describeAgent } = require("./user-agent");
const { createGeo, describeRecords, isPublicIp, POINTER } = require("./geo");
const zlib = require("zlib");

describe("orgKind", () => {
  it.each([
    ["Comcast Cable Communications, LLC", "home"],
    ["T-Mobile USA, Inc.", "home"],
    ["Ziply Fiber", "home"],
    ["Google Fiber Inc.", "home"],
    ["Microsoft Corporation", "mixed"],
    ["Google LLC", "mixed"],
    ["Amazon.com, Inc.", "mixed"],
    ["Oracle Corporation", "mixed"],
    ["ZSCALER, INC.", "proxy"],
    ["Netskope Inc", "proxy"],
    ["Proofpoint, Inc.", "scanner"],
    ["Mimecast Ltd", "scanner"],
    ["Cloudflare, Inc.", "relay"],
    ["Akamai Technologies, Inc.", "relay"],
    ["M247 Europe SRL", "relay"],
    ["Akamai Connected Cloud", "cloud"],
    ["DigitalOcean, LLC", "cloud"],
    ["Apple Inc.", "org"],
    ["Starbucks Coffee Company", "org"],
    ["Mobileye Vision Technologies", "org"],
    ["The Cheesecake Factory Restaurants", "org"],
  ])("%s is %s", (org, kind) => {
    expect(orgKind(org)).toBe(kind);
  });

  it("is blank without an owner", () => {
    expect(orgKind("")).toBe("");
    expect(orgKind(undefined)).toBe("");
  });
});

describe("describeAgent", () => {
  it("reads a Windows Edge desktop", () => {
    expect(
      describeAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
      ),
    ).toEqual({ device: "desktop", os: "Windows", browser: "Edge" });
  });

  it("reads an iPhone in Safari", () => {
    expect(
      describeAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      ),
    ).toEqual({ device: "phone", os: "iOS", browser: "Safari" });
  });

  it("reads the LinkedIn app on Android", () => {
    expect(
      describeAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 [LinkedInApp]",
      ),
    ).toEqual({ device: "phone", os: "Android", browser: "LinkedIn app" });
  });

  it("reads an Android tablet and an iPad", () => {
    expect(
      describeAgent(
        "Mozilla/5.0 (Linux; Android 13; SM-X700) Chrome/120.0 Safari/537.36",
      ).device,
    ).toBe("tablet");
    expect(
      describeAgent(
        "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1",
      ).device,
    ).toBe("tablet");
  });

  it("is blank without a user agent", () => {
    expect(describeAgent("")).toEqual({ device: "", os: "", browser: "" });
  });
});

describe("isPublicIp", () => {
  it.each(["73.140.10.10", "8.8.8.8", "2601:600:8e00::1"])(
    "%s is public",
    (ip) => {
      expect(isPublicIp(ip)).toBe(true);
    },
  );
  it.each([
    "unknown",
    "",
    "10.0.0.1",
    "192.168.1.5",
    "172.20.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "100.64.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
  ])("%s is not", (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });
});

describe("describeRecords", () => {
  it("keeps only the owner and the place", () => {
    expect(
      describeRecords(
        {
          city: { names: { en: "Seattle" } },
          subdivisions: [{ names: { en: "Washington" } }],
          country: { iso_code: "US" },
          location: { latitude: 47.6, longitude: -122.3 },
        },
        {
          autonomous_system_number: 7922,
          autonomous_system_organization: "Comcast Cable Communications, LLC",
        },
      ),
    ).toEqual({
      org: "Comcast Cable Communications, LLC",
      orgKind: "home",
      city: "Seattle",
      region: "Washington",
      country: "US",
    });
  });

  it("copes with missing records", () => {
    expect(describeRecords(null, null)).toEqual({
      org: "",
      orgKind: "",
      city: "",
      region: "",
      country: "",
    });
  });
});

describe("createGeo", () => {
  const gz = (text) => zlib.gzipSync(Buffer.from(text));
  const pointer = (month) =>
    Buffer.from(
      JSON.stringify({
        month,
        city: `geo/city-${month}.mmdb.gz`,
        asn: `geo/asn-${month}.mmdb.gz`,
      }),
    );

  function setup(files, clock = { now: 0 }) {
    const downloads = [];
    const geo = createGeo({
      download: async (name) => {
        downloads.push(name);
        return files[name] || null;
      },
      openReader: (buffer) => {
        const label = buffer.toString();
        return {
          get: () =>
            label.startsWith("asn")
              ? { autonomous_system_organization: `Owner ${label}` }
              : {
                  city: { names: { en: `City ${label}` } },
                  country: { iso_code: "US" },
                },
        };
      },
      now: () => clock.now,
    });
    return { geo, downloads, clock };
  }

  it("loads once and answers from memory", async () => {
    const { geo, downloads } = setup({
      [POINTER]: pointer("2026-11"),
      "geo/city-2026-11.mmdb.gz": gz("city-11"),
      "geo/asn-2026-11.mmdb.gz": gz("asn-11"),
    });
    const [a, b] = await Promise.all([
      geo.lookup("8.8.8.8"),
      geo.lookup("1.1.1.1"),
    ]);
    expect(a).toMatchObject({
      org: "Owner asn-11",
      city: "City city-11",
      country: "US",
    });
    expect(b).toMatchObject({ org: "Owner asn-11" });
    await geo.lookup("9.9.9.9");
    expect(downloads).toEqual([
      POINTER,
      "geo/city-2026-11.mmdb.gz",
      "geo/asn-2026-11.mmdb.gz",
    ]);
  });

  it("skips private addresses without loading anything", async () => {
    const { geo, downloads } = setup({});
    expect(await geo.lookup("10.0.0.1")).toBeNull();
    expect(downloads).toEqual([]);
  });

  it("returns null and waits ten minutes after a failed load", async () => {
    const { geo, downloads, clock } = setup({});
    expect(await geo.lookup("8.8.8.8")).toBeNull();
    clock.now = 5 * 60 * 1000;
    expect(await geo.lookup("8.8.8.8")).toBeNull();
    expect(downloads).toEqual([POINTER]);
    clock.now = 11 * 60 * 1000;
    await geo.lookup("8.8.8.8");
    expect(downloads).toEqual([POINTER, POINTER]);
  });

  it("rejects a pointer outside geo/", async () => {
    const { geo, downloads } = setup({
      [POINTER]: Buffer.from(
        JSON.stringify({ month: "x", city: "../secret", asn: "geo/a" }),
      ),
    });
    expect(await geo.lookup("8.8.8.8")).toBeNull();
    expect(downloads).toEqual([POINTER]);
  });

  it("switches to next month's files after the daily re-check", async () => {
    const files = {
      [POINTER]: pointer("2026-11"),
      "geo/city-2026-11.mmdb.gz": gz("city-11"),
      "geo/asn-2026-11.mmdb.gz": gz("asn-11"),
      "geo/city-2026-12.mmdb.gz": gz("city-12"),
      "geo/asn-2026-12.mmdb.gz": gz("asn-12"),
    };
    const { geo, clock } = setup(files);
    await geo.lookup("8.8.8.8");
    files[POINTER] = pointer("2026-12");
    clock.now = 25 * 60 * 60 * 1000;
    // The re-check runs in the background; this lookup still answers from November.
    expect(await geo.lookup("8.8.8.8")).toMatchObject({ org: "Owner asn-11" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await geo.lookup("8.8.8.8")).toMatchObject({ org: "Owner asn-12" });
  });
});

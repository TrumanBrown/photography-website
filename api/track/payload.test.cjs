// Run by Vitest with globals enabled (see vitest.config.ts).
const { cleanEvents, cleanVia, MAX_BATCH } = require("./payload");

describe("cleanVia", () => {
  it("keeps short lowercase tags", () => {
    expect(cleanVia("resume")).toBe("resume");
    expect(cleanVia(" LinkedIn ")).toBe("linkedin");
    expect(cleanVia("job-fair-2026")).toBe("job-fair-2026");
  });

  it("drops anything else", () => {
    expect(cleanVia("")).toBe("");
    expect(cleanVia("a".repeat(33))).toBe("");
    expect(cleanVia("<script>")).toBe("");
    expect(cleanVia("me@example.com")).toBe("");
    expect(cleanVia(42)).toBe("");
  });
});

describe("cleanEvents", () => {
  it("keeps each kind in its own shape", () => {
    expect(
      cleanEvents([
        { k: "show", t: 0 },
        { k: "reach", v: "job:microsoft", n: 3, t: 4100.6 },
        { k: "click", v: "resume-pdf", t: 9000 },
        {
          k: "copy",
          v: "  Led   migration\nwork ",
          s: "job:microsoft",
          t: 9500,
        },
        { k: "wd", v: 12000, t: 12000 },
        { k: "hide", t: 12000 },
      ]),
    ).toEqual([
      { k: "show", t: 0 },
      { k: "reach", v: "job:microsoft", n: 3, t: 4101 },
      { k: "click", v: "resume-pdf", t: 9000 },
      { k: "copy", v: "Led migration work", s: "job:microsoft", t: 9500 },
      { k: "wd", v: 12000, t: 12000 },
      { k: "hide", t: 12000 },
    ]);
  });

  it("drops unknown kinds, bad names and bad times", () => {
    expect(
      cleanEvents([
        { k: "eval", v: "x", t: 0 },
        { k: "click", v: "Resume PDF", t: 0 },
        { k: "click", v: "resume-pdf", t: -1 },
        { k: "click", v: "resume-pdf", t: 2 * 60 * 60 * 1000 },
        { k: "reach", v: "job:x", n: 1.5, t: 0 },
        { k: "wd", v: "lots", t: 0 },
        { k: "copy", v: "   ", t: 0 },
        null,
        "click",
      ]),
    ).toEqual([]);
  });

  it("caps copied text and falls back to the panel as its section", () => {
    const [event] = cleanEvents([
      { k: "copy", v: "x".repeat(500), s: "Bad Section", t: 1 },
    ]);
    expect(event.v).toHaveLength(100);
    expect(event.s).toBe("weekdays");
  });

  it("keeps at most one batch's worth", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      k: "click",
      v: `x${i}`,
      t: i,
    }));
    expect(cleanEvents(many)).toHaveLength(MAX_BATCH);
  });

  it("returns nothing for a non-list", () => {
    expect(cleanEvents(undefined)).toEqual([]);
    expect(cleanEvents({ k: "show" })).toEqual([]);
  });
});

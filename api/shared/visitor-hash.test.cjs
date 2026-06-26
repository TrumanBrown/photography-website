// Run by Vitest with globals enabled (see vitest.config.ts), so describe/it/
// expect are available without importing the ESM-only vitest entrypoint.
const { visitorHash, todayUtc } = require("./visitor-hash");

describe("visitorHash", () => {
  it("is deterministic for the same inputs", () => {
    expect(visitorHash("1.2.3.4", "UA", "2026-06-26", "salt")).toBe(
      visitorHash("1.2.3.4", "UA", "2026-06-26", "salt"),
    );
  });

  it("returns 16 hex characters", () => {
    expect(visitorHash("1.2.3.4", "UA", "2026-06-26", "salt")).toMatch(
      /^[0-9a-f]{16}$/,
    );
  });

  it("rotates with the day bucket, so a visitor is not tracked across days", () => {
    const today = visitorHash("1.2.3.4", "UA", "2026-06-26", "salt");
    const tomorrow = visitorHash("1.2.3.4", "UA", "2026-06-27", "salt");
    expect(today).not.toBe(tomorrow);
  });

  it("depends on the salt", () => {
    expect(visitorHash("1.2.3.4", "UA", "2026-06-26", "a")).not.toBe(
      visitorHash("1.2.3.4", "UA", "2026-06-26", "b"),
    );
  });

  it("distinguishes different IPs", () => {
    expect(visitorHash("1.1.1.1", "UA", "d", "s")).not.toBe(
      visitorHash("2.2.2.2", "UA", "d", "s"),
    );
  });
});

describe("todayUtc", () => {
  it("formats a date as YYYY-MM-DD in UTC", () => {
    expect(todayUtc(new Date("2026-06-26T23:59:00Z"))).toBe("2026-06-26");
  });
});

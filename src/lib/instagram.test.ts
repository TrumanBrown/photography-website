import { describe, expect, it } from "vitest";
import { instagramUrl } from "./instagram";

describe("instagramUrl", () => {
  it("normalises a profile address", () => {
    expect(instagramUrl("https://instagram.com/some.account_1")).toBe(
      "https://www.instagram.com/some.account_1/",
    );
    expect(instagramUrl("  https://www.instagram.com/someone/ ")).toBe(
      "https://www.instagram.com/someone/",
    );
  });

  it("gives no link without the secret", () => {
    expect(instagramUrl(undefined)).toBeNull();
    expect(instagramUrl("")).toBeNull();
  });

  it("ignores anything that isn't a plain profile address", () => {
    for (const bad of [
      "http://instagram.com/someone",
      "https://instagram.com.evil.example/someone",
      "https://www.instagram.com/p/abc123/",
      "https://www.instagram.com/someone/?utm=x",
      "javascript:alert(1)",
      "@someone",
    ]) {
      expect(instagramUrl(bad)).toBeNull();
    }
  });
});

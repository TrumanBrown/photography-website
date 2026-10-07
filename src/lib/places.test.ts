import { describe, it, expect } from "vitest";
import { regionOf, regionSlug } from "./places";

describe("regionOf", () => {
  it("takes the broadest part of a comma-separated location", () => {
    expect(regionOf("Limón Province, Costa Rica")).toBe("Costa Rica");
    expect(regionOf("Lijiang, Yunnan, China")).toBe("China");
    expect(regionOf("Puget Sound, Washington")).toBe("Washington");
  });

  it("handles a location with no comma", () => {
    expect(regionOf("Washington")).toBe("Washington");
  });

  it("folds compass-prefixed regions into the parent so they share a hub", () => {
    expect(regionOf("Eastern Washington")).toBe("Washington");
    expect(regionOf("Western Washington")).toBe("Washington");
    expect(regionOf("Northern California")).toBe("California");
  });

  it("keeps a compass word that is part of the name itself", () => {
    // "North Cascades" is the range's name, not a direction applied to it,
    // and it is already followed by the state in practice.
    expect(regionOf("North Cascades, Washington")).toBe("Washington");
  });

  it("trims surrounding whitespace", () => {
    expect(regionOf("Tibet ,  China ")).toBe("China");
  });

  it("returns undefined for an empty or whitespace location", () => {
    expect(regionOf("")).toBeUndefined();
    expect(regionOf("   ")).toBeUndefined();
    expect(regionOf(",")).toBeUndefined();
  });
});

describe("regionSlug", () => {
  it("lowercases and hyphenates", () => {
    expect(regionSlug("Costa Rica")).toBe("costa-rica");
    expect(regionSlug("Washington")).toBe("washington");
  });

  it("strips punctuation and accents to a safe URL", () => {
    expect(regionSlug("Limón Province")).toBe("lim-n-province");
    expect(regionSlug("  Spaced  Out  ")).toBe("spaced-out");
  });
});

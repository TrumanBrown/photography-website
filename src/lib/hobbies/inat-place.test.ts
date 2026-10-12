import { describe, expect, it } from "vitest";
import { coarseCoord, coarsePlace } from "./inat-place";

describe("coarsePlace", () => {
  it("drops the street from an address", () => {
    expect(coarsePlace("123 Main St, Springfield, OR 97477, USA")).toBe(
      "OR, USA",
    );
    expect(coarsePlace("Main St, Springfield, OR")).toBe("Springfield, OR");
  });

  it("keeps a town or region as it is", () => {
    expect(coarsePlace("Springfield, OR")).toBe("Springfield, OR");
    expect(coarsePlace("Bijagua, Upala, Alajuela, Costa Rica")).toBe(
      "Alajuela, Costa Rica",
    );
    expect(coarsePlace("Costa Rica")).toBe("Costa Rica");
  });

  it("returns nothing for nothing", () => {
    expect(coarsePlace(null)).toBe("");
    expect(coarsePlace(undefined)).toBe("");
    expect(coarsePlace("97477")).toBe("");
  });
});

describe("coarseCoord", () => {
  it("snaps to a 0.1° grid", () => {
    expect(coarseCoord(44.04621)).toBe(44);
    expect(coarseCoord(-123.0219)).toBe(-123);
    expect(coarseCoord(45.5512)).toBe(45.6);
    expect(coarseCoord(10.04)).toBe(10);
  });

  it("never returns negative zero", () => {
    expect(Object.is(coarseCoord(-0.02), 0)).toBe(true);
  });
});

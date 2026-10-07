import { describe, expect, it } from "vitest";
import { coordsFor, isMapped, LAND } from "./geo";

describe("coordsFor", () => {
  it("resolves the exact locations the archive uses", () => {
    expect(coordsFor("Limón Province, Costa Rica")).toEqual({
      lat: 10.2,
      lon: -83.5,
    });
    expect(coordsFor("Eastern Washington")).toEqual({ lat: 47.1, lon: -119.3 });
    expect(coordsFor("Lijiang, Yunnan, China")).toEqual({
      lat: 26.87,
      lon: 100.23,
    });
  });

  it("ignores case and accents", () => {
    expect(coordsFor("limon province, costa rica")).toEqual(
      coordsFor("Limón Province, Costa Rica"),
    );
  });

  it("falls back to the broader part of a location", () => {
    // not in the table by name, but "Costa Rica" is
    expect(coordsFor("Some New Lodge, Costa Rica")).toEqual(
      coordsFor("Costa Rica"),
    );
  });

  it("finds a known place named inside a longer string", () => {
    expect(coordsFor("Northern California coast")).toEqual(
      coordsFor("California"),
    );
    expect(coordsFor("Beijing → Xi'an → Chengdu")).toEqual(
      coordsFor("Beijing"),
    );
  });

  it("prefers explicit coordinates from EXIF over the table", () => {
    const exact = { lat: 1.5, lon: 2.5 };
    expect(coordsFor("Eastern Washington", exact)).toEqual(exact);
  });

  it("ignores unusable explicit coordinates", () => {
    expect(
      coordsFor("Eastern Washington", { lat: Number.NaN, lon: 0 }),
    ).toEqual({
      lat: 47.1,
      lon: -119.3,
    });
  });

  it("gives up rather than guessing", () => {
    expect(coordsFor("Atlantis")).toBeUndefined();
    expect(coordsFor("")).toBeUndefined();
    expect(isMapped("Atlantis")).toBe(false);
    expect(isMapped("Eastern Washington")).toBe(true);
  });
});

describe("land outlines", () => {
  it("ships rings of plausible coordinates", () => {
    expect(LAND.length).toBeGreaterThan(10);
    for (const ring of LAND) {
      expect(ring.length).toBeGreaterThan(3);
      for (const [lon, lat] of ring) {
        expect(lon).toBeGreaterThanOrEqual(-180);
        expect(lon).toBeLessThanOrEqual(180);
        expect(lat).toBeGreaterThanOrEqual(-90);
        expect(lat).toBeLessThanOrEqual(90);
      }
    }
  });
});

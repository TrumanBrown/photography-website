import { describe, expect, it } from "vitest";
import { coordsFor, GAZETTEER_POINTS, isMapped, LAND } from "./geo";

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
    // Sessions from one trip get their own pins, not the "Tibet, China" one.
    expect(coordsFor("Nagqu, Tibet, China")).toEqual({ lat: 31.48, lon: 92.06 });
    expect(coordsFor("Shannan and Shigatse, Tibet, China")).toEqual({
      lat: 29.1,
      lon: 89.7,
    });
    // These four sessions had no pin, so the globe was missing places.
    expect(coordsFor("Minnesota")).toEqual({ lat: 46.73, lon: -94.69 });
    expect(coordsFor("Scottish Highlands, Scotland")).toEqual({
      lat: 57.12,
      lon: -4.71,
    });
    expect(coordsFor("Scotland, United Kingdom")).toEqual({
      lat: 56.49,
      lon: -4.2,
    });
    expect(coordsFor("Stockholm, Sweden")).toEqual({ lat: 59.33, lon: 18.07 });
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

  it("never takes a position from anywhere but the table", () => {
    // Photos are stripped of GPS before publishing; a pin is always a coarse,
    // public point picked by hand.
    expect(coordsFor.length).toBe(1);
    expect(coordsFor("Oregon Coast, Oregon")).toEqual({
      lat: 44.6,
      lon: -124.05,
    });
    expect(coordsFor("Kauai, Hawaii")).toEqual({ lat: 22.07, lon: -159.5 });
  });

  it("keeps every point coarse: two decimal places at most", () => {
    for (const { lat, lon } of GAZETTEER_POINTS) {
      expect(Math.round(lat * 100) / 100).toBe(lat);
      expect(Math.round(lon * 100) / 100).toBe(lon);
    }
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

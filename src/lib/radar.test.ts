import { describe, expect, it } from "vitest";
import {
  advance,
  afterglow,
  AFTERGLOW_FLOOR,
  altitudeText,
  compassPoint,
  dashedCircle,
  describe as describeReading,
  distanceText,
  fitText,
  glyph,
  layout,
  matrixText,
  PANEL,
  radarPoint,
  rangeAndBearing,
  readRadar,
  readSnapshot,
  textPixels,
  textWidth,
  trendText,
  trendValue,
} from "./radar";

const CENTER = { latitude: 47.6175, longitude: -122.305 };

function apiFlight(
  callsign: string,
  latitude: number,
  longitude: number,
  extra: Record<string, unknown> = {},
) {
  return {
    identifiers: { icao24: "abc123", callsign, registration: null },
    aircraft: { typeCode: "B738" },
    position: {
      latitude,
      longitude,
      altitudeFeet: 3500,
      onGround: false,
      projected: { latitude, longitude },
    },
    movement: {
      speedKnots: 200,
      headingDegrees: 90,
      verticalRateFeetPerMinute: -800,
    },
    ...extra,
  };
}

describe("readSnapshot", () => {
  it("reads flights, centre, range and time from the API's shape", () => {
    const snap = readSnapshot({
      status: "ok",
      generatedAt: "2026-11-05T21:40:51.396Z",
      query: { center: CENTER, radiusNauticalMiles: 16 },
      flights: [apiFlight("ASA123", 47.7, -122.3)],
    });
    expect(snap.center).toEqual(CENTER);
    expect(snap.rangeNm).toBe(16);
    expect(snap.at).toBe(Date.parse("2026-11-05T21:40:51.396Z"));
    expect(snap.flights).toHaveLength(1);
    expect(snap.flights[0]).toMatchObject({
      label: "ASA123",
      type: "B738",
      altitudeFeet: 3500,
      speedKnots: 200,
      onGround: false,
    });
  });

  it("skips flights with no position and survives junk", () => {
    expect(readSnapshot(null).flights).toEqual([]);
    expect(readSnapshot({ flights: [{ position: {} }, null] }).flights).toEqual(
      [],
    );
    expect(readSnapshot({}).rangeNm).toBe(16);
  });

  it("falls back to the registration, then the hex id, for a label", () => {
    const snap = readSnapshot({
      flights: [
        {
          identifiers: {
            callsign: "",
            registration: "n667lf",
            icao24: "a8cf3a",
          },
          position: { latitude: 47.6, longitude: -122.3 },
        },
      ],
    });
    expect(snap.flights[0].label).toBe("N667LF");
  });
});

describe("range and bearing", () => {
  it("is zero at the centre", () => {
    expect(rangeAndBearing(CENTER, CENTER).distanceNm).toBeCloseTo(0, 6);
  });

  it("points north for a point due north, about 60 nm a degree", () => {
    const { distanceNm, bearing } = rangeAndBearing(CENTER, {
      latitude: CENTER.latitude + 1,
      longitude: CENTER.longitude,
    });
    expect(distanceNm).toBeCloseTo(60, 0);
    expect(bearing).toBeCloseTo(0, 3);
  });

  it("points east for a point due east", () => {
    const { bearing } = rangeAndBearing(CENTER, {
      latitude: CENTER.latitude,
      longitude: CENTER.longitude + 0.1,
    });
    expect(bearing).toBeGreaterThan(89);
    expect(bearing).toBeLessThan(91);
  });
});

describe("advance", () => {
  const flight = readSnapshot({ flights: [apiFlight("X", 47.6, -122.3)] })
    .flights[0];

  it("moves a flight along its heading at its speed", () => {
    const later = advance(flight, 36);
    // 200 kt for 36 s is 2 nm, due east.
    const moved = rangeAndBearing(flight, later);
    expect(moved.distanceNm).toBeCloseTo(2, 2);
    expect(moved.bearing).toBeGreaterThan(89);
    expect(moved.bearing).toBeLessThan(91);
  });

  it("leaves parked planes, unknown speeds and no time alone", () => {
    expect(advance({ ...flight, onGround: true }, 30)).toEqual({
      ...flight,
      onGround: true,
    });
    expect(advance({ ...flight, speedKnots: null }, 30).latitude).toBe(
      flight.latitude,
    );
    expect(advance(flight, 0)).toBe(flight);
  });

  it("caps how far it guesses ahead", () => {
    expect(
      rangeAndBearing(flight, advance(flight, 600)).distanceNm,
    ).toBeCloseTo(rangeAndBearing(flight, advance(flight, 60)).distanceNm, 6);
  });
});

describe("the panel's text", () => {
  it("formats like the real panel", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(44)).toBe("NE");
    expect(compassPoint(359)).toBe("N");
    expect(compassPoint(-90)).toBe("W");
    expect(trendValue(null)).toBe(0);
    expect(trendValue(99)).toBe(0);
    expect(trendValue(500)).toBe(1);
    expect(trendText(-500)).toBe("DES");
    expect(distanceText(2.345)).toBe("2.3NM");
    expect(distanceText(12.6)).toBe("13NM");
    expect(altitudeText(null)).toBe("ALT?");
    expect(altitudeText(1725)).toBe("1725FT");
    expect(matrixText("asa-12 é!")).toBe("ASA-12");
    expect(matrixText("!!")).toBe("UNKNOWN");
  });
});

describe("readRadar", () => {
  const snap = readSnapshot({
    query: { center: CENTER, radiusNauticalMiles: 16 },
    flights: [
      apiFlight("FAR", 47.75, -122.305),
      apiFlight("NEAR", 47.63, -122.305),
      apiFlight("GONE", 48.6, -122.305),
      apiFlight("PARKED", 47.62, -122.305, {
        position: { latitude: 47.62, longitude: -122.305, onGround: true },
      }),
    ],
  });
  const reading = readRadar(snap);

  it("keeps airborne flights in range, nearest first", () => {
    expect(reading.contacts.map((c) => c.label)).toEqual(["NEAR", "FAR"]);
    expect(reading.contacts[0].nearest).toBe(true);
    expect(reading.contacts[1].nearest).toBe(false);
  });

  it("prints the nearest flight the way the panel does", () => {
    expect(reading.nearest).toMatchObject({
      label: "NEAR",
      detail: ["B738 3500FT", "200KT DES"],
      compass: "N",
      trend: -1,
    });
  });

  it("says it plainly for a screen reader", () => {
    expect(describeReading(reading, 16)).toBe(
      "2 planes within 16 nautical miles of Seattle right now. Nearest is NEAR, a B738 at 3,500 ft, 0.8 nautical miles north.",
    );
    expect(describeReading(readRadar({ ...snap, flights: [] }), 16)).toBe(
      "No planes within 16 nautical miles of Seattle right now.",
    );
  });
});

describe("font and layout", () => {
  it("has a 3 × 5 glyph for everything matrixText keeps", () => {
    for (const char of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-? ") {
      const g = glyph(char);
      expect(g).toHaveLength(5);
      for (const row of g) expect(row).toHaveLength(3);
    }
    expect(glyph("é")).toEqual(glyph("?"));
  });

  it("measures, fits and lights text", () => {
    expect(textWidth("AB")).toBe(7);
    expect(textWidth("AB", 2)).toBe(14);
    expect(fitText("ABCDEFGH", 15)).toBe("ABCD");
    expect(fitText("ABCDEFGH", 14)).toBe("ABC");
    const lit = textPixels("I", 1, 2);
    expect(lit).toContainEqual([1, 2]);
    expect(lit).toContainEqual([2, 3]);
    expect(lit.every(([x, y]) => x >= 1 && x <= 3 && y >= 2 && y <= 6)).toBe(
      true,
    );
  });

  it("draws the callsign big when it fits, and keeps the radar on the panel", () => {
    for (const label of ["N667LF", "SWA123456", "UNKNOWN"]) {
      const l = layout(label);
      expect(textWidth(label, l.labelScale)).toBeLessThanOrEqual(PANEL - 2);
      expect(l.center[1] + l.radius).toBeLessThan(PANEL);
      expect(l.center[1] - l.radius).toBeGreaterThan(l.rows[1] + 5);
    }
    expect(layout("N667LF").labelScale).toBe(2);
    expect(layout("SWA12345").labelScale).toBe(2);
    expect(layout("SWA123456").labelScale).toBe(1);
  });

  it("puts contacts inside the radar and drops those past the range", () => {
    const l = layout("ASA1");
    expect(radarPoint(0, 0, 16, l)).toEqual(l.center);
    expect(radarPoint(16, 0, 16, l)).toEqual([
      l.center[0],
      l.center[1] - l.radius,
    ]);
    expect(radarPoint(17, 0, 16, l)).toBeNull();
    const ring = dashedCircle(l.center, 8);
    expect(ring.length).toBeGreaterThan(8);
    for (const [x, y] of ring)
      expect(Math.round(Math.hypot(x - l.center[0], y - l.center[1]))).toBe(8);
  });

  it("brightens a contact as the sweep passes, then decays to a floor", () => {
    expect(afterglow(90, 90)).toBe(1);
    expect(afterglow(150, 90)).toBeLessThan(1);
    expect(afterglow(150, 90)).toBeGreaterThan(AFTERGLOW_FLOOR);
    expect(afterglow(60, 90)).toBe(AFTERGLOW_FLOOR);
  });
});

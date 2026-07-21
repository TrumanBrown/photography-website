import { describe, expect, it } from "vitest";
import {
  TERRAIN_X,
  calculateHikeStats,
  createDefaultHike,
  normalizeHikeState,
  randomizeHike,
  terrainElevationAt,
} from "./hiking-model";

describe("hiking scene model", () => {
  it("creates independent default scenes", () => {
    const first = createDefaultHike();
    const second = createDefaultHike();
    first.terrain[0] = 0.9;
    first.features[0].x = 0.8;
    expect(second.terrain[0]).not.toBe(first.terrain[0]);
    expect(second.features[0].x).not.toBe(first.features[0].x);
  });

  it("passes exactly through each editable terrain anchor", () => {
    const terrain = [0.1, 0.3, 0.8, 0.5, 0.2];
    TERRAIN_X.forEach((x, index) => {
      expect(terrainElevationAt(terrain, x)).toBeCloseTo(terrain[index], 8);
    });
  });

  it("keeps the ridge angular between anchors instead of rounding summits", () => {
    const terrain = [0.1, 0.9, 0.2, 0.8, 0.1];
    const midpoint = (TERRAIN_X[0] + TERRAIN_X[1]) / 2;
    expect(terrainElevationAt(terrain, midpoint)).toBeCloseTo(0.5, 8);
  });

  it("makes a steeper profile longer and harder", () => {
    const gentle = createDefaultHike();
    gentle.terrain = [0.1, 0.2, 0.3, 0.2, 0.1];
    const steep = createDefaultHike();
    steep.terrain = [0.1, 0.8, 0.2, 0.9, 0.1];
    expect(calculateHikeStats(steep).elevationFeet).toBeGreaterThan(
      calculateHikeStats(gentle).elevationFeet,
    );
    expect(calculateHikeStats(steep).durationHours).toBeGreaterThan(
      calculateHikeStats(gentle).durationHours,
    );
  });

  it("normalizes untrusted saved state into bounded controls", () => {
    const state = normalizeHikeState({
      biome: "not-a-place",
      distance: 999,
      terrain: [-4, 0.2, 8, 0.4, 0.5],
      routeName:
        "  A very long imaginary route name that should be safely trimmed at the boundary  ",
      features: [
        { id: "lake-x", type: "lake", x: 20 },
        { type: "bogus", x: 0.5 },
      ],
    });
    expect(state.biome).toBe("cascades");
    expect(state.distance).toBe(18);
    expect(
      state.terrain.every((height) => height >= 0.08 && height <= 0.96),
    ).toBe(true);
    expect(state.features).toHaveLength(1);
    expect(state.features[0].x).toBe(0.93);
    expect(state.routeName.length).toBeLessThanOrEqual(48);
  });

  it("randomizes deterministically from a seed", () => {
    const state = createDefaultHike();
    expect(randomizeHike(state, 9381)).toEqual(randomizeHike(state, 9381));
    expect(randomizeHike(state, 9381)).not.toEqual(randomizeHike(state, 9382));
  });

  it("randomizes into two distinct summits with a saddle between them", () => {
    const terrain = randomizeHike(createDefaultHike(), 1122).terrain;
    expect(terrain[1]).toBeGreaterThan(terrain[0] + 0.2);
    expect(terrain[1]).toBeGreaterThan(terrain[2] + 0.15);
    expect(terrain[3]).toBeGreaterThan(terrain[2] + 0.15);
    expect(terrain[3]).toBeGreaterThan(terrain[4] + 0.2);
    expect(Math.max(...terrain)).toBeLessThanOrEqual(0.96);
  });
});

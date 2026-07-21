import { describe, expect, it } from "vitest";
import {
  baseTerrainElevationAt,
  calculateHikeStats,
  countTerrainPeaks,
  createDefaultHike,
  featureAdjustedElevationAt,
  generateTerrainProfile,
  mountainCountForDistance,
  normalizeHikeState,
  randomizeHike,
  resizeTerrainForDistance,
  suggestFeaturePosition,
  terrainElevationAt,
  terrainXPositions,
} from "./hiking-model";
import {
  terrainAnchorPoint,
  terrainElevationFromCanvasY,
  terrainReliefForDistance,
} from "./hiking-renderer";

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
    const positions = terrainXPositions(terrain.length, 55, "fjord");
    positions.forEach((x, index) => {
      expect(terrainElevationAt(terrain, x, positions)).toBeCloseTo(
        terrain[index],
        8,
      );
    });
  });

  it("keeps the ridge angular between anchors instead of rounding summits", () => {
    const terrain = [0.1, 0.9, 0.2, 0.8, 0.1];
    const positions = [0.04, 0.27, 0.5, 0.73, 0.96];
    const midpoint = (positions[0] + positions[1]) / 2;
    expect(terrainElevationAt(terrain, midpoint, positions)).toBeCloseTo(
      0.5,
      8,
    );
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

  it("migrates a legacy five-point route into the variable profile", () => {
    const state = normalizeHikeState({
      version: 1,
      biome: "cascades",
      distance: 12,
      terrain: [0.1, 0.82, 0.35, 0.94, 0.12],
      features: [],
      seed: 4817,
    });
    expect(state.version).toBe(2);
    expect(state.terrain.length).toBeGreaterThan(5);
    expect(countTerrainPeaks(state.terrain)).toBe(mountainCountForDistance(12));
  });

  it("randomizes deterministically from a seed", () => {
    const state = createDefaultHike();
    expect(randomizeHike(state, 9381)).toEqual(randomizeHike(state, 9381));
    expect(randomizeHike(state, 9381)).not.toEqual(randomizeHike(state, 9382));
  });

  it("scales mountain count with route length", () => {
    expect(mountainCountForDistance(3)).toBe(1);
    expect(mountainCountForDistance(9.2)).toBe(3);
    expect(mountainCountForDistance(18)).toBe(7);
    const short = generateTerrainProfile("cascades", 3, 1122);
    const long = generateTerrainProfile("cascades", 18, 1122);
    expect(countTerrainPeaks(short)).toBe(1);
    expect(countTerrainPeaks(long)).toBe(7);
    expect(short.length).toBeGreaterThan(5);
    expect(long.length).toBeGreaterThan(short.length);
  });

  it("produces materially different silhouettes for different seeds and biomes", () => {
    const first = generateTerrainProfile("cascades", 12, 1001);
    const second = generateTerrainProfile("cascades", 12, 2002);
    const fjord = generateTerrainProfile("fjord", 12, 1001);
    expect(first).not.toEqual(second);
    expect(first).not.toEqual(fjord);
  });

  it("adds mountains while preserving some existing shape when distance grows", () => {
    const short = createDefaultHike();
    short.distance = 3;
    short.terrain = generateTerrainProfile(
      short.biome,
      short.distance,
      short.seed,
    );
    const long = resizeTerrainForDistance(short, 18);
    expect(countTerrainPeaks(long.terrain)).toBeGreaterThan(
      countTerrainPeaks(short.terrain),
    );
    expect(long.terrain.length).toBeGreaterThan(short.terrain.length);
  });

  it("zooms the whole mountain world out as mileage grows", () => {
    expect(terrainReliefForDistance(3)).toBeGreaterThan(
      terrainReliefForDistance(18),
    );
    const short = resizeTerrainForDistance(createDefaultHike(), 3);
    const long = resizeTerrainForDistance(short, 18);
    for (const state of [short, long]) {
      const index = state.terrain.indexOf(Math.max(...state.terrain));
      const point = terrainAnchorPoint(state, index, 1000, 600);
      expect(terrainElevationFromCanvasY(state, point.y, 600)).toBeCloseTo(
        state.terrain[index],
        8,
      );
    }
  });

  it("trail moments reshape the route instead of acting as visual-only markers", () => {
    const base = createDefaultHike();
    base.features = [];
    const x = 0.5;
    const elevation = baseTerrainElevationAt(base, x);
    const lake = {
      ...base,
      features: [{ id: "lake-test", type: "lake" as const, x }],
    };
    const lookout = {
      ...base,
      features: [{ id: "lookout-test", type: "lookout" as const, x }],
    };
    expect(featureAdjustedElevationAt(lake, x)).toBeLessThan(elevation - 0.08);
    expect(featureAdjustedElevationAt(lookout, x)).toBeGreaterThan(
      elevation + 0.07,
    );
  });

  it("places lakes lower than lookouts on the same generated route", () => {
    const state = createDefaultHike();
    state.features = [];
    const lakeX = suggestFeaturePosition(state, "lake");
    const lookoutX = suggestFeaturePosition(state, "lookout");
    expect(baseTerrainElevationAt(state, lakeX)).toBeLessThan(
      baseTerrainElevationAt(state, lookoutX),
    );
  });
});

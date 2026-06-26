import { describe, it, expect } from "vitest";
import {
  stockingCapacity,
  stockingStatus,
  PLANTED_CAPACITY_PER_GALLON,
} from "./stocking";

describe("stockingCapacity", () => {
  it("scales linearly with gallons", () => {
    expect(stockingCapacity(20)).toBeCloseTo(11, 10);
    expect(stockingCapacity(10)).toBeCloseTo(5.5, 10);
    expect(stockingCapacity(0)).toBe(0);
  });

  it("uses the documented capacity constant", () => {
    expect(PLANTED_CAPACITY_PER_GALLON).toBe(0.55);
  });
});

describe("stockingStatus", () => {
  it("reports an empty tank as lightly stocked", () => {
    const s = stockingStatus(20, 0);
    expect(s.pct).toBe(0);
    expect(s.label).toBe("Lightly stocked");
  });

  it("matches the worked example from the docs (~42% reads healthy)", () => {
    // 20 gal -> capacity 11 units; ~4.65 bioload -> ~0.42 of capacity.
    const s = stockingStatus(20, 4.65);
    expect(s.pct).toBeCloseTo(0.4227, 3);
    expect(s.label).toBe("Healthy");
    expect(s.color).toBe("#10b981");
  });

  // 10 gal -> capacity 5.5, so bioload = pct * 5.5.
  it.each([
    [2.145, "Lightly stocked"], // 0.39
    [2.255, "Healthy"], // 0.41
    [4.62, "Healthy"], // 0.84
    [4.73, "Heavily stocked"], // 0.86
    [5.445, "Heavily stocked"], // 0.99
    [5.555, "Overstocked"], // 1.01
  ])('classifies bioload %d as "%s"', (bioload, label) => {
    expect(stockingStatus(10, bioload).label).toBe(label);
  });

  it("colors heavily stocked amber and overstocked red", () => {
    expect(stockingStatus(10, 4.73).color).toBe("#f59e0b");
    expect(stockingStatus(10, 6).color).toBe("#ef4444");
  });
});

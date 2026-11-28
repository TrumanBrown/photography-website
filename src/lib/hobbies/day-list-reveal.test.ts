import { describe, expect, it } from "vitest";
import {
  FLASH_STEPS,
  countEase,
  flashAt,
  headAt,
  hitEnds,
  revealPlan,
  ripplesAt,
  settledAt,
  shadeAt,
  tapeKm,
} from "./day-list-reveal";

const KMS = [12_000, 2_400, 900, 37, 0];

describe("revealPlan", () => {
  it("builds up longer and hits harder the closer the guess", () => {
    const plans = KMS.map(revealPlan);
    for (let i = 1; i < plans.length; i++) {
      expect(plans[i].tier).toBeGreaterThan(plans[i - 1].tier);
      expect(plans[i].hold).toBeGreaterThanOrEqual(plans[i - 1].hold);
      expect(plans[i].dim).toBeGreaterThanOrEqual(plans[i - 1].dim);
      expect(plans[i].flash).toBeGreaterThanOrEqual(plans[i - 1].flash);
      expect(plans[i].ripples).toBeGreaterThanOrEqual(plans[i - 1].ripples);
      expect(plans[i].count).toBeGreaterThanOrEqual(plans[i - 1].count);
    }
    // A miss by a continent gets no hold and no hit at all.
    expect(plans[0]).toMatchObject({ hold: 0, dim: 0, flash: 0, ripples: 0 });
  });
});

describe("headAt", () => {
  const near = revealPlan(37);
  const frac = 0.3;

  it("runs out to the boundary, then into the middle, never backwards", () => {
    const end = settledAt(near, frac);
    let last = -1;
    for (let ms = 0; ms <= end + 50; ms += 5) {
      const h = headAt(near, frac, ms);
      expect(h).toBeGreaterThanOrEqual(last);
      last = h;
    }
    expect(headAt(near, frac, 0)).toBe(0);
    expect(headAt(near, frac, near.run)).toBeCloseTo(frac, 6);
    expect(headAt(near, frac, end)).toBe(1);
  });

  it("crawls into the boundary on a close guess", () => {
    // The last tenth of the way takes at least a third of the run.
    let ms = 0;
    while (headAt(near, frac, ms) < frac * 0.9) ms++;
    expect(near.run - ms).toBeGreaterThan(near.run / 3);
  });

  it("goes straight to the middle from inside the place", () => {
    const spot = revealPlan(0);
    expect(headAt(spot, 0, spot.glide / 2)).toBeCloseTo(0.5, 6);
    expect(headAt(spot, 0, spot.glide)).toBe(1);
  });
});

describe("tapeKm", () => {
  it("ticks up to the distance and stops on it", () => {
    const frac = 0.4;
    const plan = revealPlan(37);
    const shown = [0, 200, 600, 1000, plan.run, plan.run + 300].map((ms) =>
      tapeKm(37, headAt(plan, frac, ms), frac),
    );
    expect(shown[0]).toBe(0);
    expect(shown.at(-2)).toBe(37);
    expect(shown.at(-1)).toBe(37);
    expect(Math.max(...shown)).toBe(37);
  });
});

describe("shadeAt", () => {
  it("leaves the pool of light alone and darkens in three steps", () => {
    const seen = new Set<number>();
    for (let d = 0; d <= 200; d++) seen.add(shadeAt(d, 50, 150, 0.6));
    expect(shadeAt(40, 50, 150, 0.6)).toBe(0);
    expect(shadeAt(190, 50, 150, 0.6)).toBeCloseTo(0.6, 6);
    expect([...seen].sort()).toEqual(
      [0, 0.2, 0.4, 0.6].map((v) => expect.closeTo(v, 6)),
    );
  });
});

describe("the hit", () => {
  it("flashes at once and dies away in steps", () => {
    const plan = revealPlan(0);
    expect(flashAt(plan, -1)).toBe(0);
    expect(flashAt(plan, 0)).toBe(plan.flash);
    let last = Infinity;
    for (let ms = 0; ms <= hitEnds(plan) + 50; ms += 10) {
      const f = flashAt(plan, ms);
      expect(f).toBeLessThanOrEqual(last);
      last = f;
    }
    expect(last).toBe(0);
    expect(
      new Set(Array.from({ length: 40 }, (_, i) => flashAt(plan, i * 10))).size,
    ).toBe(FLASH_STEPS.length + 1);
  });

  it("sends out the plan's ripples, one after another, and they all end", () => {
    const plan = revealPlan(37);
    expect(ripplesAt(plan, -10)).toEqual([]);
    expect(ripplesAt(plan, 0)).toHaveLength(1);
    expect(ripplesAt(plan, 200)).toHaveLength(plan.ripples);
    expect(ripplesAt(plan, hitEnds(plan))).toEqual([]);
    expect(ripplesAt(revealPlan(9_000), 100)).toEqual([]);
  });
});

describe("countEase", () => {
  it("covers most of the score early and the last digits slowly", () => {
    const plan = revealPlan(37);
    expect(countEase(plan, 0)).toBe(0);
    expect(countEase(plan, 1)).toBe(1);
    expect(countEase(plan, 0.5)).toBeGreaterThan(0.9);
  });
});

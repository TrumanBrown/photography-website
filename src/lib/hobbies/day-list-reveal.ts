/**
 * Narrow nature's answer, paced by how close the guess was. A guess a world
 * away gets the answer quickly. A close one gets a build-up and a hit, the
 * way Krillion, Plain and Farflung play their best results (2026-11-27):
 *
 * - The dotted line runs out from the pin with the distance ticking up at
 *   its head, quick at first and crawling into the last few km, so you don't
 *   know where it stops until it does (Krillion's depth counter slows the
 *   same way into its last few metres).
 * - A held beat: the world darkens in stepped bands round a pool of light on
 *   the pin and the place, the rings drift in, and the boundary inks in from
 *   where the line touched it (Farflung holds and dims before its verdict).
 * - The finder slams in, and as it locks on the map flashes in the result's
 *   colour, ripples run out from the pin and the rings shudder (Krillion and
 *   Farflung flash the screen in a rarity's colour).
 * - The score counts up and slows into its last digits (Plain's climb).
 *
 * Everything here is a pure function of time, so it can be tested without a
 * page; day-list.ts plays it.
 */

/** How close a guess was: 4 inside the place, 0 a world away. */
export type Tier = 0 | 1 | 2 | 3 | 4;

/** The verdict for each tier, the widest miss first. */
export const VERDICTS = [
  "Wrong side of the planet",
  "Not quite",
  "Right part of the world",
  "Near enough",
  "Spot on",
] as const;

/** The tier for a guess `km` from the place (0 inside it). */
export function tierFor(km: number): Tier {
  return km <= 0 ? 4 : km < 400 ? 3 : km < 1500 ? 2 : km < 5000 ? 1 : 0;
}

/** How the answer plays for one guess. Times in ms. */
export interface RevealPlan {
  tier: Tier;
  /** The line's run from the pin to the boundary (none from inside it). */
  run: number;
  /** How hard the run slows into its end: the power of its ease-out. */
  crawl: number;
  /** The held beat between the line stopping and the finder closing in. */
  hold: number;
  /** How dark the world away from the answer gets over the hold, 0 to 1. */
  dim: number;
  /** The rings drifting on from the boundary into the place's middle. */
  glide: number;
  /** The finder closing in on the place. */
  slam: number;
  /** How far past the place the finder snaps before it settles (easeOutBack). */
  overshoot: number;
  /** The flash in the result's colour as the finder locks on, 0 to 1. */
  flash: number;
  /** Ripples running out from the pin as it locks on. */
  ripples: number;
  /** The score counting up. */
  count: number;
  /** The verdict lands like a stamp instead of dropping in. */
  stamp: boolean;
}

/** The plan for a guess `km` from the place. */
export function revealPlan(km: number): RevealPlan {
  const tier = tierFor(km);
  switch (tier) {
    case 4:
      return {
        tier,
        run: 0,
        crawl: 4,
        hold: 1150,
        dim: 0.62,
        glide: 1150,
        slam: 300,
        overshoot: 2.2,
        flash: 0.6,
        ripples: 3,
        count: 1900,
        stamp: true,
      };
    case 3:
      return {
        tier,
        run: 1500,
        crawl: 4,
        hold: 700,
        dim: 0.56,
        glide: 700,
        slam: 320,
        overshoot: 2,
        flash: 0.5,
        ripples: 2,
        count: 1700,
        stamp: true,
      };
    case 2:
      return {
        tier,
        run: 1150,
        crawl: 3,
        hold: 280,
        dim: 0.3,
        glide: 420,
        slam: 420,
        overshoot: 1.5,
        flash: 0.28,
        ripples: 1,
        count: 1300,
        stamp: false,
      };
    default:
      return {
        tier,
        run: 950,
        crawl: 2.2,
        hold: 0,
        dim: 0,
        glide: 420,
        slam: 620,
        overshoot: 1.1,
        flash: 0,
        ripples: 0,
        count: 1000,
        stamp: false,
      };
  }
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeInOut = (t: number) => {
  const k = clamp01(t);
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
};

/** An ease-out at `power`: quick away, then a crawl into the end. */
export const crawl = (t: number, power: number): number =>
  1 - Math.pow(1 - clamp01(t), power);

/**
 * How far the line's head is along the way from the pin to the place's
 * middle, `ms` after it set off: out to the boundary at `frac` on a crawl,
 * then on into the middle over the glide (only the rings go that far).
 */
export function headAt(plan: RevealPlan, frac: number, ms: number): number {
  if (ms <= 0) return 0;
  const run = frac > 0 ? plan.run : 0;
  if (ms < run) return frac * crawl(ms / run, plan.crawl);
  if (!plan.glide) return 1;
  return frac + (1 - frac) * easeInOut((ms - run) / plan.glide);
}

/** When the line has stopped and the rings have reached the middle. */
export const settledAt = (plan: RevealPlan, frac: number): number =>
  (frac > 0 ? plan.run : 0) + plan.glide;

/** The distance shown at the line's head, `head` of the way along. */
export const tapeKm = (km: number, head: number, frac: number): number =>
  frac > 0 ? Math.round(km * clamp01(head / frac)) : 0;

/**
 * How dark a map pixel `d` away from the middle of the light gets, with the
 * light reaching `inner` and the dark full by `outer`, at `amount` of the
 * hold's dim: three steps, like a pixel game's lighting.
 */
export function shadeAt(
  d: number,
  inner: number,
  outer: number,
  amount: number,
): number {
  if (amount <= 0 || d <= inner) return 0;
  const k = outer > inner ? clamp01((d - inner) / (outer - inner)) : 1;
  return (Math.ceil(k * 3) / 3) * amount;
}

/** Each step of the flash, as a share of its strength. */
export const FLASH_STEPS = [1, 0.62, 0.34, 0.14];
/** How long each step of the flash holds. */
export const FLASH_STEP_MS = 70;

/** The flash `ms` after the lock: full at once, then down in four steps. */
export function flashAt(plan: RevealPlan, ms: number): number {
  if (!plan.flash || ms < 0) return 0;
  const i = Math.floor(ms / FLASH_STEP_MS);
  return i < FLASH_STEPS.length ? plan.flash * FLASH_STEPS[i] : 0;
}

/** One ripple's run out from the pin. */
export const RIPPLE_MS = 700;
/** Each ripple after the first follows this far behind. */
export const RIPPLE_GAP = 150;

/** The ripples `ms` after the lock: each one's progress, 0 to 1. */
export function ripplesAt(plan: RevealPlan, ms: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < plan.ripples; i++) {
    const p = (ms - i * RIPPLE_GAP) / RIPPLE_MS;
    if (p >= 0 && p < 1) out.push(p);
  }
  return out;
}

/** When the last ripple has gone. */
export const hitEnds = (plan: RevealPlan): number =>
  Math.max(
    plan.flash ? FLASH_STEPS.length * FLASH_STEP_MS : 0,
    plan.ripples ? (plan.ripples - 1) * RIPPLE_GAP + RIPPLE_MS : 0,
  );

/** The score's count, eased: most of it at once, the last digits slowly. */
export const countEase = (plan: RevealPlan, k: number): number =>
  crawl(k, plan.stamp ? 4 : 3);

import type { ImageMetadata } from "astro";

/**
 * Stipple plates: pen-and-ink drawings of each hobby, made from Truman's
 * photos by the stipple-plates skill (.github/skills/stipple-plates). Every
 * hobby has a `card` plate (the /hobbies/ grid) and a `mini` plate (the home
 * page band), in ink on paper and on scratchboard for dark mode, each with two
 * re-inked frames for the hover boil. Imported rather than served from
 * public/, so a re-rendered plate gets a new hashed URL.
 */
const files = import.meta.glob<ImageMetadata>("../assets/plates/*.webp", {
  eager: true,
  import: "default",
});

export type PlateSize = "card" | "mini";

/** File suffixes in boil order: the plate, then its two re-inkings. */
export const PLATE_FRAMES = ["", "-b1", "-b2"] as const;

export interface Plate {
  width: number;
  height: number;
  /** URLs of the plate and its boil frames, ink on paper. */
  light: string[];
  /** The same on scratchboard, for dark mode. */
  dark: string[];
}

export function plateFor(slug: string, size: PlateSize): Plate | null {
  const file = (suffix: string) =>
    files[`../assets/plates/${slug}-${size}${suffix}.webp`];
  const light = PLATE_FRAMES.map((frame) => file(frame));
  const dark = PLATE_FRAMES.map((frame) => file(`${frame}-dark`));
  if (!light[0] || !dark[0]) return null;
  const still = { light: light[0], dark: dark[0] };
  return {
    width: still.light.width,
    height: still.light.height,
    // A missing boil frame repeats the plate, so it just doesn't move.
    light: light.map((image) => (image ?? still.light).src),
    dark: dark.map((image) => (image ?? still.dark).src),
  };
}

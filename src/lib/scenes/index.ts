import aquarium from "./aquarium";
import birding from "./birding";
import crab from "./crab";
import fishing from "./fishing";
import type { Scene } from "./engine";
import globe from "./globe";
import herping from "./herping";
import hiking from "./hiking";
import { type Dots, median, split } from "./stage";

/**
 * Each hobby's opening scene, by slug. Loaded on demand by src/lib/open.ts
 * (fetched ahead on pages with hobby cards), so pages without them never pay
 * for it.
 */
export const SCENES: Record<string, Scene> = {
  "narrow-nature": globe,
  "aquarium-keeping": aquarium,
  "tide-pooling": crab,
  fishing,
  birding,
  herping,
  hiking,
};

export interface Staged {
  dots: Dots;
  parts: Record<string, Dots>;
  prep: unknown;
}

const staged = new WeakMap<Dots, Map<Scene, Staged>>();

/**
 * A plate's dots split into the scene's parts, and with `props`, the scene's
 * props drawn to match. Done once per plate; a plate's dots are already
 * particular to the theme.
 */
export function ready(
  scene: Scene,
  dots: Dots,
  dark: boolean,
  props = true,
): Staged {
  let byScene = staged.get(dots);
  if (!byScene) staged.set(dots, (byScene = new Map()));
  let entry = byScene.get(scene);
  if (!entry) {
    entry = { dots, parts: split(dots, scene.parts ?? []), prep: undefined };
    byScene.set(scene, entry);
  }
  if (props && entry.prep === undefined && scene.prepare)
    entry.prep = scene.prepare(dots, median(dots.r), dark);
  return entry;
}

export { play } from "./engine";

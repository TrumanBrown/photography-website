import { landed, type LandingNote } from "../landing";
import { cardUnits, readDots } from "../plate-dots";
import aquarium from "./aquarium";
import birding from "./birding";
import crab from "./crab";
import { clock, type Scene, show } from "./engine";
import fishing from "./fishing";
import globe from "./globe";
import herping from "./herping";
import hiking from "./hiking";
import { type Dots, median, split } from "./stage";

/**
 * Each hobby's opening scene, by slug. Loaded on demand by src/lib/open.ts
 * (fetched ahead on pages with hobby cards) and by a hobby page a scene is
 * carrying on into (src/lib/landing.ts), so other pages never pay for it.
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

interface Debug {
  duration: number;
  leave: number;
  depart: number;
  seek(t: number): void;
}

/**
 * On the hobby page a scene changed into: build the scene again from the
 * same plate and seed, and play the rest of it over the page from the frame
 * the last page left on, which the page has been showing since its first
 * paint (the note's `art`). `claim()` says whether it's still wanted; it
 * isn't if the page gave up waiting and showed itself.
 */
export async function resume(
  note: LandingNote,
  claim: () => boolean,
): Promise<boolean> {
  const s = note.scene;
  if (!s) return false;
  const slug = location.pathname.split("/").filter(Boolean).pop() ?? "";
  const scene = SCENES[slug];
  if (!scene) throw new Error(`No scene for ${slug}.`);
  const img = new Image();
  img.src = s.plate;
  await img.decode();
  const field = cardUnits(readDots(img), img.naturalWidth);
  if (!field) throw new Error("The plate couldn't be read.");
  const stagedScene = ready(scene, field, s.dark);

  const root = document.documentElement;
  const style = getComputedStyle(root);
  const shown = show(
    {
      scene,
      prep: stagedScene.prep,
      main: stagedScene,
      rect: s.rect,
      w: s.w,
      h: s.h,
      colors: {
        ink: note.ink || field.color,
        red: style.getPropertyValue("--stamp").trim() || "#b3301c",
        paper: style.getPropertyValue("--paper").trim() || "#fbfaf8",
      },
      font: getComputedStyle(document.body).fontFamily,
      dark: s.dark,
      seed: s.seed,
    },
    "landing-veil",
  );
  // Draw the first frame before claiming, so a scene that can't draw falls
  // back to the plain fade.
  const { canvas, depart } = shown;
  const end = shown.run.duration;
  const elapsed = Math.max(0, Date.now() - note.at) * s.speed;
  const t0 = Math.min(depart, s.t + elapsed);
  shown.draw(t0);
  if (!claim()) return false;
  document.body.append(canvas);
  // The canvas now shows what the first paint did: the class can go.
  landed(root);

  if (
    import.meta.env.DEV &&
    new URLSearchParams(location.search).has("scene-debug")
  ) {
    const debug: Debug = {
      duration: end,
      leave: shown.leave,
      depart,
      seek: shown.draw,
    };
    (window as unknown as { __scene?: Debug }).__scene = debug;
    return true;
  }

  const time = clock(s.speed);
  const hurry = () => time.hurry();
  const onKey = (event: KeyboardEvent) => {
    if (["Escape", "Enter", " "].includes(event.key)) hurry();
  };
  const done = () => {
    canvas.remove();
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pointerdown", hurry, true);
  };
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointerdown", hurry, true);
  // Coming back to this page from the back/forward cache, it's long over.
  window.addEventListener(
    "pageshow",
    (event) => {
      if (event.persisted) done();
    },
    { once: true },
  );

  const frame = (now: number) => {
    if (!canvas.isConnected) return;
    const t = Math.min(end, t0 + time.now(now));
    try {
      shown.draw(t);
    } catch {
      done();
      return;
    }
    if (t < end) requestAnimationFrame(frame);
    else done();
  };
  requestAnimationFrame(frame);
  return true;
}

export { play } from "./engine";

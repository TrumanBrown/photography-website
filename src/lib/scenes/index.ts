import { landed, type LandingNote } from "../landing";
import { cardUnits, type DotField, loadPlate, readDots } from "../plate-dots";
import { takeData } from "./carry";
import { clock, pushZoom, rendererReady, show, warmRenderer } from "./engine";
import { ready, SCENES, type Staged } from "./table";
import { split } from "./stage";

/**
 * The hobby scenes for the page. Loaded on demand by src/lib/open.ts
 * (fetched ahead on pages with hobby cards) and by a hobby page a scene is
 * carrying on into (src/lib/landing.ts), so other pages never pay for them.
 */
export { ready, SCENES, type Staged } from "./table";

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
 * paint (the note's `frame`). `claim()` says whether it's still wanted; it
 * isn't if the page gave up waiting and showed itself.
 */
export async function resume(
  note: LandingNote,
  claim: () => boolean,
  over: () => void = () => {},
): Promise<boolean> {
  const s = note.scene;
  if (!s) return false;
  const slug = location.pathname.split("/").filter(Boolean).pop() ?? "";
  const scene = SCENES[slug];
  if (!scene) throw new Error(`No scene for ${slug}.`);
  // The WebGL renderer builds its shaders while the scene is set up again.
  warmRenderer();
  // The plate's dots and the props, as the last page had them; or, if they
  // didn't make it, read and drawn again (the same, from the same plate).
  const carried = takeData(note.path, note.at);
  let staged: Staged;
  if (carried) {
    const dots = carried.dots as DotField;
    staged = {
      dots,
      parts: split(dots, scene.parts ?? []),
      prep: carried.prep,
    };
  } else {
    const img = await loadPlate(s.plate);
    const field = cardUnits(readDots(img), img.naturalWidth);
    if (!field) throw new Error("The plate couldn't be read.");
    staged = ready(scene, field, s.dark);
  }

  // Give the renderer what's left of the hold, near enough, to be ready.
  const holdLeft = note.at + s.hold - Date.now();
  await rendererReady(Math.max(0, Math.min(250, holdLeft - 60)));

  const root = document.documentElement;
  const style = getComputedStyle(root);
  const shown = show(
    {
      scene,
      prep: staged.prep,
      main: staged,
      rect: s.rect,
      w: s.w,
      h: s.h,
      colors: {
        ink: note.ink || (staged.dots as DotField).color || "#16150f",
        red: style.getPropertyValue("--stamp").trim() || "#b3301c",
        paper: style.getPropertyValue("--paper").trim() || "#fbfaf8",
      },
      font: getComputedStyle(document.body).fontFamily,
      dark: s.dark,
      seed: s.seed,
      zoom: () => pushZoom(Date.now() - note.at),
    },
    "landing-veil",
  );
  const { canvas, depart } = shown;
  const end = shown.run.duration;
  /** Where the scene is now: on from where it left, but not past the hold. */
  const sceneNow = () =>
    Math.min(depart, s.t + Math.max(0, Date.now() - note.at) * s.speed);
  // Draw once before claiming, so a scene that can't draw falls back to the
  // plain fade.
  shown.draw(sceneNow());
  if (!claim()) {
    shown.dispose();
    return false;
  }

  if (
    import.meta.env.DEV &&
    new URLSearchParams(location.search).has("scene-debug")
  ) {
    document.body.append(canvas);
    landed(root);
    const debug: Debug = {
      duration: end,
      leave: shown.leave,
      depart,
      seek: shown.draw,
    };
    (window as unknown as { __scene?: Debug }).__scene = debug;
    return true;
  }

  const hurry = () => time?.hurry();
  const onKey = (event: KeyboardEvent) => {
    if (["Escape", "Enter", " "].includes(event.key)) hurry();
  };
  const done = () => {
    canvas.remove();
    shown.dispose();
    over();
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

  // Take over from the CSS on a frame of its own, at the moment the CSS has
  // got to, so the swap doesn't show; from there the scene's own clock runs.
  let time: ReturnType<typeof clock> | null = null;
  let t0 = 0;
  const frame = () => {
    if (!time) {
      t0 = sceneNow();
      time = clock(s.speed);
      shown.draw(t0);
      document.body.append(canvas);
      landed(root);
    } else if (!canvas.isConnected) return;
    if (shown.lost) {
      done();
      return;
    }
    const t = Math.min(end, t0 + time.now());
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

/** This module's own address, for the next page to fetch it early. */
export const moduleUrl = import.meta.url;

export { play, warmRenderer } from "./engine";

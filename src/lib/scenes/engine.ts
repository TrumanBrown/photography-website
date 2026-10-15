import type { HeldFrame, Reveal } from "../landing";
import { type Renderer, renderer } from "./gl";
import { applyLook, type Look } from "./look";
import {
  canvasSink,
  type Colors,
  type Op,
  pageLabels,
  Pen,
  type Sink,
} from "./pen";
import {
  camLerp,
  type Cam,
  cubicBezier,
  type Dots,
  type Mat,
  median,
  type PartTest,
  PLATE_H,
  PLATE_W,
  type Pt,
  seeded,
  smootherstep,
} from "./stage";

/**
 * Plays a hobby scene: the card's plate lifts off its card onto a sheet of
 * paper and acts out its little story in its own dots (src/lib/scenes/*.ts).
 *
 * Most scenes end by opening the hobby page themselves: the fish swims off
 * and its ripples wash the paper away, the crab's pinch sends a shockwave
 * through it, and so on. That has to happen over the hobby page, so those
 * scenes change page as soon as the plate has lifted (`leave`), before
 * anything in them moves. Until `depart` the camera only eases in a touch,
 * which the hobby page carries on in CSS from its first paint while it
 * loads; then it builds the scene again from the same plate, props and seed
 * and plays the rest over itself (index.ts `resume`). So nothing ever stops
 * mid-move to wait for the page. The globe instead plays out here and ends
 * zoomed into a few big dots, which the hobby page opens through
 * (src/lib/landing.ts).
 *
 * A second click, tap, Enter or Space hurries the rest along; Escape puts
 * the page back.
 */

/** How long the plate takes to rise from its card to the middle of the screen. */
export const LIFT_MS = 450;
/** Scenes that carry on over the hobby page change page as the lift ends... */
export const LEAVE = LIFT_MS;
/** ...hold while it loads... */
export const HOLD = 420;
/** ...and start moving here. */
export const ACT = LEAVE + HOLD;
/**
 * From the moment the page changes the camera pushes in a touch, easing out
 * by the clock over PUSH_MS, so a hobby page that's slow to pick the scene
 * up shows it still drifting in rather than stopped. The landing CSS plays
 * the same curve.
 */
export const HOLD_ZOOM = 1.03;
export const PUSH_MS = 1400;
export const PUSH_EASE = [0.33, 1, 0.68, 1] as const;
const pushEase = cubicBezier(...PUSH_EASE);
/** The push in, `ms` after the page changed (or 1 before it does). */
export function pushZoom(ms: number): number {
  return ms <= 0
    ? 1
    : 1 + (HOLD_ZOOM - 1) * pushEase(Math.min(1, ms / PUSH_MS));
}
/** How long the paper takes to cover the page behind. */
const PAPER_MS = 320;
/** How much faster the rest of a scene plays once you click again. */
export const HURRY = 2.8;
/** The mini plate a home-page card shows hands over to the finer card plate. */
const SWAP_FROM = 60;
const SWAP_MS = 300;
/** At most this many big dots are handed to the next page. */
const KEEP = 900;

export type { Colors, Look, Reveal };

export interface DrawOpts {
  alpha?: number;
  /** Paper laid around each dot first, in the dots' own units, so a figure reads over busy stipple behind it. */
  halo?: number;
  /** Bends each dot after the matrix, in world units: write x, y and a radius factor into `out`. */
  warp?: (x: number, y: number, out: Float64Array) => void;
  color?: "ink" | "red";
  /** The dots the scene dives into: the last frame of these goes to the next page. */
  target?: boolean;
  /** Grows or shrinks the pen. */
  size?: number;
  /**
   * Draw only the paper halos, or only the ink. A figure in several pieces
   * lays all its halos down first, so its own pieces don't cut into each other.
   */
  pass?: "halo" | "ink";
  /** The dots are in CSS px on the screen, not on the plate: no camera. */
  screen?: boolean;
}

export interface Painter {
  /** Viewport, CSS px. */
  readonly w: number;
  readonly h: number;
  /** Set the camera; draw calls after it use it. */
  cam(c: Cam): void;
  /** A part of the plate (see Scene.parts), through `m`. */
  part(name: string, m?: Mat, o?: DrawOpts): void;
  dots(d: Dots, m?: Mat, o?: DrawOpts): void;
  /** A pen line through world points, `width` CSS px wide, on a paper margin `halo` px wide. */
  line(
    pts: readonly Pt[],
    o: { width: number; alpha?: number; color?: "ink" | "red"; halo?: number },
  ): void;
  /** A small label at a world point, nudged by (dx, dy) CSS px. */
  label(
    text: string,
    x: number,
    y: number,
    o: { dx?: number; dy?: number; alpha?: number; color?: "ink" | "red" },
  ): void;
  /**
   * Open holes through the paper, and anything drawn so far, onto the page
   * underneath: circles in CSS px, as x, y, r. Draw what moves on top after.
   */
  cut(holes: ArrayLike<number>, count?: number): void;
  /** The whole sheet's opacity and blur (CSS px), for a scene that fades away. */
  look(o: { opacity?: number; blur?: number }): void;
  screen(x: number, y: number): [number, number];
}

export interface SceneContext {
  /** The plate's dots, card units, and its parts. */
  dots: Dots;
  parts: Record<string, Dots>;
  /** The plate's typical dot radius, card units: the pen props are drawn with. */
  r0: number;
  rand: () => number;
  dark: boolean;
  w: number;
  h: number;
  /** The camera lifting the plate off its card onto the middle of the screen. */
  lift(t: number): Cam;
  /** Where the lift ends. */
  stage: Cam;
  /** The camera scale at which a dot of radius `r` is one of the big final dots. */
  big(r: number): number;
}

export interface SceneRun {
  /** Length of the whole scene, ms. */
  duration: number;
  /**
   * When the page changes, ms: the start of a still pose that lasts until
   * `depart`, so the next page can pick the scene up without a jump. Left
   * out, the page changes at the end, on the big dots (`reveal`).
   */
  leave?: number;
  depart?: number;
  /** For a scene that ends on big dots: where the next page opens from. */
  reveal?: Reveal;
  draw(t: number, p: Painter): void;
}

export interface Scene<P = unknown> {
  /** Named parts of the plate, in card units; the first to claim a dot gets it. */
  parts?: ReadonlyArray<readonly [string, PartTest]>;
  /** Heavier set-up (props), done ahead of a click when possible. */
  prepare?(dots: Dots, r0: number, dark: boolean): P;
  start(ctx: SceneContext, prep: P): SceneRun;
}

/** Erases a scene's prop type so scenes can share one table. */
export const defineScene = <P>(scene: Scene<P>) =>
  scene as unknown as Scene<unknown>;

/** How the scene hands over to the next page. */
export type Final =
  | {
      kind: "dots";
      /** x, y, radius of each big dot, CSS px, in a flat list. */
      dots: number[];
      w: number;
      h: number;
      reveal: Reveal;
    }
  | {
      kind: "scene";
      /** Where it left off, ms into the scene, and when, by Date.now(). */
      t: number;
      at: number;
      /** That frame, for the next page to paint first. */
      frame: HeldFrame;
      w: number;
      h: number;
      rect: [number, number, number, number];
      /** 1, or faster if it was hurried along. */
      speed: number;
      /** How long the hold lasts from here, wall-clock ms, and how far it eases in. */
      hold: number;
      zoom: number;
    };

export interface ShowOptions {
  scene: Scene<unknown>;
  prep: unknown;
  main: { dots: Dots; parts: Record<string, Dots> };
  /** The coarser mini plate a home-page card shows, handing over to `main`. */
  from?: { dots: Dots; parts: Record<string, Dots> };
  /** Where the card's plate was on screen: left, top, width, height, CSS px. */
  rect: readonly [number, number, number, number];
  /** The viewport the scene is laid out in, CSS px. */
  w: number;
  h: number;
  colors: Colors;
  font: string;
  dark: boolean;
  seed: number;
  /** The camera's push in right now, about the middle of the screen. */
  zoom?: () => number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Dots drawn, as the next page paints them before anything else
 * (landing.ts): colour by colour, a tenth of a pixel or so out at most.
 */
export function frameOf(ops: readonly Op[], w: number, h: number): HeldFrame {
  const out: HeldFrame["ops"] = [];
  for (const op of ops) {
    if (op.xyr.length < 3 || op.alpha < 0.001) continue;
    const xyr = new Array<number>(op.xyr.length - (op.xyr.length % 3));
    for (let i = 0; i < xyr.length; i += 3) {
      xyr[i] = round1(op.xyr[i]);
      xyr[i + 1] = round1(op.xyr[i + 1]);
      xyr[i + 2] = Math.round(op.xyr[i + 2] * 20) / 20;
    }
    out.push([op.color, Math.round(op.alpha * 1000) / 1000, xyr]);
  }
  return { w, h, ops: out };
}

export interface Show {
  run: SceneRun;
  canvas: HTMLCanvasElement;
  /** When the page changes and when it moves on again; see SceneRun. */
  leave: number;
  depart: number;
  draw(t: number): void;
  /** Draw the frame at `t` and return it for the next page (frameOf). */
  held(t: number): HeldFrame;
  /** The big dots the last frame drawn ended on. */
  final(): Extract<Final, { kind: "dots" }>;
  /** The GPU dropped the canvas: the scene can't go on. */
  readonly lost: boolean;
  /** Let go of the canvas's GPU resources and listeners. */
  dispose(): void;
}

/**
 * The page's WebGL renderer, where the GPU runs it; scenes draw on a 2D
 * canvas otherwise. On the dev server `?scene-2d` keeps to the 2D canvas and
 * `?scene-gl` takes WebGL even in software, to compare them.
 */
function gpu(): Renderer | null {
  const asked = import.meta.env.DEV
    ? new URLSearchParams(location.search)
    : null;
  if (asked?.has("scene-2d")) return null;
  return renderer(Boolean(asked?.has("scene-gl")));
}

/** Get the WebGL renderer building its shaders, ahead of any scene. */
export function warmRenderer(): void {
  gpu();
}

/** Wait up to `ms` for the WebGL renderer to be ready; false if it isn't. */
export function rendererReady(ms: number): Promise<boolean> {
  return gpu()?.whenReady(ms) ?? Promise.resolve(false);
}

/** A scene set up to draw any moment of it, on whatever sink it's given. */
export interface Stage {
  run: SceneRun;
  /** When the page changes and when it moves on again; see SceneRun. */
  leave: number;
  depart: number;
  draw(t: number): Look;
  /** Draw the frame at `t` and return it for the next page (frameOf). */
  held(t: number): HeldFrame;
  /** The big dots the last frame drawn ended on. */
  final(): Extract<Final, { kind: "dots" }>;
}

export interface StageOptions extends ShowOptions {
  sink: Sink;
  /** The canvas's size right now, CSS px, and its pixel ratio. */
  size(): { w: number; h: number; dpr: number };
}

/**
 * Set a scene up to draw on `o.sink`. It touches nothing on the page, so it
 * runs the same in a worker (worker.ts) as on the page itself (`show`).
 */
export function stageScene(o: StageOptions): Stage {
  const { w, h, sink } = o;
  const [left, top, width, height] = o.rect;

  const card: Cam = {
    ax: left + width / 2,
    ay: top + height / 2,
    fx: PLATE_W / 2,
    fy: PLATE_H / 2,
    s: width / PLATE_W,
  };
  const stageW = Math.min(0.86 * w, ((0.78 * h) / 3) * 4, 1180);
  const stage: Cam = {
    ax: w / 2,
    ay: h / 2,
    fx: PLATE_W / 2,
    fy: PLATE_H / 2,
    s: stageW / PLATE_W,
  };
  const bigDot = Math.max(22, Math.min(56, 0.05 * Math.min(w, h)));
  const run = o.scene.start(
    {
      dots: o.main.dots,
      parts: o.main.parts,
      r0: median(o.main.dots.r),
      rand: seeded(o.seed),
      dark: o.dark,
      w,
      h,
      lift: (t) => camLerp(card, stage, smootherstep(t / LIFT_MS)),
      stage,
      big: (r) => bigDot / r,
    },
    o.prep,
  );
  const leave = Math.min(run.leave ?? run.duration, run.duration);
  const depart = Math.max(leave, Math.min(run.depart ?? leave, run.duration));

  const pen = new Pen(sink, o.colors);

  function draw(t: number): Look {
    const { w: vw, h: vh, dpr } = o.size();
    // The hold's ease in, about the middle of the screen, on everything.
    sink.frame(vw, vh, dpr, o.zoom?.() ?? 1, smootherstep(t / PAPER_MS));
    const swap = o.from ? smootherstep((t - SWAP_FROM) / SWAP_MS) : 1;
    pen.sources = o.from
      ? [
          { parts: o.from.parts, weight: 1 - swap },
          { parts: o.main.parts, weight: swap },
        ]
      : [{ parts: o.main.parts, weight: 1 }];
    pen.w = vw;
    pen.h = vh;
    pen.recorded = [];
    pen.opacity = 1;
    pen.blur = 0;
    run.draw(t, pen);
    // A blur is softer dots where the sink can do that, and CSS otherwise.
    sink.soften?.(pen.blur);
    sink.flush();
    return { opacity: pen.opacity, blur: sink.soften ? 0 : pen.blur };
  }

  function held(t: number): HeldFrame {
    pen.ops = [];
    try {
      draw(t);
      return frameOf(pen.ops, w, h);
    } finally {
      pen.ops = null;
    }
  }

  function final(): Extract<Final, { kind: "dots" }> {
    let dots = pen.recorded;
    if (dots.length > KEEP * 3) {
      // Keep the dots nearest the middle; the rest are at the edges.
      const order = Array.from({ length: dots.length / 3 }, (_, i) => i).sort(
        (a, b) =>
          Math.hypot(dots[a * 3] - w / 2, dots[a * 3 + 1] - h / 2) -
          Math.hypot(dots[b * 3] - w / 2, dots[b * 3 + 1] - h / 2),
      );
      dots = order
        .slice(0, KEEP)
        .flatMap((i) => [dots[i * 3], dots[i * 3 + 1], dots[i * 3 + 2]]);
    }
    return {
      kind: "dots",
      dots: dots.map((v) => Math.round(v * 10) / 10),
      w,
      h,
      reveal: run.reveal ?? { from: [0.5, 0.5] },
    };
  }

  return { run, leave, depart, draw, held, final };
}

/** Set a scene up on a full-screen canvas on this page, ready to draw any moment of it. */
export function show(o: ShowOptions, className: string): Show {
  const root = document.documentElement;
  // The WebGL canvas if it's ready (it's never waited on here), or a 2D one.
  const gl = gpu();
  const canvas = gl?.ready ? gl.canvas : document.createElement("canvas");
  const labels = pageLabels(o.colors, o.font);
  const sink: Sink = gl?.ready
    ? gl.sink(o.colors, labels)
    : canvasSink(canvas, o.colors, labels);
  canvas.className = className;
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.opacity = "";
  canvas.style.filter = "";

  // The canvas fills the viewport. Its size is read when the window changes
  // size, never while drawing, so a frame never waits on the page's layout.
  const size = { w: root.clientWidth || o.w, h: root.clientHeight || o.h };
  const resized = () => {
    size.w = root.clientWidth;
    size.h = root.clientHeight;
  };
  window.addEventListener("resize", resized);
  const staged = stageScene({
    ...o,
    sink,
    size: () => ({
      ...size,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    }),
  });

  let disposed = false;
  return {
    run: staged.run,
    canvas,
    leave: staged.leave,
    depart: staged.depart,
    draw: (t) => applyLook(canvas, staged.draw(t)),
    held: staged.held,
    final: staged.final,
    get lost() {
      return sink.lost;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("resize", resized);
      sink.dispose();
    },
  };
}

/**
 * A clock that can be hurried: ms since it started, running `HURRY` times
 * faster from whenever `hurry()` was called.
 */
export function clock(speed = 1) {
  const start = performance.now();
  let at = -1;
  let from = 0;
  let rate = speed;
  const now = (when = performance.now()) =>
    at < 0 ? (when - start) * rate : from + (when - at) * rate;
  return {
    now,
    get rate() {
      return rate;
    },
    hurry() {
      if (rate >= HURRY) return;
      const when = performance.now();
      from = now(when);
      at = when;
      rate = HURRY;
    },
  };
}

export interface PlayOptions extends Omit<ShowOptions, "rect" | "w" | "h"> {
  /** The plate on the card, hidden while its dots are on stage. */
  img: HTMLImageElement;
  done(final: Final): void;
  cancelled(): void;
  /** The scene can't go on (the GPU dropped its canvas): just go to the page. */
  failed(): void;
}

interface Debug {
  duration: number;
  leave: number;
  depart: number;
  seek(t: number): void;
  final(): Final;
  /** Change page as the scene would at `leave`. */
  hand(): void;
}

/**
 * Play a scene from the card plate `img`, up to where the page changes.
 * `dispose` takes it down without a word (when the page comes back from the
 * back/forward cache).
 */
export function play(options: PlayOptions): {
  cancel(): void;
  dispose(): void;
} {
  const { img } = options;
  const root = document.documentElement;
  const box = img.getBoundingClientRect();
  const rect: [number, number, number, number] = [
    box.left,
    box.top,
    box.width,
    box.height,
  ];
  const w = root.clientWidth;
  const h = root.clientHeight;
  // The camera's push in starts when the page changes.
  let leftAt = 0;
  const s = show(
    {
      ...options,
      rect,
      w,
      h,
      zoom: () => (leftAt ? pushZoom(Date.now() - leftAt) : 1),
    },
    "open-layer",
  );
  const { canvas } = s;

  const time = clock();
  const handsOver = s.leave < s.run.duration;
  const finish = (): Final => {
    if (!handsOver) return s.final();
    leftAt = Date.now();
    return {
      kind: "scene",
      t: s.leave,
      at: leftAt,
      frame: s.held(s.leave),
      w,
      h,
      rect,
      speed: time.rate,
      hold: PUSH_MS,
      zoom: HOLD_ZOOM,
    };
  };

  let stopped = false;
  let raf = 0;
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      time.hurry();
    }
  };
  const hold = (event: Event) => event.preventDefault();
  const hurry = () => time.hurry();
  const listen = (on: boolean) => {
    const method = on ? "addEventListener" : "removeEventListener";
    window[method]("keydown", onKey as EventListener, true);
    canvas[method]("pointerdown", hurry);
    canvas[method]("wheel", hold, {
      passive: false,
    } as AddEventListenerOptions);
    canvas[method]("touchmove", hold, {
      passive: false,
    } as AddEventListenerOptions);
  };
  /** Take it all down and show the card's plate again. */
  function dispose() {
    stopped = true;
    cancelAnimationFrame(raf);
    listen(false);
    canvas.remove();
    s.dispose();
    img.style.visibility = "";
  }
  function cancel() {
    if (stopped) return;
    dispose();
    options.cancelled();
  }

  document.body.append(canvas);
  img.style.visibility = "hidden";
  listen(true);

  if (
    import.meta.env.DEV &&
    new URLSearchParams(location.search).has("scene-debug")
  ) {
    // Frame by frame from the console or a test: __scene.seek(ms).
    const debug: Debug = {
      duration: s.run.duration,
      leave: s.leave,
      depart: s.depart,
      seek: s.draw,
      final: () => (s.leave < s.run.duration ? finish() : s.final()),
      hand: () => {
        stopped = true;
        listen(false);
        options.done(finish());
      },
    };
    (window as unknown as { __scene?: Debug }).__scene = debug;
    s.draw(0);
    return { cancel, dispose };
  }

  function frame(now: number) {
    if (stopped) return;
    if (s.lost) {
      stopped = true;
      listen(false);
      options.failed();
      return;
    }
    const t = Math.min(s.leave, time.now(now));
    s.draw(t);
    if (t < s.leave) {
      raf = requestAnimationFrame(frame);
      return;
    }
    stopped = true;
    listen(false);
    options.done(finish());
    // Ease into the hold until this page goes; the next page carries on
    // from the same moment.
    if (handsOver) raf = requestAnimationFrame(holding);
  }
  const holding = (now: number) => {
    if (!canvas.isConnected) return;
    s.draw(Math.min(s.depart, time.now(now)));
    raf = requestAnimationFrame(holding);
  };
  raf = requestAnimationFrame(frame);
  return { cancel, dispose };
}

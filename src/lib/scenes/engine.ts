import type { Reveal } from "../landing";
import {
  camLerp,
  camMat,
  type Cam,
  type Dots,
  grow,
  ID,
  type Mat,
  median,
  mul,
  type PartTest,
  PLATE_H,
  PLATE_W,
  type Pt,
  seeded,
  smootherstep,
  toScreen,
} from "./stage";

/**
 * Plays a hobby scene over the page: the card's plate lifts off its card onto
 * a sheet of paper, acts out its little story (src/lib/scenes/*.ts), and ends
 * zoomed into a handful of big ink dots, which the hobby page then opens
 * through (src/lib/landing.ts).
 *
 * A second click, tap, Enter or Space hurries the rest of the scene along;
 * Escape puts the page back.
 */

/** How long the plate takes to rise from its card to the middle of the screen. */
export const LIFT_MS = 450;
/** How long the paper takes to cover the page behind. */
const PAPER_MS = 320;
/** How much faster the rest of a scene plays once you click again. */
const HURRY = 2.8;
/** The mini plate a home-page card shows hands over to the finer card plate. */
const SWAP_FROM = 60;
const SWAP_MS = 300;
/** At most this many dots are handed to the next page. */
const KEEP = 900;

export type { Reveal };

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
  /** Length of the whole scene, ms; it ends on the big dots. */
  duration: number;
  reveal: Reveal;
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

export interface Final {
  /** x, y, radius of each big dot, CSS px, in a flat list. */
  dots: number[];
  w: number;
  h: number;
  reveal: Reveal;
}

export interface PlayOptions {
  scene: Scene<unknown>;
  prep: unknown;
  /** The plate on the card, hidden while its dots are on stage. */
  img: HTMLImageElement;
  main: { dots: Dots; parts: Record<string, Dots> };
  /** The coarser mini plate a home-page card shows, handing over to `main`. */
  from?: { dots: Dots; parts: Record<string, Dots> };
  colors: { ink: string; red: string; paper: string };
  font: string;
  dark: boolean;
  seed: number;
  done(final: Final): void;
  cancelled(): void;
}

let scratch = new Float32Array(3 * 4096);
const bent = new Float64Array(3);

class Pen implements Painter {
  w = 0;
  h = 0;
  recorded: number[] = [];
  sources: Array<{ parts: Record<string, Dots>; weight: number }> = [];
  private m: Mat = ID;
  private c: Cam = { ax: 0, ay: 0, fx: 0, fy: 0, s: 1 };

  constructor(
    private ctx: CanvasRenderingContext2D,
    private colors: PlayOptions["colors"],
    private font: string,
  ) {}

  cam(c: Cam) {
    this.c = c;
    this.m = camMat(c);
  }

  screen(x: number, y: number) {
    return toScreen(this.c, x, y);
  }

  part(name: string, m: Mat = ID, o: DrawOpts = {}) {
    for (const source of this.sources) {
      const d = source.parts[name];
      if (!d || source.weight <= 0.002) continue;
      this.dots(d, m, {
        ...o,
        alpha: (o.alpha ?? 1) * source.weight,
        target: o.target && source.weight > 0.5,
      });
    }
  }

  dots(d: Dots, m: Mat = ID, o: DrawOpts = {}) {
    const alpha = o.alpha ?? 1;
    if (alpha <= 0.003 || !d.n) return;
    const ctx = this.ctx;
    const cam = this.m;
    const M = mul(cam, m);
    const k = grow(M) * (o.size ?? 1);
    const halo = o.pass === "ink" ? 0 : (o.halo ?? 0) * grow(M);
    if (scratch.length < d.n * 3) scratch = new Float32Array(d.n * 3 * 2);
    const out = scratch;
    let count = 0;
    for (let i = 0; i < d.n; i++) {
      let X: number;
      let Y: number;
      let R = d.r[i] * k;
      if (o.warp) {
        const x = m[0] * d.x[i] + m[2] * d.y[i] + m[4];
        const y = m[1] * d.x[i] + m[3] * d.y[i] + m[5];
        bent[0] = x;
        bent[1] = y;
        bent[2] = 1;
        o.warp(x, y, bent);
        X = cam[0] * bent[0] + cam[4];
        Y = cam[3] * bent[1] + cam[5];
        R *= bent[2];
      } else {
        X = M[0] * d.x[i] + M[2] * d.y[i] + M[4];
        Y = M[1] * d.x[i] + M[3] * d.y[i] + M[5];
      }
      const reach = R + halo;
      if (
        R < 0.05 ||
        X < -reach ||
        Y < -reach ||
        X > this.w + reach ||
        Y > this.h + reach
      )
        continue;
      out[count * 3] = X;
      out[count * 3 + 1] = Y;
      out[count * 3 + 2] = R;
      count++;
    }
    if (!count) return;
    ctx.globalAlpha = Math.min(1, alpha);
    if (halo > 0) {
      ctx.fillStyle = this.colors.paper;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const R = out[i * 3 + 2] + halo;
        ctx.moveTo(out[i * 3] + R, out[i * 3 + 1]);
        ctx.arc(out[i * 3], out[i * 3 + 1], R, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    if (o.pass === "halo") {
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = o.color === "red" ? this.colors.red : this.colors.ink;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const R = out[i * 3 + 2];
      ctx.moveTo(out[i * 3] + R, out[i * 3 + 1]);
      ctx.arc(out[i * 3], out[i * 3 + 1], R, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    if (o.target && alpha > 0.5) {
      for (let i = 0; i < count; i++)
        this.recorded.push(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
    }
  }

  line(
    pts: readonly Pt[],
    o: { width: number; alpha?: number; color?: "ink" | "red"; halo?: number },
  ) {
    const alpha = o.alpha ?? 1;
    if (alpha <= 0.003 || pts.length < 2) return;
    const ctx = this.ctx;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.lineCap = "square";
    ctx.lineJoin = "miter";
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const [X, Y] = this.screen(x, y);
      if (i) ctx.lineTo(X, Y);
      else ctx.moveTo(X, Y);
    });
    if (o.halo) {
      ctx.strokeStyle = this.colors.paper;
      ctx.lineWidth = o.width + 2 * o.halo;
      ctx.stroke();
    }
    ctx.strokeStyle = o.color === "red" ? this.colors.red : this.colors.ink;
    ctx.lineWidth = o.width;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  label(
    text: string,
    x: number,
    y: number,
    o: { dx?: number; dy?: number; alpha?: number; color?: "ink" | "red" },
  ) {
    const alpha = o.alpha ?? 1;
    if (alpha <= 0.003) return;
    const ctx = this.ctx;
    const [X, Y] = this.screen(x, y);
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.font = `600 11px ${this.font}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "1.4px";
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";
    ctx.lineWidth = 4;
    ctx.strokeStyle = this.colors.paper;
    ctx.strokeText(text, X + (o.dx ?? 0), Y + (o.dy ?? 0));
    ctx.fillStyle = o.color === "red" ? this.colors.red : this.colors.ink;
    ctx.fillText(text, X + (o.dx ?? 0), Y + (o.dy ?? 0));
    ctx.globalAlpha = 1;
  }
}

interface Debug {
  duration: number;
  seek(t: number): void;
  final(): Final;
}

/**
 * Play a scene from the card plate `img`. `dispose` takes it down without a
 * word (when the page comes back from the back/forward cache).
 */
export function play(options: PlayOptions): {
  cancel(): void;
  dispose(): void;
} {
  const { scene, img, main, from } = options;
  const root = document.documentElement;
  const canvas = document.createElement("canvas");
  canvas.className = "open-layer";
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas.");
  const w = root.clientWidth;
  const h = root.clientHeight;
  const rect = img.getBoundingClientRect();

  const card: Cam = {
    ax: rect.left + rect.width / 2,
    ay: rect.top + rect.height / 2,
    fx: PLATE_W / 2,
    fy: PLATE_H / 2,
    s: rect.width / PLATE_W,
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
  const run = scene.start(
    {
      dots: main.dots,
      parts: main.parts,
      r0: median(main.dots.r),
      rand: seeded(options.seed),
      dark: options.dark,
      w,
      h,
      lift: (t) => camLerp(card, stage, smootherstep(t / LIFT_MS)),
      stage,
      big: (r) => bigDot / r,
    },
    options.prep,
  );

  const pen = new Pen(ctx, options.colors, options.font);
  pen.w = w;
  pen.h = h;

  function draw(t: number) {
    const vw = root.clientWidth;
    const vh = root.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(vw * dpr))
      canvas.width = Math.round(vw * dpr);
    if (canvas.height !== Math.round(vh * dpr))
      canvas.height = Math.round(vh * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.clearRect(0, 0, vw, vh);
    ctx!.globalAlpha = smootherstep(t / PAPER_MS);
    ctx!.fillStyle = options.colors.paper;
    ctx!.fillRect(0, 0, vw, vh);
    ctx!.globalAlpha = 1;
    const swap = from ? smootherstep((t - SWAP_FROM) / SWAP_MS) : 1;
    pen.sources = from
      ? [
          { parts: from.parts, weight: 1 - swap },
          { parts: main.parts, weight: swap },
        ]
      : [{ parts: main.parts, weight: 1 }];
    pen.recorded = [];
    run.draw(t, pen);
  }

  function final(): Final {
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
      dots: dots.map((v) => Math.round(v * 10) / 10),
      w,
      h,
      reveal: run.reveal,
    };
  }

  let stopped = false;
  let raf = 0;
  const start = performance.now();
  let hurriedAt = -1;
  let hurriedFrom = 0;
  const clock = (now: number) =>
    hurriedAt < 0 ? now - start : hurriedFrom + (now - hurriedAt) * HURRY;
  const hurry = () => {
    if (hurriedAt >= 0) return;
    const now = performance.now();
    hurriedFrom = clock(now);
    hurriedAt = now;
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      hurry();
    }
  };
  const hold = (event: Event) => event.preventDefault();
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
    const debug: Debug = { duration: run.duration, seek: draw, final };
    (window as unknown as { __scene?: Debug }).__scene = debug;
    draw(0);
    return { cancel, dispose };
  }

  function frame(now: number) {
    if (stopped) return;
    const t = Math.min(run.duration, clock(now));
    draw(t);
    if (t < run.duration) {
      raf = requestAnimationFrame(frame);
      return;
    }
    stopped = true;
    listen(false);
    options.done(final());
  }
  raf = requestAnimationFrame(frame);
  return { cancel, dispose };
}

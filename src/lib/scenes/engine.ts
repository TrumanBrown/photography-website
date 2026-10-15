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
 * Plays a hobby scene: the card's plate lifts off its card onto a sheet of
 * paper and acts out its little story in its own dots (src/lib/scenes/*.ts).
 *
 * Most scenes end by opening the hobby page themselves: the fish swims off
 * and its ripples wash the paper away, the crab's pinch sends a shockwave
 * through it, and so on. That has to happen over the hobby page, so those
 * scenes change page during a held pose (`leave` to `depart`). The hobby
 * page paints that same frame before anything else, builds the scene again
 * from the same plate and seed, and plays the rest over itself (resume.ts).
 * The globe instead ends zoomed into a few big dots, and the hobby page
 * opens through those (src/lib/landing.ts).
 *
 * A second click, tap, Enter or Space hurries the rest along; Escape puts
 * the page back.
 */

/** How long the plate takes to rise from its card to the middle of the screen. */
export const LIFT_MS = 450;
/** How long the paper takes to cover the page behind. */
const PAPER_MS = 320;
/** How much faster the rest of a scene plays once you click again. */
export const HURRY = 2.8;
/** The mini plate a home-page card shows hands over to the finer card plate. */
const SWAP_FROM = 60;
const SWAP_MS = 300;
/** At most this many big dots are handed to the next page. */
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
      /** Where it left off, ms into the scene. */
      t: number;
      /** That frame, as a CSS background layer, for the next page's first paint. */
      art: string;
      w: number;
      h: number;
      rect: [number, number, number, number];
      /** 1, or faster if it was hurried along. */
      speed: number;
    };

export interface Colors {
  ink: string;
  red: string;
  paper: string;
}

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
}

interface Op {
  color: string;
  alpha: number;
  xyr: number[];
}

let scratch = new Float32Array(3 * 4096);
const bent = new Float64Array(3);

class Pen implements Painter {
  w = 0;
  h = 0;
  recorded: number[] = [];
  /** While set, every dot drawn is noted here too, for the next page's first paint. */
  ops: Op[] | null = null;
  opacity = 1;
  blur = 0;
  sources: Array<{ parts: Record<string, Dots>; weight: number }> = [];
  private m: Mat = ID;
  private c: Cam = { ax: 0, ay: 0, fx: 0, fy: 0, s: 1 };

  constructor(
    private ctx: CanvasRenderingContext2D,
    private colors: Colors,
    private font: string,
  ) {}

  cam(c: Cam) {
    this.c = c;
    this.m = camMat(c);
  }

  screen(x: number, y: number) {
    return toScreen(this.c, x, y);
  }

  look(o: { opacity?: number; blur?: number }) {
    if (o.opacity !== undefined) this.opacity = o.opacity;
    if (o.blur !== undefined) this.blur = o.blur;
  }

  cut(holes: ArrayLike<number>, count = Math.floor(holes.length / 3)) {
    if (!count) return;
    const ctx = this.ctx;
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const r = holes[i * 3 + 2];
      if (r <= 0) continue;
      ctx.moveTo(holes[i * 3] + r, holes[i * 3 + 1]);
      ctx.arc(holes[i * 3], holes[i * 3 + 1], r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
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
    const cam = o.screen ? ID : this.m;
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
    const a = Math.min(1, alpha);
    ctx.globalAlpha = a;
    if (halo > 0) {
      ctx.fillStyle = this.colors.paper;
      ctx.beginPath();
      const noted: number[] | null = this.ops ? [] : null;
      for (let i = 0; i < count; i++) {
        const R = out[i * 3 + 2] + halo;
        ctx.moveTo(out[i * 3] + R, out[i * 3 + 1]);
        ctx.arc(out[i * 3], out[i * 3 + 1], R, 0, Math.PI * 2);
        noted?.push(out[i * 3], out[i * 3 + 1], R);
      }
      ctx.fill();
      if (noted)
        this.ops!.push({ color: this.colors.paper, alpha: a, xyr: noted });
    }
    if (o.pass === "halo") {
      ctx.globalAlpha = 1;
      return;
    }
    const color = o.color === "red" ? this.colors.red : this.colors.ink;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const R = out[i * 3 + 2];
      ctx.moveTo(out[i * 3] + R, out[i * 3 + 1]);
      ctx.arc(out[i * 3], out[i * 3 + 1], R, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    if (this.ops)
      this.ops.push({
        color,
        alpha: a,
        xyr: Array.from(out.subarray(0, count * 3)),
      });
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

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Dots as an SVG CSS background layer, `w` × `h` CSS px from the top left,
 * the way the canvas drew them: a zero-length stroke with round caps is a
 * dot, so dots of one size share a path. Paints before any script runs.
 */
export function svgLayer(ops: readonly Op[], w: number, h: number): string {
  let body = "";
  for (const op of ops) {
    const bySize = new Map<number, string[]>();
    for (let i = 0; i + 2 < op.xyr.length; i += 3) {
      const r = Math.round(op.xyr[i + 2] * 20) / 20;
      let list = bySize.get(r);
      if (!list) bySize.set(r, (list = []));
      list.push(`M${round1(op.xyr[i])} ${round1(op.xyr[i + 1])}h0`);
    }
    let paths = "";
    for (const [r, list] of bySize)
      paths += `<path stroke-width='${round1(r * 2 * 10) / 10}' d='${list.join("")}'/>`;
    const fade = op.alpha < 0.999 ? ` opacity='${op.alpha.toFixed(3)}'` : "";
    body += `<g stroke='${op.color}'${fade}>${paths}</g>`;
  }
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>` +
    `<g fill='none' stroke-linecap='round'>${body}</g></svg>`;
  // Only what would end the URL or the data early needs escaping.
  const data = svg.replace(
    /[%#"<>]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `url("data:image/svg+xml,${data}") 0 0 / ${w}px ${h}px no-repeat`;
}

export interface Show {
  run: SceneRun;
  canvas: HTMLCanvasElement;
  /** When the page changes and when it moves on again; see SceneRun. */
  leave: number;
  depart: number;
  draw(t: number): void;
  /** Draw the frame at `t` and return it as an SVG layer (svgLayer). */
  art(t: number): string;
  /** The big dots the last frame drawn ended on. */
  final(): Extract<Final, { kind: "dots" }>;
}

/** Set a scene up on a full-screen canvas, ready to draw any moment of it. */
export function show(o: ShowOptions, className: string): Show {
  const root = document.documentElement;
  const canvas = document.createElement("canvas");
  canvas.className = className;
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas.");
  const { w, h } = o;
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

  const pen = new Pen(ctx, o.colors, o.font);

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
    ctx!.fillStyle = o.colors.paper;
    ctx!.fillRect(0, 0, vw, vh);
    ctx!.globalAlpha = 1;
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
    const opacity = pen.opacity < 0.999 ? String(Math.max(0, pen.opacity)) : "";
    if (canvas.style.opacity !== opacity) canvas.style.opacity = opacity;
    const filter = pen.blur > 0.05 ? `blur(${pen.blur.toFixed(2)}px)` : "";
    if (canvas.style.filter !== filter) canvas.style.filter = filter;
  }

  function art(t: number): string {
    pen.ops = [];
    try {
      draw(t);
      return svgLayer(pen.ops, w, h);
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

  return { run, canvas, leave, depart, draw, art, final };
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
  const s = show({ ...options, rect, w, h }, "open-layer");
  const { canvas } = s;

  const time = clock();
  const finish = (): Final =>
    s.leave < s.run.duration
      ? {
          kind: "scene",
          t: s.leave,
          art: s.art(s.leave),
          w,
          h,
          rect,
          speed: time.rate,
        }
      : s.final();

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
    const t = Math.min(s.leave, time.now(now));
    s.draw(t);
    if (t < s.leave) {
      raf = requestAnimationFrame(frame);
      return;
    }
    stopped = true;
    listen(false);
    options.done(finish());
  }
  raf = requestAnimationFrame(frame);
  return { cancel, dispose };
}

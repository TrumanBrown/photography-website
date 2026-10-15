import type { DrawOpts, Painter } from "./engine";
import { drawLabel, LABEL_HALO, type LabelArt, type Labeler } from "./label";
import {
  type Cam,
  camMat,
  type Dots,
  grow,
  ID,
  type Mat,
  mul,
  type Pt,
  toScreen,
} from "./stage";

/**
 * Where a Pen's dots, holes, lines and labels end up, in CSS px: a 2D canvas
 * (below) or WebGL (gl.ts). A frame starts with `frame` and ends with
 * `flush`; everything in between draws in order, over what came before.
 */
export interface Sink {
  /** The GPU dropped the canvas: nothing more will draw. */
  readonly lost: boolean;
  /**
   * Size the canvas and clear it to paper at `paper` opacity. `zoom` scales
   * everything after it about the middle of the screen.
   */
  frame(vw: number, vh: number, dpr: number, zoom: number, paper: number): void;
  /** Circles (x, y, r triples), each grown by `grow`, in one colour at one opacity. */
  circles(
    xyr: Float32Array,
    count: number,
    grow: number,
    color: string,
    alpha: number,
  ): void;
  /** Open holes through everything drawn so far: x, y, r triples. */
  erase(holes: ArrayLike<number>, count: number): void;
  /** A pen line through screen points with square ends. */
  line(pts: readonly Pt[], width: number, color: string, alpha: number): void;
  /** A small label, its top left at (x, y), haloed in paper. */
  text(text: string, x: number, y: number, color: string, alpha: number): void;
  /**
   * Soften every dot's edge by `px` CSS px, which reads as the whole sheet
   * blurred, where the sink can do that cheaply (WebGL). Set before `flush`.
   */
  soften?(px: number): void;
  flush(): void;
  dispose(): void;
}

export interface Colors {
  ink: string;
  red: string;
  paper: string;
}

/** A dot noted for the next page's first paint. */
export interface Op {
  color: string;
  alpha: number;
  xyr: number[];
}

let scratch = new Float32Array(3 * 4096);
const bent = new Float64Array(3);

/**
 * Draws a scene: works out where each dot lands on the screen, through the
 * camera, its matrix and any warp, and hands them to a sink.
 */
export class Pen implements Painter {
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
    readonly sink: Sink,
    private colors: Colors,
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
    if (count) this.sink.erase(holes, count);
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
    if (halo > 0) {
      this.sink.circles(out, count, halo, this.colors.paper, a);
      if (this.ops) {
        const noted: number[] = [];
        for (let i = 0; i < count; i++)
          noted.push(out[i * 3], out[i * 3 + 1], out[i * 3 + 2] + halo);
        this.ops.push({ color: this.colors.paper, alpha: a, xyr: noted });
      }
    }
    if (o.pass === "halo") return;
    const color = o.color === "red" ? this.colors.red : this.colors.ink;
    this.sink.circles(out, count, 0, color, a);
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
    const on = pts.map(([x, y]) => this.screen(x, y));
    const a = Math.min(1, alpha);
    if (o.halo) this.sink.line(on, o.width + 2 * o.halo, this.colors.paper, a);
    this.sink.line(
      on,
      o.width,
      o.color === "red" ? this.colors.red : this.colors.ink,
      a,
    );
  }

  label(
    text: string,
    x: number,
    y: number,
    o: { dx?: number; dy?: number; alpha?: number; color?: "ink" | "red" },
  ) {
    const alpha = o.alpha ?? 1;
    if (alpha <= 0.003) return;
    const [X, Y] = this.screen(x, y);
    this.sink.text(
      text,
      X + (o.dx ?? 0),
      Y + (o.dy ?? 0),
      o.color === "red" ? this.colors.red : this.colors.ink,
      Math.min(1, alpha),
    );
  }
}

/** Labels drawn here on the page, each once. */
export function pageLabels(colors: Colors, font: string): Labeler {
  const known = new Map<string, LabelArt | null>();
  return (text, color, dpr) => {
    const key = `${text}|${color}|${dpr}`;
    if (!known.has(key))
      known.set(key, drawLabel(text, color, colors.paper, font, dpr));
    return known.get(key) ?? null;
  };
}

/** A sink drawing on a 2D canvas: the fallback where WebGL isn't there. */
export function canvasSink(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  colors: Colors,
  labels: Labeler,
): Sink {
  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("No 2D canvas.");
  let dpr = 1;
  const disc = (xyr: Float32Array, i: number, grow: number) => {
    const r = xyr[i * 3 + 2] + grow;
    ctx.moveTo(xyr[i * 3] + r, xyr[i * 3 + 1]);
    ctx.arc(xyr[i * 3], xyr[i * 3 + 1], r, 0, Math.PI * 2);
  };
  return {
    lost: false,
    frame(vw, vh, ratio, zoom, paper) {
      dpr = ratio;
      if (canvas.width !== Math.round(vw * dpr))
        canvas.width = Math.round(vw * dpr);
      if (canvas.height !== Math.round(vh * dpr))
        canvas.height = Math.round(vh * dpr);
      const k = dpr * zoom;
      ctx.setTransform(
        k,
        0,
        0,
        k,
        (dpr * (1 - zoom) * vw) / 2,
        (dpr * (1 - zoom) * vh) / 2,
      );
      ctx.clearRect(0, 0, vw, vh);
      ctx.globalAlpha = paper;
      ctx.fillStyle = colors.paper;
      ctx.fillRect(0, 0, vw, vh);
      ctx.globalAlpha = 1;
    },
    circles(xyr, count, grow, color, alpha) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < count; i++) disc(xyr, i, grow);
      ctx.fill();
      ctx.globalAlpha = 1;
    },
    erase(holes, count) {
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
    },
    line(pts, width, color, alpha) {
      ctx.globalAlpha = alpha;
      ctx.lineCap = "square";
      ctx.lineJoin = "miter";
      ctx.beginPath();
      pts.forEach(([x, y], i) => {
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
    text(text, x, y, color, alpha) {
      const art = labels(text, color, dpr);
      if (!art) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(art.image, x - LABEL_HALO, y - LABEL_HALO, art.w, art.h);
      ctx.globalAlpha = 1;
    },
    flush() {},
    dispose() {},
  };
}

import land from "../geo-land.json";
import { defineScene, LIFT_MS } from "./engine";
import {
  backOut,
  closer,
  type Dots,
  dive,
  dotRing,
  easeOut,
  ID,
  lerp,
  type Pt,
  seg,
  seeded,
  smootherstep,
  smoothstep,
} from "./stage";

/**
 * Narrow nature: the globe spins, a red finder box closes in on wherever it
 * stops, and the camera dives into the dots of that spot.
 *
 * The plate's globe hands over to a stipple globe drawn from the site's own
 * coastlines (the same ones the plate was made from), so it can turn.
 */

/** The globe on the plate (stipple-plates' globe_field), card units. */
const G = { x: 440, y: 310, r: 265 };
/** The view the plate was drawn from (subjects.json). */
const VIEW = { lat: 22, lon: -100 };
const LIGHT = (() => {
  const v = [-0.5, 0.55, 0.67];
  const n = Math.hypot(...v);
  return v.map((c) => c / n);
})();
/** Stipple points on the sphere; about a quarter of them show at a time. */
const POINTS = 34000;

const CROSS_FROM = 150;
const SPIN_FROM = LIFT_MS;
const SPIN_MS = 1200;
const SPIN_TO = SPIN_FROM + SPIN_MS;
const FIND_FROM = SPIN_TO - 680;
const LOCK_MS = 180;
const DIVE_FROM = SPIN_TO + LOCK_MS;
const DIVE_MS = 720;
/** Half the finder box once it's locked on, card units. */
const BOX = 44;

interface Prep {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  land: Uint8Array;
  /** A fixed random number per point, for thinning the sea by its light. */
  u: Float32Array;
  isLand(lat: number, lon: number): boolean;
  rim: Dots;
  r: number;
}

function landRaster(): (lat: number, lon: number) => boolean {
  const W = 720;
  const H = 360;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return () => false;
  ctx.fillStyle = "#000";
  // One fill per outline, so overlapping outlines add up rather than cancel.
  for (const ring of land as number[][][]) {
    ctx.beginPath();
    ring.forEach(([lon, lat], i) => {
      const x = ((lon + 180) / 360) * W;
      const y = ((90 - lat) / 180) * H;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  }
  const alpha = ctx.getImageData(0, 0, W, H).data;
  return (lat, lon) => {
    const x = Math.floor(((((lon + 180) % 360) + 360) % 360) * (W / 360));
    const y = Math.max(0, Math.min(H - 1, Math.floor(((90 - lat) / 180) * H)));
    return alpha[(y * W + x) * 4 + 3] > 127;
  };
}

/** A spot well inside some land, away from the poles, so the dive lands on dots. */
function pickTarget(
  isLand: Prep["isLand"],
  rand: () => number,
): { lat: number; lon: number } {
  for (let i = 0; i < 600; i++) {
    const lat = (Math.asin(2 * rand() - 1) * 180) / Math.PI;
    const lon = rand() * 360 - 180;
    if (lat < -45 || lat > 62) continue;
    const inland = [
      [0, 0],
      [2.5, 0],
      [-2.5, 0],
      [0, 2.5],
      [0, -2.5],
    ].every(([a, b]) => isLand(lat + a, lon + b));
    if (inland) return { lat, lon };
  }
  return { lat: 9.9, lon: -84.1 };
}

const fmt = (v: number, pos: string, neg: string) =>
  `${Math.abs(v).toFixed(1)}° ${v >= 0 ? pos : neg}`;

export default defineScene<Prep>({
  parts: [["globe", (x, y) => Math.hypot(x - G.x, y - G.y) < G.r + 7]],

  prepare(_dots, r0) {
    const isLand = landRaster();
    const rand = seeded(7);
    const x = new Float32Array(POINTS);
    const y = new Float32Array(POINTS);
    const z = new Float32Array(POINTS);
    const isLandAt = new Uint8Array(POINTS);
    const u = new Float32Array(POINTS);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const jitter = 0.75 * Math.sqrt((4 * Math.PI) / POINTS);
    for (let i = 0; i < POINTS; i++) {
      // A Fibonacci sphere, nudged so it reads as stipple, not a lattice.
      let py = 1 - (2 * (i + 0.5)) / POINTS;
      const ring = Math.sqrt(1 - py * py);
      let px = Math.cos(i * golden) * ring;
      let pz = Math.sin(i * golden) * ring;
      px += (rand() - 0.5) * jitter;
      py += (rand() - 0.5) * jitter;
      pz += (rand() - 0.5) * jitter;
      const len = Math.hypot(px, py, pz);
      x[i] = px / len;
      y[i] = py / len;
      z[i] = pz / len;
      const lat = (Math.asin(y[i]) * 180) / Math.PI;
      const lon = (Math.atan2(x[i], z[i]) * 180) / Math.PI;
      isLandAt[i] = isLand(lat, lon) ? 1 : 0;
      u[i] = rand();
    }
    return {
      x,
      y,
      z,
      land: isLandAt,
      u,
      isLand,
      rim: dotRing(G.x, G.y, G.r + 0.5, r0 * 0.95, r0 * 1.9, rand),
      r: r0 * 1.08,
    };
  },

  start(ctx, prep) {
    const { w, h, rand, dark } = ctx;
    const target = pickTarget(prep.isLand, rand);
    const d = (((VIEW.lon - target.lon) % 360) + 360) % 360;
    const spin = d < 200 ? d + 360 : d;
    const label = `${fmt(target.lat, "N", "S")} · ${fmt(target.lon, "E", "W")}`;

    const sx = new Float32Array(POINTS);
    const sy = new Float32Array(POINTS);
    const sr = new Float32Array(POINTS);
    const globe: Dots = { x: sx, y: sy, r: sr, n: 0 };
    const deg = Math.PI / 180;

    function project(lat: number, lon: number) {
      const cl = Math.cos(-lon * deg);
      const sl = Math.sin(-lon * deg);
      const ct = Math.cos(lat * deg);
      const st = Math.sin(lat * deg);
      let n = 0;
      for (let i = 0; i < POINTS; i++) {
        const x1 = prep.x[i] * cl + prep.z[i] * sl;
        const z1 = prep.z[i] * cl - prep.x[i] * sl;
        const y2 = prep.y[i] * ct - z1 * st;
        const z2 = prep.y[i] * st + z1 * ct;
        if (z2 <= 0.02) continue;
        const shade = Math.max(
          0,
          x1 * LIGHT[0] + y2 * LIGHT[1] + z2 * LIGHT[2],
        );
        const ink = dark ? shade : 1 - shade;
        if (!prep.land[i] && prep.u[i] > 0.1 + 0.5 * Math.pow(ink, 1.5))
          continue;
        sx[n] = G.x + G.r * x1;
        sy[n] = G.y - G.r * y2;
        sr[n] = prep.r * (prep.land[i] ? 0.86 + 0.32 * ink : 0.8);
        n++;
      }
      globe.n = n;
    }

    // The spin: a quick flick, then a long slow-down onto the target.
    const turn = (t: number) => {
      const u = seg(t, SPIN_FROM, SPIN_TO);
      return easeOut(u, 2.2) * smoothstep(u / 0.1);
    };
    const push = (t: number) =>
      closer(
        ctx.lift(t),
        lerp(1, 1.06, smootherstep(seg(t, SPIN_FROM, DIVE_FROM))),
        G.x,
        G.y,
      );
    const from = push(DIVE_FROM);
    const end = ctx.big(prep.r * 0.98);

    return {
      duration: DIVE_FROM + DIVE_MS,
      reveal: { from: [0.5, 0.5] },
      draw(t, p) {
        const u = seg(t, DIVE_FROM, DIVE_FROM + DIVE_MS);
        p.cam(
          t < DIVE_FROM ? push(t) : dive(from, G.x, G.y, end, u, w / 2, h / 2),
        );

        const k = turn(t);
        const lat = lerp(
          VIEW.lat,
          target.lat,
          smootherstep(seg(t, SPIN_FROM, SPIN_TO)),
        );
        project(lat, VIEW.lon - spin * k);

        const cross = smootherstep(seg(t, CROSS_FROM, LIFT_MS));
        const fade =
          1 - smootherstep(seg(t, DIVE_FROM, DIVE_FROM + DIVE_MS * 0.45));
        p.part("rest", ID, { alpha: fade });
        p.part("globe", ID, { alpha: 1 - cross });
        p.dots(globe, ID, { alpha: cross, target: true });
        p.dots(prep.rim, ID, { alpha: cross * fade });

        // The finder: a red box closing in as the spin runs out, then locking on.
        const find = seg(t, FIND_FROM, SPIN_TO);
        if (find > 0) {
          const lock = seg(t, SPIN_TO, SPIN_TO + LOCK_MS);
          const pulse = 1 - 0.12 * Math.sin(Math.PI * lock);
          const half = lerp(G.r * 1.15, BOX, backOut(find, 1.1)) * pulse;
          const alpha =
            smootherstep(find / 0.25) *
            (1 - smootherstep(seg(t, DIVE_FROM, DIVE_FROM + DIVE_MS * 0.35)));
          const arm = Math.min(half * 0.45, 12 + half * 0.1);
          const box: Pt[][] = [];
          for (const [sxn, syn] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ]) {
            const cx = G.x + sxn * half;
            const cy = G.y + syn * half;
            box.push([
              [cx, cy - syn * arm],
              [cx, cy],
              [cx - sxn * arm, cy],
            ]);
          }
          for (const corner of box)
            p.line(corner, { width: 2.5, color: "red", alpha, halo: 2 });
          const tick = smootherstep(lock / 0.6) * alpha;
          if (tick > 0) {
            const inner = half * lerp(1, 0.45, smootherstep(lock));
            for (const [a, b] of [
              [0, -1],
              [1, 0],
              [0, 1],
              [-1, 0],
            ])
              p.line(
                [
                  [G.x + a * half, G.y + b * half],
                  [G.x + a * inner, G.y + b * inner],
                ],
                { width: 2, color: "red", alpha: tick, halo: 1.5 },
              );
            p.label(label, G.x - half, G.y + half, {
              dy: 9,
              color: "red",
              alpha: tick,
            });
          }
        }
      },
    };
  },
});

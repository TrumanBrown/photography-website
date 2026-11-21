/**
 * The bald eagle that crosses the title screen now and then, drawn in pixels
 * on the name's own grid and colours.
 *
 * Its frames come from public-domain footage of a bald eagle flying side-on
 * (US Fish and Wildlife Service, on Wikimedia Commons, cut by the local
 * scripts-local/prep-welcome-bird.py kept with the mocks), so every wingbeat
 * is a real one at its real speed, with a hand-set head so it reads at sprite
 * size. It flies side-on and always faces
 * the way it goes. Like an eagle flap-gliding, it sinks a little through each
 * glide and the beats that follow lift it back, so its path dips and rises in
 * a slow wave. It flies under the name, in front of the far peaks and behind
 * the trees on either side, which it cuts itself away under (scene.near), and
 * moves with its own depth when the scene does.
 *
 * About 8 s a crossing on a desktop, 6 s on a phone; the first comes `first`
 * ms after it starts, then one every `every` ms (a little random), alternating
 * sides. Pause stops it, and with reduced motion it never flies.
 */
import { clamp } from "./frame";
import type { Scene } from "./scene";
import meta from "./eagle.json";

// Over the valley: nearer than the far peaks, farther than the trees.
const NEAR = 0.45;
// The crossing's speed: tail-to-head lengths a second (a bald eagle cruises
// at 10 to 13 m/s, some 14 to 18 of its lengths; this is the easy end), with
// the length as a fraction of the photo's width.
const LEN = 0.0115;
const SPEED = 14;
// Under the name and above the far range on a desktop (photo fractions); a
// phone flies in the open sky between its top controls and the name.
const BAND = [0.33, 0.405];
// The wave, in body lengths: a glide sinks at SINK a second (about 3.5
// degrees at its speed), the beats climb at CLIMB, and the change eases over
// TAU seconds so the top and bottom of each dip are round. It never strays
// more than HMAX from its line.
const SINK = 0.9;
const CLIMB = 0.55;
const TAU = 0.28;
const HMAX = 1.0;
const BOB = 1.7; // the frames' own per-beat bob, scaled up so it reads
const FADE = 0.14; // seconds into and out of the glide pose

export interface Eagle {
  readonly paused: boolean;
  pause(): void;
  play(): void;
  /** Lands a crossing in progress and waits (the title screen is hidden). */
  rest(): void;
  wake(): void;
}

interface Flight {
  dir: 1 | -1;
  yA: number;
  yB: number;
  arc: number;
  amp: number;
  h: number;
  vh: number;
  hz: number;
  speed: number;
  u: number;
  x: number | null;
  phase: number;
  beats: number;
  want: number;
  glide: number;
  gliding: boolean;
  gl: number;
  sp: number;
  bob: number;
  k: number;
  last: number;
  fitted: boolean;
}

export function createEagle(
  scene: Scene,
  o: {
    /** CSS px per sprite pixel: half a font pixel of the name. */
    unit: () => number;
    /** The name and the controls along the top, for a phone's open sky. */
    name: HTMLElement;
    topControls: () => HTMLElement[];
    first: number;
    every: number;
  },
): Eagle {
  const cv = scene.bird;
  const ctx = cv.getContext("2d")!;
  let sheet: HTMLImageElement | null = null;
  let flight: Flight | null = null;
  let timer = 0;
  let dpr = 1;
  let crossings = 0;
  let side = 0;
  let paused = false;
  let asleep = !scene.active;
  const firstDir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;

  // The canvas is a small square that travels with the eagle (by transform),
  // not the whole screen: when it changes, only the glass it passes under has
  // to redraw.
  cv.style.width = cv.style.height = "0px";
  cv.style.visibility = "hidden";
  cv.style.willChange = "transform";

  function fit(k: number): void {
    const [ax, ay] = meta.anchor;
    const [bw, bh] = meta.box;
    const reach = Math.max(ax, bw - ax, ay, bh - ay) * k;
    let n = Math.ceil(reach * 2.3) + 8;
    n += n % 2; // even, so its middle is a whole pixel
    if (n !== side) {
      side = n;
      cv.width = cv.height = n;
      cv.style.width = cv.style.height = `${n / dpr}px`;
    }
  }
  function schedule(ms: number): void {
    window.clearTimeout(timer);
    if (paused || asleep) return;
    timer = window.setTimeout(launch, ms);
  }
  const pixelK = (): number => Math.max(2, Math.round(o.unit() * dpr));
  const drawnLen = (): number => (pixelK() / dpr) * meta.length;

  /** On a phone, the open sky between the top controls and the name. */
  function phoneSky(): [number, number] {
    const bottom = o.name.getBoundingClientRect().top;
    let top = 0;
    for (const el of o.topControls()) {
      const r = el.getBoundingClientRect();
      if (r.height && r.bottom < bottom) top = Math.max(top, r.bottom);
    }
    const len = drawnLen();
    let a = top + 12 + len;
    let b = bottom - 8 - len;
    if (b < a) a = b = (top + bottom) / 2;
    return [scene.fy(a), scene.fy(b)];
  }

  /** A crossing: which way, how high, and its rhythm of beats and glides. */
  function plan(): Flight {
    const g = scene.geo;
    let band: number[];
    if (g.kind === "tall") band = phoneSky();
    else {
      band = BAND;
      // Never so high that its body goes behind the name (a raised wing may).
      const below = scene.fy(
        o.name.getBoundingClientRect().bottom + 0.45 * drawnLen(),
      );
      if (below > band[0]) band = [Math.min(below, band[1] - 0.012), band[1]];
    }
    const dir: 1 | -1 =
      crossings++ % 2 === 0 ? firstDir : firstDir === 1 ? -1 : 1;
    // Its line is the top of the wave (the glides dip below it), chosen with
    // room underneath; where there isn't much, the wave is shallower.
    const lenF = (drawnLen() * Math.abs(scene.fy(100) - scene.fy(0))) / 100;
    const hi = Math.max(band[0], band[1] - HMAX * lenF);
    const yA = band[0] + Math.random() * (hi - band[0]);
    const yB = clamp(yA + (Math.random() - 0.5) * 0.02, band[0], hi);
    const amp =
      clamp((band[1] - Math.max(yA, yB)) / lenF + 0.35, 0.35, HMAX) / HMAX;
    return {
      dir,
      yA,
      yB,
      arc: -(0.002 + Math.random() * 0.005), // a little higher in the middle
      amp,
      h: (Math.random() - 0.5) * 0.2 * amp, // off its line, in body lengths (+ is down)
      vh: 0,
      hz: meta.hz * (0.95 + Math.random() * 0.1),
      speed:
        SPEED * (0.9 + Math.random() * 0.2) * (g.kind === "tall" ? 0.7 : 1),
      u: 0,
      x: null,
      phase: (meta.level + 0.5) / meta.cycle.length, // from level wings
      beats: 0,
      want: 2 + Math.floor(Math.random() * 3), // beats before the first glide
      glide: 0,
      gliding: false,
      gl: 0,
      sp: 1,
      bob: 0,
      k: pixelK(), // device pixels per sprite pixel, fixed for the crossing
      last: 0,
      fitted: false,
    };
  }

  function launch(): void {
    if (paused || asleep || document.hidden || !sheet || !scene.active) {
      schedule(4000);
      return;
    }
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    flight = plan();
    scene.keepAlive++;
    scene.kick();
  }
  function land(next = true): void {
    if (flight) scene.keepAlive = Math.max(0, scene.keepAlive - 1);
    flight = null;
    ctx.clearRect(0, 0, cv.width, cv.height);
    cv.style.visibility = "hidden";
    if (next) schedule(o.every * (0.85 + Math.random() * 0.4));
  }

  // Whole beats, then a glide that starts and ends on level wings.
  function wing(f: Flight, dt: number): number {
    const n = meta.cycle.length;
    const levelP = (meta.level + 0.5) / n;
    if (f.gliding) {
      f.glide -= dt;
      // It flaps again when the glide is over, or sooner if it sank well below its line.
      if (f.glide <= 0 || f.h > 0.78 * HMAX * f.amp) {
        f.gliding = false;
        f.beats = 0;
        f.want = 3 + Math.floor(Math.random() * 3);
      }
      return meta.level;
    }
    const before = f.phase;
    f.phase += dt * f.hz;
    // A beat ends each time the cycle comes back round to level wings.
    if (Math.floor(f.phase - levelP) > Math.floor(before - levelP)) {
      f.beats++;
      // Glide once it has had its beats and climbed back near its line.
      const climbed = f.h < 0.22 * f.amp || f.beats >= 7;
      if (f.beats >= f.want && climbed && f.u < 0.82) {
        f.gliding = true;
        f.glide = 1.0 + Math.random() * 0.9;
        f.phase = Math.floor(f.phase - levelP) + levelP; // rest on level wings
        return meta.level;
      }
    }
    return Math.floor((((f.phase % 1) + 1) % 1) * n) % n;
  }

  function draw(now: number): void {
    const f = flight;
    if (!f || !sheet) return;
    const dt = f.last ? Math.min(0.05, (now - f.last) / 1000) : 0;
    f.last = now;
    const g = scene.geo;
    const len = LEN * (g.kind === "tall" ? 1.25 : 1); // a phone shows less sky
    const scaleD = 1 - 0.14 * f.u; // heading a little away as it crosses
    const lenPx = (f.k / dpr) * meta.length;
    const margin = lenPx * 3;
    const x0 = scene.fx(f.dir > 0 ? -margin : g.vw + margin);
    const x1 = scene.fx(f.dir > 0 ? g.vw + margin : -margin);
    if (f.x == null) f.x = x0;
    const ci = wing(f, dt);
    f.gl = clamp(f.gl + ((f.gliding ? 1 : -1) * dt) / FADE, 0, 1);
    const surge = f.gliding
      ? 0
      : 0.05 * Math.cos(2 * Math.PI * (f.phase - 0.3));
    f.sp += ((f.gliding ? 0.95 : 1.03) + surge - f.sp) * Math.min(1, dt * 6);
    f.x += f.dir * f.speed * f.sp * len * scaleD * dt;
    // Sinking through a glide, climbing on the beats (harder the lower it is),
    // level when flapping above its line, eased so it never turns sharply.
    let want = f.gliding
      ? SINK * f.amp
      : Math.min(0, -(CLIMB * f.amp + 0.9 * f.h));
    want = clamp(want, -0.9, SINK);
    f.vh += (want - f.vh) * (1 - Math.exp(-dt / TAU));
    f.h = clamp(f.h + f.vh * dt, -HMAX * f.amp, HMAX * f.amp);
    f.u = clamp((f.x - x0) / (x1 - x0), 0, 1);
    if ((f.dir > 0 && f.x >= x1) || (f.dir < 0 && f.x <= x1)) {
      land();
      return;
    }
    const fy = f.yA + (f.yB - f.yA) * f.u + f.arc * 4 * f.u * (1 - f.u);
    const p = scene.pt(f.x, fy);
    const at = scene.off(NEAR);
    // The body rides up and down with the beat and settles in the glide.
    const bobT = meta.bob[meta.cycle[ci]] * BOB * (1 - f.gl);
    f.bob += (bobT - f.bob) * Math.min(1, dt * 20);
    let X = (p.x + at.x) * dpr;
    let Y = (p.y + at.y + f.h * lenPx) * dpr + f.bob * f.k;
    const [bw, bh] = meta.box;
    const [ax, ay] = meta.anchor;
    const A = meta.cycle[ci];
    // Sized once a crossing, at its start.
    if (!f.fitted) {
      fit(f.k);
      f.fitted = true;
    }
    ctx.clearRect(0, 0, cv.width, cv.height);
    const c = side / 2;
    // Hard pixels: a whole number of screen pixels per sprite pixel, on its
    // grid, with the glide pose swapped in halfway through the fade.
    X = Math.round(X / f.k) * f.k;
    Y = Math.round(Y / f.k) * f.k;
    const rx = Math.round(X - c);
    const ry = Math.round(Y - c);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(c, c);
    ctx.scale(f.dir * f.k, f.k);
    const frame = f.gl > 0.5 ? meta.glide : A;
    ctx.drawImage(
      sheet,
      frame * bw,
      0,
      bw,
      bh,
      -Math.round(ax),
      -Math.round(ay),
      bw,
      bh,
    );
    ctx.restore();
    // Behind the trees on either side: cut away wherever the near land
    // (moving with those trees) covers this square.
    const nr = scene.near;
    if (nr && nr.kind === g.kind) {
      const nb = scene.nearBox();
      const sx = ((rx / dpr - nb.x) / nb.w) * nr.w;
      const sy = ((ry / dpr - nb.y) / nb.h) * nr.h;
      const sw = (side / dpr / nb.w) * nr.w;
      const sh = (side / dpr / nb.h) * nr.h;
      if (sx < nr.w && sy < nr.h && sx + sw > 0 && sy + sh > 0) {
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(nr.img, sx, sy, sw, sh, 0, 0, side, side);
        ctx.restore();
      }
    }
    // Whole device pixels, so the pixel look stays sharp.
    cv.style.transform = `translate3d(${rx / dpr}px,${ry / dpr}px,0)`;
    cv.style.visibility = "visible";
  }
  scene.onFrame((_st, _dt, now) => {
    if (flight) draw(now);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && flight) land();
  });

  // Its frames load once the photo has painted, so on a slow line they never
  // compete with it; the first crossing still comes `first` ms after the start.
  const t0 = performance.now();
  void scene.ready.then(() => {
    const im = new Image();
    im.decoding = "async";
    im.onload = () => {
      sheet = im;
      schedule(Math.max(600, o.first - (performance.now() - t0)));
    };
    im.onerror = () => console.warn("Title eagle frames");
    im.src = meta.src;
  });

  return {
    get paused() {
      return paused;
    },
    pause() {
      paused = true;
      window.clearTimeout(timer);
      land(false);
    },
    play() {
      paused = false;
      schedule(900);
    },
    rest() {
      asleep = true;
      window.clearTimeout(timer);
      land(false);
    },
    wake() {
      if (!asleep) return;
      asleep = false;
      schedule(o.first);
    },
  };
}

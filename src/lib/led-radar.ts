/**
 * The live LED radar beside balcFlights-LED on the front door's Weekdays side
 * (src/components/about/Projects.astro). It fetches the same public flight
 * API my panel reads (seattlebalc.com, a friend's site, so the page credits
 * it in words but doesn't link it) and draws the panel's radar on a 64 × 64
 * grid of LEDs: the nearest plane's callsign, its type, altitude,
 * speed and climb, and every plane in range with a sweep passing over them.
 *
 * Nothing loads until the panel is on screen. It asks for new data every 20
 * seconds while it's visible (the API caches for 20 seconds and asks not to
 * be polled harder), moves the planes along their headings in between, and
 * stops when it's off screen, the tab is hidden or someone presses Pause.
 * Under reduced motion there's no sweep: the planes are drawn still and
 * redrawn when new data arrives.
 */
import { prefersReducedMotion } from "./motion";
import {
  advance,
  afterglow,
  BLINK_DUTY,
  COLORS,
  dashedCircle,
  describe,
  dim,
  fitText,
  FLIGHTS_URL,
  layout,
  PANEL,
  radarPoint,
  readRadar,
  readSnapshot,
  type Reading,
  type Rgb,
  type Snapshot,
  SWEEP_ALPHA,
  SWEEP_DEG_PER_S,
  SWEEP_TAIL,
  SWEEP_TAIL_DEG,
  textPixels,
  textWidth,
  TRAIL_ALPHA,
  TRAIL_FALLOFF,
  TRAIL_POINTS,
} from "./radar";

const POLL_MS = 20_000;
const TRAIL_EVERY_MS = 3_000;
const FRAME_MS = 50;
/** Within this, the distance shows in the panel's "overhead" orange. */
const OVERHEAD_NM = 1;
const LED_OFF = "#1a1917";
const PANEL_BG = "#0b0b0a";

type Pixels = Map<number, Rgb>;
const key = (x: number, y: number) => y * PANEL + x;

function put(px: Pixels, x: number, y: number, color: Rgb): void {
  if (x < 0 || y < 0 || x >= PANEL || y >= PANEL) return;
  px.set(key(x, y), color);
}

/** One frame of the panel as lit pixels, in the order the panel draws them. */
function frame(
  reading: Reading | null,
  rangeNm: number,
  state: {
    message: string | null;
    stale: boolean;
    sweep: number | null;
    seconds: number;
    trail: Array<[number, number]>;
  },
): Pixels {
  const px: Pixels = new Map();
  const near = reading?.nearest ?? null;
  const label = state.message ?? near?.label ?? "NO PLANES";
  const l = layout(label);
  const textColor = state.stale || state.message ? COLORS.stale : COLORS.text;
  for (const [x, y] of textPixels(
    fitText(label, PANEL - 2, l.labelScale),
    1,
    0,
    l.labelScale,
  ))
    put(px, x, y, textColor);

  if (near) {
    const trailing: Array<[string, Rgb]> = [
      [near.compass, COLORS.label],
      [
        near.distance,
        near.distanceNm < OVERHEAD_NM ? COLORS.overhead : COLORS.target,
      ],
    ];
    l.rows.forEach((top, i) => {
      const [text, color] = trailing[i];
      const left = PANEL - 1 - textWidth(text);
      for (const [x, y] of textPixels(text, left, top)) put(px, x, y, color);
      const line = fitText(near.detail[i], left - 2);
      const lineColor = i ? COLORS.trend[near.trend] : COLORS.detail;
      for (const [x, y] of textPixels(line, 1, top)) put(px, x, y, lineColor);
    });
  }

  const { center, radius } = l;
  for (const [x, y] of dashedCircle(center, Math.round(radius * 0.5)))
    put(px, x, y, COLORS.ring);
  for (const [x, y] of dashedCircle(center, Math.round(radius * 0.9)))
    put(px, x, y, COLORS.ringOuter);
  for (const [x, y] of [
    [center[0], center[1] - radius],
    [center[0], center[1] + radius],
    [center[0] - radius, center[1]],
    [center[0] + radius, center[1]],
  ])
    put(px, x, y, COLORS.ring);

  if (state.sweep !== null) {
    for (let i = SWEEP_TAIL - 1; i >= 0; i--) {
      const a = ((state.sweep - i * SWEEP_TAIL_DEG) * Math.PI) / 180;
      const fade = ((1 - i / SWEEP_TAIL) * 0.9 + 0.06) * SWEEP_ALPHA;
      const color = dim(COLORS.sweep, fade);
      for (let r = 0; r <= radius; r += 0.5)
        put(
          px,
          Math.round(center[0] + Math.sin(a) * r),
          Math.round(center[1] - Math.cos(a) * r),
          color,
        );
    }
  }
  put(px, center[0], center[1], COLORS.origin);

  for (const contact of reading?.contacts ?? []) {
    const base = COLORS.trend[contact.trend];
    const glow =
      state.sweep === null ? 1 : afterglow(state.sweep, contact.bearing);
    if (contact.nearest) {
      state.trail.forEach(([distance, bearing], i) => {
        const fade = glow * (TRAIL_ALPHA - i * TRAIL_FALLOFF);
        const p = radarPoint(distance, bearing, rangeNm, l);
        if (p && fade > 0) put(px, p[0], p[1], dim(base, fade));
      });
    }
    const p = radarPoint(contact.distanceNm, contact.bearing, rangeNm, l);
    if (!p) continue;
    const [x, y] = p;
    const color = dim(base, glow);
    put(px, x, y, color);
    if (contact.nearest) {
      put(px, x + 1, y, color);
      put(px, x, y + 1, color);
      put(px, x + 1, y + 1, color);
      const lit = state.sweep === null || state.seconds % 1 < BLINK_DUTY;
      const marker = dim(COLORS.target, lit ? 1 : 0.25);
      put(px, x, y - 2, marker);
      put(px, x, y + 3, marker);
      put(px, x - 2, y, marker);
      put(px, x + 3, y, marker);
    }
  }
  return px;
}

export function initLedRadar(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>("canvas");
  const says = root.querySelector<HTMLElement>("[data-radar-says]");
  const pause = root.querySelector<HTMLButtonElement>("[data-radar-pause]");
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;

  let snapshot: Snapshot | null = null;
  let failed = false;
  let paused = false;
  let onScreen = false;
  let raf = 0;
  let poller = 0;
  let last = 0;
  let lastDraw = 0;
  let sweep = 0;
  let seconds = 0;
  let trail: Array<[number, number]> = [];
  let trailFor = "";
  let lastTrail = 0;
  let grid: HTMLCanvasElement | null = null;
  let size = 0;

  /** The dark LEDs, drawn once per size so a frame only paints the lit ones. */
  function resize(): number {
    const css = canvas!.clientWidth || 320;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(css * dpr);
    if (px === size && grid) return px;
    size = px;
    canvas!.width = px;
    canvas!.height = px;
    grid = document.createElement("canvas");
    grid.width = px;
    grid.height = px;
    const g = grid.getContext("2d")!;
    g.fillStyle = PANEL_BG;
    g.fillRect(0, 0, px, px);
    const cell = px / PANEL;
    g.fillStyle = LED_OFF;
    for (let y = 0; y < PANEL; y++)
      for (let x = 0; x < PANEL; x++) {
        g.beginPath();
        g.arc((x + 0.5) * cell, (y + 0.5) * cell, cell * 0.36, 0, Math.PI * 2);
        g.fill();
      }
    return px;
  }

  function reading(): Reading | null {
    if (!snapshot) return null;
    const ahead = prefersReducedMotion()
      ? 0
      : (Date.now() - snapshot.at) / 1000;
    return readRadar(
      snapshot,
      snapshot.flights.map((f) => advance(f, ahead)),
    );
  }

  function draw(still: boolean): void {
    const px = resize();
    const cell = px / PANEL;
    const r = reading();
    const near = r?.nearest ?? null;
    if (near && near.label !== trailFor) {
      trail = [];
      trailFor = near.label;
    }
    if (near && performance.now() - lastTrail > TRAIL_EVERY_MS && !still) {
      trail.unshift([near.distanceNm, near.bearing]);
      trail = trail.slice(0, TRAIL_POINTS);
      lastTrail = performance.now();
    }
    const message = snapshot ? null : failed ? "NO DATA" : "LOADING";
    const lit = frame(r, snapshot?.rangeNm ?? 16, {
      message,
      stale: failed || snapshot?.status === "degraded",
      sweep: still ? null : sweep,
      seconds,
      trail: still ? [] : trail.slice(1),
    });
    ctx!.drawImage(grid!, 0, 0);
    for (const [k, [red, green, blue]] of lit) {
      const x = k % PANEL;
      const y = Math.floor(k / PANEL);
      ctx!.fillStyle = `rgb(${red} ${green} ${blue})`;
      ctx!.beginPath();
      ctx!.arc((x + 0.5) * cell, (y + 0.5) * cell, cell * 0.4, 0, Math.PI * 2);
      ctx!.fill();
    }
  }

  function tell(): void {
    const r = reading();
    const text = snapshot
      ? describe(r!, snapshot.rangeNm)
      : failed
        ? "No flight data right now. The panel tries again in a moment."
        : "Looking for planes over Seattle...";
    if (says) says.textContent = text;
    canvas!.setAttribute(
      "aria-label",
      `A 64 by 64 LED radar of the planes over Seattle. ${text}`,
    );
  }

  async function fetchFlights(): Promise<void> {
    try {
      const res = await fetch(FLIGHTS_URL, {
        signal: AbortSignal.timeout(8000),
        credentials: "omit",
      });
      if (!res.ok) throw new Error(String(res.status));
      snapshot = readSnapshot(await res.json());
      failed = false;
    } catch {
      failed = true;
    }
    tell();
    if (prefersReducedMotion() || paused) draw(true);
  }

  function tick(now: number): void {
    const dt = last ? Math.min(now - last, 100) / 1000 : 0;
    last = now;
    sweep = (sweep + SWEEP_DEG_PER_S * dt) % 360;
    seconds += dt;
    if (now - lastDraw >= FRAME_MS) {
      draw(false);
      lastDraw = now;
    }
    raf = requestAnimationFrame(tick);
  }

  function running(): boolean {
    return onScreen && !paused && !document.hidden;
  }

  function sync(): void {
    const go = running();
    if (go && !poller) {
      void fetchFlights();
      poller = window.setInterval(() => void fetchFlights(), POLL_MS);
    } else if (!go && poller) {
      window.clearInterval(poller);
      poller = 0;
    }
    const animate = go && !prefersReducedMotion();
    if (animate && !raf) {
      last = 0;
      raf = requestAnimationFrame(tick);
    } else if (!animate && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      draw(true);
    }
  }

  if (prefersReducedMotion() && pause) pause.hidden = true;
  pause?.addEventListener("click", () => {
    paused = !paused;
    pause.textContent = paused ? "Play" : "Pause";
    sync();
  });
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("resize", () => {
    if (!raf) draw(true);
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      sync();
    }).observe(root);
  } else {
    onScreen = true;
    sync();
  }
  tell();
  draw(true);
}

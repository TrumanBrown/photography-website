/**
 * Fishing map interactive — the island for the Fishing hobby.
 *
 * Renders pixel maps of Minnesota + Washington from the baked masks in
 * fishing-geo.json (land/lake/river/sound), draws each named water as a small
 * clickable fish sprite (its signature species), shimmers the water, and opens a
 * species panel when you tap a water. The same sprites (fishing-sprites.ts) are
 * drawn into the catch-gallery thumbnails. Self-contained: all geometry + data
 * are baked/committed, no runtime fetch. Pauses offscreen / honors reduced motion.
 *
 * The pixel art keeps its own land and water colours, a step darker in dark
 * mode, and sits on the page's paper: the canvas leaves everything outside the
 * state clear. What goes on top of the art follows the page: the Twin Cities
 * box is a 1px ink rule with a tracked caption, names sit on paper tags in
 * Libre Franklin 400, and the only ring is round the fish the arrow keys are on.
 *
 * Mounted by src/components/hobbies/Fishing.astro via [data-fish-*] hooks.
 */
import { canvasFont, canvasFontIsReady, canvasFontReady } from '../canvas-font';
import { covered, whenUncovered } from '../covered';
import geo from './fishing-geo.json';
import watersJson from './fishing-waters.json';
import { FISH_BY_ID, type FishSpecies } from './fishing-species';
import { drawFish } from './fishing-sprites';
import {
  aimLeap,
  createAirLayer,
  leapAt,
  planLeap,
  plungeTime,
  ringAt,
  ringPixels,
  riseAt,
  splashDrops,
  dropAt,
  surfaceAt,
  RISE,
  SURFACE,
  UNDER,
  type Drop,
  type LeapPlan,
  type Ring,
} from './fishing-leap';

interface Marker { id: string; fx: number; fy: number; }
interface StateGeo { name: string; gw: number; gh: number; H: number; cells: string; markers: Marker[]; inset?: { x: number; y: number; w: number; h: number }; }
interface Water { id: string; state: string; name: string; kind: string; r: number; species: string[]; }

const INSET_KEYS = ((geo as unknown as { insets?: Record<string, StateGeo> }).insets ?? {}) as Record<string, StateGeo>;
const REGIONS = { ...(geo.states as unknown as Record<string, StateGeo>), ...INSET_KEYS } as Record<string, StateGeo>;
const WATERS = Object.fromEntries(
  (watersJson.waters as unknown as Water[]).map((w) => [w.id, w]),
) as Record<string, Water>;

const BAKE = 3; // art px per map cell; the art is scaled onto the screen with smoothing off
type Pal = { land: string; land2: string; edge: string; lake: string; lake2: string; river: string; sound: string };
// The maps' own pixel colours. Dark mode takes them a step down so the land
// doesn't glow on the dark page.
const LIGHT: Pal = {
  land: '#869a6a', land2: '#90a274', edge: '#6c7f55',
  lake: '#4f9fc4', lake2: '#82c2da', river: '#5aa6cc', sound: '#3f86b0',
};
const DARK: Pal = {
  land: '#6b7b55', land2: '#73825d', edge: '#566644',
  lake: '#3f7f9d', lake2: '#689bae', river: '#4885a3', sound: '#326b8d',
};
const KIND_LABEL: Record<string, string> = { lake: 'Lake', river: 'River / stream', sound: 'Saltwater' };

/** The page tokens for what's drawn on top of the art. */
type Ink = { paper: string; ink: string; ink2: string };
type Theme = { pal: Pal; ink: Ink; key: string };
function readTheme(): Theme {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const ink = { paper: get('--paper', '#fbfaf8'), ink: get('--ink', '#16150f'), ink2: get('--ink-2', '#706c63') };
  const dark = document.documentElement.classList.contains('dark');
  return { pal: dark ? DARK : LIGHT, ink, key: `${dark}${ink.paper}${ink.ink}${ink.ink2}` };
}

type Ctx = CanvasRenderingContext2D;

export function initFishing(root: HTMLElement): void {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const panel = root.querySelector<HTMLElement>('[data-fish-panel]');
  const pTitle = root.querySelector<HTMLElement>('[data-fish-panel-title]');
  const pKind = root.querySelector<HTMLElement>('[data-fish-panel-kind]');
  const pList = root.querySelector<HTMLElement>('[data-fish-panel-list]');
  const pClose = root.querySelector<HTMLButtonElement>('[data-fish-panel-close]');

  function speciesRow(f: FishSpecies): HTMLElement {
    const row = document.createElement('div');
    row.className = 'flex items-start gap-3';
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 38;
    cv.className = 'shrink-0 bg-band';
    cv.style.width = '64px'; cv.style.height = '38px'; cv.style.imageRendering = 'pixelated';
    const c = cv.getContext('2d');
    if (c) { c.imageSmoothingEnabled = false; drawFish(c, f.category, 32, 20, 2.3, f.color, f.accent, -1); }
    const txt = document.createElement('div');
    txt.className = 'min-w-0';
    const nm = document.createElement('div');
    nm.className = 'text-sm leading-tight text-ink';
    nm.textContent = f.common;
    const nt = document.createElement('div');
    nt.className = 'mt-0.5 text-xs text-ink-3';
    nt.textContent = f.note;
    txt.append(nm, nt);
    row.append(cv, txt);
    return row;
  }

  // The panel is a modal: Escape or the scrim closes it and focus goes back.
  let returnFocus: HTMLElement | null = null;
  function openPanel(waterId: string): void {
    const w = WATERS[waterId];
    if (!w || !panel || !pTitle || !pKind || !pList) return;
    pTitle.textContent = w.name;
    pKind.textContent = `${KIND_LABEL[w.kind] ?? ''} · ${w.species.length} species`;
    pList.replaceChildren();
    for (const id of w.species) {
      const f = FISH_BY_ID[id];
      if (f) pList.appendChild(speciesRow(f));
    }
    const opening = !panel.classList.contains('is-open');
    if (opening) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    panel.classList.add('is-open');
    // A short fade, so the splash the fish just made shows through for a beat.
    if (opening && !reduce) panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'cubic-bezier(.4, 0, .2, 1)' });
    pClose?.focus({ preventScroll: true });
  }

  // A tap sends the fish up, and its panel opens as it goes back in. Taps
  // before then each send their own fish, and the panel goes to the newest:
  // a second tap on a fish still in the air just keeps it as the one. The
  // panel waits for whichever fish was tapped last, so a run of taps across
  // the map is a run of leaps, then one panel.
  let pending = 0;
  function pick(waterId: string, waitMs: number, canvas: HTMLCanvasElement): void {
    clearTimeout(pending);
    pending = 0;
    if (waitMs <= 0) {
      openPanel(waterId);
      return;
    }
    pending = window.setTimeout(() => {
      pending = 0;
      // The phone's tabs may have hidden that map in the meantime.
      if (canvas.offsetParent !== null) openPanel(waterId);
    }, waitMs);
  }
  function closePanel(): void {
    if (!panel?.classList.contains('is-open')) return;
    panel.classList.remove('is-open');
    returnFocus?.focus({ preventScroll: true });
    returnFocus = null;
  }
  pClose?.addEventListener('click', closePanel);
  panel?.addEventListener('click', (e) => { if (e.target === panel) closePanel(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });

  // map views
  const live = root.querySelector<HTMLElement>('[data-fish-live]');
  const announce = (text: string) => {
    if (live) live.textContent = text;
  };
  let theme = readTheme();
  const views: Array<ReturnType<typeof makeView>> = [];
  // Fish in the air and their drops, over every map at once.
  const air = createAirLayer((c, dpr, now) => {
    let busy = false;
    for (const v of views) if (v.drawAir(c, dpr, now)) busy = true;
    return busy;
  });
  root.querySelectorAll<HTMLCanvasElement>('[data-fish-canvas]').forEach((cv) => {
    const key = cv.dataset.fishCanvas ?? '';
    if (REGIONS[key])
      views.push(
        makeView(key, cv, (id, ms) => pick(id, ms, cv), reduce, key in INSET_KEYS, announce, () => theme, air.wake),
      );
  });
  const paintAll = () => {
    const now = performance.now();
    for (const v of views) v.frame(now);
  };

  // Sharp at any width: each canvas matches its box in device pixels. The
  // phone's hidden state has no width until its tab shows it, and showing it
  // always repaints, since with reduced motion no loop would catch a theme
  // that changed while it was hidden. A hidden canvas skips the paint.
  const ro = new ResizeObserver(() => {
    const now = performance.now();
    for (const v of views) {
      v.fit();
      v.frame(now);
    }
  });
  for (const v of views) ro.observe(v.canvas);

  // The theme toggle swaps a class on <html>: rebake the art in the other
  // theme's colours and redraw what sits on top of it.
  new MutationObserver(() => {
    const next = readTheme();
    if (next.key === theme.key) return;
    theme = next;
    for (const v of views) v.retheme();
    paintAll();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  // The names wait for Libre Franklin, then every map draws again with them.
  void canvasFontReady().then(paintAll);

  // mobile MN/WA toggle
  root.querySelectorAll<HTMLButtonElement>('[data-fish-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.fishTab;
      root.querySelectorAll<HTMLElement>('[data-fish-map]').forEach((m) => m.classList.toggle('is-active', m.dataset.fishMap === key));
      root.querySelectorAll<HTMLElement>('[data-fish-tab]').forEach((b) => {
        b.setAttribute('aria-checked', String(b === btn));
      });
    });
  });

  // catch-gallery sprite thumbnails
  root.querySelectorAll<HTMLCanvasElement>('[data-fish-sprite]').forEach((cv) => {
    const f = FISH_BY_ID[cv.dataset.fishSprite ?? ''];
    const c = cv.getContext('2d');
    if (f && c) {
      c.imageSmoothingEnabled = false;
      const u = Math.max(2, Math.floor(cv.width / 26));
      drawFish(c, f.category, cv.width / 2, cv.height / 2, u, f.color, f.accent, -1);
    }
  });

  // animation loop (shared; pauses offscreen / hidden)
  let raf = 0, running = false, onscreen = true;
  const step = (now: number) => { for (const v of views) v.frame(now); raf = requestAnimationFrame(step); };
  // Not under a scene that's still playing; it starts once that's gone.
  const start = () => { if (running || covered()) return; running = true; raf = requestAnimationFrame(step); };
  const stop = () => { running = false; cancelAnimationFrame(raf); };
  new IntersectionObserver((es) => {
    onscreen = es.some((e) => e.isIntersecting);
    if (onscreen && !document.hidden && !reduce) start(); else stop();
  }, { threshold: 0.01 }).observe(root);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (onscreen && !reduce) start(); });
  whenUncovered(() => { if (onscreen && !document.hidden && !reduce) start(); });

  for (const v of views) v.frame(0); // initial static paint
  if (!reduce) start();
}

function makeView(
  key: string,
  canvas: HTMLCanvasElement,
  onPick: (id: string, waitMs: number) => void,
  reduce: boolean,
  alwaysLabel: boolean,
  announce: (text: string) => void,
  theme: () => Theme,
  wake: () => void,
) {
  const s = REGIONS[key];
  const ctx = canvas.getContext('2d')!;
  const W = s.gw * BAKE, Hpx = s.gh * BAKE;
  // The art's own size until the first fit, so the box has the map's shape.
  canvas.width = W; canvas.height = Hpx;

  // The pixel art is drawn at its own size and scaled onto the screen with
  // smoothing off. The names, the Twin Cities rule and the focus ring go on
  // top at the screen's resolution, so they stay sharp at any width.
  const art = document.createElement('canvas');
  art.width = W; art.height = Hpx;
  const actx = art.getContext('2d')!;
  actx.imageSmoothingEnabled = false;
  const base = document.createElement('canvas');
  base.width = W; base.height = Hpx;
  const bctx = base.getContext('2d')!;
  function retheme(): void {
    bctx.clearRect(0, 0, W, Hpx);
    bake(bctx, s, theme().pal);
  }
  retheme();

  let cssW = 0, cssH = 0, dpr = 1;
  function fit(): boolean {
    const w = canvas.clientWidth;
    if (!w) return false;
    const d = Math.min(window.devicePixelRatio || 1, 2);
    if (w === cssW && d === dpr) return false;
    cssW = w;
    cssH = (w * Hpx) / W;
    dpr = d;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    return true;
  }

  const water: Array<{ gx: number; gy: number }> = [];
  for (let gy = 0; gy < s.gh; gy++) {
    for (let gx = 0; gx < s.gw; gx++) {
      const c = s.cells[gy * s.gw + gx];
      if (c === '2' || c === '3' || c === '4') water.push({ gx, gy });
    }
  }

  const marks = s.markers
    .map((m) => {
      const w = WATERS[m.id];
      if (!w) return null;
      const sp = FISH_BY_ID[w.species[0]];
      return { id: m.id, px: (m.fx / 100) * W, py: (m.fy / s.H) * Hpx, r: w.r, sp };
    })
    .filter((m): m is NonNullable<typeof m> => !!m && !!m.sp);

  // The leaps. Positions are art px on this map, and the motion itself comes
  // from fishing-leap.ts in CSS px, so every map moves at the same pace.
  type Mark = (typeof marks)[number];
  const sizeOf = (m: Mark) => 1.05 + m.r * 1.05;
  /** The waterline, art px under a fish's centre: where its shadow sits. */
  const below = (u: number) => u * 2.6;
  const bobOf = (m: Mark, now: number) => (reduce ? 0 : Math.sin(now / 520 + m.px) * 1.3);
  interface Leap { plan: LeapPlan; born: number; u: number; y0: number; line: number; gone: number }
  const leaps = new Map<Mark, Leap>();
  const rises = new Map<Mark, number>();
  type Owned = { born: number; delay: number; owner: Leap | null };
  /** `shore`: stops at the shore. The rings round a fish's own spot don't. */
  const rings: Array<Ring & Owned & { x: number; y: number; dot: number; shore: boolean }> = [];
  const drops: Array<Owned & { x: number; y: number; u: number; d: Drop }> = [];
  const isWater = (ax: number, ay: number) => {
    const gx = Math.floor(ax / BAKE), gy = Math.floor(ay / BAKE);
    if (gx < 0 || gy < 0 || gx >= s.gw || gy >= s.gh) return false;
    const c = s.cells[gy * s.gw + gx];
    return c === '2' || c === '3' || c === '4';
  };
  const spray = () => {
    const { pal } = theme();
    return [pal.lake2, pal.river, pal.lake2, pal.sound];
  };
  /** When the panel for a leap opens: as it goes back in, and never after 550 ms. */
  const openAt = (lp: Leap) => lp.born + Math.min(lp.plan.air + 0.05, 0.55) * 1000;

  /** Send a fish up. Returns how long until its panel should open, ms. */
  function leap(m: Mark): number {
    const now = performance.now();
    const cur = leaps.get(m);
    // Still in the air: let it finish, and its panel opens when it's in.
    if (cur && (now - cur.born) / 1000 < cur.plan.air) return openAt(cur) - now;
    if (cur) {
      // Back under or coming up from an earlier leap: drop what that one had
      // still to come, and go again from its spot.
      for (const list of [rings, drops] as Array<Array<Owned>>) {
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].owner === cur && list[i].born + list[i].delay * 1000 > now) list.splice(i, 1);
        }
      }
    }
    const k = cssW / W || 1;
    const u = sizeOf(m) * (hover === m ? 1.3 : 1);
    const len = 15 * u * k;
    const y0 = m.py + bobOf(m, now);
    const line = y0 + below(sizeOf(m));
    // Water under where it would come down: anywhere from its middle to
    // just under its waterline.
    const wet = (dx: number) => {
      const x = m.px + dx / k;
      for (let y = m.py - u; y <= line + u; y += 1) if (isWater(x, y)) return true;
      return false;
    };
    const plan = aimLeap(planLeap(len, -1), wet);
    const lp: Leap = { plan, born: now, u, y0, line, gone: plan.air + plungeTime(plan, (line - y0) * k, len) };
    leaps.set(m, lp);
    rises.delete(m);
    const bx = m.px + (plan.dir * plan.dist) / k;
    // A little water as it leaves, a crown and two rings where it goes back
    // in, and one more ring as it comes back up on its spot.
    const dot = Math.max(1, Math.round(sizeOf(m)));
    rings.push({ x: m.px, y: line - u, dot, shore: false, born: now, delay: 0, life: 0.45, reach: u * 5, owner: lp });
    rings.push({ x: bx, y: line - u, dot, shore: true, born: now, delay: plan.air, life: 0.85, reach: u * 10, owner: lp });
    rings.push({ x: bx, y: line - u, dot, shore: true, born: now, delay: plan.air + 0.15, life: 0.7, reach: u * 6.5, owner: lp });
    rings.push({ x: m.px, y: line - u, dot, shore: false, born: now, delay: lp.gone + UNDER, life: 0.5, reach: u * 6, owner: lp });
    for (const d of splashDrops(6, 0.55, plan.dir, spray())) drops.push({ x: m.px, y: line, u, born: now, delay: 0, owner: lp, d });
    for (const d of splashDrops(16, 1, plan.dir * 0.6, spray()))
      drops.push({ x: bx, y: line, u, born: now, delay: plan.air, owner: lp, d });
    wake();
    return openAt(lp) - now;
  }

  /** A rise: the fish lifts a touch and leaves one ring. Not again for 0.7 s. */
  function rise(m: Mark): void {
    if (reduce || leaps.has(m)) return;
    const now = performance.now();
    const last = rises.get(m);
    if (last !== undefined && now - last < 700) return;
    rises.set(m, now);
    const u = sizeOf(m);
    const dot = Math.max(1, Math.round(u));
    rings.push({ x: m.px, y: m.py + bobOf(m, now) + below(u) - u, dot, shore: false, born: now, delay: 0.06, life: 0.6, reach: u * 7, owner: null });
  }

  // The fish in the air turn on the map's own pixel grid: each is drawn
  // upright at art size, turned onto a scratch canvas with smoothing off,
  // and only then scaled up to the screen.
  const sprites = new Map<string, HTMLCanvasElement>();
  function sprite(m: Mark, u: number, dir: 1 | -1): HTMLCanvasElement {
    const id = `${m.id}|${u.toFixed(3)}|${dir}`;
    let cv = sprites.get(id);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = 2 * Math.ceil(u * 10.5) + 2;
      cv.height = 2 * Math.ceil(u * 5) + 2;
      const c = cv.getContext('2d')!;
      c.imageSmoothingEnabled = false;
      drawFish(c, m.sp.category, cv.width / 2, cv.height / 2, u, m.sp.color, m.sp.accent, dir);
      sprites.set(id, cv);
    }
    return cv;
  }
  const spin = document.createElement('canvas');
  const sctx = spin.getContext('2d')!;
  /** The fish turned, with anything more than `cut` art px under its centre left off. Returns its size. */
  function turned(img: HTMLCanvasElement, angle: number, flip: number, cut: number): number {
    const D = 2 * Math.ceil(Math.hypot(img.width, img.height) / 2) + 2;
    if (spin.width < D) spin.width = spin.height = D;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, spin.width, spin.height);
    sctx.imageSmoothingEnabled = false;
    sctx.translate(D / 2, D / 2);
    sctx.rotate(angle);
    sctx.scale(1, flip);
    sctx.drawImage(img, -img.width / 2, -img.height / 2);
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    if (cut < D / 2) sctx.clearRect(0, D / 2 + cut, D, D);
    return D;
  }

  /** Paint the fish in the air and the drops on the layer over the page. */
  function drawAir(c: CanvasRenderingContext2D, ldpr: number, now: number): boolean {
    if (!leaps.size && !drops.length) return false;
    if (canvas.offsetParent === null) {
      // The phone's tabs hid this map: whatever was in the air is gone.
      leaps.clear();
      drops.length = 0;
      rings.length = 0;
      return false;
    }
    const r = canvas.getBoundingClientRect();
    const k = r.width / W;
    const dev = (v: number) => Math.round(v * ldpr) / ldpr;
    let busy = false;
    for (const [m, lp] of leaps) {
      const t = (now - lp.born) / 1000;
      if (t >= lp.gone) continue;
      busy = true;
      const p = leapAt(lp.plan, t);
      const ax = Math.round(m.px + p.x / k), ay = Math.round(lp.y0 + p.y / k);
      const line = Math.round(lp.line);
      const D = turned(sprite(m, lp.u, lp.plan.dir), p.angle, p.flip, line - ay);
      const x0 = dev(r.left + (ax - D / 2) * k), y0 = dev(r.top + (ay - D / 2) * k);
      c.drawImage(spin, 0, 0, D, D, x0, y0, dev(r.left + (ax + D / 2) * k) - x0, dev(r.top + (ay + D / 2) * k) - y0);
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const e = drops[i];
      const t = (now - e.born) / 1000 - e.delay;
      if (t < 0) {
        busy = true;
        continue;
      }
      const at = dropAt(e.d, t);
      if (!at) {
        drops.splice(i, 1);
        continue;
      }
      busy = true;
      const size = Math.max(e.d.size, Math.round(e.u * (e.d.size === 2 ? 1.3 : 0.8)));
      const ax = Math.round(e.x + at.x / k), ay = Math.round(e.y + at.y / k);
      const x0 = dev(r.left + ax * k), y0 = dev(r.top + ay * k);
      c.fillStyle = e.d.color;
      c.fillRect(x0, y0, dev(r.left + (ax + size) * k) - x0, dev(r.top + (ay + size) * k) - y0);
    }
    return busy;
  }

  let hover: (typeof marks)[number] | null = null;
  const toArt = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (Hpx / r.height) };
  };
  const pick = (p: { x: number; y: number }) => {
    let best: (typeof marks)[number] | null = null, bd = Infinity;
    for (const m of marks) {
      const d = (p.x - m.px) ** 2 + (p.y - m.py) ** 2;
      const hr = 9 + m.r * 6;
      if (d < hr * hr && d < bd) { bd = d; best = m; }
    }
    return best;
  };
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const next = pick(toArt(e));
    canvas.style.cursor = next ? 'pointer' : 'default';
    if (next === hover) return;
    hover = next;
    if (next) rise(next);
    // With reduced motion there's no loop to show the name.
    if (reduce) frame(performance.now());
  });
  canvas.addEventListener('pointerleave', () => {
    if (!hover) return;
    hover = null;
    if (reduce) frame(performance.now());
  });
  // Open on click, not pointerdown. The panel opens over the map, so a tap's
  // click would land on its scrim and close it again, and the mousedown that
  // follows a pointerdown would pull focus off the panel's button.
  // The fish answers first: it leaps, and the panel opens as it goes back in.
  canvas.addEventListener('click', (e) => {
    const hit = pick(toArt(e));
    if (hit) onPick(hit.id, reduce ? 0 : leap(hit));
  });

  // Keyboard: the map's frame takes focus, the arrow keys walk its waters from
  // west to east, and Enter or Space opens the one they're on. Reduced motion
  // has no animation loop, so each change repaints.
  const box = canvas.parentElement;
  const order = [...marks].sort((a, b) => a.px - b.px);
  let chosen: (typeof marks)[number] | null = null;
  const keyboardFocused = () => !!box && box.matches(':focus-visible');
  const choose = (m: (typeof marks)[number]) => {
    chosen = m;
    hover = m;
    rise(m);
    frame(performance.now());
    announce(`${WATERS[m.id].name}, ${order.indexOf(m) + 1} of ${order.length}`);
  };
  if (box?.hasAttribute('tabindex') && order.length) {
    box.addEventListener('focus', () => {
      if (chosen) {
        hover = chosen;
        frame(performance.now());
      } else if (keyboardFocused()) choose(order[0]);
    });
    box.addEventListener('blur', () => {
      if (hover === chosen) hover = null;
      frame(performance.now());
    });
    box.addEventListener('keydown', (e) => {
      const at = chosen ? order.indexOf(chosen) : -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') choose(order[Math.min(order.length - 1, at + 1)]);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') choose(order[Math.max(0, at - 1)]);
      else if (e.key === 'Home') choose(order[0]);
      else if (e.key === 'End') choose(order[order.length - 1]);
      else if (e.key === 'Enter' || e.key === ' ') {
        if (!chosen) choose(order[0]);
        // Enter is a tap: the fish leaps and the panel opens as it lands.
        if (chosen) onPick(chosen.id, reduce ? 0 : leap(chosen));
      } else return;
      e.preventDefault();
    });
  }

  /**
   * A name on a paper tag, centred on x with its baseline at y (CSS px).
   * Caps are the site's .u-label: 10px, tracked, upper case, in ink-2. Given
   * more spots, it takes the first that keeps clear of every fish.
   */
  function tag(text: string, x: number, y: number, caps = false, spots: Array<(w: number) => [number, number]> = []): void {
    if (!canvasFontIsReady()) return;
    const { ink } = theme();
    ctx.save();
    ctx.font = canvasFont(caps ? 10 : 11);
    if (caps && 'letterSpacing' in ctx) ctx.letterSpacing = '1.6px';
    const t = caps ? text.toUpperCase() : text;
    const w = ctx.measureText(t).width;
    const k = cssW / W;
    const place = ([cx, cy]: [number, number]) => {
      const left = Math.round(Math.max(4, Math.min(cssW - 4 - w, cx - w / 2)));
      return { left, base: Math.round(Math.max(12, Math.min(cssH - 5, cy))) };
    };
    const clear = ({ left, base }: { left: number; base: number }) =>
      marks.every((m) => {
        const u = (1.05 + m.r * 1.05) * k;
        const x0 = m.px * k - u * 10, x1 = m.px * k + u * 10, y0 = m.py * k - u * 5, y1 = m.py * k + u * 5;
        return x1 < left - 4 || x0 > left + w + 4 || y1 < base - 10 || y0 > base + 4;
      });
    const all = [place([x, y]), ...spots.map((spot) => place(spot(w)))];
    const at = all.find(clear) ?? all[0];
    ctx.fillStyle = ink.paper;
    ctx.fillRect(at.left - 4, at.base - 10, Math.ceil(w) + 8, 14);
    ctx.fillStyle = caps ? ink.ink2 : ink.ink;
    ctx.fillText(t, at.left, at.base);
    ctx.restore();
  }

  function frame(now: number): void {
    if (canvas.offsetParent === null) return; // hidden (mobile inactive map)
    if (!cssW) fit();
    if (!cssW) return;
    const { pal, ink } = theme();

    // The art, at its own size.
    actx.clearRect(0, 0, W, Hpx);
    actx.drawImage(base, 0, 0);
    if (!reduce) {
      const band = (now / 45) % (s.gw + s.gh);
      actx.fillStyle = pal.lake2;
      for (const w of water) if (Math.abs(w.gx + w.gy - band) < 2.2) actx.fillRect(w.gx * BAKE, w.gy * BAKE, BAKE, BAKE);
    }
    // Rings on the water, under the fish, in the water's light colour.
    actx.fillStyle = pal.lake2;
    for (let i = rings.length - 1; i >= 0; i--) {
      const g = rings[i];
      const t = (now - g.born) / 1000;
      const at = ringAt(g, t);
      if (!at) {
        if (t >= g.delay + g.life) rings.splice(i, 1);
        continue;
      }
      // On a grid of the fish's own pixel size, so the ring is as chunky
      // as the sprite it came from.
      const q = g.dot;
      const cx = Math.round(g.x / q), cy = Math.round(g.y / q);
      ringPixels(at.rx / q, at.ry / q).forEach(([dx, dy], j) => {
        if (j % at.every) return;
        const x = (cx + dx) * q, y = (cy + dy) * q;
        if (g.shore && !isWater(x + q / 2, y + q / 2)) return;
        actx.fillRect(x, y, q, q);
      });
    }
    const bobs = new Map<(typeof marks)[number], number>();
    for (const m of marks) {
      const bob = reduce ? 0 : Math.sin(now / 520 + m.px) * 1.3;
      bobs.set(m, bob);
      const u = 1.05 + m.r * 1.05;
      const big = hover === m;
      const lp = leaps.get(m);
      let y = m.py + bob;
      let cut = Infinity;
      if (lp) {
        const t = (now - lp.born) / 1000;
        const back = lp.gone + UNDER;
        if (t < lp.plan.air) {
          // Out of the water: its shadow follows it along the surface,
          // smaller the higher it is. The fish is on the layer above.
          const p = leapAt(lp.plan, t);
          const k = cssW / W;
          const high = Math.min(1, Math.max(0, -p.y / lp.plan.lift));
          const sw = u * 10 * (1 - 0.55 * high);
          actx.fillStyle = 'rgba(15,30,45,0.16)';
          actx.fillRect(Math.round(m.px + p.x / k - sw / 2), Math.round(lp.line), Math.round(sw), Math.round(Math.max(1, u)));
          continue;
        }
        if (t < back) continue; // under the water
        if (t < back + SURFACE) {
          // Back up on its own spot, through the surface.
          cut = Math.round(y + below(u));
          y += surfaceAt(t - back) * (below(u) + u * 4.5);
        } else leaps.delete(m);
      }
      const rt = rises.get(m);
      if (rt !== undefined && now - rt < RISE * 1000) y -= riseAt((now - rt) / 1000) * u * 2.4;
      actx.fillStyle = 'rgba(15,30,45,0.16)';
      actx.fillRect(Math.round(m.px - u * 5), Math.round(m.py + u * 2.6 + bob), Math.round(u * 10), Math.round(Math.max(1, u)));
      if (cut < Infinity) {
        actx.save();
        actx.beginPath();
        actx.rect(0, 0, W, cut);
        actx.clip();
      }
      drawFish(actx, m.sp.category, m.px, y, big ? u * 1.3 : u, m.sp.color, m.sp.accent, -1);
      if (cut < Infinity) actx.restore();
    }

    // Onto the screen, pixels kept square.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(art, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = cssW / W;

    if (s.inset) {
      // A 1px ink rule round the area the metro map blows up, on whole
      // device pixels so it stays one line.
      const snap = (v: number) => Math.round(v * dpr) / dpr;
      const half = Math.round(dpr) % 2 ? 0.5 / dpr : 0;
      const rx = snap((s.inset.x / 100) * cssW), ry = snap((s.inset.y / s.H) * cssH);
      const rw = snap((s.inset.w / 100) * cssW), rh = snap((s.inset.h / s.H) * cssH);
      ctx.strokeStyle = ink.ink;
      ctx.lineWidth = 1;
      ctx.strokeRect(rx + half, ry + half, rw, rh);
      // Under the box, or beside or over it when a fish is in the way.
      tag('Twin Cities', rx + rw / 2, ry + rh + 14, true, [
        (w) => [rx - 8 - w / 2, ry + rh / 2 + 4],
        () => [rx + rw / 2, ry - 6],
        (w) => [rx + rw + 8 + w / 2, ry + rh / 2 + 4],
      ]);
    }
    if (alwaysLabel) {
      for (const m of marks) {
        const u = 1.05 + m.r * 1.05;
        tag(WATERS[m.id].name, m.px * k, (m.py + (bobs.get(m) ?? 0) + u * 4) * k + 13);
      }
    } else if (hover) {
      // Above where the focus ring would be, so the two never cross.
      const u = 1.05 + hover.r * 1.05;
      tag(WATERS[hover.id].name, hover.px * k, (hover.py - u * 6.5) * k - 10);
    }
    // The one ring: round the fish the arrow keys are on, ink outside and
    // paper inside so it reads on land and water in both themes.
    if (chosen && keyboardFocused()) {
      const u = 1.05 + chosen.r * 1.05;
      const rad = u * 6.5 * k + 3;
      const x = chosen.px * k, y = chosen.py * k;
      ctx.lineWidth = 2;
      ctx.strokeStyle = ink.ink;
      ctx.beginPath();
      ctx.arc(x, y, rad + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = ink.paper;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  return { canvas, frame, fit, retheme, drawAir };
}

/** The map from its cells. Outside the state stays clear, so the page shows. */
function bake(b: Ctx, s: StateGeo, C: Pal): void {
  const at = (gx: number, gy: number) => (gx < 0 || gy < 0 || gx >= s.gw || gy >= s.gh ? '0' : s.cells[gy * s.gw + gx]);
  for (let gy = 0; gy < s.gh; gy++) {
    for (let gx = 0; gx < s.gw; gx++) {
      const code = s.cells[gy * s.gw + gx];
      if (code === '0') continue;
      let col: string;
      if (code === '1') {
        const edge = at(gx - 1, gy) === '0' || at(gx + 1, gy) === '0' || at(gx, gy - 1) === '0' || at(gx, gy + 1) === '0';
        col = edge ? C.edge : (gx + gy) % 6 === 0 ? C.land2 : C.land;
      } else if (code === '2') col = (gx * 7 + gy) % 9 === 0 ? C.lake2 : C.lake;
      else if (code === '3') col = C.river;
      else col = C.sound;
      b.fillStyle = col;
      b.fillRect(gx * BAKE, gy * BAKE, BAKE, BAKE);
    }
  }
}

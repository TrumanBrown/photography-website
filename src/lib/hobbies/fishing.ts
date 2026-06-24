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
 * Mounted by src/components/hobbies/Fishing.astro via [data-fish-*] hooks.
 */
import geo from './fishing-geo.json';
import watersJson from './fishing-waters.json';
import { FISH_BY_ID, type FishSpecies } from './fishing-species';
import { drawFish } from './fishing-sprites';

interface Marker { id: string; fx: number; fy: number; }
interface StateGeo { name: string; gw: number; gh: number; H: number; cells: string; markers: Marker[]; inset?: { x: number; y: number; w: number; h: number }; }
interface Water { id: string; state: string; name: string; kind: string; r: number; species: string[]; }

const INSET_KEYS = ((geo as unknown as { insets?: Record<string, StateGeo> }).insets ?? {}) as Record<string, StateGeo>;
const REGIONS = { ...(geo.states as unknown as Record<string, StateGeo>), ...INSET_KEYS } as Record<string, StateGeo>;
const WATERS = Object.fromEntries(
  (watersJson.waters as unknown as Water[]).map((w) => [w.id, w]),
) as Record<string, Water>;

const BAKE = 3; // bitmap px per map cell (CSS scales the canvas; pixels stay crisp)
const C = {
  land: '#869a6a', land2: '#90a274', edge: '#6c7f55',
  lake: '#4f9fc4', lake2: '#82c2da', river: '#5aa6cc', sound: '#3f86b0', bg: '#e9eff0',
};
const KIND_LABEL: Record<string, string> = { lake: 'Lake', river: 'River / stream', sound: 'Saltwater' };

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
    cv.className = 'shrink-0 rounded bg-sky-50 dark:bg-neutral-800';
    cv.style.width = '64px'; cv.style.height = '38px'; cv.style.imageRendering = 'pixelated';
    const c = cv.getContext('2d');
    if (c) { c.imageSmoothingEnabled = false; drawFish(c, f.category, 32, 20, 2.3, f.color, f.accent, -1); }
    const txt = document.createElement('div');
    txt.className = 'min-w-0';
    const nm = document.createElement('div');
    nm.className = 'text-sm font-medium leading-tight';
    nm.textContent = f.common;
    const nt = document.createElement('div');
    nt.className = 'text-xs text-neutral-500 dark:text-neutral-400';
    nt.textContent = f.note;
    txt.append(nm, nt);
    row.append(cv, txt);
    return row;
  }

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
    panel.classList.add('is-open');
  }
  pClose?.addEventListener('click', () => panel?.classList.remove('is-open'));
  panel?.addEventListener('click', (e) => { if (e.target === panel) panel.classList.remove('is-open'); });

  // map views
  const views: Array<{ frame: (now: number) => void }> = [];
  root.querySelectorAll<HTMLCanvasElement>('[data-fish-canvas]').forEach((cv) => {
    const key = cv.dataset.fishCanvas ?? '';
    if (REGIONS[key]) views.push(makeView(key, cv, openPanel, reduce, key in INSET_KEYS));
  });

  // mobile MN/WA toggle
  root.querySelectorAll<HTMLButtonElement>('[data-fish-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.fishTab;
      root.querySelectorAll<HTMLElement>('[data-fish-map]').forEach((m) => m.classList.toggle('is-active', m.dataset.fishMap === key));
      root.querySelectorAll<HTMLElement>('[data-fish-tab]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('bg-white', on); b.classList.toggle('dark:bg-neutral-700', on);
        b.classList.toggle('shadow-sm', on); b.classList.toggle('text-neutral-500', !on);
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
  const start = () => { if (running) return; running = true; raf = requestAnimationFrame(step); };
  const stop = () => { running = false; cancelAnimationFrame(raf); };
  new IntersectionObserver((es) => {
    onscreen = es.some((e) => e.isIntersecting);
    if (onscreen && !document.hidden && !reduce) start(); else stop();
  }, { threshold: 0.01 }).observe(root);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (onscreen && !reduce) start(); });

  for (const v of views) v.frame(0); // initial static paint
  if (!reduce) start();
}

function makeView(key: string, canvas: HTMLCanvasElement, onPick: (id: string) => void, reduce: boolean, alwaysLabel: boolean) {
  const s = REGIONS[key];
  const ctx = canvas.getContext('2d')!;
  const W = s.gw * BAKE, Hpx = s.gh * BAKE;
  canvas.width = W; canvas.height = Hpx;
  ctx.imageSmoothingEnabled = false;

  const base = document.createElement('canvas');
  base.width = W; base.height = Hpx;
  bake(base.getContext('2d')!, s);

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

  let hover: (typeof marks)[number] | null = null;
  const toBmp = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
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
    hover = pick(toBmp(e));
    canvas.style.cursor = hover ? 'pointer' : 'default';
  });
  canvas.addEventListener('pointerleave', () => { hover = null; });
  canvas.addEventListener('pointerdown', (e) => { const hit = pick(toBmp(e)); if (hit) onPick(hit.id); });

  function labelAt(text: string, cx: number, cy: number): void {
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(Math.round(cx - tw / 2 - 4), Math.round(cy - 10), Math.round(tw + 8), 14);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, Math.round(cx), Math.round(cy));
    ctx.textAlign = 'left';
  }

  function frame(now: number): void {
    if (canvas.offsetParent === null) return; // hidden (mobile inactive map)
    ctx.clearRect(0, 0, W, Hpx);
    ctx.drawImage(base, 0, 0);
    if (!reduce) {
      const band = (now / 45) % (s.gw + s.gh);
      ctx.fillStyle = C.lake2;
      for (const w of water) if (Math.abs(w.gx + w.gy - band) < 2.2) ctx.fillRect(w.gx * BAKE, w.gy * BAKE, BAKE, BAKE);
    }
    for (const m of marks) {
      const bob = reduce ? 0 : Math.sin(now / 520 + m.px) * 1.3;
      const u = 1.05 + m.r * 1.05;
      const big = hover === m;
      ctx.fillStyle = 'rgba(190,228,242,0.5)';
      ctx.beginPath();
      ctx.arc(m.px, m.py + bob, u * 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(15,30,45,0.16)';
      ctx.fillRect(Math.round(m.px - u * 5), Math.round(m.py + u * 2.6 + bob), Math.round(u * 10), Math.round(Math.max(1, u)));
      drawFish(ctx, m.sp.category, m.px, m.py + bob, big ? u * 1.3 : u, m.sp.color, m.sp.accent, -1);
      if (alwaysLabel) labelAt(WATERS[m.id].name, m.px, m.py + bob + u * 4 + 12);
    }
    if (s.inset) {
      const rx = (s.inset.x / 100) * W, ry = (s.inset.y / s.H) * Hpx, rw = (s.inset.w / 100) * W, rh = (s.inset.h / s.H) * Hpx;
      ctx.strokeStyle = 'rgba(37,99,235,0.95)';
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(rx) + 1, Math.round(ry) + 1, Math.round(rw), Math.round(rh));
      labelAt('Twin Cities', rx + rw / 2, ry + rh + 12);
    }
    if (!alwaysLabel && hover) {
      const u = 1.05 + hover.r * 1.05;
      labelAt(WATERS[hover.id].name, hover.px, hover.py - u * 4 - 7);
    }
  }
  return { frame };
}

function bake(b: Ctx, s: StateGeo): void {
  const W = s.gw * BAKE, Hpx = s.gh * BAKE;
  b.fillStyle = C.bg;
  b.fillRect(0, 0, W, Hpx);
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

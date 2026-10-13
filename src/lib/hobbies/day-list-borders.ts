/**
 * Country and state borders over the Day list map, from Natural Earth's 1:10m
 * boundary lines. scripts/build-day-list-borders.mjs simplifies them into
 * three levels of detail: level 0 loads with the map, and the finer two load
 * a cell at a time when a zoom needs them. Until a finer level arrives the
 * map keeps drawing the coarser one, the way the tiles work.
 *
 * Country borders always show. Each state line carries the zoom where its
 * country's states are about 10 pixels across, and fades in from there, so
 * every country's states arrive at the same size on screen. At world view
 * the map shows countries only, which is the view you guess from.
 */
import index from "./day-list-borders/index.json";

/** 0 country, 1 disputed or indefinite (dashed), 2 state or province. */
export type BorderKind = 0 | 1 | 2;

export interface BorderLine {
  /** Longitude, latitude pairs. */
  pts: Float32Array;
  w: number;
  s: number;
  e: number;
  n: number;
}

export interface BorderGroup {
  kind: BorderKind;
  zoom: number;
  lines: BorderLine[];
}

interface BorderLevel {
  from: number;
  precision: number;
  maxZoom: number;
  file?: string;
  cell?: number;
  /** col, row, then the box its lines cover: west, south, east, north. */
  cells?: number[][];
}

interface BorderFile {
  precision: number;
  groups: [number, number, string][];
}

const INDEX = index as { levels: BorderLevel[] };

const FILES = import.meta.glob<BorderFile>("./day-list-borders/l*.json", {
  import: "default",
});

/** Zoom levels a line takes to fade in, once it's due. */
const FADE = 0.75;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------ pure maths */

/** Map zoom: 0 is the world 256 CSS pixels across, and each step doubles it. */
export function borderZoom(worldWidth: number): number {
  return Math.log2(worldWidth / 256);
}

/** How much of a line shows: none before its zoom, all by FADE after. */
export function borderFade(minZoom: number, zoom: number): number {
  return clamp((zoom - minZoom) / FADE, 0, 1);
}

/** State lines stay off at world view and come in over the first zoom step. */
export function stateShare(k: number): number {
  return clamp((k - 1.1) / 0.5, 0, 1);
}

/** The level to draw when a CSS pixel covers `degPerPx` degrees. */
export function borderLevelFor(
  degPerPx: number,
  levels: { from: number }[] = INDEX.levels,
): number {
  for (let i = 0; i < levels.length; i++) {
    if (degPerPx >= levels[i].from) return i;
  }
  return levels.length - 1;
}

/** The cells whose lines reach into a box (degrees: west, south, east, north). */
export function cellsInView(
  cells: number[][],
  w: number,
  s: number,
  e: number,
  n: number,
): string[] {
  return cells
    .filter((c) => c[2] <= e && c[4] >= w && c[3] <= n && c[5] >= s)
    .map((c) => `${c[0]}-${c[1]}`);
}

/**
 * One group's string back into lines: polyline-encoded, longitude first,
 * lines separated by spaces, each starting from where the last one ended.
 */
export function decodeGroup(text: string, precision: number): BorderLine[] {
  const lines: BorderLine[] = [];
  let x = 0;
  let y = 0;
  let i = 0;
  let pts: number[] = [];
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = text.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  const finish = () => {
    if (pts.length >= 4) {
      lines.push({ pts: Float32Array.from(pts), w, s, e, n });
    }
    pts = [];
    w = Infinity;
    s = Infinity;
    e = -Infinity;
    n = -Infinity;
  };
  while (i < text.length) {
    if (text.charCodeAt(i) === 32) {
      finish();
      i++;
      continue;
    }
    x += next();
    y += next();
    const lon = x / precision;
    const lat = y / precision;
    pts.push(lon, lat);
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  finish();
  return lines;
}

/* ----------------------------------------------------------- the layer */

export interface BorderStyle {
  ink: string;
  /** Dark mode draws light lines on darker land, which need less. */
  dark: boolean;
}

export interface BorderView {
  width: number;
  height: number;
  k: number;
  cu: number;
  cv: number;
}

export interface Borders {
  /** Draw what's loaded for this view, and ask for what it's missing. */
  draw(
    ctx: CanvasRenderingContext2D,
    view: BorderView,
    style: BorderStyle,
  ): void;
}

interface Chunk {
  state: "loading" | "ready" | "failed";
  groups: BorderGroup[];
}

export function createBorders(onLoad: () => void): Borders {
  const chunks = new Map<string, Chunk>();

  function load(name: string): Chunk {
    const known = chunks.get(name);
    if (known) return known;
    const chunk: Chunk = { state: "loading", groups: [] };
    chunks.set(name, chunk);
    const importer = FILES[`./day-list-borders/${name}.json`];
    if (!importer) {
      chunk.state = "failed";
      return chunk;
    }
    importer()
      .then((file) => {
        chunk.groups = file.groups.map(([kind, zoom, text]) => ({
          kind: kind as BorderKind,
          zoom,
          lines: decodeGroup(text, file.precision),
        }));
        chunk.state = "ready";
        onLoad();
      })
      .catch(() => {
        chunk.state = "failed";
      });
    return chunk;
  }

  /** The files a level needs for this box, or null if it has none to give. */
  function namesFor(level: number, w: number, s: number, e: number, n: number) {
    const lv = INDEX.levels[level];
    if (lv.file) return [lv.file];
    return cellsInView(lv.cells ?? [], w, s, e, n).map(
      (cell) => `l${level}-${cell}`,
    );
  }

  // The coarsest level comes with the map.
  load(INDEX.levels[0].file ?? "l0");

  return {
    draw(ctx, view, style) {
      const worldW = view.width * view.k;
      const worldH = view.height * view.k;
      const degPerPx = 360 / worldW;
      const zoom = borderZoom(worldW);
      // lon/lat to CSS pixels.
      const sx = worldW / 360;
      const ox = (0.5 - view.cu) * worldW + view.width / 2;
      const sy = -worldH / 180;
      const oy = (0.5 - view.cv) * worldH + view.height / 2;
      const margin = 4 * degPerPx;
      const w = -ox / sx - margin;
      const e = (view.width - ox) / sx + margin;
      const n = -oy / sy + margin;
      const s = (view.height - oy) / sy - margin;

      // The finest level that's all here, asking for the one the view wants.
      const target = borderLevelFor(degPerPx);
      let drawn: Chunk[] = [];
      for (let level = target; level >= 0; level--) {
        const names = namesFor(level, w, s, e, n);
        const wanted = names.map((name) =>
          level === target || chunks.has(name) ? load(name) : null,
        );
        if (wanted.every((c) => c?.state === "ready")) {
          drawn = wanted as Chunk[];
          break;
        }
      }
      if (!drawn.length) return;

      const t = clamp((zoom - 1.5) / 5, 0, 1);
      const states = stateShare(view.k);
      const passes: [BorderKind, number, number][] = [
        // kind, CSS px, opacity
        [2, 0.5 + 0.4 * t, style.dark ? 0.26 : 0.34],
        [1, 0.6 + 0.6 * t, style.dark ? 0.42 : 0.56],
        [0, 0.6 + 0.6 * t, style.dark ? 0.42 : 0.56],
      ];
      ctx.save();
      ctx.strokeStyle = style.ink;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (const [kind, width, opacity] of passes) {
        // One path per zoom across every chunk, so the pieces a cell edge
        // splits still join without a darker dot.
        const byZoom = new Map<number, BorderLine[][]>();
        for (const chunk of drawn) {
          for (const group of chunk.groups) {
            if (group.kind !== kind) continue;
            const list = byZoom.get(group.zoom) ?? [];
            list.push(group.lines);
            byZoom.set(group.zoom, list);
          }
        }
        ctx.lineWidth = width;
        ctx.setLineDash(kind === 1 ? [width * 2.5, width * 2.5] : []);
        for (const [minZoom, lists] of byZoom) {
          const share = borderFade(minZoom, zoom) * (kind === 2 ? states : 1);
          if (share < 0.02) continue;
          ctx.beginPath();
          let any = false;
          for (const lines of lists) {
            for (const line of lines) {
              if (line.e < w || line.w > e || line.n < s || line.s > n) {
                continue;
              }
              const p = line.pts;
              ctx.moveTo(p[0] * sx + ox, p[1] * sy + oy);
              for (let i = 2; i < p.length; i += 2) {
                ctx.lineTo(p[i] * sx + ox, p[i + 1] * sy + oy);
              }
              any = true;
            }
          }
          if (!any) continue;
          ctx.globalAlpha = opacity * share;
          ctx.stroke();
        }
      }
      ctx.restore();
    },
  };
}

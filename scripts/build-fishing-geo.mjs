#!/usr/bin/env node
/**
 * Build the committed geometry for the Fishing hobby map.
 *
 * Reads public-domain Natural Earth data (state outline, lake polygons, river
 * centerlines + the denser North America rivers layer) and the curated waters in
 * src/lib/hobbies/fishing-waters.json, then for Minnesota and Washington:
 *   - projects everything with one equirectangular transform per state,
 *   - rasterizes a pixel grid (point-in-polygon for land/lakes, distance-to-
 *     segment for rivers), CLIPPED to the state so water never spills outside,
 *   - paints a small bit of saltwater for WA's Sound/Canal,
 *   - projects each named water's marker position.
 *
 * Output: src/lib/hobbies/fishing-geo.json  (masks as digit strings + markers).
 * The runtime imports that — no Natural Earth data ships to the browser.
 *
 * Run: node scripts/build-fishing-geo.mjs   (downloads ~14MB to .cache once)
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const CACHE = '.cache/natural-earth';
const SOURCES = {
  states: 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json',
  lakes: NE + 'ne_10m_lakes.geojson',
  lakesNA: NE + 'ne_10m_lakes_north_america.geojson',
  rivers: NE + 'ne_10m_rivers_lake_centerlines.geojson',
  riversNA: NE + 'ne_10m_rivers_north_america.geojson',
};

const METRO_BBOX = [-94.0, 44.72, -92.75, 45.38]; // Twin Cities metro [minLon, minLat, maxLon, maxLat]
const STATES = {
  mn: { name: 'Minnesota', gw: 120, insetBox: METRO_BBOX, markerFilter: (w) => w.state === 'mn' && !w.metro },
  wa: { name: 'Washington', gw: 132, markerFilter: (w) => w.state === 'wa' },
};
const INSETS = {
  metro: { name: 'Minnesota', gw: 132, bbox: METRO_BBOX, markerFilter: (w) => !!w.metro },
};
const MAJOR_RIVER = /mississippi|minnesota|red river|st\.? croix|rainy|columbia|snake|yakima|skagit|cowlitz|spokane|wenatchee|snoqualmie/i;

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function cached(key, url) {
  await mkdir(CACHE, { recursive: true });
  const file = join(CACHE, key + '.json');
  if (await exists(file)) return JSON.parse(await readFile(file, 'utf8'));
  process.stdout.write(`  fetching ${key} … `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  await writeFile(file, text);
  console.log(`${(text.length / 1e6).toFixed(1)}MB`);
  return JSON.parse(text);
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDistSq(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}
function bboxOf(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of pts) { if (p[0] < a) a = p[0]; if (p[1] < b) b = p[1]; if (p[0] > c) c = p[0]; if (p[1] > d) d = p[1]; }
  return [a, b, c, d];
}

function buildState(key, cfg, data, waters) {
  // state outline -> largest ring
  const f = data.states.features.find((x) => (x.properties.name || x.properties.NAME) === cfg.name);
  const rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((p) => p[0]);
  rings.sort((a, b) => b.length - a.length);
  const ring = rings[0];

  const lons = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
  // a custom bbox (a zoomed inset) overrides the state's own extent
  const minLon = cfg.bbox ? cfg.bbox[0] : Math.min(...lons);
  const maxLon = cfg.bbox ? cfg.bbox[2] : Math.max(...lons);
  const minLat = cfg.bbox ? cfg.bbox[1] : Math.min(...lats);
  const maxLat = cfg.bbox ? cfg.bbox[3] : Math.max(...lats);
  const midLat = (minLat + maxLat) / 2, kx = Math.cos((midLat * Math.PI) / 180);
  const M = cfg.bbox ? 0 : 5; // margin so a full state never touches the frame edge
  const scale = (100 - 2 * M) / ((maxLon - minLon) * kx);
  const H = (maxLat - minLat) * scale + 2 * M;
  const tx = (lon) => M + ((lon - minLon) * kx) * scale;
  const ty = (lat) => M + ((maxLat - lat)) * scale;
  const proj = (p) => [tx(p[0]), ty(p[1])];
  const stateRing = ring.map(proj);

  const pad = 0.4;
  const bb = [minLon - pad, maxLon + pad, minLat - pad, maxLat + pad];
  const inBB = (lon, lat) => lon >= bb[0] && lon <= bb[1] && lat >= bb[2] && lat <= bb[3];

  // lakes within bbox -> projected rings + bbox
  const lakeRings = [];
  for (const lf of [...data.lakes.features, ...data.lakesNA.features]) {
    if (!lf.geometry) continue;
    const polys = lf.geometry.type === 'Polygon' ? [lf.geometry.coordinates] : lf.geometry.type === 'MultiPolygon' ? lf.geometry.coordinates : [];
    for (const poly of polys) {
      const outer = poly[0];
      if (!outer.some((p) => inBB(p[0], p[1]))) continue;
      const pts = outer.map(proj);
      lakeRings.push({ pts, bb: bboxOf(pts) });
    }
  }

  // river segments within bbox -> projected, with half-width
  const segs = [];
  for (const rf of [...data.rivers.features, ...data.riversNA.features]) {
    if (!rf.geometry) continue;
    const nm = (rf.properties && (rf.properties.name || rf.properties.Name)) || '';
    const hw = (MAJOR_RIVER.test(nm) ? 0.9 : 0.45);
    const lines = rf.geometry.type === 'LineString' ? [rf.geometry.coordinates] : rf.geometry.type === 'MultiLineString' ? rf.geometry.coordinates : [];
    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const p = line[i], q = line[i + 1];
        if (!inBB(p[0], p[1]) || !inBB(q[0], q[1])) continue;
        const a = proj(p), b = proj(q);
        segs.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], hw, bb: [Math.min(a[0], b[0]) - hw, Math.min(a[1], b[1]) - hw, Math.max(a[0], b[0]) + hw, Math.max(a[1], b[1]) + hw] });
      }
    }
  }

  // sounds (saltwater) for this state -> projected ellipses
  const sounds = waters.filter((w) => w.state === key && w.kind === 'sound').map((w) => ({ cx: tx(w.lon), cy: ty(w.lat), rx: w.r * 5, ry: w.r * 7.5 }));

  const pick = cfg.markerFilter ?? ((w) => w.state === key);
  const unitsPerKm = 100 / ((maxLon - minLon) * kx * 111.32);
  // lakes Natural Earth omits (e.g. the small metro lakes) get painted from a km radius
  const paints = waters.filter(pick).filter((w) => w.paintKm).map((w) => ({ cx: tx(w.lon), cy: ty(w.lat), r: Math.max(0.6, w.paintKm * unitsPerKm) }));

  // rasterize
  const gw = cfg.gw, gh = Math.round((H * gw) / 100);
  const cw = 100 / gw, ch = H / gh;
  const stateBB = bboxOf(stateRing);
  const cells = new Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const py = (gy + 0.5) * ch;
    for (let gx = 0; gx < gw; gx++) {
      const px = (gx + 0.5) * cw;
      let code = 0;
      const inState = px >= stateBB[0] && px <= stateBB[2] && py >= stateBB[1] && py <= stateBB[3] && pointInRing(px, py, stateRing);
      if (inState) {
        let lake = false;
        for (const lr of lakeRings) { if (px >= lr.bb[0] && px <= lr.bb[2] && py >= lr.bb[1] && py <= lr.bb[3] && pointInRing(px, py, lr.pts)) { lake = true; break; } }
        if (lake) code = 2;
        else {
          let river = false;
          for (const s of segs) { if (px >= s.bb[0] && px <= s.bb[2] && py >= s.bb[1] && py <= s.bb[3] && segDistSq(px, py, s.x1, s.y1, s.x2, s.y2) <= s.hw * s.hw) { river = true; break; } }
          code = river ? 3 : 1;
        }
      } else {
        for (const so of sounds) { const dx = (px - so.cx) / so.rx, dy = (py - so.cy) / so.ry; if (dx * dx + dy * dy <= 1) { code = 4; break; } }
      }
      if (code !== 0) { for (const pp of paints) { const dx = (px - pp.cx) / pp.r, dy = (py - pp.cy) / pp.r; if (dx * dx + dy * dy <= 1) { code = 2; break; } } }
      cells[gy * gw + gx] = code;
    }
  }

  const markers = waters.filter(pick).map((w) => ({ id: w.id, fx: +tx(w.lon).toFixed(2), fy: +ty(w.lat).toFixed(2) }));
  const counts = cells.reduce((m, c) => ((m[c] = (m[c] || 0) + 1), m), {});
  console.log(`  ${cfg.name}: ${gw}x${gh}  land=${counts[1] || 0} lake=${counts[2] || 0} river=${counts[3] || 0} sound=${counts[4] || 0}  lakes=${lakeRings.length} segs=${segs.length}`);
  const result = { name: cfg.name, gw, gh, H: +H.toFixed(2), cells: cells.join(''), markers };
  if (cfg.insetBox) {
    const [a, b, c, d] = cfg.insetBox; // [minLon, minLat, maxLon, maxLat]
    result.inset = { x: +tx(a).toFixed(2), y: +ty(d).toFixed(2), w: +(tx(c) - tx(a)).toFixed(2), h: +(ty(b) - ty(d)).toFixed(2) };
  }
  return result;
}

async function main() {
  console.log('Loading sources…');
  const data = {};
  for (const [k, url] of Object.entries(SOURCES)) data[k] = await cached(k, url);
  const waters = JSON.parse(await readFile('src/lib/hobbies/fishing-waters.json', 'utf8')).waters;

  const out = { generated: new Date().toISOString(), states: {}, insets: {} };
  for (const [key, cfg] of Object.entries(STATES)) out.states[key] = buildState(key, cfg, data, waters);
  for (const [key, cfg] of Object.entries(INSETS)) out.insets[key] = buildState(key, cfg, data, waters);

  await writeFile('src/lib/hobbies/fishing-geo.json', JSON.stringify(out));
  const bytes = JSON.stringify(out).length;
  console.log(`\nWrote src/lib/hobbies/fishing-geo.json (${(bytes / 1024).toFixed(0)} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });

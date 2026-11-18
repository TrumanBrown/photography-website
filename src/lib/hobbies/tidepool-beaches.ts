/**
 * The six beaches of the tide pooling toy, what lives where on each, and the
 * deal that puts animals on a beach.
 *
 * Each beach is a patch of shore seen straight down, built by
 * scripts/tidepool/build-beaches.py from CC0 scans and served from
 * public/tidepool/<VERSION>/<beach>/. Its beach.json lists the loose rocks
 * (with the way each one tips over), the spots animals can sit (`slots`, by
 * kind), and seaweed anchors. The toy draws the animals at those spots, so
 * nothing alive is in the scene unless something here put it there.
 *
 * Pure: no DOM, so the deal is tested (tidepool-beaches.test.ts).
 */
import { SPECIES, type TidepoolSpecies } from "./tidepool-species";

/** Bump with scripts/tidepool/build-beaches.py's VERSION. */
export const ART_VERSION = "v2";
export const ART_BASE = `/tidepool/${ART_VERSION}`;

export type BeachId =
  "cobble" | "potholes" | "boulder" | "sand" | "bench" | "channel";

export interface Beach {
  id: BeachId;
  title: string;
  /** One line under the toy when you arrive. */
  line: string;
}

export const BEACHES: Beach[] = [
  {
    id: "sand",
    title: "Sandy beach",
    line: "Rippled sand with loose rocks to turn. The big one takes a few heaves, and the waves dug a little pool at its foot.",
  },
  {
    id: "cobble",
    title: "Cobble beach",
    line: "Rounded stones of every size. The big loose ones have the most under them.",
  },
  {
    id: "potholes",
    title: "Potholes",
    line: "A sandstone bench pitted with little round pools and loose stones.",
  },
  {
    id: "boulder",
    title: "The big boulder",
    line: "One boulder too big to turn in one go. Big crabs, and now and then a young octopus, hide under rocks like this.",
  },
  {
    id: "bench",
    title: "Mussel bench",
    line: "Open rock packed with mussels and barnacles, with goosenecks in the cracks. Nothing turns over here, so look along the bed and in the pool.",
  },
  {
    id: "channel",
    title: "Surge channel",
    line: "A gut of water between two rock benches, with seaweed in it. Brush it aside to see what's under it.",
  },
];

// ------------------------------------------------------------ beach.json

export interface Rock {
  file: string;
  under: string;
  /** The sprite's box in field px. */
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rot: number;
  /** Radians: the way it tips over, onto the most open ground beside it. */
  fall: number;
  /** Heaves it takes to turn over: 1 for most, 3 for the big boulder. */
  heavy: number;
  /** About how far it is across, and how tall, field px. */
  size: number;
  thick: number;
  /** Its outline, field px. */
  pts: [number, number][];
}

export interface Weed {
  kind: "surfgrass" | "kelp" | "sea-lettuce" | "rockweed";
  x: number;
  y: number;
  seed: number;
  /** Radians: which way is into the water from where it grows. */
  toward?: number;
}

export interface BeachData {
  name: BeachId;
  title: string;
  W: number;
  H: number;
  /** Field px per cm: how big the animals are drawn. */
  pxcm: number;
  labels: string[];
  rocks: Rock[];
  /** Spots by kind: [x, y, ...extra] in field px. */
  slots: Record<string, number[][]>;
  weeds: Weed[];
}

// ------------------------------------------------------------ habitats

/**
 * Where each animal turns up, by slot kind, with a weight. `under` is under a
 * loose rock, `under-big` under a boulder too heavy to turn in one go. Slot
 * kinds come from build-beaches.py: cobble (stone, gap, puddle), potholes
 * (pothole, bench), boulder (pool, gravel), sand (sand, wrack, and runnel for
 * the shallow pool at the big rock's foot), bench (crack, bed-edge, pool,
 * rock) and channel (floor, boulder, ledge).
 */
export const HABITAT: Record<string, Partial<Record<string, number>>> = {
  "purple-shore-crab": { under: 6, crack: 1 },
  "green-shore-crab": { under: 6 },
  "kelp-crab": { floor: 4, pool: 1 },
  "red-rock-crab": { "under-big": 4, floor: 2, runnel: 1 },
  "porcelain-crab": { under: 5, "under-big": 2 },
  "hairy-hermit-crab": { puddle: 3, pothole: 3, pool: 2, runnel: 2 },
  "grainyhand-hermit-crab": {
    puddle: 3,
    pothole: 3,
    pool: 2,
    runnel: 2,
    gap: 1,
  },
  "ochre-star": { "bed-edge": 6, pool: 2, ledge: 2, pothole: 1 },
  "sunflower-star": { floor: 2, pool: 1 },
  "six-rayed-star": { under: 3, pothole: 2, pool: 1 },
  "blood-star": { pool: 2, floor: 2, pothole: 1 },
  "leather-star": { pool: 2, floor: 2 },
  "giant-green-anemone": { pool: 4, pothole: 2, floor: 2 },
  "aggregating-anemone": { pothole: 1, pool: 1 },
  "painted-anemone": { floor: 2, pool: 2, pothole: 1 },
  "opalescent-nudibranch": { pool: 2, pothole: 2, floor: 2 },
  "sea-lemon": { pool: 1, floor: 2 },
  "clown-nudibranch": { pool: 1, floor: 2, pothole: 1 },
  "leopard-dorid": { pool: 1, floor: 2, under: 1 },
  "gumboot-chiton": { floor: 2, pool: 1 },
  "black-katy-chiton": { stone: 2, bench: 3, rock: 3, crack: 2, ledge: 2 },
  "lined-chiton": { pool: 2, pothole: 2, under: 1, floor: 1 },
  "black-turban-snail": {
    stone: 3,
    bench: 3,
    pothole: 3,
    pool: 2,
    puddle: 2,
    rock: 2,
  },
  "frilled-dogwinkle": { "bed-edge": 3, stone: 2, crack: 1, bench: 1 },
  "checkered-periwinkle": { stone: 3, bench: 3, rock: 3, crack: 2 },
  "moon-snail": { sand: 4, runnel: 2 },
  "ribbed-limpet": { stone: 3, bench: 2, rock: 3 },
  "plate-limpet": { stone: 2, pool: 1, rock: 2, pothole: 1 },
  "purple-sea-urchin": { pool: 4, pothole: 4, floor: 3 },
  "green-sea-urchin": { pool: 1, floor: 2, pothole: 1 },
  "red-sea-urchin": { floor: 3, pool: 1 },
  "gooseneck-barnacle": { crack: 5, ledge: 2 },
  "california-mussel": { ledge: 1 },
  "tidepool-sculpin": { pool: 3, pothole: 3, puddle: 3, runnel: 2, floor: 1 },
  "penpoint-gunnel": { under: 4, floor: 1 },
  "high-cockscomb": { under: 5 },
  "tidepool-shrimp": { pool: 2, pothole: 2, puddle: 2, runnel: 1, floor: 1 },
  "california-sea-cucumber": { floor: 2, pool: 1, "under-big": 1 },
  "giant-pacific-octopus": { "under-big": 2, floor: 1 },
};

/** Slot kinds that are under water, so the water is drawn over them. */
export const WET_SLOTS = new Set([
  "puddle",
  "pothole",
  "pool",
  "runnel",
  "floor",
  "boulder",
]);

/** How many animals each kind of spot gets on a deal. */
const PER_KIND: Record<string, number> = {
  stone: 6,
  gap: 2,
  puddle: 3,
  pothole: 9,
  bench: 6,
  pool: 7,
  gravel: 0,
  sand: 3,
  runnel: 3,
  wrack: 0,
  crack: 5,
  "bed-edge": 4,
  rock: 5,
  floor: 12,
  boulder: 0,
  ledge: 4,
};

/** How big each animal is drawn, cm across what its cutout shows. Small ones
 *  are drawn a little larger than life so they can be seen and tapped. */
export const MIN_CM = 2.4;

// ------------------------------------------------------------ labels

/** What a tap on the ground says, by label. A species id logs that animal. */
export interface OtherLife {
  common: string;
  scientific: string;
  fact: string;
}

export const LABEL_SPECIES = new Set([
  "acorn-barnacle",
  "california-mussel",
  "gooseneck-barnacle",
  "aggregating-anemone",
]);

export const OTHER_LIFE: Record<string, OtherLife> = {
  coralline: {
    common: "Coralline algae",
    scientific: "Corallinales",
    fact: "Red algae that build calcium carbonate into their walls, so these pink crusts feel like stone.",
  },
  sponge: {
    common: "Red encrusting sponge",
    scientific: "",
    fact: "A sponge growing as a thin crust on the shaded underside of a rock. Several kinds here look alike.",
  },
  film: {
    common: "Green algae film",
    scientific: "",
    fact: "A film of diatoms and young green algae. Snails and limpets scrape it off the rock with their rasping tongues.",
  },
  "bull-kelp": {
    common: "Bull kelp",
    scientific: "Nereocystis luetkeana",
    fact: "It lives one season, growing from a spore to as much as 30 m long, held up by a single gas-filled float.",
  },
  eelgrass: {
    common: "Eelgrass",
    scientific: "Zostera marina",
    fact: "A flowering plant, not a seaweed. It grows in meadows on sand and mud and washes up in drifts after storms.",
  },
  "tube-worms": {
    common: "Spiral tube worms",
    scientific: "Spirorbinae",
    fact: "Each tiny white coil is the limy tube of a worm a few millimetres long, which fans out feathery gills when the tide covers it.",
  },
  surfgrass: {
    common: "Surfgrass",
    scientific: "Phyllospadix sp.",
    fact: "A flowering plant, not a seaweed. It grows on surf-swept rock in the low zone and even flowers underwater.",
  },
  "sea-lettuce": {
    common: "Sea lettuce",
    scientific: "Ulva sp.",
    fact: "A green seaweed only two cells thick, thin enough to see light through.",
  },
  rockweed: {
    common: "Rockweed",
    scientific: "Fucus distichus",
    fact: "The swollen tips hold its reproductive cells, and at low tide its fronds keep the animals under them wet.",
  },
  kelp: {
    common: "Kelp",
    scientific: "Laminariales",
    fact: "Flat brown blades held to the rock by a root-like holdfast. Kelp crabs climb them and eat them.",
  },
};

/** Plain lines for bare ground. */
export const GROUND_SAYS: Record<string, string> = {
  rock: "Bare rock.",
  gravel: "Gravel and broken shell.",
  sand: "Wet sand.",
  water: "Just water over the bottom.",
  sandstone: "Bare sandstone.",
  cobble: "A stone too wedged in to move.",
  shells: "Pieces of clam and cockle shell, broken up by the waves.",
  tracks: "Tracks in the sand.",
};

// ------------------------------------------------------------ the deal

export interface Placed {
  id: string;
  /** The slot kind it sits on, or 'under' with `rock` set. */
  on: string;
  rock: number | null;
  x: number;
  y: number;
  /** Radians, and how big to draw it, cm across. */
  rot: number;
  cm: number;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RARITY: Record<TidepoolSpecies["rarity"], number> = {
  common: 6,
  uncommon: 3,
  rare: 1,
};

function weighted<T>(
  items: T[],
  weight: (t: T) => number,
  R: () => number,
): T | null {
  let total = 0;
  for (const it of items) total += weight(it);
  if (total <= 0) return null;
  let r = R() * total;
  for (const it of items) if ((r -= weight(it)) <= 0) return it;
  return items[items.length - 1];
}

/** Who can sit on a kind of spot, weighted by habitat and rarity. */
export function candidates(kind: string): TidepoolSpecies[] {
  return SPECIES.filter((s) => (HABITAT[s.id]?.[kind] ?? 0) > 0);
}

/** cm across the cutout of `id`, from `sizes` (the cutouts' own record). */
export function drawCm(id: string, sizes: Record<string, number>): number {
  return Math.max(MIN_CM, sizes[id] ?? 5);
}

function inside(pts: [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      hit = !hit;
  }
  return hit;
}

/** Where a rock lies once it's over: its outline mirrored across the hinge. */
export function landing(rock: Rock): [number, number][] {
  const ux = Math.cos(rock.fall);
  const uy = Math.sin(rock.fall);
  let e = -Infinity;
  for (const [x, y] of rock.pts)
    e = Math.max(e, (x - rock.cx) * ux + (y - rock.cy) * uy);
  return rock.pts.map(([x, y]) => {
    const p = (x - rock.cx) * ux + (y - rock.cy) * uy;
    return [x + ux * 2 * (e - p), y + uy * 2 * (e - p)];
  });
}

/** The hinge's distance from the rock's centre along its fall. */
export function hingeReach(rock: Rock): number {
  const ux = Math.cos(rock.fall);
  const uy = Math.sin(rock.fall);
  let e = -Infinity;
  for (const [x, y] of rock.pts)
    e = Math.max(e, (x - rock.cx) * ux + (y - rock.cy) * uy);
  return e;
}

/**
 * Put animals on a beach. Each kind of spot gets a few animals that live
 * there, rarer ones less often; each loose rock hides none to two (the big
 * boulder three to five). Animals keep clear of each other, of the rocks and
 * of where each rock lands when it's turned over. `must` are species that
 * have to be on this beach (today's three), placed first where they can live.
 */
export function deal(
  beach: BeachData,
  seed: number,
  sizes: Record<string, number>,
  must: string[] = [],
): Placed[] {
  const R = rng(seed);
  const px = beach.pxcm;
  const out: Placed[] = [];
  const keepOut: { x: number; y: number; r: number }[] = [];
  for (const rock of beach.rocks) {
    const land = landing(rock);
    let lx = 0;
    let ly = 0;
    for (const [x, y] of land) {
      lx += x;
      ly += y;
    }
    keepOut.push({
      x: rock.cx,
      y: rock.cy,
      r: Math.max(rock.rx, rock.ry) * 1.05,
    });
    keepOut.push({
      x: lx / land.length,
      y: ly / land.length,
      r: Math.max(rock.rx, rock.ry) * 1.1,
    });
  }
  const clearOfRocks = (x: number, y: number, r: number) =>
    !keepOut.some((k) => Math.hypot(k.x - x, k.y - y) < k.r + r * 0.6);
  const clear = (x: number, y: number, r: number) =>
    clearOfRocks(x, y, r) &&
    !out.some(
      (p) =>
        p.rock === null &&
        Math.hypot(p.x - x, p.y - y) < (drawCm(p.id, sizes) * px) / 2 + r * 0.9,
    );

  const lives = (id: string, rock: Rock) =>
    (HABITAT[id]?.under ?? 0) +
      (rock.heavy > 1 ? (HABITAT[id]?.["under-big"] ?? 0) : 0) >
    0;
  const fits = (id: string, rock: Rock) =>
    drawCm(id, sizes) * px < Math.min(rock.rx, rock.ry) * 1.6;

  // Today's three that hide under rocks each get their rock first: a loose
  // one they fit under if they live under loose rocks, else the boulder, so
  // a small crab can't take the room a sea cucumber needs under the boulder.
  const assigned = new Map<number, string[]>();
  for (const id of must) {
    const room = (r: Rock) => Math.min(r.rx, r.ry);
    const used = (i: number) => assigned.get(i)?.length ?? 0;
    const pick = beach.rocks
      .map((rock, i) => ({ rock, i }))
      .filter(({ rock }) => lives(id, rock))
      .sort(
        (a, b) =>
          Number(b.rock.heavy === 1 && fits(id, b.rock)) -
            Number(a.rock.heavy === 1 && fits(id, a.rock)) ||
          Number(fits(id, b.rock)) - Number(fits(id, a.rock)) ||
          used(a.i) - used(b.i) ||
          room(b.rock) - room(a.rock),
      )[0];
    if (pick) assigned.set(pick.i, [...(assigned.get(pick.i) ?? []), id]);
  }

  // Under each rock, the biggest first so they get the room.
  const underFor = (rock: Rock, i: number) => {
    const big = rock.heavy > 1;
    const wants = (assigned.get(i) ?? []).sort(
      (a, b) => drawCm(b, sizes) - drawCm(a, sizes),
    );
    const n = Math.max(
      wants.length,
      big ? 3 + Math.floor(R() * 3) : R() < 0.2 ? 0 : R() < 0.6 ? 1 : 2,
    );
    const pool = SPECIES.filter((s) => lives(s.id, rock));
    const placedHere: Placed[] = [];
    // Spread out under the rock, inside its outline. One of today's three
    // still goes in if there's no room left, a little crowded.
    const put = (sp: TidepoolSpecies, tries: number, crowd: boolean) => {
      for (let t = 0; t < tries; t++) {
        const a = R() * Math.PI * 2;
        const d = Math.sqrt(R()) * (big ? 0.72 : 0.55);
        const x = rock.cx + Math.cos(a) * rock.rx * d;
        const y = rock.cy + Math.sin(a) * rock.ry * d;
        const r = (drawCm(sp.id, sizes) * px) / 2;
        if (!inside(rock.pts, x, y)) continue;
        if (
          !crowd &&
          placedHere.some(
            (p) =>
              Math.hypot(p.x - x, p.y - y) <
              (drawCm(p.id, sizes) * px) / 2 + r * 0.7,
          )
        )
          continue;
        const p: Placed = {
          id: sp.id,
          on: "under",
          rock: i,
          x,
          y,
          rot: R() * Math.PI * 2,
          cm: drawCm(sp.id, sizes),
        };
        placedHere.push(p);
        out.push(p);
        return true;
      }
      return false;
    };
    for (let k = 0; k < n; k++) {
      const want = wants[k];
      const sp = want
        ? SPECIES.find((s) => s.id === want)!
        : weighted(
            pool.filter(
              (s) => fits(s.id, rock) && !placedHere.some((p) => p.id === s.id),
            ),
            (s) =>
              RARITY[s.rarity] *
              ((HABITAT[s.id]?.under ?? 0) +
                (big ? (HABITAT[s.id]?.["under-big"] ?? 0) : 0)),
            R,
          );
      if (!sp) break;
      if (!put(sp, 20, false) && want) put(sp, 40, true);
    }
  };
  beach.rocks.forEach((rock, i) => underFor(rock, i));

  // Out in the open, kind by kind. Today's three first, where they can live.
  const kinds = Object.keys(beach.slots).filter((k) => (PER_KIND[k] ?? 0) > 0);
  const spots: Record<string, number[][]> = {};
  for (const k of kinds) spots[k] = [...beach.slots[k]];
  const place = (sp: TidepoolSpecies, kind: string, crowd = false): boolean => {
    const list = spots[kind];
    const r = (drawCm(sp.id, sizes) * px) / 2;
    for (let j = 0; j < list.length; j++) {
      const [x, y, room] = list[j];
      if (room !== undefined && r > room * 1.4 && kind !== "pothole") continue;
      if (crowd ? !clearOfRocks(x, y, r) : !clear(x, y, r)) continue;
      list.splice(j, 1);
      out.push({
        id: sp.id,
        on: kind,
        rock: null,
        x,
        y,
        rot: R() * Math.PI * 2,
        cm: drawCm(sp.id, sizes),
      });
      return true;
    }
    return false;
  };
  for (const id of must) {
    if (out.some((p) => p.id === id)) continue;
    const sp = SPECIES.find((s) => s.id === id);
    if (!sp) continue;
    const ks = kinds
      .filter((k) => (HABITAT[id]?.[k] ?? 0) > 0)
      .sort(() => R() - 0.5);
    // If every spot it lives in is taken, it shares one rather than go missing.
    if (!ks.some((k) => place(sp, k))) ks.some((k) => place(sp, k, true));
  }
  for (const kind of kinds) {
    const want = PER_KIND[kind];
    let got = out.filter((p) => p.on === kind).length;
    let tries = 0;
    while (got < want && tries++ < want * 6) {
      const sp = weighted(
        candidates(kind),
        (s) => RARITY[s.rarity] * (HABITAT[s.id]![kind] ?? 0),
        R,
      );
      if (!sp) break;
      // Not too many of one kind on a beach, except snails and limpets.
      const same = out.filter((p) => p.id === sp.id).length;
      if (same >= (/snail|periwinkle|limpet|urchin/.test(sp.id) ? 3 : 1))
        continue;
      if (place(sp, kind)) got++;
    }
  }
  return out;
}

/** Which beaches an animal can turn up on, from their slot kinds. */
export function beachesFor(
  id: string,
  beaches: Record<BeachId, BeachData>,
): BeachId[] {
  return (Object.keys(beaches) as BeachId[]).filter((b) => {
    const kinds = Object.keys(beaches[b].slots);
    if (beaches[b].rocks.length) kinds.push("under");
    if (beaches[b].rocks.some((r) => r.heavy > 1)) kinds.push("under-big");
    return kinds.some(
      (k) =>
        (HABITAT[id]?.[k] ?? 0) > 0 &&
        ((PER_KIND[k] ?? 0) > 0 || k.startsWith("under")),
    );
  });
}

// ------------------------------------------------------------ the daily three

/** A day's number, from the visitor's own calendar date. */
export function dayNumber(d: Date): number {
  return Math.floor(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000,
  );
}

/**
 * The beach the toy opens on, and where today's three live: sand, loose
 * rocks, one big rock and a small pool, so a first visit has a bit of
 * everything (Truman, 2026-11-17). New beach goes through the rest.
 */
export const HOME_BEACH: BeachId = "sand";

/**
 * The clue for each animal in today's three: one of its own facts, the one
 * that says how to know it without naming it. Facts are already checked
 * (species-facts.test.ts), so clues don't add new claims.
 */
export const CLUE_FACT: Record<string, number> = {
  "purple-shore-crab": 0,
  "green-shore-crab": 0,
  "kelp-crab": 0,
  "red-rock-crab": 0,
  "porcelain-crab": 0,
  "hairy-hermit-crab": 0,
  "grainyhand-hermit-crab": 0,
  "ochre-star": 1,
  "sunflower-star": 0,
  "six-rayed-star": 0,
  "blood-star": 0,
  "leather-star": 0,
  "giant-green-anemone": 0,
  "aggregating-anemone": 0,
  "painted-anemone": 0,
  "opalescent-nudibranch": 0,
  "sea-lemon": 0,
  "clown-nudibranch": 0,
  "leopard-dorid": 0,
  "gumboot-chiton": 0,
  "black-katy-chiton": 0,
  "lined-chiton": 0,
  "black-turban-snail": 0,
  "frilled-dogwinkle": 0,
  "checkered-periwinkle": 0,
  "moon-snail": 0,
  "ribbed-limpet": 0,
  "plate-limpet": 0,
  "purple-sea-urchin": 0,
  "green-sea-urchin": 0,
  "red-sea-urchin": 0,
  "gooseneck-barnacle": 0,
  "california-mussel": 0,
  "tidepool-sculpin": 1,
  "penpoint-gunnel": 0,
  "high-cockscomb": 0,
  "tidepool-shrimp": 0,
  "california-sea-cucumber": 0,
  "giant-pacific-octopus": 0,
};

export function clueFor(sp: TidepoolSpecies): string {
  return sp.facts[CLUE_FACT[sp.id] ?? 0] ?? sp.facts[0];
}

/** Three animals that live on the home beach, the same for everyone that day. */
export function todaysThree(day: number, beach: BeachData): string[] {
  const R = rng(day * 2654435761);
  const kinds = new Set(
    Object.keys(beach.slots).filter((k) => (PER_KIND[k] ?? 0) > 0),
  );
  if (beach.rocks.length) kinds.add("under");
  if (beach.rocks.some((r) => r.heavy > 1)) kinds.add("under-big");
  const pool = SPECIES.filter(
    (s) =>
      [...kinds].some((k) => (HABITAT[s.id]?.[k] ?? 0) > 0) &&
      CLUE_FACT[s.id] !== undefined,
  );
  const out: string[] = [];
  while (out.length < 3 && out.length < pool.length) {
    const sp = weighted(
      pool.filter((s) => !out.includes(s.id)),
      (s) => RARITY[s.rarity] + 1,
      R,
    );
    if (!sp) break;
    out.push(sp.id);
  }
  return out;
}

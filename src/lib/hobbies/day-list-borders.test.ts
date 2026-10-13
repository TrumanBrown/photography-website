import { describe, it, expect } from "vitest";
import {
  borderFade,
  borderLevelFor,
  borderZoom,
  cellsInView,
  decodeGroup,
  stateShare,
} from "./day-list-borders";
import index from "./day-list-borders/index.json";

interface BorderFile {
  precision: number;
  groups: [number, number, string][];
}
const files = import.meta.glob<BorderFile>("./day-list-borders/l*.json", {
  eager: true,
  import: "default",
});
const nameOf = (path: string) =>
  path.replace("./day-list-borders/", "").replace(".json", "");
const levels = index.levels as {
  from: number;
  file?: string;
  cells?: number[][];
}[];

/** The encoder the build uses, so the tests can make their own strings. */
function encode(lines: number[][][], precision: number): string {
  const num = (v: number) => {
    let z = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (z >= 0x20) {
      s += String.fromCharCode((0x20 | (z & 0x1f)) + 63);
      z >>= 5;
    }
    return s + String.fromCharCode(z + 63);
  };
  let px = 0;
  let py = 0;
  return lines
    .map((line) =>
      line
        .map(([lon, lat]) => {
          const x = Math.round(lon * precision);
          const y = Math.round(lat * precision);
          const s = num(x - px) + num(y - py);
          px = x;
          py = y;
          return s;
        })
        .join(""),
    )
    .join(" ");
}

describe("decodeGroup", () => {
  it("reads Google's polyline encoding, first number first", () => {
    // Google's worked example, which puts latitude first; here it reads as
    // longitude first, the order the borders are stored in.
    const [line] = decodeGroup("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 1e5);
    expect([...line.pts].map((v) => Math.round(v * 1000) / 1000)).toEqual([
      38.5, -120.2, 40.7, -120.95, 43.252, -126.453,
    ]);
    expect(line.w).toBeCloseTo(38.5);
    expect(line.e).toBeCloseTo(43.252);
    expect(line.s).toBeCloseTo(-126.453);
    expect(line.n).toBeCloseTo(-120.2);
  });

  it("splits lines at spaces, each starting where the last one ended", () => {
    const lines = [
      [
        [-122.5, 47.25],
        [-122.25, 47.5],
      ],
      [
        [10, 50],
        [10.5, 49.5],
        [11, 50],
      ],
    ];
    const decoded = decodeGroup(encode(lines, 100), 100);
    expect(decoded).toHaveLength(2);
    expect([...decoded[1].pts]).toEqual([10, 50, 10.5, 49.5, 11, 50]);
    expect(decoded[1]).toMatchObject({ w: 10, e: 11, s: 49.5, n: 50 });
  });

  it("drops a line that's only one point", () => {
    const text = encode(
      [
        [[5, 5]],
        [
          [6, 6],
          [7, 7],
        ],
      ],
      100,
    );
    expect(decodeGroup(text, 100)).toHaveLength(1);
  });
});

describe("zoom and fading", () => {
  it("counts zoom from a world 256 pixels across", () => {
    expect(borderZoom(256)).toBe(0);
    expect(borderZoom(1024)).toBe(2);
  });

  it("fades a line in over three quarters of a zoom step", () => {
    expect(borderFade(3, 2.5)).toBe(0);
    expect(borderFade(3, 3)).toBe(0);
    expect(borderFade(3, 3.375)).toBeCloseTo(0.5);
    expect(borderFade(3, 3.75)).toBe(1);
    expect(borderFade(-1, 0)).toBe(1);
  });

  it("keeps state lines off at world view", () => {
    expect(stateShare(1)).toBe(0);
    expect(stateShare(1.35)).toBeCloseTo(0.5);
    expect(stateShare(2)).toBe(1);
  });

  it("picks a finer level as a pixel covers less of the world", () => {
    expect(borderLevelFor(0.5)).toBe(0);
    expect(borderLevelFor(0.1)).toBe(0);
    expect(borderLevelFor(0.05)).toBe(1);
    expect(borderLevelFor(0.01)).toBe(2);
    expect(borderLevelFor(0)).toBe(2);
  });

  it("finds the cells whose lines reach into a view", () => {
    const cells = [
      [0, 0, -180, 30, -120, 90],
      [1, 0, -125, 30, -60, 90],
      [3, 1, 0, -30, 60, 30],
    ];
    expect(cellsInView(cells, -122, 45, -121, 46)).toEqual(["0-0", "1-0"]);
    expect(cellsInView(cells, 10, 0, 20, 10)).toEqual(["3-1"]);
    expect(cellsInView(cells, 100, 0, 110, 10)).toEqual([]);
  });
});

describe("the built borders", () => {
  it("goes from coarse to fine, ending at the closest zoom", () => {
    const from = levels.map((l) => l.from);
    expect(from).toEqual([...from].sort((a, b) => b - a));
    expect(from.at(-1)).toBe(0);
    expect(levels[0].file).toBe("l0");
  });

  it("has a file for every cell the index lists, and nothing else", () => {
    const named = levels.flatMap((l, i) =>
      l.file ? [l.file] : (l.cells ?? []).map((c) => `l${i}-${c[0]}-${c[1]}`),
    );
    expect(Object.keys(files).map(nameOf).sort()).toEqual([...named].sort());
  });

  it("decodes to lines on the globe, inside their cell's box", () => {
    for (const [i, level] of levels.entries()) {
      const chunks = level.file
        ? [{ name: level.file, box: [-180, -90, 180, 90] }]
        : (level.cells ?? []).map((c) => ({
            name: `l${i}-${c[0]}-${c[1]}`,
            box: c.slice(2),
          }));
      for (const { name, box } of chunks) {
        const file = files[`./day-list-borders/${name}.json`];
        for (const [kind, zoom, text] of file.groups) {
          expect([0, 1, 2]).toContain(kind);
          // Country borders show at every zoom; states from their own.
          if (kind < 2) expect(zoom).toBe(-1);
          for (const line of decodeGroup(text, file.precision)) {
            expect(line.w).toBeGreaterThanOrEqual(box[0]);
            expect(line.s).toBeGreaterThanOrEqual(box[1]);
            expect(line.e).toBeLessThanOrEqual(box[2]);
            expect(line.n).toBeLessThanOrEqual(box[3]);
          }
        }
      }
    }
  });

  it("draws countries from the start and the big federations' states first", () => {
    const l0 = files["./day-list-borders/l0.json"];
    const kinds = new Set(l0.groups.map((g) => g.at(0)));
    expect(kinds.has(0)).toBe(true);
    const stateZooms = l0.groups.filter((g) => g[0] === 2).map((g) => g[1]);
    expect(Math.min(...stateZooms)).toBeLessThan(2);
  });

  it("leaves out state lines drawn across open sea", () => {
    // Between Valencia and Ibiza, where Natural Earth draws a region line.
    for (const [path, file] of Object.entries(files)) {
      for (const [kind, , text] of file.groups) {
        if (kind !== 2) continue;
        for (const line of decodeGroup(text, file.precision)) {
          const inSea =
            line.w >= 0.4 && line.e <= 1.0 && line.s >= 38.5 && line.n <= 39.1;
          expect(inSea, `${path} has a line in the sea`).toBe(false);
        }
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { PALETTES, recolour, type Frame } from "./day-list-pixel";

/** A frame of relief greys, one row per array, as the map draws them. */
function frame(rows: number[][]): Frame {
  const H = rows.length;
  const W = rows[0].length;
  const d = new Uint8ClampedArray(W * H * 4);
  rows.forEach((row, y) =>
    row.forEach((g, x) => d.set([g, g, g, 255], (y * W + x) * 4)),
  );
  return { d, W, H, P: PALETTES.day };
}

const pixel = (f: Frame, x: number, y: number) =>
  Array.from(f.d.slice((y * f.W + x) * 4, (y * f.W + x) * 4 + 3));

describe("recolour", () => {
  it("paints sea, coast and the land steps", () => {
    const f = frame([
      [0, 0, 0, 0],
      [0, 230, 230, 0],
      [0, 230, 230, 0],
      [0, 0, 0, 0],
    ]);
    recolour(f, new Uint8Array(16));
    expect(pixel(f, 0, 0)).toEqual(PALETTES.day.sea);
    expect(pixel(f, 0, 1)).toEqual(PALETTES.day.shallow);
    // Snow stays snow on the coast; lower land would turn to sand.
    expect(pixel(f, 1, 1)).toEqual(PALETTES.day.land[4]);
  });

  it("dots the graticule over the sea and never across the land", () => {
    const f = frame([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 230, 230],
      [0, 0, 230, 230],
    ]);
    const grid = {
      cols: Uint8Array.from([0, 0, 0, 1]),
      rows: Uint8Array.from([1, 0, 0, 0]),
    };
    recolour(f, new Uint8Array(16), Infinity, grid);
    expect(pixel(f, 0, 0)).toEqual(PALETTES.day.dots);
    expect(pixel(f, 3, 1)).toEqual(PALETTES.day.shallow);
    expect(pixel(f, 3, 3)).toEqual(PALETTES.day.land[4]);
  });

  it("gives the world's last row the ground above it, not a fringe of strays", () => {
    const rows = [
      [140, 140, 140, 140, 140, 140],
      [140, 140, 140, 140, 140, 140],
      [140, 140, 140, 140, 140, 140],
      [140, 30, 140, 30, 140, 30],
    ];
    const f = frame(rows);
    recolour(f, new Uint8Array(24), 4);
    const last = [0, 1, 2, 3, 4, 5].map((x) => pixel(f, x, 3).join());
    expect(new Set(last)).toEqual(new Set([pixel(f, 2, 2).join()]));
  });
});

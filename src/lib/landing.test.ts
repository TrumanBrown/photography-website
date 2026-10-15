import { describe, expect, it } from "vitest";
import {
  dotsArt,
  LANDING_KEY,
  landingBootstrap,
  planReveal,
  REVEAL_MS,
  settleBox,
  windowAt,
} from "./landing";

/** Run the inline <head> script against a fake page and report what it did. */
function boot(options: { note?: unknown; path: string; reduced?: boolean }) {
  const store = new Map<string, string>();
  if (options.note !== undefined)
    store.set(LANDING_KEY, JSON.stringify(options.note));
  const classes = new Set<string>();
  const props = new Map<string, string>();
  const win: Record<string, unknown> = {
    matchMedia: () => ({ matches: Boolean(options.reduced) }),
  };
  const timers: number[] = [];
  const run = new Function(
    "sessionStorage",
    "location",
    "document",
    "window",
    "setTimeout",
    landingBootstrap,
  );
  run(
    {
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => store.delete(key),
    },
    { pathname: options.path },
    {
      documentElement: {
        classList: {
          add: (c: string) => classes.add(c),
          remove: (c: string) => classes.delete(c),
        },
        style: {
          setProperty: (name: string, value: string) => props.set(name, value),
        },
      },
    },
    win,
    (_: () => void, ms: number) => timers.push(ms),
  );
  return {
    landing: classes.has("landing"),
    dots: classes.has("landing-dots"),
    left: store.has(LANDING_KEY),
    timers,
    art: props.get("--landing-dots"),
    note: win.landingNote,
  };
}

describe("landingBootstrap", () => {
  it("is hashed as written, so it can't contain escapes or placeholders", () => {
    expect(landingBootstrap).not.toContain("\\");
    expect(landingBootstrap).not.toContain("${");
    expect(landingBootstrap).toContain(`'${LANDING_KEY}'`);
  });

  it("opens the page on the photograph when a spin is landing here", () => {
    const result = boot({
      note: { path: "/sessions/olympic-winter-2026/", at: Date.now() },
      path: "/sessions/olympic-winter-2026/",
    });
    expect(result.landing).toBe(true);
    expect(result.left).toBe(false);
    // and never leaves the page hidden for good
    expect(result.timers).toEqual([4000]);
  });

  it("opens a hobby page on bare paper when a card dived into it", () => {
    const result = boot({
      note: {
        path: "/hobbies/aquarium-keeping/",
        at: Date.now(),
        kind: "dots",
      },
      path: "/hobbies/aquarium-keeping/",
    });
    expect(result).toMatchObject({ dots: true, landing: false, left: false });
    expect(result.timers).toEqual([4000]);
  });

  it("paints a scene's last dots before the first paint, and keeps the note", () => {
    const note = {
      path: "/hobbies/fishing/",
      at: Date.now(),
      kind: "dots",
      dots: [10, 20, 30],
      w: 400,
      h: 300,
      art: dotsArt([10, 20, 30], 400, 300, "rgb(22, 21, 15)"),
    };
    const result = boot({ note, path: "/hobbies/fishing/" });
    expect(result.dots).toBe(true);
    expect(result.art).toBe(note.art);
    expect(result.note).toEqual(note);
  });

  it("matches with or without the trailing slash", () => {
    const result = boot({
      note: { path: "/sessions/olympic-winter-2026/", at: Date.now() },
      path: "/sessions/olympic-winter-2026",
    });
    expect(result.landing).toBe(true);
  });

  it("ignores a note meant for another page, or an old one, and clears it", () => {
    const elsewhere = boot({
      note: { path: "/sessions/tibet-spring-2026/", at: Date.now() },
      path: "/sessions/olympic-winter-2026/",
    });
    expect(elsewhere).toMatchObject({ landing: false, left: false });
    const stale = boot({
      note: { path: "/sessions/olympic-winter-2026/", at: Date.now() - 60_000 },
      path: "/sessions/olympic-winter-2026/",
    });
    expect(stale).toMatchObject({ landing: false, left: false });
  });

  it("does nothing on an ordinary visit, or with reduced motion", () => {
    expect(boot({ path: "/" })).toMatchObject({ landing: false });
    const reduced = boot({
      note: { path: "/sessions/olympic-winter-2026/", at: Date.now() },
      path: "/sessions/olympic-winter-2026/",
      reduced: true,
    });
    expect(reduced.landing).toBe(false);
  });

  it("survives a note it can't read", () => {
    expect(boot({ note: "not json {", path: "/" }).landing).toBe(false);
  });
});

describe("settleBox", () => {
  const screen = { left: 0, top: 0, width: 1425, height: 900 };
  const banner = { left: 264, top: 0, width: 1109, height: 468 };

  it("starts full screen and ends exactly on the banner", () => {
    expect(settleBox(screen, banner, 0)).toEqual(screen);
    expect(settleBox(screen, banner, 1)).toEqual(banner);
  });

  it("moves one way only, easing in and out", () => {
    let previous = settleBox(screen, banner, 0);
    for (let k = 0.01; k <= 1.0001; k += 0.01) {
      const box = settleBox(screen, banner, k);
      expect(box.width).toBeLessThanOrEqual(previous.width + 1e-9);
      expect(box.left).toBeGreaterThanOrEqual(previous.left - 1e-9);
      previous = box;
    }
    const early = settleBox(screen, banner, 0.02);
    expect(screen.width - early.width).toBeLessThan(1);
  });
});

describe("dotsArt", () => {
  it("is a CSS background layer of the dots, stretched to the screen", () => {
    const art = dotsArt([10, 20, 30, 50.5, 60, 7], 400, 300, "rgb(22, 21, 15)");
    expect(art.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(art.endsWith('") 0 0 / 100% 100% no-repeat')).toBe(true);
    const data = art.slice(5, art.indexOf('")'));
    const svg = decodeURIComponent(data.slice("data:image/svg+xml,".length));
    expect(svg).toContain("viewBox='0 0 400 300'");
    expect(svg.match(/<circle /g)).toHaveLength(2);
    expect(svg).toContain("cx='50.5' cy='60' r='7'");
    // Nothing in the URL that could end it early.
    expect(data).not.toMatch(/["#\s]/);
  });
});

describe("planReveal", () => {
  const w = 1440;
  const h = 900;
  // A scene's last frame: big dots over part of the screen, bare paper elsewhere.
  const dots: number[] = [];
  for (let y = 60; y < 700; y += 110)
    for (let x = 80; x < 900; x += 120) dots.push(x + (y % 3) * 9, y, 44);

  for (const reveal of [
    { from: [0.5, 0.5] as const },
    { wave: [-1, 0] as const },
    { wave: [0.35, 1] as const },
  ]) {
    it(`opens the whole screen in the end (${JSON.stringify(reveal)})`, () => {
      const wins = planReveal(dots, w, h, reveal);
      for (let y = 0; y <= h; y += 15)
        for (let x = 0; x <= w; x += 15) {
          const open = wins.some(
            (v) => Math.hypot(x - v.x, y - v.y) <= windowAt(v, REVEAL_MS).hole,
          );
          expect(open, `paper left at ${x}, ${y}`).toBe(true);
        }
    });
  }

  it("starts as exactly the dots the scene ended on", () => {
    const wins = planReveal(dots, w, h);
    const inked = wins.filter((v) => v.r > 0);
    expect(inked).toHaveLength(dots.length / 3);
    for (const v of inked)
      expect(windowAt(v, 0)).toEqual({ hole: 0, ring: v.r });
  });

  it("opens from the point it's given, in order", () => {
    const wins = planReveal(dots, w, h, { from: [0, 0] });
    const nearest = wins.reduce((a, b) =>
      Math.hypot(a.x, a.y) < Math.hypot(b.x, b.y) ? a : b,
    );
    expect(nearest.delay).toBe(0);
    for (const v of wins) expect(v.delay).toBeLessThanOrEqual(REVEAL_MS);
  });

  it("turns each dot into a ring that thins away as its window opens", () => {
    const [v] = planReveal(dots, w, h);
    let gone = false;
    for (let ms = 0; ms <= REVEAL_MS; ms += 10) {
      const { hole, ring } = windowAt(v, ms);
      if (ring) {
        expect(gone).toBe(false);
        expect(ring).toBeGreaterThan(hole);
      } else if (hole > 0) gone = true;
    }
    expect(gone).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { LANDING_KEY, landingBootstrap, settleBox } from "./landing";

/** Run the inline <head> script against a fake page and report what it did. */
function boot(options: { note?: unknown; path: string; reduced?: boolean }) {
  const store = new Map<string, string>();
  if (options.note !== undefined)
    store.set(LANDING_KEY, JSON.stringify(options.note));
  const classes = new Set<string>();
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
      },
    },
    { matchMedia: () => ({ matches: Boolean(options.reduced) }) },
    (_: () => void, ms: number) => timers.push(ms),
  );
  return {
    landing: classes.has("landing"),
    left: store.has(LANDING_KEY),
    timers,
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

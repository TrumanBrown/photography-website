import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** document.fonts with a load the test settles by hand. */
function fakeFonts() {
  let settle: { resolve: () => void; reject: (e: Error) => void } | null = null;
  const fonts = {
    load: vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          settle = { resolve, reject };
        }),
    ),
    ready: Promise.resolve(),
  };
  return {
    fonts,
    resolve: () => settle?.resolve(),
    reject: () => settle?.reject(new Error("blocked")),
  };
}

describe("canvas font", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("isn't ready until Libre Franklin has loaded", async () => {
    const f = fakeFonts();
    vi.stubGlobal("document", { fonts: f.fonts });
    const { canvasFontIsReady, canvasFontReady } =
      await import("./canvas-font");

    expect(canvasFontIsReady()).toBe(false);
    expect(f.fonts.load).toHaveBeenCalledWith(
      expect.stringContaining('"Libre Franklin"'),
    );
    f.resolve();
    await canvasFontReady();
    expect(canvasFontIsReady()).toBe(true);
  });

  it("still lets text be drawn when the font can't load", async () => {
    const f = fakeFonts();
    vi.stubGlobal("document", { fonts: f.fonts });
    const { canvasFontIsReady, canvasFontReady } =
      await import("./canvas-font");

    const waiting = canvasFontReady();
    f.reject();
    await waiting;
    expect(canvasFontIsReady()).toBe(true);
  });
});

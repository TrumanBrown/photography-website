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

interface FakeWorker {
  url: string;
  options: unknown;
  posted: Array<{ message: Record<string, unknown>; transfer?: unknown[] }>;
  terminated: boolean;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
}

interface FakeCanvas {
  className: string;
  attributes: Record<string, string>;
  removed: boolean;
  width: number;
  height: number;
  style: Record<string, string>;
  /** What was asked of getContext(). */
  context?: [string, unknown];
}

/** What the head script painted on a 2D canvas: each fill, and how. */
interface Painted {
  fills: Array<{ style: string; alpha: number; dots: number[][] }>;
  rects: Array<{ style: string; rect: number[] }>;
  scale: number[];
}

/** Run the inline <head> script against a fake page and report what it did. */
function boot(options: {
  note?: unknown;
  path: string;
  reduced?: boolean;
  search?: string;
  /** Whether the fake browser can run canvases in a worker. */
  workers?: boolean;
  /** What the last page carried for the scene. */
  carried?: string;
  /** Whether a 2D canvas can be had. */
  no2d?: boolean;
}) {
  const store = new Map<string, string>();
  if (options.note !== undefined)
    store.set(LANDING_KEY, JSON.stringify(options.note));
  if (options.carried !== undefined)
    store.set("globe-landing-data", options.carried);
  const classes = new Set<string>();
  const props = new Map<string, string>();
  const workers: FakeWorker[] = [];
  const canvases: FakeCanvas[] = [];
  const appended: unknown[] = [];
  const dispatched: string[] = [];
  const painted: Painted = { fills: [], rects: [], scale: [] };
  const offscreen = { offscreen: true };
  let dots: number[][] = [];
  const pen = {
    fillStyle: "",
    globalAlpha: 1,
    fillRect(...rect: number[]) {
      painted.rects.push({ style: pen.fillStyle, rect });
    },
    scale(x: number, y: number) {
      painted.scale = [x, y];
    },
    beginPath() {
      dots = [];
    },
    moveTo() {},
    arc(x: number, y: number, r: number, from: number, to: number) {
      expect(to - from).toBeCloseTo(Math.PI * 2);
      dots.push([x, y, r]);
    },
    fill() {
      painted.fills.push({
        style: pen.fillStyle,
        alpha: pen.globalAlpha,
        dots,
      });
    },
  };
  class Worker implements FakeWorker {
    posted: FakeWorker["posted"] = [];
    terminated = false;
    onmessage: FakeWorker["onmessage"] = null;
    onerror: FakeWorker["onerror"] = null;
    constructor(
      public url: string,
      public options: unknown,
    ) {
      workers.push(this);
    }
    postMessage(message: Record<string, unknown>, transfer?: unknown[]) {
      this.posted.push({ message, transfer });
    }
    terminate() {
      this.terminated = true;
    }
  }
  const win: Record<string, unknown> = {
    matchMedia: () => ({ matches: Boolean(options.reduced) }),
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 3,
    ...(options.workers ? { Worker, OffscreenCanvas: class {} } : {}),
  };
  const timers: Array<{ ms: number; fn: () => void }> = [];
  const links: Array<Record<string, string>> = [];
  const run = new Function(
    "sessionStorage",
    "location",
    "document",
    "window",
    "setTimeout",
    "Worker",
    "HTMLCanvasElement",
    "Event",
    landingBootstrap,
  );
  run(
    {
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => store.delete(key),
    },
    { pathname: options.path, search: options.search ?? "" },
    {
      documentElement: {
        classList: {
          add: (c: string) => classes.add(c),
          remove: (c: string) => classes.delete(c),
          contains: (c: string) => classes.has(c),
        },
        style: {
          setProperty: (name: string, value: string) => props.set(name, value),
        },
        appendChild: (el: unknown) => appended.push(el),
      },
      createElement: (tag: string) => {
        if (tag !== "canvas") return {};
        const canvas: FakeCanvas & Record<string, unknown> = {
          className: "",
          attributes: {},
          removed: false,
          width: 300,
          height: 150,
          style: {},
          setAttribute: (name: string, value: string) =>
            (canvas.attributes[name] = value),
          transferControlToOffscreen: () => offscreen,
          getContext: (type: string, settings: unknown) => {
            canvas.context = [type, settings];
            return options.no2d ? null : pen;
          },
          remove: () => (canvas.removed = true),
        };
        canvases.push(canvas);
        return canvas;
      },
      head: {
        appendChild: (el: Record<string, string>) => links.push(el),
      },
      dispatchEvent: (event: { type: string }) => dispatched.push(event.type),
    },
    win,
    (fn: () => void, ms: number) => timers.push({ fn, ms }),
    Worker,
    {
      prototype: options.workers
        ? { transferControlToOffscreen: () => offscreen }
        : {},
    },
    class {
      constructor(public type: string) {}
    },
  );
  return {
    landing: classes.has("landing"),
    dots: classes.has("landing-dots"),
    left: store.has(LANDING_KEY),
    timers: timers.map((timer) => timer.ms),
    /** Run the timers set for `ms`, as if that long had passed. */
    fire(ms: number) {
      for (const timer of timers) if (timer.ms === ms) timer.fn();
    },
    classes,
    art: props.get("--landing-dots"),
    props,
    links,
    workers,
    canvases,
    appended,
    dispatched,
    painted,
    offscreen,
    win,
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

  it("eases a scene's frame in while the page loads, and fetches the scene", () => {
    const at = Date.now() - 120;
    const result = boot({
      note: {
        path: "/hobbies/birding/",
        at,
        kind: "dots",
        art: "url(x)",
        scene: { hold: 420, zoom: 1.03, module: "/_astro/index.abc.js" },
      },
      path: "/hobbies/birding/",
    });
    expect(result.dots).toBe(true);
    expect(result.props.get("--landing-zoom")).toBe("1.03");
    expect(result.props.get("--landing-hold")).toBe("420ms");
    // Started where the last page left off: some way into the hold already.
    const delay = parseFloat(result.props.get("--landing-delay")!);
    expect(delay).toBeLessThanOrEqual(-120);
    expect(delay).toBeGreaterThan(-1000);
    expect(result.links).toEqual([
      { rel: "modulepreload", href: "/_astro/index.abc.js" },
    ]);
  });

  it("leaves the hold alone when there's no scene to carry on", () => {
    const result = boot({
      note: { path: "/hobbies/birding/", at: Date.now(), kind: "dots" },
      path: "/hobbies/birding/",
    });
    expect(result.props.has("--landing-zoom")).toBe(false);
    expect(result.links).toEqual([]);
    expect(result.classes.has("landing-scene")).toBe(false);
  });

  const sceneNote = (extra: Record<string, unknown> = {}) => ({
    path: "/hobbies/birding/",
    at: Date.now() - 80,
    kind: "dots",
    ink: "#16150f",
    art: "url(x)",
    w: 1280,
    h: 800,
    scene: {
      hold: 420,
      zoom: 1.03,
      module: "/_astro/index.abc.js",
      worker: "/_astro/worker.abc.js",
      red: "#b3301c",
      paper: "#fbfaf8",
      ...extra,
    },
  });

  it("starts the scene's worker under the frame, with what the last page carried", () => {
    const note = sceneNote();
    const result = boot({
      note,
      path: "/hobbies/birding/",
      workers: true,
      carried: "carried-dots",
    });
    expect(result.dots).toBe(true);
    const [worker] = result.workers;
    expect(worker.url).toBe("/_astro/worker.abc.js");
    expect(worker.options).toEqual({ type: "module" });
    // Its canvas sits under the frame the page paints first.
    const [canvas] = result.canvases;
    expect(canvas.className).toBe("landing-veil");
    expect(canvas.attributes["aria-hidden"]).toBe("true");
    expect(result.appended).toEqual([canvas]);
    const [init, resume] = worker.posted;
    expect(init.message).toMatchObject({
      type: "init",
      canvas: result.offscreen,
      software: false,
      gl: true,
    });
    expect(init.transfer).toEqual([result.offscreen]);
    expect(resume.message).toEqual({
      type: "resume",
      slug: "birding",
      note: {
        path: note.path,
        at: note.at,
        kind: "dots",
        ink: note.ink,
        scene: note.scene,
      },
      carried: "carried-dots",
      // The view at most at twice the pixels, as the page draws it.
      view: { w: 1280, h: 800, dpr: 2 },
      red: "#b3301c",
      paper: "#fbfaf8",
    });
    // The page takes it over, with whatever it's said by then.
    const early = result.win.landingWorker as {
      worker: FakeWorker;
      canvas: FakeCanvas;
      inbox: unknown[];
    };
    expect(early.worker).toBe(worker);
    expect(early.canvas).toBe(canvas);
    worker.onmessage!({ data: { type: "shown" } });
    worker.onerror!();
    expect(early.inbox).toEqual([{ type: "shown" }, { type: "failed" }]);
    // No need for the scenes module on the page.
    expect(result.links).toEqual([]);
  });

  it("keeps the page's own animations still while a scene plays, eight seconds at most", () => {
    const result = boot({ note: sceneNote(), path: "/hobbies/birding/" });
    expect(result.classes.has("landing-scene")).toBe(true);
    expect(result.timers).toContain(8000);
    result.fire(8000);
    expect(result.classes.has("landing-scene")).toBe(false);
    expect(result.dispatched).toEqual(["landing:uncovered"]);
  });

  it("doesn't call the page uncovered twice", () => {
    const result = boot({ note: sceneNote(), path: "/hobbies/birding/" });
    // The scene ended and the page said so itself.
    result.classes.delete("landing-scene");
    result.fire(8000);
    expect(result.dispatched).toEqual([]);
  });

  it("shows the page after four seconds, stopping a worker the page never took on", () => {
    const result = boot({
      note: sceneNote(),
      path: "/hobbies/birding/",
      workers: true,
    });
    result.fire(4000);
    expect(result.classes.has("landing-dots")).toBe(false);
    expect(result.workers[0].terminated).toBe(true);
    expect(result.canvases[0].removed).toBe(true);
    expect(result.win.landingWorker).toBeUndefined();
  });

  it("leaves a worker the page took on to the page", () => {
    const result = boot({
      note: sceneNote(),
      path: "/hobbies/birding/",
      workers: true,
    });
    result.win.landingWorker = undefined;
    result.fire(4000);
    expect(result.workers[0].terminated).toBe(false);
    expect(result.canvases[0].removed).toBe(false);
  });

  it("fetches the scenes module instead where there's no worker to start", () => {
    const flagged = boot({
      note: sceneNote(),
      path: "/hobbies/birding/",
      workers: true,
      search: "?scene-main",
    });
    const unable = boot({ note: sceneNote(), path: "/hobbies/birding/" });
    const older = boot({
      note: sceneNote({ worker: undefined }),
      path: "/hobbies/birding/",
      workers: true,
    });
    for (const result of [flagged, unable, older]) {
      expect(result.workers).toEqual([]);
      expect(result.canvases).toEqual([]);
      expect(result.links).toEqual([
        { rel: "modulepreload", href: "/_astro/index.abc.js" },
      ]);
    }
  });

  const held = {
    w: 1200,
    h: 700,
    ops: [
      ["#16150f", 1, [10, 20, 3, 40, 50, 4.5]],
      ["#b3301c", 0.5, [100, 120, 2]],
    ],
  };

  it("paints a scene's frame once, on a canvas of its own, before the first paint", () => {
    const result = boot({
      note: { ...sceneNote(), frame: held },
      path: "/hobbies/birding/",
      workers: true,
    });
    const frame = result.canvases.find((c) => c.className === "landing-frame")!;
    // Drawn on the CPU: all the GPU has to do is take the picture, once.
    expect(frame.context).toEqual([
      "2d",
      { alpha: false, willReadFrequently: true },
    ]);
    // At the size it was laid out in, at most at twice the pixels.
    expect([frame.width, frame.height]).toEqual([2400, 1400]);
    expect(frame.style).toEqual({ width: "1200px", height: "700px" });
    expect(frame.attributes["aria-hidden"]).toBe("true");
    expect(result.painted.rects).toEqual([
      { style: "#fbfaf8", rect: [0, 0, 2400, 1400] },
    ]);
    expect(result.painted.scale).toEqual([2, 2]);
    expect(result.painted.fills).toEqual([
      {
        style: "#16150f",
        alpha: 1,
        dots: [
          [10, 20, 3],
          [40, 50, 4.5],
        ],
      },
      { style: "#b3301c", alpha: 0.5, dots: [[100, 120, 2]] },
    ]);
    // Over the worker's canvas, which comes up underneath it.
    expect(result.appended).toEqual([result.canvases[0], frame]);
    // The worker has no use for it.
    expect(result.workers[0].posted[1].message).not.toHaveProperty(
      "note.frame",
    );
  });

  it("paints the frame for a scene the page will carry on itself", () => {
    const result = boot({
      note: { ...sceneNote(), frame: held },
      path: "/hobbies/birding/",
    });
    expect(result.appended).toEqual([result.canvases[0]]);
    expect(result.canvases[0].className).toBe("landing-frame");
  });

  it("takes the frame down after four seconds, with the rest", () => {
    const result = boot({
      note: { ...sceneNote(), frame: held },
      path: "/hobbies/birding/",
    });
    result.fire(4000);
    expect(result.canvases[0].removed).toBe(true);
    expect(result.classes.has("landing-dots")).toBe(false);
  });

  it("opens on bare paper where it can't paint the frame", () => {
    const result = boot({
      note: { ...sceneNote(), frame: held },
      path: "/hobbies/birding/",
      no2d: true,
    });
    expect(result.appended).toEqual([]);
    expect(result.dots).toBe(true);
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

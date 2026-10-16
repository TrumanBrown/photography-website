import { afterEach, describe, expect, it, vi } from "vitest";
import { createUpgrader, loadOriginal, type ShownImage } from "./lightbox";

const CAPPED = "https://example.blob.core.windows.net/variants/DSC01107.webp";
const FULL =
  "https://example.blob.core.windows.net/originals/eastern-washington/DSC01107.JPEG";

/** An <img> as PhotoSwipe builds it: showing the capped copy. */
const shown = (): ShownImage => ({ src: CAPPED, srcset: "" });

/** Lets every pending promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A load that finishes, or fails, when the test says so. */
function controlledLoad() {
  const pending: Array<{ resolve: () => void; reject: (e: Error) => void }> =
    [];
  const load = vi.fn(
    (_url: string) =>
      new Promise<void>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return { load, pending };
}

describe("createUpgrader", () => {
  it("swaps the original in once it has loaded, not before", async () => {
    const { load, pending } = controlledLoad();
    const upgrade = createUpgrader(load);
    const img = { src: CAPPED, srcset: `${CAPPED} 1600w` };

    upgrade(img, FULL);
    expect(load).toHaveBeenCalledWith(FULL);
    await settle();
    expect(img.src).toBe(CAPPED);

    pending[0].resolve();
    await settle();
    expect(img.src).toBe(FULL);
    expect(img.srcset).toBe("");
  });

  it("fetches the original once per image, however often its slide comes back", async () => {
    const { load, pending } = controlledLoad();
    const upgrade = createUpgrader(load);
    const img = shown();

    upgrade(img, FULL);
    upgrade(img, FULL); // still downloading
    pending[0].resolve();
    await settle();
    upgrade(img, FULL); // already the original
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("upgrades the new image PhotoSwipe builds for a photograph it threw away", async () => {
    // Stepping more than five photographs away, or closing the lightbox and
    // opening it again, makes PhotoSwipe rebuild the slide's <img> on the
    // capped copy. That one used to stay at 1600 px until the page reloaded.
    const { load, pending } = controlledLoad();
    const upgrade = createUpgrader(load);
    const first = shown();
    upgrade(first, FULL);
    pending[0].resolve();
    await settle();
    expect(first.src).toBe(FULL);

    const rebuilt = shown();
    upgrade(rebuilt, FULL);
    expect(load).toHaveBeenCalledTimes(2);
    pending[1].resolve();
    await settle();
    expect(rebuilt.src).toBe(FULL);
  });

  it("keeps the capped copy if the original fails, and tries again next time", async () => {
    const { load, pending } = controlledLoad();
    const upgrade = createUpgrader(load);
    const img = shown();

    upgrade(img, FULL);
    pending[0].reject(new Error("offline"));
    await settle();
    expect(img.src).toBe(CAPPED);

    upgrade(img, FULL);
    expect(load).toHaveBeenCalledTimes(2);
    pending[1].resolve();
    await settle();
    expect(img.src).toBe(FULL);
  });

  it("leaves alone a slide with no original to upgrade to", () => {
    const { load } = controlledLoad();
    const upgrade = createUpgrader(load);

    upgrade(shown(), undefined);
    upgrade({ src: FULL, srcset: "" }, FULL);
    upgrade(undefined, FULL);
    expect(load).not.toHaveBeenCalled();
  });
});

describe("loadOriginal", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Stands in for the browser's Image, which loads or fails once given a src. */
  function stubImage(
    outcome: "load" | "error",
    decodeWith?: () => Promise<void>,
  ) {
    class FakeImage {
      decoding = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decode = decodeWith;
      #src = "";
      get src() {
        return this.#src;
      }
      set src(url: string) {
        this.#src = url;
        setTimeout(() => (outcome === "load" ? this.onload : this.onerror)?.());
      }
    }
    vi.stubGlobal("Image", FakeImage);
  }

  it("waits for the original to decode, so the swap never paints a blank frame", async () => {
    let decoded!: () => void;
    stubImage(
      "load",
      () => new Promise<void>((resolve) => (decoded = resolve)),
    );
    let done = false;
    const loading = loadOriginal(FULL).then(() => (done = true));

    await settle();
    expect(done).toBe(false);
    decoded();
    await loading;
    expect(done).toBe(true);
  });

  it("still resolves when the browser declines to decode a loaded image", async () => {
    stubImage("load", () => Promise.reject(new Error("EncodingError")));
    await expect(loadOriginal(FULL)).resolves.toBeUndefined();
  });

  it("rejects when the original can't be fetched", async () => {
    stubImage("error");
    await expect(loadOriginal(FULL)).rejects.toThrow("DSC01107.JPEG");
  });
});

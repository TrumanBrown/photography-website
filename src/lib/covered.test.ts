import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COVERED, covered, uncover, whenUncovered } from "./covered";

/** Just enough of a document: the class list on <html>, and its events. */
function fakeDocument() {
  const classes = new Set<string>();
  return Object.assign(new EventTarget(), {
    documentElement: {
      classList: {
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
        contains: (c: string) => classes.has(c),
      },
    },
  });
}

describe("covered", () => {
  beforeEach(() => vi.stubGlobal("document", fakeDocument()));
  afterEach(() => vi.unstubAllGlobals());

  it("starts what waited on the scene once it's gone, and only once", () => {
    document.documentElement.classList.add(COVERED);
    expect(covered()).toBe(true);
    const start = vi.fn();
    whenUncovered(start);
    expect(start).not.toHaveBeenCalled();
    uncover();
    expect(covered()).toBe(false);
    expect(start).toHaveBeenCalledTimes(1);
    uncover();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("hears the head script's own fallback too", () => {
    document.documentElement.classList.add(COVERED);
    const start = vi.fn();
    whenUncovered(start);
    // What the inline script does after eight seconds (landing.ts).
    document.documentElement.classList.remove(COVERED);
    document.dispatchEvent(new Event("landing:uncovered"));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("leaves a page nothing covered alone", () => {
    const start = vi.fn();
    const heard = vi.fn();
    document.addEventListener("landing:uncovered", heard);
    whenUncovered(start);
    uncover();
    expect(start).not.toHaveBeenCalled();
    expect(heard).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CARRY_KEY, leaveData, pack, takeData, unpack } from "./carry";

describe("carrying a scene's data to the next page", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    globalThis.sessionStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    } as Storage;
  });
  afterEach(() => {
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  });

  const dots = () => ({
    x: Float32Array.from([1.5, -2.25, 1e-7, 880]),
    y: Float32Array.from([0.1, 0.2, 0.3, 0.4]),
    r: Float32Array.from([1.6, 1.6, 1.7, 0.9]),
    n: 4,
  });

  it("packs float arrays so they come back exactly", () => {
    const before = { dots: dots(), path: [[1, 2]], r0: 1.6, parts: [dots()] };
    const after = unpack(JSON.parse(JSON.stringify(pack(before))));
    expect(after).toEqual(before);
    const { x } = (after as { dots: { x: Float32Array } }).dots;
    expect(x).toBeInstanceOf(Float32Array);
    expect(Array.from(x)).toEqual(Array.from(before.dots.x));
  });

  it("won't carry a function", () => {
    expect(() => pack({ draw: () => 1 })).toThrow();
  });

  it("hands the data to the landing it was left for, once", () => {
    expect(
      leaveData({
        path: "/hobbies/fishing/",
        at: 5,
        dots: dots(),
        prep: { rod: dots() },
      }),
    ).toBe(true);
    const got = takeData("/hobbies/fishing/", 5);
    expect(got?.dots).toEqual(dots());
    expect(got?.prep).toEqual({ rod: dots() });
    expect(store.has(CARRY_KEY)).toBe(false);
    expect(takeData("/hobbies/fishing/", 5)).toBeNull();
  });

  it("drops data left for another landing", () => {
    leaveData({ path: "/hobbies/fishing/", at: 5, dots: dots(), prep: null });
    expect(takeData("/hobbies/birding/", 5)).toBeNull();
    expect(store.has(CARRY_KEY)).toBe(false);
    leaveData({ path: "/hobbies/fishing/", at: 5, dots: dots(), prep: null });
    expect(takeData("/hobbies/fishing/", 6)).toBeNull();
  });

  it("gives up quietly when storage is full", () => {
    globalThis.sessionStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(leaveData({ path: "/a/", at: 1, dots: dots(), prep: null })).toBe(
      false,
    );
    expect(takeData("/a/", 1)).toBeNull();
  });
});

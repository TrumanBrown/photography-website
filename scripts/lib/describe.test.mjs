import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  sampleEvenly,
  parseModelJson,
  parseCaptionJson,
  captionImages,
  captionsEnabledFor,
  activeProvider,
  isEnabled,
} from "./describe.mjs";

describe("sampleEvenly", () => {
  it("returns everything when the list is already short enough", () => {
    expect(sampleEvenly([1, 2, 3], 8)).toEqual([1, 2, 3]);
    expect(sampleEvenly([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });

  it("spans the whole list rather than taking a prefix", () => {
    const items = Array.from({ length: 60 }, (_, i) => i);
    const picked = sampleEvenly(items, 6);
    expect(picked).toHaveLength(6);
    expect(picked[0]).toBe(0);
    // The last pick should come from the back of the list, not frame 6.
    expect(picked.at(-1)).toBeGreaterThan(45);
  });

  it("never returns more than asked for", () => {
    const items = Array.from({ length: 55 }, (_, i) => i);
    expect(sampleEvenly(items, 8)).toHaveLength(8);
    expect(sampleEvenly(items, 1)).toHaveLength(1);
  });

  it("picks distinct items", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const picked = sampleEvenly(items, 8);
    expect(new Set(picked).size).toBe(picked.length);
  });

  it("handles an empty list", () => {
    expect(sampleEvenly([], 8)).toEqual([]);
  });
});

describe("parseModelJson", () => {
  it("parses a plain JSON reply", () => {
    const out = parseModelJson(
      '{"title":"Gunn Peak","location":"Washington","description":"A scramble."}',
    );
    expect(out).toEqual({
      title: "Gunn Peak",
      location: "Washington",
      description: "A scramble.",
    });
  });

  it("tolerates a markdown code fence", () => {
    const out = parseModelJson(
      '```json\n{"title":"T","location":"L","description":"D"}\n```',
    );
    expect(out.title).toBe("T");
  });

  it("defaults a missing location to an empty string", () => {
    const out = parseModelJson('{"title":"T","description":"D"}');
    expect(out.location).toBe("");
  });

  it("trims surrounding whitespace on every field", () => {
    const out = parseModelJson(
      '{"title":"  T  ","location":"  L  ","description":"  D  "}',
    );
    expect(out).toEqual({ title: "T", location: "L", description: "D" });
  });

  it("rejects a reply with no usable description", () => {
    expect(() => parseModelJson('{"title":"T","description":"   "}')).toThrow(
      /description/,
    );
    expect(() => parseModelJson('{"title":"T"}')).toThrow(/description/);
  });

  it("rejects a reply with no usable title", () => {
    expect(() => parseModelJson('{"description":"D"}')).toThrow(/title/);
  });

  it("rejects text that is not JSON at all", () => {
    expect(() => parseModelJson("I cannot identify this place.")).toThrow();
  });
});

describe("provider selection", () => {
  const saved = {};
  const keys = ["DESCRIBE_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"];

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("is disabled when no key is configured, so builds stay unaffected", () => {
    expect(activeProvider()).toBeNull();
    expect(isEnabled()).toBe(false);
  });

  it("stays disabled when keys are empty strings, as unset CI secrets are", () => {
    process.env.OPENAI_API_KEY = "";
    process.env.ANTHROPIC_API_KEY = "";
    process.env.DESCRIBE_PROVIDER = "";
    expect(activeProvider()).toBeNull();
    expect(isEnabled()).toBe(false);
  });

  it("infers openai from OPENAI_API_KEY", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    expect(activeProvider()).toBe("openai");
    expect(isEnabled()).toBe(true);
  });

  it("infers anthropic from ANTHROPIC_API_KEY", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(activeProvider()).toBe("anthropic");
  });

  it("prefers openai when both keys are present", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(activeProvider()).toBe("openai");
  });

  it("lets DESCRIBE_PROVIDER override the inferred provider", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.DESCRIBE_PROVIDER = "mock";
    expect(activeProvider()).toBe("mock");
  });
});

describe("parseCaptionJson", () => {
  it("maps filenames to captions", () => {
    const out = parseCaptionJson(
      '{"a.jpg":"A heron on a branch","b.jpg":"Bull kelp at low tide"}',
      ["a.jpg", "b.jpg"],
    );
    expect(out.get("a.jpg")).toBe("A heron on a branch");
    expect(out.get("b.jpg")).toBe("Bull kelp at low tide");
  });

  it("drops filenames that were not in the batch", () => {
    const out = parseCaptionJson(
      '{"a.jpg":"Real","hallucinated.jpg":"Invented"}',
      ["a.jpg"],
    );
    expect(out.has("hallucinated.jpg")).toBe(false);
    expect(out.size).toBe(1);
  });

  it("strips a trailing full stop", () => {
    const out = parseCaptionJson('{"a.jpg":"A garter snake mid-meal."}', [
      "a.jpg",
    ]);
    expect(out.get("a.jpg")).toBe("A garter snake mid-meal");
  });

  it("tolerates a code fence", () => {
    const out = parseCaptionJson('```json\n{"a.jpg":"Caption"}\n```', [
      "a.jpg",
    ]);
    expect(out.get("a.jpg")).toBe("Caption");
  });

  it("skips empty and non-string captions", () => {
    const out = parseCaptionJson(
      '{"a.jpg":"   ","b.jpg":null,"c.jpg":"Good"}',
      ["a.jpg", "b.jpg", "c.jpg"],
    );
    expect(out.size).toBe(1);
    expect(out.get("c.jpg")).toBe("Good");
  });

  it("truncates to the sidecar caption limit", () => {
    const long = "x".repeat(900);
    const out = parseCaptionJson(JSON.stringify({ "a.jpg": long }), ["a.jpg"]);
    expect(out.get("a.jpg").length).toBeLessThanOrEqual(500);
  });

  it("rejects an array or non-object reply", () => {
    expect(() => parseCaptionJson('["a","b"]', ["a.jpg"])).toThrow(
      /caption object/,
    );
  });
});

describe("captionImages", () => {
  it("never re-captions an image that already has one", async () => {
    const images = [
      { file: "a.jpg", caption: "Mine, hand written" },
      { file: "b.jpg" },
    ];
    // No imagesDir on disk, so nothing encodes and nothing is sent. The point
    // is that the already-captioned image is filtered out before any call.
    const out = await captionImages({
      title: "T",
      location: "L",
      images,
      imagesDir: "/nonexistent",
      provider: "mock",
    });
    expect(out.has("a.jpg")).toBe(false);
  });

  it("returns an empty map when every image is already captioned", async () => {
    const images = [{ file: "a.jpg", caption: "Set" }];
    const out = await captionImages({
      title: "T",
      images,
      imagesDir: "/nonexistent",
      provider: "mock",
    });
    expect(out.size).toBe(0);
  });

  it("rejects an unknown provider", async () => {
    await expect(
      captionImages({
        title: "T",
        images: [{ file: "a.jpg" }],
        imagesDir: "/x",
        provider: "nope",
      }),
    ).rejects.toThrow(/Unknown provider/);
  });
});

describe("captionsEnabledFor", () => {
  const saved = {};
  const keys = ["OPENAI_API_KEY", "DESCRIBE_CAPTIONS"];
  const SLUG = "gunn-peak-june-2026";

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("stays off when only the API key is set, so captions are a deliberate step", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    expect(captionsEnabledFor(SLUG)).toBe(false);
  });

  it("stays off when the flag is set but no provider is configured", () => {
    process.env.DESCRIBE_CAPTIONS = "1";
    expect(captionsEnabledFor(SLUG)).toBe(false);
  });

  it("turns on for every session when set to a truthy switch", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    for (const v of ["1", "true", "on", "yes", "TRUE"]) {
      process.env.DESCRIBE_CAPTIONS = v;
      expect(captionsEnabledFor(SLUG)).toBe(true);
      expect(captionsEnabledFor("any-other-session")).toBe(true);
    }
  });

  it("treats empty and falsey flags as off", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    for (const v of ["", "   ", "0", "off", "false", "no"]) {
      process.env.DESCRIBE_CAPTIONS = v;
      expect(captionsEnabledFor(SLUG)).toBe(false);
    }
  });

  it("limits captioning to the listed sessions, so one can be trialled first", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.DESCRIBE_CAPTIONS = SLUG;
    expect(captionsEnabledFor(SLUG)).toBe(true);
    expect(captionsEnabledFor("costa-rica-bijagua-august-2026")).toBe(false);
  });

  it("accepts a comma-separated list with loose spacing", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.DESCRIBE_CAPTIONS = ` ${SLUG} , tibet-spring-2026 `;
    expect(captionsEnabledFor(SLUG)).toBe(true);
    expect(captionsEnabledFor("tibet-spring-2026")).toBe(true);
    expect(captionsEnabledFor("olympic-winter-2026")).toBe(false);
  });
});

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  sampleEvenly,
  parseModelJson,
  parseCaptionJson,
  captionImages,
  captionsEnabledFor,
  activeProvider,
  isEnabled,
  inatSpecies,
  describeSession,
  copyProblems,
  azureChatUrl,
  styleExamples,
} from "./describe.mjs";

// The keyless Azure path signs in through @azure/identity. Tests never reach a
// real tenant; they get a fixed token instead.
vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: class {
    async getToken() {
      return {
        token: "test-token",
        expiresOnTimestamp: Date.now() + 3_600_000,
      };
    }
  },
}));

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
  const keys = [
    "DESCRIBE_PROVIDER",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "AZURE_OPENAI_ENDPOINT",
  ];

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
    process.env.AZURE_OPENAI_ENDPOINT = "";
    process.env.DESCRIBE_PROVIDER = "";
    expect(activeProvider()).toBeNull();
    expect(isEnabled()).toBe(false);
  });

  it("infers azure from AZURE_OPENAI_ENDPOINT, with no key at all", () => {
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com/";
    expect(activeProvider()).toBe("azure");
    expect(isEnabled()).toBe(true);
  });

  it("lets an API key win over the keyless endpoint", () => {
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com/";
    process.env.OPENAI_API_KEY = "sk-test";
    expect(activeProvider()).toBe("openai");
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

describe("inatSpecies", () => {
  it("returns an empty list when no user is configured", async () => {
    expect(await inatSpecies("")).toEqual([]);
  });

  it("returns an empty list rather than throwing when the lookup fails", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("network down");
    };
    try {
      // Accuracy aid, not a dependency: a failed lookup must not break a build.
      expect(await inatSpecies("someone")).toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("collects common names across pages and stops on a short page", async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return {
        ok: true,
        json: async () => ({
          results: [
            { taxon: { preferred_common_name: `Species ${calls}` } },
            { taxon: {} }, // no common name, skipped
          ],
        }),
      };
    };
    try {
      const out = await inatSpecies("someone");
      expect(out).toEqual(["Species 1"]);
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("azureChatUrl", () => {
  it("adds the v1 path to a bare resource endpoint", () => {
    expect(azureChatUrl("https://x.openai.azure.com/")).toBe(
      "https://x.openai.azure.com/openai/v1/chat/completions",
    );
  });

  it("accepts an endpoint that already ends in /openai/v1", () => {
    expect(azureChatUrl("https://x.openai.azure.com/openai/v1/")).toBe(
      "https://x.openai.azure.com/openai/v1/chat/completions",
    );
  });
});

describe("copyProblems", () => {
  const good = {
    title: "Gunn Peak, Washington, June 2026",
    description: "Two tarns sitting just under the summit block.",
  };

  it("passes copy that follows the rules", () => {
    expect(copyProblems(good)).toEqual([]);
  });

  it("flags an em dash in the title or the description", () => {
    const inTitle = copyProblems({
      ...good,
      title: "Gunn Peak, Washington — June 2026",
    });
    const inBody = copyProblems({ ...good, description: "Tarns — a tower." });
    expect(inTitle.join(" ")).toMatch(/em dash/);
    expect(inBody.join(" ")).toMatch(/em dash/);
  });

  it("names the banned word it found", () => {
    const out = copyProblems({ ...good, description: "A stunning tarn." });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/"stunning"/);
  });

  it("flags a title that isn't Place, Region, Month Year", () => {
    expect(copyProblems({ ...good, title: "Mt Baker Fall 2026" })).toHaveLength(
      1,
    );
  });
});

describe("describeSession with keyless Azure OpenAI", () => {
  const saved = {};
  const keys = [
    "DESCRIBE_PROVIDER",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "AZURE_OPENAI_ENDPOINT",
    "AZURE_OPENAI_DEPLOYMENT",
  ];
  const clean = {
    title: "Gunn Peak, Washington, June 2026",
    location: "Central Cascades, Washington",
    description: "Two tarns sitting just under the summit block.",
  };
  let dir;
  let realFetch;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "describe-test-"));
    for (const file of ["a.jpg", "b.jpg"]) {
      await sharp({
        create: { width: 32, height: 24, channels: 3, background: "#3a6" },
      })
        .jpeg()
        .toFile(join(dir, file));
    }
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com/";
    process.env.AZURE_OPENAI_DEPLOYMENT = "gpt-test";
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  /** Answers model calls with the given drafts in turn and records each request. */
  function fakeModel(...drafts) {
    const requests = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("inaturalist")) {
        return { ok: true, json: async () => ({ results: [] }) };
      }
      requests.push({
        url: String(url),
        headers: init.headers,
        body: JSON.parse(init.body),
      });
      const draft = drafts[Math.min(requests.length, drafts.length) - 1];
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(draft) } }],
        }),
      };
    };
    return requests;
  }

  const session = () => ({
    slug: "gunn-peak-june-2026",
    title: "Gunn Peak June 2026",
    date: "2026-06-20",
    location: "",
    images: [{ file: "a.jpg" }, { file: "b.jpg" }],
    imagesDir: dir,
  });

  it("signs in with Entra ID and sends the photos to the deployment", async () => {
    const requests = fakeModel(clean);
    const out = await describeSession(session());

    expect(out).toMatchObject(clean);
    expect(out.sampled).toBe(2);
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req.url).toBe(
      "https://example.openai.azure.com/openai/v1/chat/completions",
    );
    expect(req.headers.Authorization).toBe("Bearer test-token");
    expect(req.body.model).toBe("gpt-test");
    expect(req.body.response_format).toEqual({ type: "json_object" });
    expect(req.body.max_completion_tokens).toBeGreaterThanOrEqual(8000);
    const photos = req.body.messages[0].content.filter(
      (part) => part.type === "image_url",
    );
    expect(photos).toHaveLength(2);
  });

  it("sends a draft that breaks a rule back once, with the complaint", async () => {
    const requests = fakeModel(
      { ...clean, description: "Two tarns — and a tower over them." },
      clean,
    );
    const out = await describeSession(session());

    expect(requests).toHaveLength(2);
    expect(requests[1].body.messages[0].content[0].text).toMatch(
      /It broke these rules:[\s\S]*em dash/,
    );
    expect(out.description).toBe(clean.description);
  });

  it("swaps out em dashes that survive the rewrite rather than publishing them", async () => {
    const stubborn = { ...clean, description: "Two tarns — and a tower." };
    const requests = fakeModel(stubborn, stubborn);
    const out = await describeSession(session());

    expect(requests).toHaveLength(2);
    expect(out.description).toBe("Two tarns, and a tower.");
  });

  it("shows the model the site's own reviewed copy for voice, but not this session's", async () => {
    const requests = fakeModel(clean);
    await describeSession(session());

    const prompt = requests[0].body.messages[0].content[0].text;
    expect(prompt).toMatch(/Other sessions on the site/);
    expect(prompt).not.toMatch(/Gunn Peak, and a pair of tarns/);
  });
});

describe("styleExamples", () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "style-examples-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("uses reviewed entries only, never drafts, the comment, or the excluded session", async () => {
    const file = join(dir, "meta.json");
    await writeFile(
      file,
      JSON.stringify({
        $comment: "not a session",
        "a-slug": { title: "A, Washington, May 2026", description: "Kept." },
        "b-slug": {
          title: "B, Washington, May 2026",
          description: "Unread.",
          draft: true,
        },
        "c-slug": { title: "C, Washington, May 2026", description: "Mine." },
      }),
    );
    const out = await styleExamples({ exclude: "c-slug", file });
    expect(out).toEqual(["A, Washington, May 2026\nKept."]);
  });

  it("returns nothing rather than failing when the file is missing", async () => {
    expect(await styleExamples({ file: join(dir, "missing.json") })).toEqual(
      [],
    );
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { localStore } from "../photos/store.mjs";
import { _resetSecrets } from "../photos/redact.mjs";
import { loadSettings, parseWindow } from "./settings.mjs";
import { decideStory, localParts, storyMinute } from "./schedule.mjs";
import { renderStory } from "./render.mjs";
import {
  STORY_LEDGER,
  pickStory,
  runStory,
  storyCandidates,
  storyDayFile,
} from "./story.mjs";

// Wednesday 2026-10-14, Los Angeles (UTC-7).
const at = (day, hhmm) => new Date(`${day}T${hhmm}:00-07:00`);
const TODAY = "2026-10-14";

function shot({
  session = "a",
  width = 4128,
  height = 6192,
  appeal = 7,
  ...extra
} = {}) {
  return { session, width, height, appeal, ...extra };
}

/** A catalog from { key: shot(...) }. */
function catalogOf(spec) {
  const catalog = { files: {}, shots: {} };
  for (const [key, s] of Object.entries(spec)) {
    const id = `${s.session}/${key}.jpg`;
    catalog.files[id] = {
      session: s.session,
      file: `${key}.jpg`,
      url: `https://example.test/${key}.jpg`,
      width: s.width,
      height: s.height,
    };
    catalog.shots[key] = {
      session: s.session,
      pick: id,
      files: [id],
      burst: s.burst ?? null,
      analysis: s.noAnalysis
        ? undefined
        : {
            appeal: s.appeal,
            group: "frog",
            skip: s.skipReason ?? null,
            idCheck: s.conflict ? "conflict" : "fits",
          },
      ...(s.skip ? { skip: true } : {}),
    };
  }
  return catalog;
}

describe("picking the story", () => {
  it("prefers a vertical photo over a better-rated landscape", () => {
    const catalog = catalogOf({
      land: shot({ width: 6192, height: 4128, appeal: 10 }),
      tall: shot({ session: "b", appeal: 6 }),
    });
    expect(pickStory({ catalog }).key).toBe("tall");
    expect(pickStory({ catalog }).vertical).toBe(true);
  });

  it("falls back to other shapes only when no vertical photo is left", () => {
    const catalog = catalogOf({
      land: shot({ width: 6192, height: 4128 }),
      tall: shot({ session: "b" }),
    });
    const pick = pickStory({
      catalog,
      storyLedger: { posted: { tall: { at: "2026-10-01" } } },
    });
    expect(pick.key).toBe("land");
    expect(pick.vertical).toBe(false);
  });

  it("leaves out used, queued, recently posted, skipped and unfit photos", () => {
    const now = at(TODAY, "12:00");
    const catalog = catalogOf({
      storied: shot(),
      queued: shot(),
      fedLately: shot(),
      fedLongAgo: shot({ appeal: 1 }),
      skipped: shot({ skip: true }),
      blurry: shot({ skipReason: "blurry" }),
      mismatch: shot({ conflict: true }),
      small: shot({ width: 800, height: 1200 }),
      unanalysed: shot({ noAnalysis: true }),
      struck: shot(),
      busy: shot(),
    });
    const keys = storyCandidates({
      catalog,
      storyLedger: {
        posted: { storied: { at: "2026-10-01" } },
        failed: { struck: { count: 2 } },
      },
      feedLedger: {
        posted: {
          fedLately: { at: "2026-10-01T00:00:00Z" },
          fedLongAgo: { at: "2026-08-01T00:00:00Z" },
        },
      },
      queue: ["queued"],
      busy: new Set(["busy"]),
      now,
    }).map((c) => c.key);
    expect(keys).toEqual(["fedLongAgo"]);
  });

  it("moves on from the outing and the burst of the last stories", () => {
    const catalog = catalogOf({
      last: shot({ session: "x", burst: "b1" }),
      sameOuting: shot({ session: "x", appeal: 9 }),
      sameBurst: shot({ session: "y", appeal: 9, burst: "b1" }),
      other: shot({ session: "z", appeal: 7 }),
    });
    const pick = pickStory({
      catalog,
      storyLedger: { posted: { last: { at: "2026-10-13" } } },
      recent: ["last"],
    });
    expect(pick.key).toBe("other");
  });
});

describe("when the story goes out", () => {
  const settings = {
    ...loadSettings({ SOCIAL_LIVE: "true", SOCIAL_STORIES: "true" }),
  };

  it("picks a time in the window for each day, the same all day", () => {
    const window = parseWindow("10:00-21:00");
    const minutes = [];
    for (let d = 1; d <= 28; d++) {
      const m = storyMinute(`2026-11-${String(d).padStart(2, "0")}`, window);
      expect(m).toBeGreaterThanOrEqual(600);
      expect(m).toBeLessThan(1260);
      minutes.push(m);
    }
    expect(new Set(minutes).size).toBeGreaterThan(20);
    expect(storyMinute(TODAY, window)).toBe(storyMinute(TODAY, window));
    expect(parseWindow("nonsense")).toEqual({ start: 600, end: 1260 });
    expect(parseWindow("21:00-10:00")).toEqual({ start: 600, end: 1260 });
    expect(parseWindow("07:30-09:00")).toEqual({ start: 450, end: 540 });
  });

  it("is due from its minute until the day ends, once", () => {
    const minute = storyMinute(TODAY, settings.storyWindow);
    const time = (m) =>
      at(
        TODAY,
        `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
      );
    expect(localParts(time(minute), settings.timezone).minutes).toBe(minute);
    expect(
      decideStory({ now: time(minute - 1), settings, day: null }).due,
    ).toBe(false);
    expect(decideStory({ now: time(minute), settings, day: null }).due).toBe(
      true,
    );
    expect(
      decideStory({ now: at(TODAY, "23:10"), settings, day: null }).due,
    ).toBe(false);
    const done = { attempts: [{ state: "published" }] };
    expect(
      decideStory({ now: time(minute + 5), settings, day: done }).reason,
    ).toBe("today's story is done");
    // A failed photo leaves today's story still to do.
    expect(
      decideStory({
        now: time(minute + 5),
        settings,
        day: { attempts: [{ state: "failed" }] },
      }).due,
    ).toBe(true);
  });

  it("is off unless SOCIAL_STORIES is set, and a rehearsal counts only while rehearsing", () => {
    expect(loadSettings({}).stories).toBe("off");
    expect(loadSettings({ SOCIAL_STORIES: "rehearse" }).stories).toBe(
      "rehearse",
    );
    const late = at(TODAY, "22:30");
    expect(
      decideStory({ now: late, settings: loadSettings({}), day: null }).due,
    ).toBe(false);
    const rehearsed = { attempts: [{ state: "dry-run" }] };
    expect(
      decideStory({
        now: late,
        settings: loadSettings({ SOCIAL_STORIES: "rehearse" }),
        day: rehearsed,
      }).due,
    ).toBe(false);
    expect(decideStory({ now: late, settings, day: rehearsed }).due).toBe(true);
  });
});

describe("the story frame", () => {
  const photo = (width, height) =>
    sharp({ create: { width, height, channels: 3, background: "#3a7" } })
      .jpeg()
      .withExif({ IFD0: { Make: "SONY", Model: "ILCE-6700" } })
      .toBuffer();

  it("is 1080×1920 with the photo whole in the middle and no metadata", async () => {
    const tall = await renderStory(await photo(4128, 6192));
    expect(tall.photo).toEqual({ width: 1080, height: 1620 });
    const meta = await sharp(tall.buffer).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([
      1080,
      1920,
      "jpeg",
    ]);
    expect(meta.exif).toBeUndefined();
    const wide = await renderStory(await photo(6192, 4128));
    expect(wide.photo).toEqual({ width: 1080, height: 720 });
    const exact = await renderStory(await photo(1080, 1920));
    expect(exact.photo).toEqual({ width: 1080, height: 1920 });
  });
});

describe("runStory", () => {
  let dir;
  let store;
  const env = { IG_ACCESS_TOKEN: "IGAAtesttoken1234567890" };
  const settings = {
    ...loadSettings({ SOCIAL_LIVE: "true", SOCIAL_STORIES: "true" }),
    loginMode: "facebook",
  };
  const minute = storyMinute(TODAY, settings.storyWindow);
  const due = at(
    TODAY,
    `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
  );
  const render = async () => ({
    buffer: Buffer.from("jpeg"),
    width: 1080,
    height: 1920,
    photo: { width: 1080, height: 1620 },
  });
  function fakeClient({ failPublishOnce = false } = {}) {
    const log = [];
    let failed = false;
    const published = new Set();
    return {
      log,
      makeClient: () => ({
        publishingLimit: async () => ({ used: 0, total: 100 }),
        createStoryContainer: async (args) => {
          log.push(["story", args]);
          return `s${log.filter((l) => l[0] === "story").length}`;
        },
        createImageContainer: async () => {
          throw new Error("a story must not be posted as a feed post");
        },
        waitUntilReady: async () => "FINISHED",
        containerStatus: async (id) =>
          published.has(id) ? "PUBLISHED" : "FINISHED",
        publish: async (id) => {
          log.push(["publish", id]);
          if (failPublishOnce && !failed) {
            failed = true;
            throw new Error("socket hang up");
          }
          published.add(id);
          return `m-${id}`;
        },
      }),
    };
  }
  const run = (client, now, extra = {}) =>
    runStory({
      settings,
      store,
      makeClient: client.makeClient,
      env,
      now,
      readImage: async () => Buffer.from("x"),
      render,
      log: () => {},
      ...extra,
    });

  beforeEach(async () => {
    _resetSecrets();
    dir = await mkdtemp(join(tmpdir(), "social-story-"));
    store = localStore(dir);
    await store.writeJson(
      "catalog.json",
      catalogOf({
        tall: shot({ session: "a" }),
        land: shot({ session: "b", width: 6192, height: 4128, appeal: 10 }),
      }),
    );
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("posts one story a day, as a story, at its time", async () => {
    const client = fakeClient();
    expect((await run(client, new Date(due - 60000))).outcome).toBe("not-due");
    expect((await run(client, due)).outcome).toBe("published");
    expect((await run(client, new Date(+due + 3600000))).outcome).toBe(
      "not-due",
    );
    expect(client.log.filter((l) => l[0] === "story")).toHaveLength(1);
    const ledger = (await store.readJson(STORY_LEDGER)).data;
    expect(Object.keys(ledger.posted)).toEqual(["tall"]);
    // The feed's history is untouched.
    expect(await store.readJson("ledger.json")).toBeNull();
  });

  it("posts today's story early when forced, but never a second one", async () => {
    const client = fakeClient();
    expect(
      (await run(client, at(TODAY, "07:30"), { force: true })).outcome,
    ).toBe("published");
    expect((await run(client, due, { force: true })).outcome).toBe("not-due");
    expect(client.log.filter((l) => l[0] === "publish")).toHaveLength(1);
  });

  it("finishes a story interrupted mid-way instead of posting twice", async () => {
    const client = fakeClient({ failPublishOnce: true });
    await expect(run(client, due)).rejects.toThrow(/socket hang up/);
    const day = (await store.readJson(storyDayFile(TODAY))).data;
    expect(day.attempts[0].state).toBe("container");
    expect((await run(client, new Date(+due + 1800000))).outcome).toBe(
      "not-due",
    );
    const after = (await store.readJson(storyDayFile(TODAY))).data;
    expect(after.attempts[0].state).toBe("published");
    expect(client.log.filter((l) => l[0] === "story")).toHaveLength(1);
  });

  it("rehearses without publishing, once a day", async () => {
    const client = fakeClient();
    const rehearse = { ...settings, stories: "rehearse" };
    const first = await run(client, due, { settings: rehearse });
    expect(first.outcome).toBe("dry-run");
    expect(
      (await run(client, new Date(+due + 1800000), { settings: rehearse }))
        .outcome,
    ).toBe("not-due");
    expect(client.log.filter((l) => l[0] === "publish")).toHaveLength(0);
    expect(await store.readJson(STORY_LEDGER)).toBeNull();
  });

  it("does nothing while stories are off", async () => {
    const client = fakeClient();
    expect(
      (
        await run(client, due, {
          settings: { ...settings, stories: "off" },
          force: true,
        })
      ).outcome,
    ).toBe("off");
    expect(client.log).toEqual([]);
  });
});

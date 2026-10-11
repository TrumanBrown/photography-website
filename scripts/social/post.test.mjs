import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localStore } from "../photos/store.mjs";
import { loadSettings } from "./settings.mjs";
import { runPost } from "./post.mjs";
import { _resetSecrets } from "../photos/redact.mjs";

// Wednesday 2026-10-14, Los Angeles (UTC-7).
const at = (day, hhmm) => new Date(`${day}T${hhmm}:00-07:00`);
const TODAY = "2026-10-14";

function fakeClient({
  failPublishOnce = false,
  statusAfterFailure = "FINISHED",
  limitError = null,
  readyStatus = "FINISHED",
  statusError = false,
} = {}) {
  const log = [];
  let failed = false;
  const published = new Set();
  return {
    log,
    makeClient: () => ({
      publishingLimit: async () => {
        if (limitError) throw new Error(limitError);
        return { used: 0, total: 100 };
      },
      createImageContainer: async (args) => {
        log.push(["create", args]);
        return `c${log.filter((l) => l[0] === "create").length}`;
      },
      waitUntilReady: async () => readyStatus,
      containerStatus: async (id) => {
        log.push(["status", id]);
        if (statusError) throw new Error("network down");
        if (published.has(id)) return "PUBLISHED";
        return readyStatus === "FINISHED" ? statusAfterFailure : readyStatus;
      },
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

async function seed(store, shots) {
  const files = {};
  const catalogShots = {};
  for (const [key, session] of Object.entries(shots)) {
    files[`${session}/${key}.jpg`] = {
      session,
      file: `${key}.jpg`,
      url: `https://example.test/${key}.jpg`,
      width: 3000,
      height: 2000,
    };
    catalogShots[key] = {
      status: "ready",
      session,
      pick: `${session}/${key}.jpg`,
      files: [`${session}/${key}.jpg`],
      post: {
        caption: `Caption ${key}`,
        alt: `Alt ${key}`,
        hashtags: ["#a", "#b"],
        appeal: 7,
        group: "frog",
      },
    };
  }
  await store.writeJson("catalog.json", {
    version: 1,
    files,
    shots: catalogShots,
    offsets: {},
    fingerprinted: {},
  });
  await store.writeJson("queue.json", { items: Object.keys(shots) });
}

describe("runPost", () => {
  let dir;
  let store;
  const env = { IG_ACCESS_TOKEN: "IGAAtesttoken1234567890" };
  const settings = { ...loadSettings({}), live: true, loginMode: "facebook" };
  const readImage = async () => Buffer.from("x");
  const render = async () => ({
    buffer: Buffer.from("jpeg"),
    width: 1440,
    height: 960,
    padded: false,
  });
  const run = (client, now, extra = {}) =>
    runPost({
      settings,
      store,
      makeClient: client.makeClient,
      env,
      now,
      readImage,
      render,
      log: () => {},
      ...extra,
    });

  beforeEach(async () => {
    _resetSecrets();
    dir = await mkdtemp(join(tmpdir(), "social-post-"));
    store = localStore(dir);
    await seed(store, { s1: "a", s2: "b", s3: "c" });
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("does nothing before the first slot", async () => {
    const client = fakeClient();
    const res = await run(client, at(TODAY, "07:00"));
    expect(res.outcome).toBe("not-due");
    expect(client.log).toEqual([]);
  });

  it("publishes once per slot and records it in the ledger", async () => {
    const client = fakeClient();
    expect((await run(client, at(TODAY, "08:35"))).outcome).toBe("published");
    expect((await run(client, at(TODAY, "09:05"))).outcome).toBe("not-due");
    const ledger = (await store.readJson("ledger.json")).data;
    expect(Object.keys(ledger.posted)).toEqual(["s1"]);
    expect(client.log.filter((l) => l[0] === "create")).toHaveLength(1);
    expect(client.log[0][1]).toMatchObject({
      caption: "Caption s1",
      altText: "Alt s1",
    });
    expect(await readdir(join(dir, "media")).catch(() => [])).toEqual([]);
  });

  it("finishes a publish interrupted mid-way instead of posting twice", async () => {
    const client = fakeClient({
      failPublishOnce: true,
      statusAfterFailure: "FINISHED",
    });
    await expect(run(client, at(TODAY, "08:35"))).rejects.toThrow(
      /socket hang up/,
    );
    const day = (await store.readJson(`days/${TODAY}.json`)).data;
    expect(day.attempts[0].state).toBe("container");

    const res = await run(client, at(TODAY, "09:05"));
    expect(res.outcome).toBe("not-due");
    const after = (await store.readJson(`days/${TODAY}.json`)).data;
    expect(after.attempts[0].state).toBe("published");
    expect(client.log.filter((l) => l[0] === "create")).toHaveLength(1);
    expect(
      Object.keys((await store.readJson("ledger.json")).data.posted),
    ).toEqual(["s1"]);
  });

  it("treats a lost publish response as published when Instagram says so", async () => {
    const client = fakeClient({
      failPublishOnce: true,
      statusAfterFailure: "PUBLISHED",
    });
    expect((await run(client, at(TODAY, "08:35"))).outcome).toBe("published");
    expect(
      Object.keys((await store.readJson("ledger.json")).data.posted),
    ).toEqual(["s1"]);
  });

  it("alerts once when a whole day passed with no post", async () => {
    await store.writeJson("state.json", { liveSince: "2026-10-12" });
    const client = fakeClient();
    const first = await run(client, at(TODAY, "07:00"));
    expect(first.alert).toMatch(/yesterday/);
    const second = await run(client, at(TODAY, "07:30"));
    expect(second.alert).toBeNull();
  });

  it("doesn't count the day it was switched on as a missed day", async () => {
    await store.writeJson("state.json", { liveSince: "2026-10-13" });
    const res = await run(fakeClient(), at(TODAY, "07:00"));
    expect(res.alert).toBeNull();
  });

  it("dry-runs without touching Instagram and paces like the real thing", async () => {
    const client = fakeClient();
    const dry = { ...settings, live: false };
    const res = await runPost({
      settings: dry,
      store,
      makeClient: client.makeClient,
      env: {},
      now: at(TODAY, "08:35"),
      readImage,
      render,
      log: () => {},
    });
    expect(res.outcome).toBe("dry-run");
    const again = await runPost({
      settings: dry,
      store,
      makeClient: client.makeClient,
      env: {},
      now: at(TODAY, "09:05"),
      readImage,
      render,
      log: () => {},
    });
    expect(again.outcome).toBe("not-due");
    expect(client.log).toEqual([]);
    expect(await store.readJson("ledger.json")).toBeNull();
  });

  it("rehearses a dry run with Instagram when it can, and never publishes it", async () => {
    const client = fakeClient();
    // Instagram can only fetch from real storage, so the rehearsal needs it.
    const blobLike = {
      ...store,
      kind: "blob",
      mediaUrl: async (name) => `https://storage.test/${name}`,
    };
    const dry = { ...settings, live: false };
    const res = await runPost({
      settings: dry,
      store: blobLike,
      makeClient: client.makeClient,
      env,
      now: at(TODAY, "08:35"),
      readImage,
      render,
      log: () => {},
    });
    expect(res).toMatchObject({ outcome: "dry-run", rehearsed: true });
    expect(client.log.filter((l) => l[0] === "create")).toHaveLength(1);
    expect(client.log[0][1].imageUrl).toMatch(
      /^https:\/\/storage\.test\/media\//,
    );
    const day = (await store.readJson(`days/${TODAY}.json`)).data;
    expect(day.attempts[0]).toMatchObject({
      state: "dry-run",
      rehearsed: true,
    });
    expect(day.attempts[0].containerId).toBeUndefined();

    // Going live later the same day neither publishes the rehearsal nor
    // counts it as one of today's posts.
    const live = await run(client, at(TODAY, "12:35"));
    expect(live.outcome).toBe("published");
    expect(client.log.filter((l) => l[0] === "publish")).toEqual([
      ["publish", "c2"],
    ]);
  });

  it("reports a rehearsal Instagram rejects without counting it against the photo", async () => {
    const client = fakeClient({ readyStatus: "ERROR" });
    const blobLike = {
      ...store,
      kind: "blob",
      mediaUrl: async (name) => `https://storage.test/${name}`,
    };
    await expect(
      runPost({
        settings: { ...settings, live: false },
        store: blobLike,
        makeClient: client.makeClient,
        env,
        now: at(TODAY, "08:35"),
        readImage,
        render,
        log: () => {},
      }),
    ).rejects.toThrow(/didn't accept the post \(ERROR\)/);
    expect(client.log.some((l) => l[0] === "publish")).toBe(false);
    expect((await store.readJson("ledger.json"))?.data?.failed ?? {}).toEqual(
      {},
    );
  });

  it("doesn't blame the photo for an outage: pauses, and reports once a day", async () => {
    const client = fakeClient({
      limitError: "Error validating access token: Session has expired",
    });
    await expect(run(client, at(TODAY, "08:35"))).rejects.toThrow(/expired/);
    const day = (await store.readJson(`days/${TODAY}.json`)).data;
    expect(day.attempts[0].state).toBe("failed");
    expect(day.pausedUntil).toBeTruthy();
    expect((await store.readJson("ledger.json"))?.data?.failed ?? {}).toEqual(
      {},
    );
    // Still paused 30 minutes later; nothing new is tried.
    expect((await run(client, at(TODAY, "09:05"))).outcome).toBe("not-due");
    // After the pause it tries again and fails quietly (already reported today).
    expect((await run(client, at(TODAY, "10:40"))).outcome).toBe("failed");
  });

  it("counts a strike when Instagram rejects the image itself", async () => {
    const client = fakeClient({ readyStatus: "ERROR" });
    await expect(run(client, at(TODAY, "08:35"))).rejects.toThrow(/ERROR/);
    const ledger = (await store.readJson("ledger.json")).data;
    expect(ledger.failed.s1.count).toBe(1);
  });

  it("never writes off a post whose status can't be read, and won't repost it", async () => {
    const lost = fakeClient({ failPublishOnce: true, statusError: true });
    await expect(run(lost, at(TODAY, "22:20"))).rejects.toThrow(
      /socket hang up/,
    );
    const day = (await store.readJson(`days/${TODAY}.json`)).data;
    expect(day.attempts[0].state).toBe("container");
    // Next morning the status is still unreadable: it stays in flight, and
    // the same photo isn't picked again.
    const next = fakeClient({ statusError: true });
    await run(next, at("2026-10-15", "08:35"));
    const stillOpen = (await store.readJson(`days/${TODAY}.json`)).data;
    expect(stillOpen.attempts[0].state).toBe("container");
    const created = next.log
      .filter((l) => l[0] === "create")
      .map((l) => l[1].caption);
    expect(created).not.toContain("Caption s1");
  });

  it("only posts approved drafts in approval mode, and only the draft approved", async () => {
    const catalog = (await store.readJson("catalog.json")).data;
    catalog.shots.s1.post.draftedAt = "2026-10-01T00:00:00Z";
    catalog.shots.s1.approved = "2026-09-01T00:00:00Z";
    catalog.shots.s2.post.draftedAt = "2026-10-01T00:00:00Z";
    catalog.shots.s2.approved = "2026-10-01T00:00:00Z";
    await store.writeJson("catalog.json", catalog);
    const client = fakeClient();
    await runPost({
      settings: { ...settings, requireApproval: true },
      store,
      makeClient: client.makeClient,
      env,
      now: at(TODAY, "08:35"),
      readImage,
      render,
      log: () => {},
    });
    expect(client.log[0][1].caption).toBe("Caption s2");
  });

  it("never picks a shot that's skipped or already posted", async () => {
    const catalog = (await store.readJson("catalog.json")).data;
    catalog.shots.s1.skip = true;
    await store.writeJson("catalog.json", catalog);
    await store.writeJson("ledger.json", {
      posted: { s2: { at: "2026-10-13T16:00:00Z" } },
      failed: {},
    });
    const client = fakeClient();
    await run(client, at(TODAY, "08:35"));
    expect(client.log[0][1].caption).toBe("Caption s3");
  });
});

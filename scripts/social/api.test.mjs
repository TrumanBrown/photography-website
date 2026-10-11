import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "./instagram.mjs";
import { _resetSecrets, redact, registerSecret } from "./redact.mjs";
import { fingerprint, keyFromBase64, seal, unseal } from "./seal.mjs";
import { ConflictError, localStore, updateJson } from "./store.mjs";
import { resolveToken } from "./token.mjs";
import {
  askJson,
  azureChatUrl,
  modelFor,
  providerFor,
  retryDelay,
} from "./model.mjs";

const TOKEN = "IGAAtesttoken1234567890";

function fakeGraph(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body
      ? Object.fromEntries(new URLSearchParams(init.body))
      : null;
    calls.push({
      method: init.method ?? "GET",
      host: u.host,
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      body,
    });
    const key = `${init.method ?? "GET"} ${u.pathname.replace(/^\/v[\d.]+/, "")}`;
    const handler = routes[key];
    const [status, json] = handler
      ? handler({ query: Object.fromEntries(u.searchParams), body })
      : [404, { error: { message: "no route" } }];
    return new Response(JSON.stringify(json), { status });
  };
  return { calls, fetchImpl };
}

describe("Instagram client", () => {
  beforeEach(() => _resetSecrets());

  it("publishes through a container with Instagram Login and never sends tags", async () => {
    const { calls, fetchImpl } = fakeGraph({
      "GET /me": () => [200, { user_id: "17841400000000001" }],
      "POST /17841400000000001/media": () => [
        200,
        { id: "180000000000000001" },
      ],
      "GET /180000000000000001": () => [200, { status_code: "FINISHED" }],
      "POST /17841400000000001/media_publish": () => [
        200,
        { id: "180000000000000002" },
      ],
    });
    const client = createClient({ token: TOKEN, fetchImpl });
    const id = await client.createImageContainer({
      imageUrl:
        "https://example.blob.core.windows.net/metadata/social/media/x.jpg?sig=abc",
      caption: "Caption",
      altText: "Alt",
      locationId: "123",
      userTags: [{ username: "hub", x: 0.5, y: 0.5 }],
    });
    expect(await client.waitUntilReady(id)).toBe("FINISHED");
    expect(await client.publish(id)).toBe("180000000000000002");
    const create = calls.find((c) => c.path.endsWith("/media"));
    expect(create.host).toBe("graph.instagram.com");
    expect(create.body).toMatchObject({ caption: "Caption", alt_text: "Alt" });
    expect(create.body.location_id).toBeUndefined();
    expect(create.body.user_tags).toBeUndefined();
  });

  it("sends location and user tags with Facebook Login", async () => {
    const { calls, fetchImpl } = fakeGraph({
      "POST /99999999999/media": () => [200, { id: "1" }],
    });
    const client = createClient({
      mode: "facebook",
      token: TOKEN,
      userId: "99999999999",
      fetchImpl,
    });
    await client.createImageContainer({
      imageUrl: "u",
      caption: "c",
      locationId: 123,
      userTags: [{ username: "hub", x: 0.5, y: 0.9 }],
    });
    expect(calls[0].host).toBe("graph.facebook.com");
    expect(calls[0].body.location_id).toBe("123");
    expect(JSON.parse(calls[0].body.user_tags)).toEqual([
      { username: "hub", x: 0.5, y: 0.9 },
    ]);
  });

  it("keeps the token and account ids out of error messages", async () => {
    const { fetchImpl } = fakeGraph({
      "POST /17841400000000001/media": () => [
        400,
        {
          error: {
            message: `Bad request for 17841400000000001 with access_token=${TOKEN}`,
            code: 100,
          },
        },
      ],
    });
    registerSecret(TOKEN);
    const client = createClient({
      token: TOKEN,
      userId: "17841400000000001",
      fetchImpl,
    });
    const err = await client
      .createImageContainer({ imageUrl: "u", caption: "c" })
      .catch((e) => e);
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).not.toContain("17841400000000001");
  });
});

describe("redact", () => {
  beforeEach(() => _resetSecrets());

  it("scrubs secrets, tokens, signatures and long ids", () => {
    registerSecret("my-secret-value");
    const text = redact(
      "a my-secret-value b https://x.blob.core.windows.net/c/d.jpg?sv=1&sig=SIGNATURE access_token=abc 17841400000000001",
    );
    expect(text).not.toMatch(/my-secret-value|SIGNATURE|abc|17841400000000001/);
    expect(redact("Rate limit for org-AbC123xyz in proj_9f8e7d6c5b")).toBe(
      "Rate limit for <redacted> in <redacted>",
    );
  });
});

describe("seal", () => {
  const key = keyFromBase64(Buffer.alloc(32, 7).toString("base64"));

  it("round-trips and refuses the wrong key", () => {
    const box = seal({ token: TOKEN }, key);
    expect(JSON.stringify(box)).not.toContain(TOKEN);
    expect(unseal(box, key)).toEqual({ token: TOKEN });
    expect(() =>
      unseal(box, keyFromBase64(Buffer.alloc(32, 8).toString("base64"))),
    ).toThrow();
    expect(() => keyFromBase64("short")).toThrow(/32 random bytes/);
  });
});

describe("store + token", () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "social-test-"));
    _resetSecrets();
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("makes conditional writes fail loudly instead of overwriting", async () => {
    const store = localStore(dir);
    const etag = await store.writeJson(
      "a.json",
      { n: 1 },
      { ifNoneMatch: "*" },
    );
    await expect(
      store.writeJson("a.json", { n: 2 }, { ifNoneMatch: "*" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      store.writeJson("a.json", { n: 2 }, { ifMatch: "stale" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await store.writeJson("a.json", { n: 2 }, { ifMatch: etag });
    const { data } = await updateJson(store, "a.json", (v) => ({ n: v.n + 1 }));
    expect(data).toEqual({ n: 3 });
  });

  it("uses the seed token, then refreshes and seals it weekly", async () => {
    const store = localStore(dir);
    const settings = { loginMode: "instagram" };
    const env = {
      IG_ACCESS_TOKEN: TOKEN,
      SOCIAL_SECRET_KEY: Buffer.alloc(32, 1).toString("base64"),
    };
    let refreshed = 0;
    const makeClient = () => ({
      refreshToken: async () => ({
        token: `fresh-token-${++refreshed}`,
        expiresIn: 5184000,
      }),
    });
    const t0 = new Date("2026-10-01T00:00:00Z");
    expect(
      await resolveToken({
        settings,
        env,
        store,
        makeClient,
        allowRefresh: true,
        now: t0,
      }),
    ).toBe("fresh-token-1");
    const sealed = (await store.readJson("token.json")).data;
    expect(JSON.stringify(sealed)).not.toContain("fresh-token-1");
    const t1 = new Date("2026-10-05T00:00:00Z");
    expect(
      await resolveToken({
        settings,
        env,
        store,
        makeClient,
        allowRefresh: true,
        now: t1,
      }),
    ).toBe("fresh-token-1");
    const t2 = new Date("2026-10-09T00:00:00Z");
    expect(
      await resolveToken({
        settings,
        env,
        store,
        makeClient,
        allowRefresh: true,
        now: t2,
      }),
    ).toBe("fresh-token-2");
    // Pasting a new seed into the secret always wins.
    const env2 = { ...env, IG_ACCESS_TOKEN: "IGAAanothertoken987654" };
    expect(
      await resolveToken({ settings, env: env2, store, makeClient, now: t2 }),
    ).toBe("IGAAanothertoken987654");
    expect(fingerprint("x")).toHaveLength(16);
  });
});

describe("vision model", () => {
  it("prefers keyless Azure OpenAI, then keys, and names the deployment as the model", () => {
    const azure = {
      AZURE_OPENAI_ENDPOINT: "https://x.openai.azure.com",
      AZURE_OPENAI_DEPLOYMENT: "dep",
      OPENAI_API_KEY: "k",
    };
    expect(providerFor(azure)).toBe("azure");
    expect(modelFor("azure", azure)).toBe("dep");
    expect(providerFor({ OPENAI_API_KEY: "k" })).toBe("openai");
    expect(providerFor({ ANTHROPIC_API_KEY: "k" })).toBe("anthropic");
    expect(providerFor({})).toBeNull();
    expect(azureChatUrl("https://x.openai.azure.com/")).toBe(
      "https://x.openai.azure.com/openai/v1/chat/completions",
    );
    expect(azureChatUrl("https://x.openai.azure.com/openai/v1")).toBe(
      "https://x.openai.azure.com/openai/v1/chat/completions",
    );
  });

  it("asks for JSON with room for reasoning, and parses the reply", async () => {
    let sent;
    const fetchImpl = async (url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '```json\n{"appeal": 7}\n```' } }],
        }),
      );
    };
    const out = await askJson({
      provider: "openai",
      model: "m",
      prompt: "p",
      images: ["aGk="],
      env: { OPENAI_API_KEY: "k" },
      fetchImpl,
    });
    expect(out).toEqual({ appeal: 7 });
    expect(sent.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(sent.body.max_completion_tokens).toBeGreaterThanOrEqual(8000);
    expect(sent.body.response_format).toEqual({ type: "json_object" });
    expect(sent.body.max_tokens).toBeUndefined();
  });

  it("waits as long as a rate limit asks, within reason", () => {
    const res = (h) => ({ headers: new Headers(h) });
    expect(retryDelay(res({ "retry-after": "20" }), 0)).toBe(20000);
    expect(retryDelay(res({ "retry-after-ms": "500" }), 0)).toBe(2000);
    expect(retryDelay(res({ "retry-after": "600" }), 0)).toBe(60000);
    expect(retryDelay(res({}), 3)).toBe(30000);
  });

  it("redacts Entra access tokens", () => {
    expect(
      redact("token eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl here"),
    ).toBe("token <jwt> here");
  });
});

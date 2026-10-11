/**
 * Vision model calls for the social auto-poster.
 *
 * Kept separate from scripts/lib/describe.mjs on purpose: that module drives the
 * public site build, and the poster needs request options current models
 * require (max_completion_tokens) without changing how the site build behaves.
 *
 * Providers, chosen by what's configured (or forced with SOCIAL_PROVIDER):
 *   azure      AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT, keyless: the
 *              workflow's own Azure sign-in gets the token, so no API key
 *              exists anywhere and photos stay in your tenant
 *   openai     OPENAI_API_KEY, optional OPENAI_BASE_URL
 *   anthropic  ANTHROPIC_API_KEY
 *   mock       no network; used for dry runs and tests
 */
import sharp from "sharp";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function providerFor(env = process.env) {
  if (env.SOCIAL_PROVIDER) return env.SOCIAL_PROVIDER;
  if (env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_DEPLOYMENT) return "azure";
  if (env.OPENAI_API_KEY) return "openai";
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export function modelFor(provider, env = process.env) {
  if (provider === "azure")
    return env.AZURE_OPENAI_DEPLOYMENT || env.SOCIAL_MODEL || "";
  if (env.SOCIAL_MODEL) return env.SOCIAL_MODEL;
  if (provider === "openai") return env.OPENAI_MODEL || "gpt-6.1-sol";
  if (provider === "anthropic")
    return env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  return "mock";
}

/** Auto-oriented JPEG, long edge capped, as base64 for the request body. */
export async function encodeForModel(input, longEdge = 1280) {
  const buf = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(longEdge, longEdge, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return buf.toString("base64");
}

export function parseJsonReply(text) {
  const cleaned = String(text ?? "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start)
    throw new Error("model reply had no JSON object");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** How long the provider asked us to wait, in ms (Retry-After / retry-after-ms), capped at a minute. */
export function retryDelay(res, attempt) {
  const ms = Number(res.headers?.get?.("retry-after-ms"));
  const s = Number(res.headers?.get?.("retry-after"));
  const asked =
    Number.isFinite(ms) && ms > 0
      ? ms
      : Number.isFinite(s) && s > 0
        ? s * 1000
        : 0;
  const backoff = [2000, 6000, 15000, 30000, 60000][attempt] ?? 60000;
  return Math.min(60_000, Math.max(asked, backoff));
}

async function post(url, headers, body, fetchImpl) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    if (res.ok) return res.json();
    // Rate limits (a backfill can outrun a small deployment) and server errors
    // are worth waiting out; anything else is a real error.
    const retryable = res.status === 429 || res.status >= 500;
    const detail = (await res.text()).slice(0, 300);
    if (!retryable || attempt >= 5) {
      throw new Error(`model request failed (${res.status}): ${detail}`);
    }
    await sleep(retryDelay(res, attempt));
  }
}

/** "https://x.openai.azure.com" or ".../openai/v1" -> the v1 chat completions URL. */
export function azureChatUrl(endpoint) {
  const base = String(endpoint).trim().replace(/\/+$/, "");
  return base.endsWith("/openai/v1")
    ? `${base}/chat/completions`
    : `${base}/openai/v1/chat/completions`;
}

let azureCredential;
let azureToken;
async function azureBearer() {
  if (azureToken && azureToken.expiresOnTimestamp - Date.now() > 5 * 60 * 1000)
    return azureToken.token;
  if (!azureCredential) {
    const { DefaultAzureCredential } = await import("@azure/identity");
    azureCredential = new DefaultAzureCredential();
  }
  azureToken = await azureCredential.getToken(
    "https://cognitiveservices.azure.com/.default",
  );
  return azureToken.token;
}

/**
 * Send a prompt plus images and get a JSON object back.
 * `images` are base64 JPEGs; the first is always the photo being described.
 */
export async function askJson({
  provider,
  model,
  prompt,
  images = [],
  // Current models reason before answering, and that counts against this.
  maxTokens = 8000,
  env = process.env,
  fetchImpl = fetch,
  mock,
}) {
  if (provider === "mock") {
    if (!mock) throw new Error("mock provider needs a mock function");
    return mock(prompt, images);
  }

  if (provider === "openai" || provider === "azure") {
    const azure = provider === "azure";
    const url = azure
      ? azureChatUrl(env.AZURE_OPENAI_ENDPOINT)
      : `${env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/chat/completions`;
    const bearer = azure ? await azureBearer() : env.OPENAI_API_KEY;
    const json = await post(
      url,
      { Authorization: `Bearer ${bearer}` },
      {
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...images.map((b64) => ({
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${b64}`,
                  detail: "high",
                },
              })),
            ],
          },
        ],
        // Reasoning models count their thinking against this, so it's generous.
        max_completion_tokens: maxTokens,
        response_format: { type: "json_object" },
      },
      fetchImpl,
    );
    return parseJsonReply(json.choices?.[0]?.message?.content);
  }

  if (provider === "anthropic") {
    const json = await post(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      {
        model,
        max_tokens: maxTokens,
        messages: [
          {
            role: "user",
            content: [
              ...images.map((b64) => ({
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data: b64 },
              })),
              { type: "text", text: prompt },
            ],
          },
        ],
      },
      fetchImpl,
    );
    return parseJsonReply(json.content?.find((c) => c.type === "text")?.text);
  }

  throw new Error(
    `Unknown provider "${provider}". Use azure, openai, anthropic or mock.`,
  );
}

/**
 * Draft session copy from the session's own photographs.
 *
 * Shared by scripts/describe-sessions.mjs (the review-first CLI) and
 * scripts/prebuild.mjs (which fills in sessions uploaded without a description).
 *
 * Generation is opt-in: with no provider configured, `isEnabled()` is false
 * and callers skip the step entirely, so builds never depend on an API being up.
 *
 * Environment:
 *   OPENAI_API_KEY      + optional OPENAI_BASE_URL, OPENAI_MODEL
 *   ANTHROPIC_API_KEY   + optional ANTHROPIC_MODEL
 *   AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT
 *                       keyless: signs in with Entra ID (the build's OIDC login,
 *                       or your `az login` locally). See infra/modules/ai.bicep.
 *   DESCRIBE_PROVIDER   force a provider instead of inferring from the above
 *
 * Azure OpenAI with an API key also works through the OpenAI path, since its v1
 * endpoint is OpenAI-compatible. Point OPENAI_BASE_URL at
 * https://<resource>.openai.azure.com/openai/v1 and set OPENAI_MODEL to the
 * deployment name rather than the model name.
 */
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VOICE_FILE = join(ROOT, ".github/instructions/site-copy.instructions.md");
const META_FILE = join(ROOT, "scripts/session-meta.json");
const SAMPLE_WIDTH = 768;

/** Which provider to use, inferred from whichever key or endpoint is present. */
export function activeProvider() {
  // Empty strings matter here: unset GitHub Actions secrets and vars are passed
  // through as '', so a plain presence check would wrongly enable the feature.
  const forced = process.env.DESCRIBE_PROVIDER;
  if (forced) return forced;
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.AZURE_OPENAI_ENDPOINT) return "azure";
  return null;
}

export function isEnabled() {
  return activeProvider() !== null;
}

/** Evenly spaced picks so the sample spans the whole session, not just the start. */
export function sampleEvenly(items, count) {
  if (items.length <= count) return items;
  const step = items.length / count;
  return Array.from({ length: count }, (_, i) => items[Math.floor(i * step)]);
}

/** Downscale one image to a base64 JPEG for the model. */
async function encodeOne(imagesDir, img) {
  const buf = await sharp(join(imagesDir, img.file))
    .rotate()
    .resize(SAMPLE_WIDTH, SAMPLE_WIDTH, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();
  return {
    file: img.file,
    caption: img.caption,
    base64: buf.toString("base64"),
  };
}

/** Encode exactly the images given, skipping any that can't be read. */
export async function encodeImages({ imagesDir, images }) {
  if (!existsSync(imagesDir)) return [];
  const onDisk = new Set(await readdir(imagesDir));
  const encoded = [];
  for (const img of images) {
    if (!onDisk.has(img.file)) continue;
    try {
      encoded.push(await encodeOne(imagesDir, img));
    } catch {
      // A single unreadable frame shouldn't sink the whole session.
    }
  }
  return encoded;
}

/** Downscale a sample of a session's images to base64 JPEGs for the model. */
export async function encodeSamples({ imagesDir, images, samples = 8 }) {
  return encodeImages({ imagesDir, images: sampleEvenly(images, samples) });
}

/** Pull the voice rules out of the instructions file so prompts stay in sync with it. */
async function loadVoiceRules() {
  try {
    const text = await readFile(VOICE_FILE, "utf8");
    const start = text.indexOf("## Voice");
    const end = text.indexOf("## Species facts");
    if (start === -1) return "";
    return text.slice(start, end === -1 ? undefined : end).trim();
  } catch {
    return "";
  }
}

/**
 * A handful of the site's reviewed descriptions, for the model to match.
 *
 * Rules alone produce copy that's correct and still sounds generated ("I've
 * framed Mount Baker above rocky ridges"). Seeing how the other pages actually
 * read fixes the voice in a way a list of rules doesn't.
 */
export async function styleExamples({
  exclude = "",
  count = 6,
  file = META_FILE,
} = {}) {
  try {
    const meta = JSON.parse(await readFile(file, "utf8"));
    const reviewed = Object.entries(meta)
      .filter(([slug]) => !slug.startsWith("$") && slug !== exclude)
      .filter(([, m]) => !m.draft && m.title && m.description);
    return sampleEvenly(reviewed, count).map(
      ([, m]) => `${m.title}\n${m.description}`,
    );
  } catch {
    return [];
  }
}

function buildPrompt({
  slug,
  title,
  date,
  location,
  imageCount,
  samples,
  voiceRules,
  species = [],
  examples = [],
}) {
  const captions = samples
    .filter((s) => s.caption)
    .map((s) => `- ${s.file}: ${s.caption}`);

  return `You are drafting gallery copy for Truman Brown's personal photography site.

Session folder: ${slug}
Current title: ${title}
Date: ${date}
Current location: ${location || "(none set)"}
Photographs in session: ${imageCount} (you are being shown ${samples.length})
${captions.length ? `Existing captions:\n${captions.join("\n")}` : ""}

Write a title, location and description for this session.

Rules that matter most:
- Identify the actual place if the photographs make it recognisable (a named park, trail, peak, landmark, city). Use the real proper noun. This is the single most useful thing you can do, because these are the words people search for.
${speciesRule(species)}
- Never invent numbers, distances, elevations, dates or conservation status.
- Describe only what is visible in the photographs, plus the name of the place.
  Everything else is a guess, and a guess printed as fact is worse than saying
  nothing. In particular, never state:
  - what an organisation, reserve, station or facility does, funds, breeds,
    protects or was founded for, even when its name hints at it;
  - the history of a site, what it used to be, or how it came to be that way;
  - trail length, difficulty, route-finding, gear or any advice about going there;
  - people who are not in the frame, including guides, companions and what
    anyone said or pointed at;
  - why an animal or plant behaves the way it does, what season it is typical
    of, or how common or rare it is.
- No superlatives about places you cannot verify ("the best spot for", "the
  only place where").
- If you cannot tell where it is, return an empty string for location rather than guessing.
- Description: 2-4 sentences, roughly 200-350 characters. Concrete nouns, specific subjects, what is actually in the frames.
- Title: sentence case, in the shape "Place, Region, Month Year".
- Never use an em dash (—) anywhere. Use a comma, a colon, or a new sentence. An em
  dash is the clearest sign of machine-written copy and will be rejected.
- Don't open with "A" or "The" every time, and don't end on a clause that restates
  what you just said.
- Write as Truman telling someone about the day, not as someone describing
  photographs. Never mention framing, shots, frames or the photographs themselves.

${voiceRules ? `Voice rules for this site:\n${voiceRules}` : ""}
${
  examples.length
    ? `
Other sessions on the site, already written in Truman's voice. Match how these
sound: plain, specific, a real detail or a dry aside where it fits. Never reuse
their phrases or borrow their subjects; this session gets its own words.

${examples.join("\n\n")}
`
    : ""
}
Reply with JSON only, no code fence:
{"title": "...", "location": "...", "description": "..."}`;
}

async function callOpenAI(prompt, samples, { detail = "low", maxTokens } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");
  // `||` not `??`: unset GitHub Actions secrets/vars arrive as empty strings.
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...samples.map((s) => ({
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${s.base64}`,
                detail,
              },
            })),
          ],
        },
      ],
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok)
    throw new Error(
      `OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

/** Azure OpenAI v1 chat URL, whether or not the endpoint already includes the path. */
export function azureChatUrl(endpoint) {
  const base = endpoint.trim().replace(/\/+$/, "");
  return base.endsWith("/openai/v1")
    ? `${base}/chat/completions`
    : `${base}/openai/v1/chat/completions`;
}

let azureCredential;
let azureToken;

/** Entra ID token for Azure OpenAI, reused until a few minutes before it expires. */
async function azureBearer() {
  if (azureToken && azureToken.expiresOnTimestamp - Date.now() > 5 * 60_000) {
    return azureToken.token;
  }
  if (!azureCredential) {
    const { DefaultAzureCredential } = await import("@azure/identity");
    azureCredential = new DefaultAzureCredential();
  }
  azureToken = await azureCredential.getToken(
    "https://cognitiveservices.azure.com/.default",
  );
  return azureToken.token;
}

async function callAzure(
  prompt,
  samples,
  { detail = "low", maxTokens = 0 } = {},
) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  if (!endpoint || !deployment) {
    throw new Error(
      "AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT must both be set.",
    );
  }

  const body = JSON.stringify({
    model: deployment,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...samples.map((s) => ({
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${s.base64}`, detail },
          })),
        ],
      },
    ],
    // Current models reason before they answer and that counts against this
    // limit, so it sits well above the length of any reply asked for here.
    max_completion_tokens: Math.max(maxTokens, 8000),
    response_format: { type: "json_object" },
  });

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(azureChatUrl(endpoint), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await azureBearer()}`,
      },
      body,
    });
    if (res.ok) {
      const json = await res.json();
      return json.choices?.[0]?.message?.content ?? "";
    }
    // A busy minute shouldn't cost a session its description until the next
    // build, so rate limits and server errors get two more tries.
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 2) {
      throw new Error(
        `Azure OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    }
    await new Promise((r) => setTimeout(r, [5_000, 20_000][attempt]));
  }
}

async function callAnthropic(prompt, samples, { maxTokens = 1024 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        {
          role: "user",
          content: [
            ...samples.map((s) => ({
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: s.base64,
              },
            })),
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok)
    throw new Error(
      `Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  const json = await res.json();
  return json.content?.find((c) => c.type === "text")?.text ?? "";
}

/** Offline stand-in so the pipeline can be exercised without an API key. */
async function callMock(prompt, samples, { mode } = {}) {
  if (mode === "captions") {
    return JSON.stringify(
      Object.fromEntries(
        samples.map((s, i) => [s.file, `Mock caption ${i + 1}`]),
      ),
    );
  }
  return JSON.stringify({
    title: "Mock title",
    location: "Mock location",
    description: `Mock draft from ${samples.length} sampled photograph(s).`,
  });
}

const PROVIDERS = {
  openai: callOpenAI,
  anthropic: callAnthropic,
  azure: callAzure,
  mock: callMock,
};

export function parseModelJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  for (const field of ["title", "description"]) {
    if (typeof parsed[field] !== "string" || !parsed[field].trim()) {
      throw new Error(`model did not return a usable "${field}"`);
    }
  }
  return {
    title: parsed.title.trim(),
    location: typeof parsed.location === "string" ? parsed.location.trim() : "",
    description: parsed.description.trim(),
  };
}

/**
 * Draft copy for one session. Throws if the provider is unavailable or the
 * reply can't be parsed; callers decide whether that's fatal.
 *
 * Drafts the build writes go live without anyone reading them first, so each
 * one is held to the same mechanical rules as the hand-written copy. A draft
 * that breaks one goes back to the model once, with the specific complaint.
 */
export async function describeSession({
  slug,
  title,
  date,
  location,
  images,
  imagesDir,
  samples = 8,
  provider = activeProvider(),
}) {
  const call = PROVIDERS[provider];
  if (!call)
    throw new Error(
      `Unknown provider "${provider}". Use openai, anthropic, azure or mock.`,
    );

  const encoded = await encodeSamples({ imagesDir, images, samples });
  if (encoded.length === 0) throw new Error("no readable images to sample");

  const [voiceRules, species, examples] = await Promise.all([
    loadVoiceRules(),
    inatSpecies(),
    styleExamples({ exclude: slug }),
  ]);
  const prompt = buildPrompt({
    slug,
    title,
    date,
    location,
    imageCount: images.length,
    samples: encoded,
    voiceRules,
    species,
    examples,
  });
  let draft = parseModelJson(await call(prompt, encoded));
  const problems = copyProblems(draft);
  if (problems.length > 0) {
    const retry = `${prompt}

Your previous draft was:
${JSON.stringify(draft)}

It broke these rules:
${problems.map((p) => `- ${p}`).join("\n")}

Rewrite it so it follows every rule.`;
    draft = parseModelJson(await call(retry, encoded));
  }
  return { ...stripEmDashes(draft), sampled: encoded.length };
}

const BANNED_WORDS =
  /\b(stunning|breathtaking|vibrant|captivating|seamless|nestled|boasts|unleash|elevate|immerse|embark|dive in|discover)\b/i;
const TITLE_SHAPE =
  /, (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/;

/**
 * What stops a draft from being publishable as-is, by the rules
 * scripts/session-copy.test.mjs enforces on the hand-written copy. Each entry
 * is phrased as feedback the model can act on. Empty means it passes.
 */
export function copyProblems({ title = "", description = "" }) {
  const text = `${title} ${description}`;
  const problems = [];
  if (text.includes("—")) {
    problems.push(
      "It uses an em dash (—). Use a comma, a colon, or a new sentence instead.",
    );
  }
  const banned = text.match(BANNED_WORDS);
  if (banned) {
    problems.push(`It uses "${banned[0]}", which the style guide bans.`);
  }
  if (title && !TITLE_SHAPE.test(title)) {
    problems.push(
      'The title must follow "Place, Region, Month Year", for example "Sauk Mountain, Washington, June 2026".',
    );
  }
  return problems;
}

/** Last resort for a draft that kept its em dashes through the rewrite. */
function stripEmDashes(draft) {
  const fix = (s) =>
    s
      .replace(/\s*—\s*/g, ", ")
      .replace(/,\s*,/g, ",")
      .trim();
  return {
    title: fix(draft.title),
    location: fix(draft.location),
    description: fix(draft.description),
  };
}

const CAPTION_BATCH = 10;
const MAX_CAPTION = 500;

function buildCaptionPrompt({
  title,
  location,
  batch,
  voiceRules,
  species = [],
}) {
  return `You are writing one short caption per photograph for a gallery on Truman Brown's personal photography site.

Session: ${title}${location ? ` (${location})` : ""}
Photographs in this batch: ${batch.map((b) => b.file).join(", ")}

These captions become the images' alt text, so they are read by screen readers
and by search engines. Accuracy matters more than flair.

Rules:
- One caption per photograph, 5-15 words. No trailing full stop.
- Say what is actually visible. Lead with the subject.
${speciesRule(species)}
- Name a peak or landmark only if you are sure. Otherwise describe it plainly.
- Never invent numbers, elevations, distances, dates or conservation status.
- No marketing words (stunning, breathtaking, vibrant). No "a photo of".
- Never use an em dash (—). Use a comma or a new sentence.
- Do not repeat the session title in every caption.

${voiceRules ? `Voice rules for this site:\n${voiceRules}` : ""}

Reply with JSON only, no code fence, mapping each filename to its caption:
{${batch.map((b) => `"${b.file}": "..."`).join(", ")}}`;
}

/** Parse a {filename: caption} reply, keeping only captions for images we asked about. */
export function parseCaptionJson(text, expectedFiles) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("model did not return a caption object");
  }

  const allowed = new Set(expectedFiles);
  const out = new Map();
  for (const [file, caption] of Object.entries(parsed)) {
    if (!allowed.has(file)) continue;
    if (typeof caption !== "string") continue;
    // Models like to end captions with a full stop even when told not to.
    const clean = caption
      .trim()
      .replace(/\.$/, "")
      .slice(0, MAX_CAPTION)
      .trim();
    if (clean) out.set(file, clean);
  }
  return out;
}

/**
 * Write a caption for every image that doesn't already have one.
 *
 * Returns a Map of filename to caption. Images are sent in batches so one bad
 * reply costs a batch rather than the whole session, and so the request stays a
 * reasonable size. Captions you already wrote are never sent or overwritten.
 */
export async function captionImages({
  title,
  location,
  images,
  imagesDir,
  batchSize = CAPTION_BATCH,
  provider = activeProvider(),
  onBatchError,
}) {
  const call = PROVIDERS[provider];
  if (!call)
    throw new Error(
      `Unknown provider "${provider}". Use openai, anthropic, azure or mock.`,
    );

  const pending = images.filter((img) => !img.caption);
  if (pending.length === 0) return new Map();

  const [voiceRules, species] = await Promise.all([
    loadVoiceRules(),
    inatSpecies(),
  ]);
  const captions = new Map();

  for (let i = 0; i < pending.length; i += batchSize) {
    const slice = pending.slice(i, i + batchSize);
    const batch = await encodeImages({ imagesDir, images: slice });
    if (batch.length === 0) continue;

    try {
      const prompt = buildCaptionPrompt({
        title,
        location,
        batch,
        voiceRules,
        species,
      });
      // "high" detail here, unlike the session summary: a caption has to resolve
      // the actual subject, and 512px is not enough to tell two frogs apart.
      const raw = await call(prompt, batch, {
        detail: "high",
        maxTokens: 2048,
        mode: "captions",
      });
      for (const [file, caption] of parseCaptionJson(
        raw,
        batch.map((b) => b.file),
      )) {
        captions.set(file, caption);
      }
    } catch (e) {
      onBatchError?.(e, slice.length);
    }
  }

  return captions;
}

/**
 * Per-image captions are a separate opt-in from the session description.
 *
 * The blast radius is different: a session description is one sentence you can
 * scan, captions are one claim per photograph. On a site that's largely wildlife
 * macro, a confidently wrong species name is worse than a generic caption, so
 * turning captions on is a deliberate second step rather than a side effect of
 * setting an API key.
 *
 * DESCRIBE_CAPTIONS accepts either a switch or a list, so you can try one
 * session before committing to the whole archive:
 *   unset / 0 / off          no captions anywhere
 *   1 / true / on / yes      caption every session
 *   <slug>[,<slug>...]       caption only those sessions
 */
export function captionsEnabledFor(slug) {
  if (!isEnabled()) return false;
  const raw = (process.env.DESCRIBE_CAPTIONS || "").trim();
  if (!raw) return false;

  const flag = raw.toLowerCase();
  if (["1", "true", "on", "yes"].includes(flag)) return true;
  if (["0", "false", "off", "no"].includes(flag)) return false;

  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(slug);
}

const INAT_USER = process.env.INATURALIST_USER || "";
const INAT_PAGE = 200;
const INAT_MAX_PAGES = 6;

/**
 * The species this photographer has actually recorded on iNaturalist.
 *
 * Used as an allowlist in the prompts. A vision model asked to name a frog will
 * happily produce a plausible-but-wrong species; constraining it to a list of
 * things the photographer has genuinely observed and had reviewed by other
 * naturalists removes most of that failure mode, and the identifications are
 * community-verified rather than guessed from one frame.
 *
 * Returns an empty list when no user is configured or iNat is unreachable, in
 * which case the prompts fall back to telling the model to stay generic.
 */
export async function inatSpecies(user = INAT_USER) {
  if (!user) return [];
  const names = [];
  try {
    for (let page = 1; page <= INAT_MAX_PAGES; page++) {
      const url =
        `https://api.inaturalist.org/v1/observations/species_counts` +
        `?user_login=${encodeURIComponent(user)}&per_page=${INAT_PAGE}&page=${page}`;
      const res = await fetch(url);
      if (!res.ok) break;
      const json = await res.json();
      const results = json.results ?? [];
      for (const r of results) {
        const common = r.taxon?.preferred_common_name;
        if (common) names.push(common);
      }
      if (results.length < INAT_PAGE) break;
    }
  } catch {
    // Accuracy aid, not a dependency: a failed lookup just means generic copy.
  }
  return names;
}

function speciesRule(species) {
  if (species.length === 0) {
    return `- Do NOT name species. Use the group instead ("a tree frog", "a heron", "a dart frog"). A wrong species name is worse than no name at all.`;
  }
  return `- You may name a species ONLY if it appears in this list of species the photographer has actually recorded and had verified on iNaturalist. Anything not on this list must stay at group level ("a tree frog", "a heron"). A wrong species name is worse than no name at all.
Verified species: ${species.join("; ")}`;
}

/**
 * Draft session copy from the session's own photographs.
 *
 * Shared by scripts/describe-sessions.mjs (the review-first CLI) and
 * scripts/prebuild.mjs (which fills in sessions uploaded without a description).
 *
 * Generation is opt-in: with no provider key configured, `isEnabled()` is false
 * and callers skip the step entirely, so builds never depend on an API being up.
 *
 * Environment:
 *   OPENAI_API_KEY      + optional OPENAI_BASE_URL, OPENAI_MODEL
 *   ANTHROPIC_API_KEY   + optional ANTHROPIC_MODEL
 *   DESCRIBE_PROVIDER   force a provider instead of inferring from the keys
 *
 * Azure OpenAI works through the OpenAI path without code changes, since its v1
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
const SAMPLE_WIDTH = 768;

/** Which provider to use, inferred from whichever key is present. */
export function activeProvider() {
  // Empty strings matter here: unset GitHub Actions secrets and vars are passed
  // through as '', so a plain presence check would wrongly enable the feature.
  const forced = process.env.DESCRIBE_PROVIDER;
  if (forced) return forced;
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
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

function buildPrompt({
  slug,
  title,
  date,
  location,
  imageCount,
  samples,
  voiceRules,
  species = [],
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
- If you cannot tell where it is, return an empty string for location rather than guessing.
- Description: 2-4 sentences, roughly 200-350 characters. Concrete nouns, specific subjects, what is actually in the frames.
- Title: sentence case. Lead with the place or the subject, not the date.

${voiceRules ? `Voice rules for this site:\n${voiceRules}` : ""}

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
      `Unknown provider "${provider}". Use openai, anthropic or mock.`,
    );

  const encoded = await encodeSamples({ imagesDir, images, samples });
  if (encoded.length === 0) throw new Error("no readable images to sample");

  const [voiceRules, species] = await Promise.all([
    loadVoiceRules(),
    inatSpecies(),
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
  });
  return {
    ...parseModelJson(await call(prompt, encoded)),
    sampled: encoded.length,
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
      `Unknown provider "${provider}". Use openai, anthropic or mock.`,
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

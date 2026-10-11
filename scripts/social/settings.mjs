/**
 * Settings for the social auto-poster, read from the environment.
 *
 * Nothing here is secret or account-identifying. Secrets (the access token, the
 * at-rest key, model API keys) are read where they're used and never logged.
 * See docs/social.md for what each variable does.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Default posting times by posts-per-day, in the configured time zone.
 * Midweek late morning, early afternoon and early evening are where the large
 * timing studies (Sprout, Buffer, Hootsuite) agree, and these keep at least
 * four hours between posts so each one gets its own first hour.
 */
const DEFAULT_SLOTS = {
  1: ["12:00"],
  2: ["09:00", "17:30"],
  3: ["08:30", "12:30", "18:00"],
  4: ["08:00", "11:30", "15:00", "18:30"],
};

function int(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** "08:30" -> minutes past midnight, or null when malformed. */
export function clockMinutes(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function parseSlots(raw, postsPerDay) {
  const fallback = DEFAULT_SLOTS[postsPerDay] ?? spread(postsPerDay);
  if (!raw) return fallback;
  const slots = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => clockMinutes(s) !== null)
    .sort((a, b) => clockMinutes(a) - clockMinutes(b));
  return slots.length >= postsPerDay ? slots.slice(0, postsPerDay) : fallback;
}

/** Evenly spaced slots between 08:00 and 20:00 for counts without a default. */
function spread(count) {
  const start = 8 * 60;
  const span = 12 * 60;
  return Array.from({ length: count }, (_, i) => {
    const m = start + Math.round((span * i) / Math.max(1, count - 1));
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  });
}

/** Public site domain, read from site.config.ts so captions point at the right place. */
export function siteDomain() {
  return siteConfigValue("domain");
}

/** The photographer's name, already public in site.config.ts. */
export function siteOwner() {
  return siteConfigValue("ownerName") || "the photographer";
}

/** The iNaturalist login the hobby pages already link to, if any. */
export function hobbyInatUser() {
  try {
    const dir = join(ROOT, "src/content/hobbies");
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()) {
      const match = /"userId":\s*"([^"]+)"/.exec(
        readFileSync(join(dir, file), "utf8"),
      );
      if (match) return match[1];
    }
  } catch {
    // No hobbies section; iNaturalist matching stays off unless configured.
  }
  return "";
}

function siteConfigValue(field) {
  try {
    const text = readFileSync(join(ROOT, "site.config.ts"), "utf8");
    return new RegExp(`${field}:\\s*["']([^"']+)["']`).exec(text)?.[1] ?? "";
  } catch {
    return "";
  }
}

export function loadSettings(env = process.env) {
  const postsPerDay = int(env.SOCIAL_POSTS_PER_DAY, 3, 1, 6);
  return {
    /** Publishing only happens when this is exactly "true". Everything else is a dry run. */
    live: env.SOCIAL_LIVE === "true",
    /** Strict mode: only post entries approved with `npm run social -- approve`. */
    requireApproval: env.SOCIAL_REQUIRE_APPROVAL === "true",
    /** "instagram" = Instagram Login (no Facebook Page); "facebook" = Facebook Login (Page-linked). */
    loginMode: env.IG_LOGIN_MODE === "facebook" ? "facebook" : "instagram",
    apiVersion: env.IG_API_VERSION || "v25.0",
    postsPerDay,
    slots: parseSlots(env.SOCIAL_SLOTS, postsPerDay),
    timezone: env.SOCIAL_TIMEZONE || "America/Los_Angeles",
    /** Never post twice within this many minutes, even when catching up. */
    minGapMinutes: int(env.SOCIAL_MIN_GAP_MINUTES, 150, 30, 720),
    /** No new posts after this local time; a missed slot waits for tomorrow. */
    dayEnd: clockMinutes(env.SOCIAL_DAY_END || "") ?? 23 * 60,
    /** "pad" adds plain borders to frames Instagram can't take as-is; "skip" leaves them out. */
    tallImages: env.SOCIAL_TALL_IMAGES === "skip" ? "skip" : "pad",
    /** Border colour for padded frames: "auto" picks black or white from the photo's edges. */
    padColor: env.SOCIAL_PAD_COLOR || "auto",
    minWidth: int(env.SOCIAL_MIN_WIDTH, 1080, 320, 4000),
    inatUser:
      env.SOCIAL_INATURALIST_USER || env.INATURALIST_USER || hobbyInatUser(),
    domain: env.SOCIAL_SITE_DOMAIN || siteDomain(),
    storageAccount: env.AZURE_STORAGE_ACCOUNT || "",
  };
}

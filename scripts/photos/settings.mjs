/**
 * Settings shared by the photo pipeline (scripts/photos), read from the
 * environment and the site's own config.
 *
 * Nothing here is secret or account-identifying. See docs/photos.md.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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

export function photoSettings(env = process.env) {
  return {
    /** Whose iNaturalist observations count as the identification for a photo. */
    inatUser: env.INATURALIST_USER || hobbyInatUser(),
    storageAccount: env.AZURE_STORAGE_ACCOUNT || "",
  };
}

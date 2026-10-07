import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guard rails for the copy in scripts/session-meta.json.
 *
 * These exist because generated-sounding copy kept creeping back in: an em dash
 * in every title, the same sentence shape in every description. A style guide
 * alone didn't stop it, so the rules that can be checked mechanically are
 * checked here instead.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const meta = JSON.parse(
  readFileSync(join(ROOT, "scripts/session-meta.json"), "utf8"),
);
const slugs = Object.keys(meta).filter((k) => !k.startsWith("$"));
const entries = slugs.map((slug) => [slug, meta[slug]]);

describe("session copy", () => {
  it("has an entry for every session with all three fields", () => {
    expect(slugs.length).toBeGreaterThan(0);
    for (const [slug, m] of entries) {
      expect(m.title, `${slug} title`).toBeTruthy();
      expect(m.description, `${slug} description`).toBeTruthy();
      expect(typeof m.location, `${slug} location`).toBe("string");
    }
  });

  it("never uses an em dash, which is the clearest tell of generated copy", () => {
    const offenders = entries
      .filter(([, m]) => `${m.title} ${m.description}`.includes("—"))
      .map(([slug]) => slug);
    expect(offenders, "use a comma, a colon, or a full stop instead").toEqual(
      [],
    );
  });

  it("keeps titles in the 'Place, Region, Month Year' shape", () => {
    const shape =
      /, (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/;
    const offenders = entries
      .filter(([, m]) => !shape.test(m.title))
      .map(([slug]) => slug);
    expect(offenders).toEqual([]);
  });

  it("has no duplicate titles", () => {
    const titles = entries.map(([, m]) => m.title);
    const dupes = titles.filter((t, i) => titles.indexOf(t) !== i);
    expect([...new Set(dupes)]).toEqual([]);
  });

  it("stays inside the sidecar field limits", () => {
    for (const [slug, m] of entries) {
      expect(m.title.length, `${slug} title`).toBeLessThanOrEqual(200);
      expect(m.location.length, `${slug} location`).toBeLessThanOrEqual(200);
      expect(m.description.length, `${slug} description`).toBeLessThanOrEqual(
        1000,
      );
    }
  });

  it("avoids the marketing words the style guide bans", () => {
    const banned =
      /\b(stunning|breathtaking|vibrant|captivating|seamless|nestled|boasts|unleash|elevate|immerse|embark|dive in|discover)\b/i;
    const offenders = entries
      .filter(([, m]) => banned.test(`${m.title} ${m.description}`))
      .map(([slug]) => slug);
    expect(offenders).toEqual([]);
  });

  it("does not open every description the same way", () => {
    // Identical opening words across many entries is what makes a set of
    // descriptions read as generated rather than written.
    const firstWords = entries.map(([, m]) =>
      m.description.split(/\s+/)[0].toLowerCase(),
    );
    const counts = new Map();
    for (const w of firstWords) counts.set(w, (counts.get(w) ?? 0) + 1);
    const overused = [...counts.entries()].filter(([, n]) => n > 3);
    expect(overused).toEqual([]);
  });
});

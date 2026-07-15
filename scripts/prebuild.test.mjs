import { describe, expect, it } from "vitest";
import {
  hashKey,
  reorderByList,
  sanitizeSlug,
  targetFileForBlob,
  validateImageTargets,
  validateSessionSidecar,
  validateSessionSlugs,
} from "./prebuild.mjs";

describe("prebuild session slugs", () => {
  it("preserves the established URL format", () => {
    expect(sanitizeSlug("June Sauk Mtn_and Nearby")).toBe(
      "june-sauk-mtn_and-nearby",
    );
  });

  it("rejects distinct folders that map to the same public slug", () => {
    expect(() => validateSessionSlugs(["Hiking 2025", "Hiking-2025"])).toThrow(
      'both map to "hiking-2025"',
    );
  });

  it("rejects a folder name that maps to an empty slug", () => {
    expect(() => validateSessionSlugs(["東京"])).toThrow(
      "does not contain any characters usable in a public URL",
    );
  });

  it("rejects slugs too long for reliable local files and public URLs", () => {
    expect(() => validateSessionSlugs(["a".repeat(201)])).toThrow(
      "the limit is 200",
    );
  });
});

describe("prebuild image targets", () => {
  it("converts non-web source extensions to JPEG filenames", () => {
    expect(targetFileForBlob({ base: "DSC0123.ARW", ext: ".arw" })).toBe(
      "DSC0123.jpg",
    );
    expect(targetFileForBlob({ base: "IMG_0042.HEIC", ext: ".heic" })).toBe(
      "IMG_0042.jpg",
    );
    expect(targetFileForBlob({ base: "ready.webp", ext: ".webp" })).toBe(
      "ready.webp",
    );
  });

  it("rejects source files that would overwrite the same generated image", () => {
    expect(() =>
      validateImageTargets(
        [
          { base: "DSC0123.ARW", ext: ".arw" },
          { base: "DSC0123.jpg", ext: ".jpg" },
        ],
        "raw-plus-jpeg",
      ),
    ).toThrow('both produce "DSC0123.jpg"');
  });

  it("applies ordering and captions written against converted source names", () => {
    const images = [{ file: "other.jpg" }, { file: "DSC0123.jpg" }];
    const ordered = reorderByList(
      images,
      [{ file: "DSC0123.ARW", caption: "Converted RAW" }],
      new Map([["DSC0123.ARW", "DSC0123.jpg"]]),
    );

    expect(ordered.map((image) => image.file)).toEqual([
      "DSC0123.jpg",
      "other.jpg",
    ]);
    expect(ordered[0].caption).toBe("Converted RAW");
  });
});

describe("prebuild cache keys", () => {
  it("does not alias known collisions from the previous 32-bit hash", () => {
    expect(hashKey("Aa")).not.toBe(hashKey("BB"));
  });

  it("is deterministic and filesystem-safe", () => {
    expect(hashKey("originals/example.jpg@etag@target.jpg")).toMatch(
      /^[a-f0-9]{64}\.bin$/,
    );
    expect(hashKey("same input")).toBe(hashKey("same input"));
  });
});

describe("session sidecar validation", () => {
  it("accepts the documented metadata shape", () => {
    const sidecar = {
      title: "Spring trip",
      date: "2026-04-18",
      location: "Coast",
      description: "",
      cover: "DSC0123.ARW",
      order: 2,
      images: [{ file: "DSC0123.ARW", caption: "Sunrise" }, "DSC0124.jpg"],
    };
    expect(validateSessionSidecar(sidecar)).toBe(sidecar);
  });

  it("rejects invalid dates and field types with actionable paths", () => {
    expect(() =>
      validateSessionSidecar(
        { title: "", date: "2025-02-29", order: "first", images: [null] },
        "trip/_session.json",
      ),
    ).toThrow(
      /trip\/_session\.json is invalid:[\s\S]*date must be a real ISO calendar date[\s\S]*order must be an integer[\s\S]*images\[0\]/,
    );
  });

  it("rejects non-object JSON values", () => {
    expect(() => validateSessionSidecar(null)).toThrow(
      "must contain a JSON object",
    );
    expect(() => validateSessionSidecar([])).toThrow(
      "must contain a JSON object",
    );
  });

  it("rejects captions longer than the public content limit", () => {
    expect(() =>
      validateSessionSidecar({
        images: [{ file: "DSC0123.jpg", caption: "x".repeat(501) }],
      }),
    ).toThrow("caption must be at most 500 characters");
  });
});

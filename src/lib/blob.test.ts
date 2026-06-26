import { describe, it, expect } from "vitest";
import { blobUrl } from "./blob";
import { siteConfig } from "../../site.config";

const base = `https://${siteConfig.blobHost}`;

describe("blobUrl", () => {
  it("builds a URL for a container and path", () => {
    expect(blobUrl("originals", "china-2025/IMG_1.jpg")).toBe(
      `${base}/originals/china-2025/IMG_1.jpg`,
    );
  });

  it("strips leading slashes from the path", () => {
    expect(blobUrl("derivatives", "/a/b.jpg")).toBe(
      `${base}/derivatives/a/b.jpg`,
    );
  });

  it("encodes each path segment but keeps the separators", () => {
    expect(blobUrl("originals", "my trip/a&b.jpg")).toBe(
      `${base}/originals/my%20trip/a%26b.jpg`,
    );
  });

  it("routes to the requested container", () => {
    expect(blobUrl("metadata", "admin-index.json")).toBe(
      `${base}/metadata/admin-index.json`,
    );
  });
});

const {
  MAX_CAPTION,
  captionsFromImages,
  normalizeSessionImages,
} = require("./session-images");

describe("session image metadata", () => {
  it("normalizes empty captions to filenames while preserving order", () => {
    expect(
      normalizeSessionImages([
        { file: "one.jpg", caption: "  First view  " },
        { file: "two.jpg", caption: "  " },
        "three.jpg",
      ]),
    ).toEqual({
      images: [
        { file: "one.jpg", caption: "First view" },
        "two.jpg",
        "three.jpg",
      ],
      errors: [],
    });
  });

  it("rejects duplicate, nested, and overlong entries", () => {
    const result = normalizeSessionImages([
      "same.jpg",
      "same.jpg",
      "../nested.jpg",
      { file: "long.jpg", caption: "x".repeat(MAX_CAPTION + 1) },
    ]);
    expect(result.images).toBeUndefined();
    expect(result.errors).toHaveLength(3);
  });

  it("extracts only non-empty captions from sidecar image entries", () => {
    expect(
      captionsFromImages([
        "one.jpg",
        { file: "two.jpg", caption: "Bird on a branch" },
        { file: "three.jpg", caption: "" },
      ]),
    ).toEqual({ "two.jpg": "Bird on a branch" });
  });

  it("treats an omitted edit as no change", () => {
    expect(normalizeSessionImages(undefined)).toEqual({
      images: undefined,
      errors: [],
    });
  });
});

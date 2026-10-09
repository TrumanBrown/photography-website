const {
  MAX_CAPTION,
  captionsFromImages,
  fullUrls,
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

describe("full-size image URLs", () => {
  const options = {
    blobHost: "acct.blob.core.windows.net",
    prefix: "Costa Rica 2026",
    thumbSlug: "costa-rica-2026",
  };

  it("serves browser-ready formats straight from originals", () => {
    expect(fullUrls({ ...options, files: ["DSC001.JPG", "two frogs.png"] })).toEqual({
      "DSC001.JPG":
        "https://acct.blob.core.windows.net/originals/Costa%20Rica%202026/DSC001.JPG",
      "two frogs.png":
        "https://acct.blob.core.windows.net/originals/Costa%20Rica%202026/two%20frogs.png",
    });
  });

  it("points RAW and HEIC at the JPEG derivative the build wrote", () => {
    expect(fullUrls({ ...options, files: ["DSC002.ARW", "IMG_1.HEIC"] })).toEqual({
      "DSC002.ARW":
        "https://acct.blob.core.windows.net/derivatives/costa-rica-2026/DSC002.jpg",
      "IMG_1.HEIC":
        "https://acct.blob.core.windows.net/derivatives/costa-rica-2026/IMG_1.jpg",
    });
  });

  it("returns nothing when the storage host is unknown", () => {
    expect(fullUrls({ ...options, blobHost: "", files: ["DSC001.JPG"] })).toEqual({});
  });
});

import { describe, expect, it } from "vitest";
import { mergeWebsiteText, targetOf } from "./sidecars.mjs";

const order = ["A.jpg", "B.jpg", "C.jpg"];
const captions = new Map([
  ["A.jpg", "Heron on a post, Tortuguero"],
  ["B.jpg", "Caiman at the waterline, Tortuguero"],
]);

describe("writing website copy into _session.json", () => {
  it("adds captions in the order the site already shows", () => {
    const { sidecar, changed, written } = mergeWebsiteText({
      sidecar: {
        title: "Tortuguero canals, Costa Rica, September 2026",
        cover: "B.jpg",
      },
      slug: "tortuguero",
      order,
      captions,
      text: { description: "Herons at every bend." },
    });
    expect(changed).toBe(true);
    expect(sidecar.cover).toBe("B.jpg");
    expect(sidecar.description).toBe("Herons at every bend.");
    expect(sidecar.images).toEqual([
      { file: "A.jpg", caption: "Heron on a post, Tortuguero" },
      { file: "B.jpg", caption: "Caiman at the waterline, Tortuguero" },
      "C.jpg",
    ]);
    expect(written.captions["A.jpg"]).toBe("Heron on a post, Tortuguero");
  });

  it("keeps a hand-set order and matches RAW sources to their published JPEGs", () => {
    expect(targetOf("B.ARW", new Set(order))).toBe("B.jpg");
    const { sidecar } = mergeWebsiteText({
      sidecar: { images: [{ file: "B.ARW" }, "A.jpg"], banner: "A.jpg" },
      slug: "tortuguero",
      order: ["B.jpg", "A.jpg", "C.jpg"],
      captions: new Map([...captions, ["C.jpg", "Anhinga drying its wings"]]),
    });
    expect(sidecar.banner).toBe("A.jpg");
    expect(sidecar.images).toEqual([
      { file: "B.ARW", caption: "Caiman at the waterline, Tortuguero" },
      { file: "A.jpg", caption: "Heron on a post, Tortuguero" },
      { file: "C.jpg", caption: "Anhinga drying its wings" },
    ]);
  });

  it("leaves your edits alone and replaces only what it wrote last time", () => {
    const { sidecar, kept } = mergeWebsiteText({
      sidecar: {
        description: "My own words.",
        images: [
          { file: "A.jpg", caption: "My heron" },
          { file: "B.jpg", caption: "Old generated caiman" },
        ],
      },
      slug: "tortuguero",
      order,
      captions,
      text: { description: "Herons at every bend." },
      written: {
        description: "Old generated text",
        captions: { "A.jpg": "Old heron", "B.jpg": "Old generated caiman" },
      },
    });
    expect(sidecar.description).toBe("My own words.");
    expect(sidecar.images[0].caption).toBe("My heron");
    expect(sidecar.images[1].caption).toBe(
      "Caiman at the waterline, Tortuguero",
    );
    expect(kept).toBe(2);
  });

  it("replaces everything with overwrite, for copy that was never yours", () => {
    const { sidecar } = mergeWebsiteText({
      sidecar: {
        description: "Generated elsewhere.",
        images: [{ file: "A.jpg", caption: "Generated elsewhere" }],
      },
      slug: "tortuguero",
      order,
      captions,
      text: { description: "Herons at every bend." },
      overwrite: true,
    });
    expect(sidecar.description).toBe("Herons at every bend.");
    expect(sidecar.images[0].caption).toBe("Heron on a post, Tortuguero");
  });

  it("only fills a title or location that's blank, even with overwrite", () => {
    const untitled = mergeWebsiteText({
      sidecar: { title: "Tortuguero" },
      slug: "tortuguero",
      text: {
        title: "Tortuguero canals, Costa Rica, September 2026",
        location: "Limón Province, Costa Rica",
      },
      overwrite: true,
    }).sidecar;
    expect(untitled.title).toBe(
      "Tortuguero canals, Costa Rica, September 2026",
    );
    expect(untitled.location).toBe("Limón Province, Costa Rica");
    const titled = mergeWebsiteText({
      sidecar: { title: "My title", location: "My place" },
      slug: "tortuguero",
      text: { title: "Other, Place, May 2026", location: "Elsewhere" },
      overwrite: true,
    }).sidecar;
    expect(titled).toEqual({ title: "My title", location: "My place" });
  });

  it("reports no change when everything is already in place", () => {
    const first = mergeWebsiteText({
      sidecar: {},
      slug: "t",
      order,
      captions,
      text: { description: "Herons." },
    });
    const again = mergeWebsiteText({
      sidecar: first.sidecar,
      slug: "t",
      order,
      captions,
      text: { description: "Herons." },
      written: first.written,
    });
    expect(again.changed).toBe(false);
  });
});

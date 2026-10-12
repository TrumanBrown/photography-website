import {
  buildHashtags,
  communityTag,
  landmarkTag,
  placeTag,
  tagify,
} from "./hashtags.mjs";
import { assembleCaption, placeLine } from "./compose.mjs";
import {
  displayName,
  lint,
  speciesLabel,
  tidy,
  ungroundedNames,
} from "../photos/text.mjs";
import { cameraName, gearLine } from "../photos/exif.mjs";

const frog = {
  id: 1,
  name: "Cruziohyla sylviae",
  common: "Sylvia's Tree Frog",
  rank: "species",
  kingdom: "Animalia",
  lineage: {
    class: { name: "Amphibia" },
    order: { name: "Anura" },
    family: { name: "Phyllomedusidae", common: "Leaf Frogs" },
  },
  iucn: null,
};
const session = {
  title: "Guayacán, Costa Rica, September 2026",
  location: "Limón Province, Costa Rica",
  description:
    "A night walk at Guayacán, and wall-to-wall amphibians once it got dark.",
};
const a6700macro = {
  make: "SONY",
  model: "ILCE-6700",
  lens: "FE 90mm F2.8 Macro G OSS",
  focalLength: 90,
  fNumber: 2.8,
  exposureTime: 1 / 160,
  iso: 3200,
};

describe("hashtags", () => {
  it("tagifies names, accents and apostrophes", () => {
    expect(tagify("Sylvia's Tree Frog")).toBe("sylviastreefrog");
    expect(tagify("Limón")).toBe("limon");
  });

  it("builds five data-driven tags for a verified animal", () => {
    const tags = buildHashtags({
      taxon: frog,
      speciesOk: true,
      group: "frog",
      facts: a6700macro,
      session,
      proposedPlace: "Costa Rica",
    });
    expect(tags).toEqual([
      "#sylviastreefrog",
      "#frogsofinstagram",
      "#costarica",
      "#macrophotography",
      "#sonya6700",
    ]);
  });

  it("never names an unverified species and caps at five", () => {
    const tags = buildHashtags({
      taxon: frog,
      speciesOk: false,
      group: "bird",
      facts: a6700macro,
      session,
      proposedPlace: "Guayacán",
    });
    expect(tags).not.toContain("#sylviastreefrog");
    expect(tags).toContain("#birdsofinstagram");
    expect(tags.length).toBeLessThanOrEqual(5);
  });

  it("only accepts place and landmark ideas grounded in the session text", () => {
    expect(placeTag({ proposed: "Tortuguero", ...session })).toBe("costarica");
    expect(placeTag({ proposed: "Guayacán", ...session })).toBe("guayacan");
    expect(placeTag({ proposed: "Limón Province", ...session })).toBe(
      "costarica",
    );
    expect(
      placeTag({
        proposed: "",
        title: "Gunn Peak, Washington, June 2026",
        location: "Central Cascades, Washington",
      }),
    ).toBe("pnw");
    expect(
      landmarkTag({
        landmark: "Mount Shuksan",
        title: "North Cascades, July 2026",
        location: "North Cascades, Washington",
      }),
    ).toBe("");
    expect(
      landmarkTag({
        landmark: "Mount Rainier",
        title: "Sunrise, Mount Rainier, July 2026",
        location: "Mount Rainier National Park, Washington",
      }),
    ).toBe("mountrainier");
  });
});

describe("camera facts", () => {
  it("names bodies the way people search for them", () => {
    expect(cameraName({ make: "SONY", model: "ILCE-6700" })).toBe("Sony a6700");
    expect(cameraName({ make: "Apple", model: "iPhone 16 Pro" })).toBe(
      "iPhone 16 Pro",
    );
    expect(cameraName({ make: "Canon", model: "Canon EOS R100" })).toBe(
      "Canon EOS R100",
    );
  });

  it("writes a gear line, with focal length only for zooms", () => {
    expect(gearLine(a6700macro)).toBe(
      "Sony a6700 · FE 90mm F2.8 Macro G OSS · f/2.8 · 1/160s · ISO 3200",
    );
    expect(
      gearLine({
        ...a6700macro,
        lens: "E 70-350mm F4.5-6.3 G OSS",
        focalLength: 350,
        fNumber: 6.3,
      }),
    ).toBe(
      "Sony a6700 · E 70-350mm F4.5-6.3 G OSS at 350mm · f/6.3 · 1/160s · ISO 3200",
    );
  });
});

describe("caption text", () => {
  it("puts species names in sentence case, keeping proper nouns", () => {
    expect(displayName("Northwestern Garter Snake")).toBe(
      "Northwestern garter snake",
    );
    expect(displayName("Hoffmann's Two-toed Sloth")).toBe(
      "Hoffmann's two-toed sloth",
    );
    expect(displayName("American Robin")).toBe("American robin");
    expect(speciesLabel(frog)).toBe("Sylvia's tree frog (Cruziohyla sylviae)");
  });

  it("tidies machine tells without changing meaning", () => {
    expect(tidy("Wet leaves — a frog! 🐸 #frog")).toBe(
      "Wet leaves, a frog. frog",
    );
  });

  it("flags banned words and passes plain text", () => {
    expect(lint("A stunning frog")).toEqual(['uses "stunning"']);
    expect(lint("Orange hands and a barred yellow side")).toEqual([]);
  });

  it("puts a post together: first line and reaction, fun fact, IUCN line, gear and link, hashtags", () => {
    const caption = assembleCaption({
      headline:
        "Agami heron (Agamia agami) with its neck stretched out, Tortuguero canals, Limón Province, Costa Rica",
      comment: "Those colours look painted on.",
      body: "Its bill is longer than its head.",
      iucn: "Near Threatened",
      gear: gearLine(a6700macro),
      pointer:
        "Full resolution and the rest of this session are on example.com, link in bio",
      hashtags: ["#agamiheron", "#birdsofinstagram"],
    });
    const parts = caption.split("\n\n");
    expect(parts[0]).toBe(
      "Agami heron (Agamia agami) with its neck stretched out, Tortuguero canals, Limón Province, Costa Rica. Those colours look painted on.",
    );
    expect(parts[1]).toBe(
      "Fun fact: Its bill is longer than its head. Listed as Near Threatened on the IUCN Red List.",
    );
    expect(parts[2]).toMatch(/^Sony a6700 .*\nFull resolution/);
    expect(parts[3]).toBe("#agamiheron #birdsofinstagram");
    // No reaction and no fact: the post simply skips them.
    expect(
      assembleCaption({
        headline: "Hanging moss",
        body: "",
        gear: "",
        pointer: "",
        hashtags: ["#forest"],
      }),
    ).toBe("Hanging moss\n\n#forest");
  });

  it("keeps place names and people's names inside species names", () => {
    for (const [name, shown] of [
      ["North American River Otter", "North American river otter"],
      [
        "La Loma Mushroomtongue Salamander",
        "La Loma mushroomtongue salamander",
      ],
      ["Canada Goose", "Canada goose"],
      ["Cape May Warbler", "Cape May warbler"],
      ["Pallas' Leaf Warbler", "Pallas' leaf warbler"],
      ["Dungeness Crab", "Dungeness crab"],
      ["Northern Alligator Lizard", "northern alligator lizard"],
      ["Lake Trout", "lake trout"],
    ])
      expect(displayName(name, { midSentence: true })).toBe(shown);
  });

  it("gives butterflies and moths their own community tags", () => {
    const lep = (family) => ({
      lineage: { order: { name: "Lepidoptera" }, family: { name: family } },
    });
    expect(communityTag({ taxon: lep("Papilionidae") })).toBe(
      "butterfliesofinstagram",
    );
    expect(communityTag({ taxon: lep("Nymphalidae") })).toBe(
      "butterfliesofinstagram",
    );
    expect(communityTag({ taxon: lep("Erebidae") })).toBe("mothsofinstagram");
    expect(communityTag({ group: "moth" })).toBe("mothsofinstagram");
  });

  it("doesn't repeat a place the line already names", () => {
    expect(placeLine({ location: "Washington" }, "Western Washington")).toBe(
      "Western Washington",
    );
    expect(placeLine({ location: "Tibet, China" }, "Tibetan plateau")).toBe(
      "Tibetan plateau, Tibet, China",
    );
    expect(
      placeLine(
        { location: "North Cascades, Washington" },
        "Yellow Aster Butte",
      ),
    ).toBe("Yellow Aster Butte, North Cascades, Washington");
    expect(placeLine({ location: "Portland area, Oregon" }, "Portland")).toBe(
      "Portland, Oregon",
    );
    expect(
      placeLine({ location: "Cascade Range, Washington" }, "Cascades"),
    ).toBe("Cascades, Washington");
  });

  it("keeps demonyms capitalised mid-sentence", () => {
    expect(displayName("Ecuadorian Hermit Crab", { midSentence: true })).toBe(
      "Ecuadorian hermit crab",
    );
    expect(
      displayName("Northwestern Garter Snake", { midSentence: true }),
    ).toBe("northwestern garter snake");
    expect(displayName("Ocean Sunfish", { midSentence: true })).toBe(
      "ocean sunfish",
    );
  });

  it("finds capitalised names that aren't in the session text", () => {
    expect(
      ungroundedNames("Snow on Mount Shuksan", "North Cascades, Washington"),
    ).toEqual(["Mount", "Shuksan"]);
    expect(
      ungroundedNames(
        "x Guayacán, Limón Province, Costa Rica",
        `${session.title} ${session.location}`,
      ),
    ).toEqual([]);
  });
});

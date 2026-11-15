import { describe, expect, it } from "vitest";
import { speciesName } from "./species-name";

describe("speciesName", () => {
  it("sentence-cases names iNaturalist sends in Title Case", () => {
    expect(speciesName("Western Red-backed Salamander")).toBe(
      "Western red-backed salamander",
    );
    expect(speciesName("Black Oystercatcher")).toBe("Black oystercatcher");
    expect(speciesName("Gray-crowned Rosy-Finch")).toBe(
      "Gray-crowned rosy-finch",
    );
    expect(speciesName("European Fire-Bellied Toad")).toBe(
      "European fire-bellied toad",
    );
  });

  it("keeps people's names, and a title in front of one", () => {
    expect(speciesName("Blanford's Snowfinch")).toBe("Blanford's snowfinch");
    expect(speciesName("Dunn's Salamander")).toBe("Dunn's salamander");
    expect(speciesName("Steller's Jay")).toBe("Steller's jay");
    expect(speciesName("Prince Henry's Laughingthrush")).toBe(
      "Prince Henry's laughingthrush",
    );
    expect(speciesName("Lady Amherst's Pheasant")).toBe(
      "Lady Amherst's pheasant",
    );
    expect(speciesName("Painted Lady")).toBe("Painted lady");
  });

  it("keeps places inside a name", () => {
    expect(speciesName("Giant Pacific Octopus")).toBe("Giant Pacific octopus");
    expect(speciesName("New Zealand Red Admiral")).toBe(
      "New Zealand red admiral",
    );
    expect(speciesName("Rocky Mountain Parnassian")).toBe(
      "Rocky Mountain parnassian",
    );
    expect(speciesName("Santa Ana Tussock Moth")).toBe(
      "Santa Ana tussock moth",
    );
    expect(speciesName("Old World Flycatchers, Robins, and Chats")).toBe(
      "Old World flycatchers, robins, and chats",
    );
    expect(speciesName("Australo-Papuan Babblers")).toBe(
      "Australo-Papuan babblers",
    );
    expect(speciesName("Cape May Warbler")).toBe("Cape May warbler");
    expect(speciesName("Cape Protea Chafer")).toBe("Cape protea chafer");
  });

  it("starts lowercase plant names with a capital and leaves scientific names alone", () => {
    expect(speciesName("common yarrow")).toBe("Common yarrow");
    expect(speciesName("Casbia tetramera")).toBe("Casbia tetramera");
    expect(speciesName(undefined)).toBe("");
  });

  it("lowercases the first word mid-sentence unless it's a proper noun", () => {
    const mid = { midSentence: true };
    expect(speciesName("Northwestern Garter Snake", mid)).toBe(
      "northwestern garter snake",
    );
    expect(speciesName("Pacific Chorus Frog", mid)).toBe("Pacific chorus frog");
    expect(speciesName("Prince Henry's Laughingthrush", mid)).toBe(
      "Prince Henry's laughingthrush",
    );
  });
});

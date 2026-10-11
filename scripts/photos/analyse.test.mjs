import { describe, expect, it } from "vitest";
import { analysisPrompt, idLevel, normaliseAnalysis } from "./analyse.mjs";

const snake = {
  name: "Thamnophis ordinoides",
  common: "Northwestern Garter Snake",
  rank: "species",
  lineage: { family: { name: "Colubridae", common: "Colubrids" } },
};
const session = {
  title: "Sauk Mountain, Washington, June 2026",
  location: "North Cascades, Washington",
};

describe("photo analysis", () => {
  it("treats any iNaturalist rank as the identification, at that rank", () => {
    expect(idLevel(snake)).toBe("species");
    expect(idLevel({ ...snake, rank: "subspecies" })).toBe("species");
    expect(idLevel({ name: "Sceloporus", rank: "genus" })).toBe("group");
    expect(idLevel(null)).toBe(null);
  });

  it("hands the model your identification as fact, and only your place names", () => {
    const prompt = analysisPrompt({
      session,
      clock: "2026-06-14T10:00:00",
      taxon: snake,
      quality: "needs_id",
      allowedNames: ["Sauk Mountain", "North Cascades"],
    });
    expect(prompt).toContain(
      "Northwestern garter snake (Thamnophis ordinoides), the photographer's own identification",
    );
    expect(prompt).toContain('"Sauk Mountain", "North Cascades"');
    expect(prompt).toContain("June 2026");
    expect(analysisPrompt({ session, taxon: null })).toContain(
      "Never name a species",
    );
  });

  it("keeps replies literal: blanks fields that break the rules and clamps the rest", () => {
    const { analysis, problems } = normaliseAnalysis(
      {
        group: "dinosaur",
        subject: "garter snake.",
        count: "2",
        scene: "Coiled on a stunning mossy log.",
        conditions: "In Fog",
        description: "A snake on moss.",
        appeal: 14,
        skip: "boring",
        id_check: "maybe",
      },
      { taxon: snake },
    );
    expect(analysis).toMatchObject({
      group: "other",
      subject: "Garter snake",
      count: 2,
      scene: "",
      conditions: "in fog",
      appeal: 10,
      skip: null,
      idCheck: "fits",
    });
    expect(problems.join(" ")).toMatch(/scene.*stunning/);
  });
});

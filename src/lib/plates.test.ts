import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLATE_FRAMES } from "./plates";

const content = fileURLToPath(new URL("../content/hobbies/", import.meta.url));
const plates = fileURLToPath(new URL("../assets/plates/", import.meta.url));

const slugs = readdirSync(content)
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.replace(/\.json$/, ""));

describe("stipple plates", () => {
  it.each(slugs)("%s has every plate the site shows", (slug) => {
    const missing = ["card", "mini"]
      .flatMap((size) =>
        PLATE_FRAMES.flatMap((frame) =>
          ["", "-dark"].map((theme) => `${slug}-${size}${frame}${theme}.webp`),
        ),
      )
      .filter((name) => !existsSync(`${plates}${name}`));
    expect(
      missing,
      "Render them with .github/skills/stipple-plates (see its SKILL.md)",
    ).toEqual([]);
  });
});

import type { CollectionEntry } from "astro:content";
import { SPECIES as AQUARIUM_SPECIES } from "@/lib/hobbies/aquarium-species";
import { SPECIES as HERP_SPECIES } from "@/lib/hobbies/herping-species";
import { SPECIES as TIDEPOOL_SPECIES } from "@/lib/hobbies/tidepool-species";
import fishingWaters from "@/lib/hobbies/fishing-waters.json";

type Hobby = CollectionEntry<"hobbies">;

/**
 * The one line of facts under a hobby page's title ("40 critters to find").
 * Counts come from each toy's own data, so adding a species updates the line.
 */
export function hobbyFacts(entry: Hobby): string | undefined {
  const { interactive, dayList } = entry.data;
  switch (interactive) {
    case "tidepool":
      return `${TIDEPOOL_SPECIES.length} critters to find`;
    case "aquarium":
      return `${AQUARIUM_SPECIES.length} species to stock`;
    case "fishing": {
      const { waters } = fishingWaters;
      const states = new Set(waters.map((water) => water.state)).size;
      return `${waters.length} waters · ${states} states`;
    }
    case "birding":
      return "Selfie · nothing uploads";
    case "roadcruise":
      return `${HERP_SPECIES.length} species to spot`;
    case "pixel-hike":
      return "Ends in a postcard";
  }
  if (dayList) return "New list every day";
  return undefined;
}

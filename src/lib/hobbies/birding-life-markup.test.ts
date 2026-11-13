import { describe, expect, it } from "vitest";
import type { Species } from "./birding-inat";
import { featuredCard, listItem, toHtml } from "./birding-life-markup";

const species: Species = {
  id: 7,
  common: "Giant babax",
  scientific: "Pterorhinus waddelli",
  photo: "https://inaturalist-open-data.s3.amazonaws.com/photos/1/small.jpg",
  mine: 2,
  globalCount: 35,
  wikipediaUrl: "https://en.wikipedia.org/wiki/Giant_babax",
  familyId: null,
  lastObservedOn: "2025-10-04",
  observationId: 356482564,
};

describe("life list markup", () => {
  it("escapes names from iNaturalist", () => {
    const html = toHtml(
      listItem(
        {
          ...species,
          common: '<img src=x onerror="alert(1)">',
          scientific: "Avis & co",
        },
        "me",
      ),
    );

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("Avis &amp; co");
  });

  it("writes the count the same way on cards and rows", () => {
    const card = toHtml(featuredCard(species, "me"));
    const row = toHtml(listItem(species, "me"));

    for (const html of [card, row]) {
      expect(html).toContain('<span aria-hidden="true">×2</span>');
      expect(html).not.toContain("Seen 2×");
    }
  });

  it("opens my sighting itself, and the list only when there are several", () => {
    const sighting =
      'href="https://www.inaturalist.org/observations/356482564"';
    const list =
      'href="https://www.inaturalist.org/observations?user_id=me&amp;taxon_id=7"';

    expect(toHtml(featuredCard(species, "me"))).toContain(sighting);
    expect(toHtml(listItem({ ...species, mine: 1 }, "me"))).toContain(sighting);
    expect(toHtml(listItem(species, "me"))).toContain(list);
  });
});

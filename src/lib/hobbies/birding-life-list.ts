/**
 * The life list in the browser. Normally the build has already written it into
 * the page (BirdingLifeList.astro), so all this does is search and sort, by
 * moving the rows that are there: no request, and no photo loads twice. When
 * the build couldn't reach iNaturalist, the section says it's loading, and
 * this fetches the list once it nears the viewport and draws it with the same
 * markup the build uses (birding-life-markup.ts).
 *
 * Mounted by src/components/hobbies/BirdingLifeList.astro via [data-life] hooks.
 */
import { initUnderlineTabs } from "../motion";
import {
  groupByFamily,
  loadLifeList,
  matchesQuery,
  normalizeQuery,
  sortSpecies,
  type SortMode,
  type Species,
} from "./birding-inat";
import {
  familySection,
  featuredCard,
  listItem,
  speciesCount,
  speciesGrid,
  type Markup,
} from "./birding-life-markup";

const SORTS: readonly SortMode[] = [
  "family",
  "recent",
  "name",
  "most-seen",
  "rarest",
];

function toDom(node: Markup | string): Node {
  if (typeof node === "string") return document.createTextNode(node);
  const el = document.createElement(node.tag);
  for (const [name, value] of Object.entries(node.attrs)) {
    el.setAttribute(name, value);
  }
  for (const child of node.children) el.append(toDom(child));
  return el;
}

const toElement = (node: Markup) => toDom(node) as HTMLElement;

interface Row {
  el: HTMLElement;
  species: Species;
}

/** The species behind each row, read back from what the markup wrote. */
function readRows(list: HTMLElement): Row[] {
  return Array.from(
    list.querySelectorAll<HTMLElement>("[data-life-row]"),
    (el) => ({
      el,
      species: {
        id: Number(el.dataset.id),
        common: el.querySelector("[data-life-name]")?.textContent ?? "",
        scientific: el.querySelector("[data-life-sci]")?.textContent ?? "",
        photo: null,
        mine: Number(el.dataset.mine) || 0,
        globalCount: Number(el.dataset.global) || Number.MAX_SAFE_INTEGER,
        wikipediaUrl: null,
        familyId: el.dataset.family || null,
        lastObservedOn: el.dataset.last || null,
      },
    }),
  );
}

export function initBirdingLifeList(root: HTMLElement): void {
  const body = root.querySelector<HTMLElement>("[data-life-body]");
  const featuredWrap = root.querySelector<HTMLElement>("[data-life-featured]");
  const listWrap = root.querySelector<HTMLElement>("[data-life-list]");
  const note = root.querySelector<HTMLElement>("[data-life-note]");
  const status = root.querySelector<HTMLElement>("[data-life-status]");
  const countEl = root.querySelector<HTMLElement>("[data-life-count]");
  const search = root.querySelector<HTMLInputElement>("[data-life-search]");
  const sort = root.querySelector<HTMLElement>("[data-life-sort]");
  const userId = root.dataset.lifeUser;
  if (!body || !featuredWrap || !listWrap || !userId) return;

  let mode: SortMode = "family";
  let rows: Row[] = [];

  const arrange = (): void => {
    const query = normalizeQuery(search?.value ?? "");
    const matched = rows.filter((row) => matchesQuery(row.species, query));
    const byId = new Map(rows.map((row) => [row.species.id, row.el]));
    const elementsFor = (species: Species[]) =>
      species
        .map((s) => byId.get(s.id))
        .filter((el): el is HTMLElement => el !== undefined);

    if (mode === "family") {
      listWrap.replaceChildren(
        ...groupByFamily(matched.map((row) => row.species)).map((group) => {
          const section = toElement(familySection(group));
          section.querySelector("ul")?.append(...elementsFor(group.members));
          return section;
        }),
      );
    } else {
      const grid = toElement(speciesGrid());
      grid.append(
        ...elementsFor(
          sortSpecies(
            matched.map((row) => row.species),
            mode,
          ),
        ),
      );
      listWrap.replaceChildren(grid);
    }

    if (!status) return;
    if (!query) status.textContent = "";
    else if (matched.length === 0) {
      status.textContent = `No species match "${search?.value.trim()}".`;
    } else {
      status.textContent = `${matched.length} of ${speciesCount(rows.length)}`;
    }
  };

  const wire = (): void => {
    rows = readRows(listWrap);
    search?.addEventListener("input", arrange);
    if (!sort) return;
    initUnderlineTabs(sort);
    sort.addEventListener("utabs:change", (event) => {
      const value = (event as CustomEvent<string>).detail as SortMode;
      mode = SORTS.includes(value) ? value : "family";
      arrange();
    });
  };

  if (root.dataset.lifeBuilt === "true") {
    wire();
    return;
  }

  const featuredN = Math.max(
    1,
    Math.min(12, Number(root.dataset.lifeFeaturedN) || 6),
  );
  const iconic = root.dataset.lifeIconic || "";

  const load = async (): Promise<void> => {
    try {
      const life = await loadLifeList(userId, iconic, featuredN, {
        partialOk: true,
      });
      if (life.species.length === 0) {
        if (note) note.textContent = "No species logged yet.";
        return;
      }
      featuredWrap.replaceChildren(
        ...life.featured.map((s) => toElement(featuredCard(s, userId))),
      );
      listWrap.replaceChildren(
        ...groupByFamily(life.species).map((group) =>
          toElement(
            familySection(
              group,
              group.members.map((s) => listItem(s, userId)),
            ),
          ),
        ),
      );
      if (countEl) countEl.textContent = speciesCount(life.species.length);
      note?.remove();
      body.hidden = false;
      wire();
    } catch {
      if (note) {
        note.textContent =
          "Couldn't load the life list right now. See it on iNaturalist.";
      }
    }
  };

  const io = new IntersectionObserver(
    (entries, observer) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        void load();
      }
    },
    { rootMargin: "200px" },
  );
  io.observe(root);
}

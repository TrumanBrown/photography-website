/**
 * The life list's markup, written once for both places it's drawn: the build
 * turns it into the page's HTML with toHtml, and the browser turns the same
 * description into elements (toDom in birding-life-list.ts) on the rare visit
 * when it has to fetch the list itself. Text and attribute values are escaped
 * on the way out, since names come from iNaturalist.
 *
 * Counts read one way everywhere, ×2 (the November 2026 review, TTT-18).
 */
import { monthYear, type FamilyGroup, type Species } from "./birding-inat";

type AttrValue = string | number | null | undefined | false;
type ChildValue = Markup | string | null | undefined | false;

export interface Markup {
  tag: string;
  attrs: Record<string, string>;
  children: (Markup | string)[];
}

/** One element: empty attributes and children (null, false, "") are left out. */
export function h(
  tag: string,
  attrs: Record<string, AttrValue> = {},
  ...children: ChildValue[]
): Markup {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined && value !== false) {
      kept[name] = String(value);
    }
  }
  return {
    tag,
    attrs: kept,
    children: children.filter((child): child is Markup | string => !!child),
  };
}

const VOID = new Set(["img", "input", "br"]);
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function toHtml(node: Markup | string): string {
  if (typeof node === "string") return escapeHtml(node);
  const attrs = Object.entries(node.attrs)
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join("");
  if (VOID.has(node.tag)) return `<${node.tag}${attrs}>`;
  return `<${node.tag}${attrs}>${node.children.map(toHtml).join("")}</${node.tag}>`;
}

const NEW_TAB = { target: "_blank", rel: "noopener noreferrer" } as const;

export function observationsUrl(userId: string, taxonId: number): string {
  return `https://www.inaturalist.org/observations?user_id=${encodeURIComponent(userId)}&taxon_id=${taxonId}`;
}

/** The observation my photo comes from, or all my sightings when that's unknown. */
function sightingUrl(s: Species, userId: string): string {
  return s.observationId
    ? `https://www.inaturalist.org/observations/${s.observationId}`
    : observationsUrl(userId, s.id);
}

/** "242 species", "1,001 species". */
export function speciesCount(n: number): string {
  return `${n.toLocaleString("en-US")} species`;
}

/** How many times I've logged it: ×2 on screen, words for a screen reader. */
function timesSeen(count: number, className: string): Markup {
  return h(
    "span",
    { class: className },
    h("span", { "aria-hidden": "true" }, `×${count}`),
    h(
      "span",
      { class: "sr-only" },
      count === 1 ? "Seen once" : `Seen ${count} times`,
    ),
  );
}

/** A rarest-sighting card: photo, names, count, rarity and links. */
export function featuredCard(s: Species, userId: string): Markup {
  return h(
    "div",
    { class: "flex flex-col overflow-hidden border border-rule" },
    s.photo &&
      h(
        "div",
        { class: "aspect-[4/3] w-full overflow-hidden bg-band" },
        h("img", {
          class: "h-full w-full object-cover",
          src: s.photo,
          alt: s.common,
          width: 240,
          height: 180,
          loading: "lazy",
          decoding: "async",
        }),
      ),
    h(
      "div",
      { class: "flex flex-1 flex-col gap-2 p-4" },
      h(
        "div",
        { class: "flex items-start justify-between gap-2" },
        h(
          "div",
          {},
          h("h3", { class: "text-[15px] font-normal leading-tight" }, s.common),
          s.scientific &&
            h("p", { class: "mt-0.5 text-xs italic text-ink-3" }, s.scientific),
        ),
        timesSeen(s.mine, "shrink-0 text-[11px] tabular-nums text-ink-2"),
      ),
      h(
        "p",
        { class: "text-[11px] leading-snug text-ink-2" },
        `Globally uncommon · ~${s.globalCount.toLocaleString("en-US")} records on iNaturalist`,
      ),
      h(
        "div",
        { class: "mt-auto flex flex-wrap gap-3 pt-1 text-xs" },
        h(
          "a",
          {
            class: "draw self-start text-ink",
            href: sightingUrl(s, userId),
            ...NEW_TAB,
          },
          "My sighting →",
        ),
        s.wikipediaUrl &&
          h(
            "a",
            {
              class: "draw self-start text-ink-2 hover:text-ink",
              href: s.wikipediaUrl,
              ...NEW_TAB,
            },
            "Wikipedia",
          ),
      ),
    ),
  );
}

/**
 * One species in the full list. The data-* values are what search and sort
 * read back, so the browser can reorder rows the build wrote without
 * fetching anything. A row opens my one sighting, or the list of them when
 * there are several.
 */
export function listItem(s: Species, userId: string): Markup {
  const seen = monthYear(s.lastObservedOn);
  return h(
    "li",
    {
      "data-life-row": "",
      "data-id": s.id,
      "data-mine": s.mine,
      "data-global": s.globalCount,
      "data-last": s.lastObservedOn ?? "",
      "data-family": s.familyId ?? "",
    },
    h(
      "a",
      {
        class:
          "group flex items-center gap-3 border-b border-rule-soft py-2 pr-2 no-underline transition-colors hover:bg-hover hover:no-underline",
        href:
          s.mine === 1 ? sightingUrl(s, userId) : observationsUrl(userId, s.id),
        ...NEW_TAB,
      },
      h(
        "div",
        { class: "h-16 w-16 shrink-0 overflow-hidden bg-band" },
        s.photo &&
          h("img", {
            class: "h-full w-full object-cover",
            src: s.photo,
            alt: "",
            width: 64,
            height: 64,
            loading: "lazy",
            decoding: "async",
          }),
      ),
      h(
        "div",
        { class: "min-w-0 flex-1" },
        h(
          "p",
          { class: "truncate text-sm text-ink", "data-life-name": "" },
          s.common,
        ),
        s.scientific &&
          h(
            "p",
            {
              class: "truncate text-xs italic text-ink-3",
              "data-life-sci": "",
            },
            s.scientific,
          ),
      ),
      h(
        "div",
        { class: "flex shrink-0 flex-col items-end gap-0.5 text-right" },
        timesSeen(s.mine, "text-xs tabular-nums text-ink-2"),
        seen && h("span", { class: "text-[11px] text-ink-2" }, seen),
      ),
    ),
  );
}

/** The grid rows sit in, by family or as one sorted list. */
export function speciesGrid(items: Markup[] = []): Markup {
  return h(
    "ul",
    {
      class:
        "m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3",
      role: "list",
    },
    ...items,
  );
}

/** A family's heading and its grid. */
export function familySection(
  group: FamilyGroup,
  items: Markup[] = [],
): Markup {
  return h(
    "section",
    { class: "space-y-2" },
    h(
      "div",
      { class: "flex items-baseline gap-2" },
      h("h4", { class: "text-sm font-normal text-ink" }, group.common),
      group.sci && h("span", { class: "text-xs italic text-ink-3" }, group.sci),
      h(
        "span",
        { class: "ml-auto text-xs tabular-nums text-ink-2" },
        speciesCount(group.members.length),
      ),
    ),
    speciesGrid(items),
  );
}

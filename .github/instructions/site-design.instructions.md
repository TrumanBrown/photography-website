---
description: "Visual rules for the public site: ink-and-paper color tokens, Libre Franklin weights, square 1px-rule components, motion, images and touch targets. Use when building or restyling a page, component, hobby, card, button, form, drawer or heading, or when something looks like stock Tailwind or generic AI UI."
applyTo: "src/**/*.astro,src/styles/**/*.css,tailwind.config.mjs"
---

# Site design

The archive looks like a field notebook: ink on paper, light type, 1px rules, square edges, and
the photographs (or stipple plates) doing all the decorating. Anything new should look like it
was always there. Before writing CSS, open the nearest existing page or component and reuse its
classes. Words follow [site-copy.instructions.md](./site-copy.instructions.md).

Admin (`src/pages/admin/`, `src/lib/admin*.ts`) is a private tool and keeps its plain Tailwind
look. Everything below is about the public pages.

## Color

- UI chrome uses the tokens in [global.css](../../src/styles/global.css), never Tailwind's
  `neutral-*`, `gray-*`, `white` or `black`: `paper`, `band`, `ink`, `ink-2`, `ink-3`, `rule`,
  `rule-soft`, `hover`. As classes: `text-ink-3`, `border-rule`, `bg-band`. In component CSS:
  `var(--ink)`. Hobby content can have its own colors (fish sprites, map relief, pixel art).
- Dark mode is `html.dark`, set by the site's toggle rather than the OS. The tokens flip with it,
  so token classes need no `dark:` variants.
- `ink` for titles, `ink-3` for prose, `ink-2` for labels and quiet links (4.5:1 in both themes).
  Color comes from the photographs, not from accent colors.
- The favicon (`public/favicon.svg`, a sunset mountain) is colorful on purpose. He asked for a
  logo that's "clean and maybe somewhat colorful" (2026-10-07), so don't recolor it to the tokens.

## Type

- Libre Franklin is self-hosted at weights **300 to 500 only**. `font-semibold`, `font-bold` or
  `font-weight: 600` and up make the browser fake a bold that looks smeared. Page titles are 300,
  titles and body 400, and 500 is the ceiling.
- Page H1: `text-2xl font-light tracking-tight sm:text-[30px]` (prints, hobbies, places, 404).
  Section H2: `text-xl font-light tracking-tight`, or `.shead` on hobby pages.
- Meta lines, counts, dates and back links are `.u-label` (10px, tracked, uppercase, `ink-2`):
  `65 sessions · 1252 photographs`, `← All sessions`. Numbers that change get `tabular-nums`.
- Prose is 13 to 15px, line-height 1.45 to 1.6, no wider than about 65ch (`max-w-prose`).
- Headings wrap `balance` and everything else `pretty`, set once in global.css. Don't override it.

## Shapes and parts

- Square corners on boxes, buttons and inputs, and 1px `rule` borders. No `rounded-*` boxes,
  blurred shadows, gradients, pills, glass or blur. Separate things with a rule or whitespace,
  not a card.
- Reuse the parts in global.css before writing new ones: `.btn` (one `.btn-ink` per view for the
  main action), `.linkbtn` (a button that reads as a word), `.draw` (a 1px underline drawn on
  hover or focus), `.hair` (progress as a 1px rule), `.utabs` (underline tabs, a radio group),
  `.shead` (a section heading with a count or link on the right).
- Cards share one anatomy: picture, title, one tracked line (`SessionCard`, `HobbyCard`).
- Illustration is a stipple plate drawn from a photo (the stipple-plates skill). No emoji. A
  control is a word (`Pause`, `Shuffle`, `Sessions`) or an arrow (`←` `→`).
- The global `:focus-visible` ring covers every control. Don't add `focus:ring-*`, and only
  remove the ring with a replacement at least as visible (the rail filter darkens its underline)
  or on an element only script focuses (Day list's result).

## Motion

- Things move only in answer to the visitor. The lead photo is the one thing that changes on its
  own, and it has a pause.
- UI transitions run 150 to 320ms on `var(--ease)`, animate `transform` and `opacity` only, and
  list their properties (never `transition: all`). Each one needs a
  `prefers-reduced-motion: reduce` version that settles instantly.
- Hover effects (card skim, rail peek, plate boil) are for fine pointers. Nothing on a touch
  screen depends on them.
- Feedback a visitor sets off (a stamp, a points pop, a badge) lands beside the thing it's about:
  never on a photograph or an animal, and never in the middle of the screen (the first-find stamp
  sits in its own row beside the photo, [specimen.ts](../../src/lib/hobbies/specimen.ts)).
- Going from one page to another never morphs one photograph into a different one (a card's
  cover into a session's banner reads as a glitch). A session card opens its page with a plain
  page change: a 200ms fade between the pages and the session rising 8px into place
  ([open.ts](../../src/lib/open.ts), [landing.ts](../../src/lib/landing.ts)).

## Layout, images, touch

- A caption never goes over its photograph, at any screen size, in the lightbox or anywhere
  else. A photo's caption and capture line sit under it, and the photograph gets smaller to make
  room. The lightbox fits each photo above its own caption
  ([lightbox-caption.ts](../../src/lib/lightbox-caption.ts) and its tests), and a zoomed or
  dragged photo covers its caption, never the reverse. Check a long caption on a phone with its
  browser bars showing (390×664) as well as on a desktop.
- Photography pages sit in the archive shell (rail plus main) and use `var(--gutter)`. Hobby
  pages use the header. The shell switches to the phone bar below 900px.
- Every `<img>` has `width` and `height`. Images on the first screen (the first row of cards,
  the first gallery photo) get `loading="eager"` and `fetchpriority="high"`, the rest are lazy.
  A light/dark image pair stays lazy on purpose: a lazy image that's `display: none` is never
  fetched (`PlateArt`).
- Controls are at least 24px in both directions (WCAG 2.5.8). For touch, grow the hit area with
  an `::after` instead of moving the layout (`.steps button` in LeadPhoto.astro). Fixed UI (the
  mail button, the phone bar) must never cover content or the focused element.

## Checking your work

Look at it. Screenshot the page at 390×844 and 1440×900 in both themes and compare it with its
neighbors before calling it done; the full route list is in the
[validation checklist](../../docs/product-experience.md#validation-checklist).
Vercel's [Web Interface Guidelines](https://vercel.com/design/guidelines) make a good audit, but
house style wins where they disagree: `...` not `…`, sentence case not Title Case, first person.

The contact drawer and its round mail button predate these rules and still use stock Tailwind
(`rounded-md`, `shadow-*`, `neutral-*`, `font-semibold`). Don't copy them.

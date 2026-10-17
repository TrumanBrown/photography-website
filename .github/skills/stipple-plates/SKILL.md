---
name: stipple-plates
description: "Turn photographs into pen-and-ink stipple drawings (dot illustrations, like a field-guide or specimen plate) in black and white, with matching light and dark-mode versions and hover animation frames. Use when asked to make, redo or add a hobby icon, illustration, drawing, logo, plate or thumbnail from a photo or image URL; to swap the photo behind a drawing; or when work on the Things to try section needs consistent black-and-white artwork."
argument-hint: 'Subject name and photo URL, e.g. "herping https://..."'
---

# Stipple plates

Pen-and-ink stipple drawings made from Truman's own photographs: about ten
thousand evenly spaced dots, one pen for the whole set, ink on paper in light
mode and scratchboard in dark mode. They're the pictures on the Things to try
cards: `card` plates on /hobbies/ and `mini` plates in the band at the foot of
the home page. The files live in `src/assets/plates/`, and
`src/components/PlateArt.astro` shows them. Each subject in `subjects.json`
is named after its hobby's slug, and the caption under a card is `plateNote`
in `src/content/hobbies/<slug>.json` (keep it in step with the subject's
`note`).

Read [lessons](./references/lessons.md) before choosing photos or touching the
pipeline. It records which photos worked, which failed and why.

## Rules

- **Truman's own photos only** (his sessions, hobby media, his iNaturalist).
  Reference images from other artists are for technique. Never trace or copy
  them; they're copyrighted.
- **Keep one look across the set.** Don't change `SIZES`, `INK`, the default
  `weight` or the Lloyd and render settings for a single subject. Tune that
  subject's entry in `subjects.json` instead.
- **Liberties are welcome when they're small and in the same pen**, like the
  gourami's bubbles or the stone bed. Say what you added.
- **Show work in progress.** Render one or two plates and show them before
  doing a whole set.

## Setup (once per machine)

```bash
PY=$(bash .github/skills/stipple-plates/scripts/setup.sh)
```

This builds a private venv in `~/.cache/stipple-plates/` (numpy, scipy,
OpenCV, rembg) without touching the repo or needing sudo. The first cutout
downloads the isnet-general-use model (about 170 MB). Afterwards use
`PY=~/.cache/stipple-plates/venv/bin/python`.

## Swap or add a plate

1. **Add or edit the entry** in [subjects.json](./subjects.json). `src`
   takes any of:
   - an image URL. Blob `originals/<session>/<file>` links use the local
     copy under `src/content/sessions` when there is one.
   - an iNaturalist observation URL (`photo: n` picks the nth photo).
   - `<session>/<file>`, e.g. `olympic-winter-2026/DSC03599.JPEG`. Session
     photos are gitignored, so without a local copy (a fresh clone) the
     public original is downloaded from Blob Storage.
   - a path relative to the repo, or an absolute or `~` path.

   Downloads are cached in `~/.cache/stipple-plates/sources/`. The gourami,
   coho and Ensatina photos aren't on the site or Blob Storage; they're kept
   in `~/.cache/stipple-plates/sources/originals/`. On another machine, copy
   them there first, or those three plates stop with "Source not found".

2. **Check the cutout:** `$PY .github/skills/stipple-plates/scripts/review.py masks <name>`.
   Open the PNG it prints. Fix `crop`, then remove anything that isn't the
   animal with `exclude` polygons, `skin_out` or `green_out`. Read coordinates
   off the grid on the right-hand (cropped) pane. For precise polygons and
   graft points, `review.py zoom <name> --box x0,y0,x1,y1` gives a close-up
   with the cutout outline and a 0.05 grid (`--raw` shows it before retouching).
3. **Render one theme first, somewhere else:** `$PY .github/skills/stipple-plates/scripts/stipple.py <name> --themes light --out /tmp/plates`.
   Without `--out`, renders go straight into `src/assets/plates/`, replacing
   the live plate (`git checkout src/assets/plates` undoes that).
4. **Judge it at display size:** `$PY .github/skills/stipple-plates/scripts/review.py plates <name> --dir /tmp/plates`.
   Tune `weight`, `tone`, `despecular` or `features`.
5. **Render the keeper into the site:** `$PY .github/skills/stipple-plates/scripts/stipple.py <name>`
   (both themes and both sizes, the defaults).
6. **Show Truman** the plate in context: `npm run dev`, then /hobbies/ and
   the band at the foot of the home page. `npm test` checks every hobby has
   all twelve files.
7. **Replay the hobby's opening scene.** Each scene in `src/lib/scenes/` is
   traced by hand on its plate (`parts` polygons, and points like the crab's
   `SHOULDER`), and its tests use a synthetic plate, so a re-render can break
   it without failing anything. Click the card with `?scene-debug` and step
   through it (the [hobby-scenes](../hobby-scenes/SKILL.md) skill).

Each render writes `<name>-<size>[-dark].webp` plus two re-inked frames,
`-b1` and `-b2`, for the hover "boil". `PlateArt.astro` cycles the three
frames every 125 ms while a card is pointed at or focused, never on touch and
not under reduced motion.

## subjects.json fields

All coordinates are 0-1 fractions. Polygons and boxes refer to the image
after `crop` and `flip`. Order of operations: crop and flip, cutout, `include`
and `exclude`, `inpaint`, `graft`, `lift`, `stretch`, `tilt` (and
`keep_level`), then framing and shading. Grafts read the raw cutout, so a
part can be grafted even if `exclude` removed it from its old place. It works
the other way too: `exclude` doesn't reach a graft's copy, so draw the `from`
polygon around any debris as well.

| Field                           | What it does                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src`, `photo`                  | Source image (see above) and which iNaturalist photo                                                                   |
| `note`                          | Caption line, e.g. "Pika · Ball Mountain, May 2026"                                                                    |
| `crop`                          | `[x0, y0, x1, y1]` crop before the cutout                                                                              |
| `flip`, `rotate`                | Mirror (face the set's direction); rotate in degrees                                                                   |
| `fill`, `cy`                    | Share of the plate the subject's box fills `[w, h]`; vertical centre                                                   |
| `exclude`                       | Polygons removed from the cutout (nets, rods, twigs)                                                                   |
| `include`                       | Polygons added to the cutout (a tail or fin the cutout missed)                                                         |
| `inpaint`                       | Polygons painted out of the photo after the cutout (a pine needle across the body)                                     |
| `lift`                          | `[[polygon, amount], ...]` brighten a shadowed area, e.g. a face turned from the light (0-1)                           |
| `tilt`                          | Rotate the cut-out subject in degrees, positive counter-clockwise; polygons stay in photo coordinates                  |
| `graft`                         | `[{from, src, dst}]` copy a clear part (`from` polygon) to a new spot; `src`/`dst` point pairs set move, turn and size |
| `keep_level`                    | `[{poly, pivot}]` parts (feet) kept at the photo's angle after `tilt`, moved to where `pivot` (the ankle) lands        |
| `clear_feet`                    | Leave a thin gap of paper between the feet and the stone bed                                                           |
| `floor_light`, `ground_light`   | Light theme only: minimum ink inside a pale animal; strength of the stone bed (default 1)                              |
| `skin_out`                      | `[x0, y0, x1, y1]` box where a holding hand and watch strap are cut out                                                |
| `green_out`                     | Cut grass and leaves crossing the animal, then inpaint                                                                 |
| `polygon`                       | Hand-drawn outline replacing the automatic cutout                                                                      |
| `mask: "sky"`, `fade`, `clouds` | Mountain mode: land below the skyline, dissolving `fade` below the ridge                                               |
| `base`                          | Mountain mode: dissolve at a level line (0-1 of the image) instead; stops a tall peak's foot arching                   |
| `skyline`, `curve`              | Hand-traced ridge `[[x, y], ...]` when sky and snow share a colour; `curve` lifts the base at the sides                |
| `sides`                         | Skyline mode: width of the side fade (default 0.06 of the width); about 0.2 dissolves a cropped forest                 |
| `fit`                           | Mask level that counts as subject when framing (default 0.5); about 0.03 keeps wide fades on the plate                 |
| `ground_out`                    | `{below, hue, s_min, v_min}` drop a meadow in front of a mountain; `teeth` (0.02) stops a lone tree hanging below      |
| `trees`                         | Light theme: `{below, gap}` open gaps between spruce crowns below `below` (0-1 of the plate); `fade` thins the forest  |
| `light`, `dark`                 | Keys that apply to one theme only, e.g. `"light": {"cap": 0.7}` for a dark forest on paper                             |
| `lum: "value"`                  | Tone from the brightest channel, so blue-shadowed snow stays snow instead of printing like rock                        |
| `clahe`, `edge`, `cap`          | Local contrast (default 2.0; 0 for broad planes), contour emphasis (0.4) and density ceiling (0.8)                     |
| `stretch`, `simplify`, `levels` | Vertical exaggeration; median filter that merges specks; flatten tone into a few bands                                 |
| `tone`                          | `[[h0, h1, s_min, v_min, value], ...]` OpenCV HSV windows held at a grey (bright bills, green frogs)                   |
| `weight`                        | Mean dot density inside the subject (default 0.46 light, 0.34 dark)                                                    |
| `despecular`                    | Percentile above which flash glare is pulled down (wet skin)                                                           |
| `features`                      | Percentile below which tiny dark features stay solid (eyes)                                                            |
| `passes`, `detail`              | Smoothing passes (default 3) and fine-texture amount (0.18)                                                            |
| `floor`, `rim`                  | Minimum density inside; outline strength (0.58)                                                                        |
| `stones`, `ground_at`           | Stone bed with cast shadow; height of the ground (0-1 of subject)                                                      |
| `bubbles`                       | Rising bubbles in front of a fish's mouth                                                                              |
| `kind: "globe"`, `lon0`, `lat0` | A lit globe from `src/lib/geo-land.json`                                                                               |

## Sizes

| Size   | Render  | Shown at                    | Use                                      |
| ------ | ------- | --------------------------- | ---------------------------------------- |
| `card` | 880x660 | about 350x260 CSS px        | /hobbies/ cards                          |
| `mini` | 360x270 | about 125-260 CSS px across | home page band                           |
| `icon` | 120x90  | 60x45                       | too small for most subjects; see lessons |

## Choosing a photo

Good sources are a whole animal side-on with its eye visible, nothing crossing
it, soft even light, and a plain or blurred background. Avoid flash glare,
backlighting and animals that match their background in colour. A mountain
works when it's dark rock against blue sky with a band of forest below
(Liberty Bell from Washington Pass). Snow-covered faces don't work, even
Everest's: white on a white page has nothing to stipple.

If Truman sends photos as chat attachments, those are downsized copies: find
the full-resolution original (search his session folders, then his Windows
Downloads under `/mnt/c/Users/<user>/Downloads`) and check it's the same
picture. File names repeat across cameras: DSC08626 was both a Costa Rica
waterfall in the sessions and an Oregon salamander in Downloads.

# What worked, and what didn't

Notes from building the Things to try set (October 2026). Truman's verdict on
the first round: "these are great, im impressed", and he singled out the
bubbles added to the gourami. In round 2 he picked four replacement photos
himself (herping, aquarium keeping, fishing, hiking) and said the others were
good. Rounds 3 and 4 fixed the salamander's legs and feet (he liked its tail)
and replaced two mountains he didn't like with Liberty Bell. Read this before
choosing photos or changing the pipeline.

## The look

- **Weighted Voronoi stippling, not halftone or dithering.** Lloyd relaxation
  gives even, hand-placed spacing. Random or error-diffusion dots read as
  noise; ordered dithering reads as a printer.
- **Round dots, drawn at 4x and downsampled.** 1-2 px circles drawn directly
  come out as crosses.
- **Dot radius from local spacing.** With one fixed radius, dark areas fuse
  into black "worms". Sizing each dot from the median distance to its six
  neighbours keeps dark areas as tight, separate dots.
- **60 Lloyd iterations.** At 36, dark regions hadn't settled and still
  clumped.
- **One pen for the set.** Card plates are 880x660 with a dot radius of 1.25
  px, shown at about 440x330 CSS px (2x). The first try (1.6-1.75 px) was
  coarse and blotchy at display size.
- **Even weight across plates.** Each plate solves a gamma so the mean dot
  density inside the subject hits `weight` (0.46 light, 0.34 dark). Without
  it a black bird and a pale fish look like two different artists.
- **Same framing.** Every subject is cut out and its bounding box scaled to
  the same share of the plate (`fill`) before shading.
- **Dark mode is scratchboard.** Light dots where the photo is light. Simply
  inverting ink and paper shows a photographic negative.
- **Liberties that landed:** the dotted bed of stones with a cast shadow
  (from the specimen-plate convention in Truman's reference), and the gourami's
  bubbles. Keep inventions small and in the same pen.

## Choosing photos

What stippled well (the current set, all chosen or approved by Truman):

- **Red rock crab:** top-down, claws spread. Needed `skin_out` for the hand
  holding it, and `ground_at` so it doesn't stand on its leg tips.
- **Honey gourami (DSC02926, his pick):** clean cutout from a soft tank
  background. The shadowed cheek printed as a dark patch until `lift`
  brightened it; orange fin edges held darker with `tone`.
- **Coho salmon (DSC06668, his pick):** side-on on a net. `exclude` cuts the
  net handle without clipping the pelvic fin; a `floor` keeps the white
  belly drawn.
- **Black Oystercatcher:** clean profile, once its bill, eye and legs got
  `tone` overrides.
- **Oregon Ensatina (DSC08626, his pick):** big dark eye, pale skin, even
  light. The cutout lost the out-of-focus tail (`include` adds it back), a
  pine needle crossed the hip (`inpaint`), and `tilt: 22` levels it onto the
  stones. The hind leg was a blurred stump folded under the hip; it is now a
  `graft` of the sharp front leg at 85% size, placed so both feet land on the
  same line after the tilt (solved, not eyeballed). The front leg is left
  exactly as photographed. Its toes came out hooked twice, for two reasons:
  the tilt turned the feet so the toes pointed at the ground (`keep_level`
  turns them back to the photo's angle), and a white twig touching the third
  toe's tip had merged into the cutout as a backward curl (cut with `exclude`
  and left out of the graft's `from` polygon).
- **Liberty Bell from Washington Pass (DSC03973, his pick, replacing
  Everest):** dark rock against blue sky, with a spruce forest below. The
  sky separates by colour, so the `skyline` came from a colour mask, not
  hand tracing. Its points (and `ground_out.below`) are in crop coordinates:
  change `crop` and they must be remapped. What made
  it work: a tight crop on the peak (0.2-0.86 of the width), so the spire is
  big; `ground_out` to drop the meadow, with `teeth` so a lone spruce out in
  the meadow doesn't hang below the forest like a drip; `trees` to open the
  forest's crowns on paper, and `fade` to thin it downhill so the peak is the
  darkest mass, like the stone beds under the animals; and `sides`, `curve`
  and `fit` for an oval vignette that dissolves instead of ending in walls.
- **Globe:** generated from the site's own coastline data, not a photo.

Earlier picks that worked but were replaced by Truman's choices: a pika
(fur is ideal for stippling), a different coho and gourami, and Mount
Rainier from Sunrise (fine, but it read as a pile of gravel).

What failed, and why:

- **Everest's north face (DSC09380, his own pick):** shaded snow and sky are
  the same blue, so only a hand-traced `skyline` found the ridge. With
  `lum: "value"`, `clahe: 0`, `stretch` and a strong `rim` it read as a peak,
  but he judged it "doesn't look good": a snow-plastered face is mostly white
  on white. A darker, more dramatic peak with trees replaced it.
- **Mostly white mountains** (snowy shots of Everest and Liberty Bell, two
  fire lookouts, and a Rainier shot that was mostly snowfield). White snow on
  a white page has nothing to stipple, and blue sky separates from ground by
  colour, which stippling throws away. A mountain needs plenty of dark rock
  in the frame; the July Liberty Bell has it.
- **Rough-skinned newt:** grass blades over its body made a broken cutout.
- **Pacific chorus frog:** bright green on green turns into one grey blob.
- **Dark salamander with flash glare:** glare on wet skin stretched to white.
  `despecular` + `features` helped, but a soft-light photo (the Ensatina)
  beat every fix.
- **Hermit crab in its shell:** reads as a shell, not an animal.
- **Backlit marmot:** a black silhouette with no interior tone.
- **Rotated lizard:** rotating the source showed the padding as a hard
  rectangle. Use `tilt` (rotates after the cutout) instead of `rotate`.

## Pipeline traps

- **Masks must use constant (black) borders when placed.** Replicate borders
  smeared the mask edge across the frame.
- **Percentile normalisation undoes tone fixes.** After `despecular` pulls
  glare down to mid-grey, normalising by the new range stretches it back to
  white. Normalise by the original range (the script does this).
- **Grey sheets lie.** Judge plates at real display size on the real paper
  colour (`review.py plates`), not as thumbnails on grey.
- **The icon size is too small for subjects.** At 120x90 (60 CSS px) most
  subjects become grey blobs; only the boldest outline survives. Don't use
  stipple plates as tab or list icons below about 120 CSS px wide.
- **rembg (isnet-general-use) is good but not psychic.** It keeps hands,
  nets, twigs and leaves the subject touches. Check `review.py masks` and fix
  with `exclude`, `skin_out` or `green_out` before tuning tone.
- **Fixed-target weight darkens pale subjects.** The gamma solve pushes
  every subject to the same mean density, so a pale gold fish or a pale
  salamander comes out heavy. Lower `weight` for them (0.3-0.36) rather than
  changing the default.
- **Ground can swallow legs.** The stone bed is masked out of the subject,
  but if `ground_at` sits above the feet the lower legs fade into gravel.
  Put the ground at the feet (`ground_at: 1.0`).
- **The sky-mask fade follows the ridge.** Measured down from the skyline, a
  tall summit gets a deep scoop cut out beneath it (an arch). Use `base`.
- **Chat attachments are downsized.** Find the original (see SKILL.md); file
  names repeat across cameras, so compare pictures, not just names.
- **Don't redraw parts Truman didn't ask about.** Asked to fix a hind leg,
  re-posing the front leg too (stretched to reach the ground) made the feet
  huge and the animal too tall; he wanted the front left alone and the hind
  leg copied from it, a little shorter. Solve geometry with the part that
  needs fixing.
- **Light and dark need different weight for pale animals.** Dark mode
  showed the toes clearly while light mode lost them in the stone bed: use
  `floor_light`, `ground_light` and `clear_feet` rather than changing both.
- **`tilt` turns the feet too.** Levelling a climbing animal points its toes
  at the ground, and they read as hooks or claws. Keep feet at the photo's
  angle with `keep_level`.
- **Debris touching a toe becomes a toe.** The cutout merges a twig or leaf
  at a toe tip into the toe. Check every foot with `review.py zoom --raw`
  before blaming the pose.
- **A landscape's crop edge is a wall.** Fade the sides (`sides`) and lower
  `fit`, so framing sizes the whole fade onto the plate. With the default
  `fit`, a wider fade shrinks the framed box, the scene is scaled up and the
  plate edge cuts the fade off.
- **A forest prints as one block on paper.** Open the crowns with `trees`,
  then `fade` it downhill. Apply that after the weight solve (the script
  does), or the solve darkens the peak to make up the lost ink.
- **Views can race renders.** Run the render and the review in one command,
  or check the file's timestamp, before judging a sheet.
- **Read polygons off the right-hand pane.** `exclude` and `skin_out` use
  0-1 coordinates of the cropped (and flipped) image, which is the cutout
  pane in the mask sheet, not the full photo.

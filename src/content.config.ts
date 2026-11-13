import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { isIsoDate } from "@/lib/sessions";

/**
 * Sessions collection — one entry per photography session.
 * Populated automatically by scripts/prebuild.mjs (which scans Blob Storage
 * or, with --local-only, the existing src/content/sessions directory).
 *
 * Each session is a JSON file: src/content/sessions/<slug>.json
 * Its referenced images live alongside: src/content/sessions/<slug>/images/*.jpg
 */
const sessions = defineCollection({
  loader: glob({
    pattern: "*.json",
    base: "./src/content/sessions",
    generateId: ({ entry }) => entry,
  }),
  schema: z.object({
    title: z.string(),
    date: z.string().refine(isIsoDate, {
      message: "date must be a real ISO calendar date (YYYY-MM-DD)",
    }),
    location: z.string().default(""),
    description: z.string().default(""),
    cover: z.string().optional(),
    /**
     * Filename of the photograph to crop into the session page's header
     * banner. Unset means "derive one from the cover"; see the session page
     * for that fallback. Set it when the cover is portrait, or when a
     * different frame simply makes the better wide crop.
     */
    banner: z.string().optional(),
    /**
     * Where to anchor the banner photograph inside the session banner, which
     * is a wide crop. Any CSS object-position value; defaults to the centre.
     * Set per session when the centre cuts the subject badly.
     */
    bannerFocus: z.string().max(40).optional(),
    order: z.number().int().nullable().optional(),
    /**
     * Filenames chosen in the admin panel to rotate in the lead box on the
     * home page. Empty keeps the session out of it; see buildLeadFrames.
     */
    showcase: z.array(z.string()).default([]),
    images: z
      .array(
        z.object({
          /** Filename within the session's images/ folder. */
          file: z.string(),
          /** Intrinsic pixel width as read by sharp. */
          width: z.number().int().positive(),
          /** Intrinsic pixel height as read by sharp. */
          height: z.number().int().positive(),
          /** The caption a visitor reads under the photo, from the sidecar. */
          caption: z.string().max(500).optional(),
          /**
           * Fuller alt text for screen readers and image search, written by
           * the captions pipeline. Falls back to the caption when absent.
           */
          alt: z.string().max(500).optional(),
          /**
           * Public URL of the full-resolution image (original JPEG/HEIC or
           * RAW-derived JPEG sidecar). Used by the lightbox. Empty in local
           * fixture mode — the lightbox falls back to the local file URL.
           */
          fullUrl: z.string().url().optional(),
          /**
           * Capture settings read from the image's EXIF metadata, pre-formatted
           * for display. Every field is optional — synthetic fixtures, stripped
           * images, and most RAW-derived JPEGs won't have them. Shown in the
           * lightbox beneath the caption.
           */
          exif: z
            .object({
              camera: z.string().optional(), // e.g. "ILCE-7M4"
              lens: z.string().optional(), // e.g. "FE 70-200mm F2.8 GM OSS"
              focalLength: z.string().optional(), // e.g. "135mm"
              aperture: z.string().optional(), // e.g. "f/2.8"
              shutter: z.string().optional(), // e.g. "1/500s"
              iso: z.string().optional(), // e.g. "ISO 200"
            })
            .optional(),
        }),
      )
      .min(1),
  }),
});

/**
 * Hobbies collection — one entry per hobby in the (optional) Hobbies section.
 * Hand-authored JSON committed to the repo (unlike sessions, which prebuild
 * generates from Blob Storage). Each hobby page may mount one self-contained
 * interactive island.
 *
 * File: src/content/hobbies/<slug>.json
 */
/** One image in a hobby media gallery: a display-size inline image plus the
 *  full-resolution original opened in the click-to-zoom lightbox. */
const hobbyMediaItem = z.object({
  /** Full-resolution blob URL (opened in the lightbox). */
  src: z.string().url(),
  /** Display-size blob URL shown inline. */
  display: z.string().url(),
  /** Intrinsic dimensions of the full-res image (PhotoSwipe needs them). */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  caption: z.string().optional(),
});

/** An iNaturalist taxon or place id, with its name so the JSON reads. */
const inatRef = z.object({
  id: z.number().int().positive(),
  name: z.string(),
});

const hobbies = defineCollection({
  loader: glob({
    pattern: "*.json",
    base: "./src/content/hobbies",
    generateId: ({ entry }) => entry,
  }),
  schema: z.object({
    title: z.string(),
    /** Short blurb shown on the hobby card. */
    summary: z.string(),
    /** A sentence or two shown on the hobby page above the interactive. */
    intro: z.string().default(""),
    /**
     * Caption under the hobby's stipple plate: what's drawn, where and when
     * ("Red rock crab · Puget Sound, May 2026"). The plates themselves are
     * src/assets/plates/<slug>-*.webp, drawn by the stipple-plates skill.
     */
    plateNote: z.string().optional(),
    /** Optional hex accent (e.g. '#0ea5e9') tinting the card icon tile. */
    accent: z.string().optional(),
    /** Explicit ordering on the hobbies landing page (ascending). */
    order: z.number().int().nullable().optional(),
    /**
     * Which interactive island to mount on the hobby page. One island per
     * hobby; null/omitted renders the page without an interactive.
     */
    interactive: z
      .enum([
        "aquarium",
        "tidepool",
        "fishing",
        "birding",
        "roadcruise",
        "travel-map",
        "pixel-hike",
        "repo-explorer",
      ])
      .nullable()
      .optional(),
    /** Heading for the photo gallery section (e.g. "My tank"). */
    mediaTitle: z.string().optional(),
    /**
     * Optional photo gallery, hosted in the `hobby-media` blob container
     * (never in `originals/`, so it stays out of the photography section).
     * Populated by scripts/upload-hobby-media.mjs.
     */
    media: z
      .object({
        hero: hobbyMediaItem.optional(),
        gallery: z.array(hobbyMediaItem).default([]),
      })
      .optional(),
    /**
     * Optional video of the real thing, a YouTube upload shown at the top of
     * the media section in place of the hero photo (which joins the grid).
     * HobbyVideo.astro loads it from youtube-nocookie.com once it's near the
     * viewport, muted, starting at the point in `lengthSeconds` that matches
     * the visitor's time of day. `moments` are seconds where one species is
     * easy to see; the aquarium picker links each `species` id to its moment.
     */
    video: z
      .object({
        youtubeId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
        /** Accessible name for the player. */
        title: z.string(),
        /** Full length of the upload, so the clock start stays inside it. */
        lengthSeconds: z.number().int().positive(),
        /** Text of the link out to YouTube, beside the section heading. */
        linkText: z.string(),
        /** Line under the heading, e.g. what lives in the tank. */
        caption: z.string().optional(),
        moments: z
          .array(
            z.object({
              /** Species id from the hobby's species data. */
              species: z.string(),
              /** How the name reads in a sentence ("pygmy cories"). */
              label: z.string(),
              /** Second in the video. */
              at: z.number().int().nonnegative(),
            }),
          )
          .default([]),
      })
      .optional(),
    /**
     * Optional daily puzzle: six species recorded at one real place in one
     * month, revealed commonest-first, with a world map to guess where. Data is
     * built by scripts/build-day-list.mjs. Opt-in per hobby; it has its own
     * page (narrow-nature.json), first in Things to try.
     */
    dayList: z
      .object({
        heading: z.string().optional(),
      })
      .optional(),
    /**
     * Optional personal touch: a live grid of the author's real iNaturalist
     * observations for this hobby, with a "View all" link to the same
     * observations on iNaturalist. The pixel game is the playful side; this is
     * the real-world record. The filter has to keep the grid to the hobby
     * (`taxa` is required); see src/lib/hobbies/inat-query.ts.
     */
    inaturalist: z
      .object({
        userId: z.string(),
        heading: z.string().optional(),
        blurb: z.string().optional(),
        limit: z.number().int().positive().max(30).optional(),
        /** Groups to show, as iNat taxa (`taxon_ids`). */
        taxa: z.array(inatRef).min(1),
        /** Groups inside `taxa` to leave out (`without_taxon_id`). */
        withoutTaxa: z.array(inatRef).optional(),
        /** Places to leave out (`not_in_place`). */
        withoutPlaces: z.array(inatRef).optional(),
        /** Coarsest identification shown (`hrank`), so vague IDs stay out. */
        maxRank: z
          .enum([
            "species",
            "genus",
            "family",
            "superfamily",
            "order",
            "class",
            "phylum",
          ])
          .optional(),
        /** Leave out captive animals (`captive=false`). */
        wildOnly: z.boolean().optional(),
      })
      .optional(),
    /**
     * Optional personal touch: a "life list" built from the author's
     * iNaturalist species_counts, fetched at build time and paged to the end,
     * with the browser fetch as a fallback (BirdingLifeList.astro). Features
     * the globally-rarest species the author has logged above the full list,
     * grouped by family.
     */
    lifeList: z
      .object({
        userId: z.string(),
        url: z.string().url(),
        heading: z.string().optional(),
        blurb: z.string().optional(),
        /** iNat iconic taxa filter, e.g. "Aves" for birds. */
        iconicTaxa: z.string().optional(),
        /** How many of the rarest species to show as cards. */
        featured: z.number().int().positive().max(12).optional(),
      })
      .optional(),
    /**
     * Optional "spark" story: a short first-person note about the species that
     * got the author into this hobby, beside the author's latest iNaturalist
     * photo of it, fetched at build time (BirdingSpark.astro).
     */
    spark: z
      .object({
        userId: z.string(),
        /** iNat taxon id of the spark species (used to pull the observation). */
        taxonId: z.number().int().positive(),
        heading: z.string().optional(),
        /** Common name shown as the card title. */
        species: z.string(),
        /** Scientific name shown beneath the title. */
        scientificName: z.string().optional(),
        /** The story, one paragraph per array entry. */
        story: z.array(z.string()).min(1),
      })
      .optional(),
    /**
     * Optional personal touch: a live map of the author's real iNaturalist
     * reptile + amphibian observations, bucketed by US state (via iNat
     * `place_ids`, admin_level 10) and drawn as a choropleth with a
     * Reptiles/Amphibians toggle. The road-cruise game is the playful side;
     * this is the real herping record. Rendered by INatHerpMap.astro.
     */
    herpMap: z
      .object({
        userId: z.string(),
        url: z.string().url(),
        heading: z.string().optional(),
        blurb: z.string().optional(),
        /** How many observations to pull per class (reptiles/amphibians). */
        limit: z.number().int().positive().max(500).optional(),
      })
      .optional(),
    /**
     * Optional personal touch: sessions from the photo archive that were
     * hikes, each a card that opens its session, newest first. A card shows
     * the session's cover unless `photo` names another of its photographs.
     * Rendered by TrailsWalked.astro.
     */
    trails: z
      .object({
        heading: z.string().optional(),
        hikes: z
          .array(
            z.object({
              /** The session's slug, as in /sessions/<slug>/. */
              session: z.string(),
              /** A photograph from that session to show instead of its cover. */
              photo: z.string().optional(),
              /**
               * Distance and elevation gain exactly as Truman gave them. Never
               * estimated or looked up: a hike without them shows neither.
               */
              miles: z.number().positive().optional(),
              gainFt: z.number().int().positive().optional(),
            }),
          )
          .min(1),
      })
      .optional(),
  }),
});

export const collections = { sessions, hobbies };

import { defineCollection, z } from "astro:content";

/**
 * Sessions collection — one entry per photography session.
 * Populated automatically by scripts/prebuild.mjs (which scans Blob Storage
 * or, with --local-only, the existing src/content/sessions directory).
 *
 * Each session is a JSON file: src/content/sessions/<slug>.json
 * Its referenced images live alongside: src/content/sessions/<slug>/images/*.jpg
 */
const sessions = defineCollection({
  type: "data",
  schema: z.object({
    title: z.string(),
    date: z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
      message: "date must be an ISO date string (YYYY-MM-DD)",
    }),
    location: z.string().default(""),
    description: z.string().default(""),
    cover: z.string().optional(),
    order: z.number().int().nullable().optional(),
    images: z
      .array(
        z.object({
          /** Filename within the session's images/ folder. */
          file: z.string(),
          /** Intrinsic pixel width as read by sharp. */
          width: z.number().int().positive(),
          /** Intrinsic pixel height as read by sharp. */
          height: z.number().int().positive(),
          /** Optional caption from EXIF or sidecar. */
          caption: z.string().optional(),
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

const hobbies = defineCollection({
  type: "data",
  schema: z.object({
    title: z.string(),
    /** Short blurb shown on the hobby card. */
    summary: z.string(),
    /** A sentence or two shown on the hobby page above the interactive. */
    intro: z.string().default(""),
    /** Emoji used as the card icon (keeps the grid asset-free). */
    emoji: z.string().default("•"),
    /** Optional icon image (e.g. an SVG under public/); overrides the emoji on the card. */
    iconSrc: z.string().optional(),
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
     * Optional personal touch: a live grid of the author's real iNaturalist
     * observations for this hobby, with a link to their full observations page.
     * The pixel game is the playful side; this is the real-world record. Any
     * hobby with an iNaturalist presence can add this block.
     */
    inaturalist: z
      .object({
        userId: z.string(),
        url: z.string().url(),
        heading: z.string().optional(),
        blurb: z.string().optional(),
        limit: z.number().int().positive().max(30).optional(),
        /** iNat iconic taxa filter, e.g. "Animalia,Mollusca,Actinopterygii". */
        iconicTaxa: z.string().optional(),
        /** iNat taxon id filter (narrows to a clade). */
        taxonId: z.number().int().positive().optional(),
      })
      .optional(),
    /**
     * Optional personal touch: a live "life list" built from the author's real
     * iNaturalist species_counts. Features the globally-rarest species the
     * author has logged (with a fun-fact/range blurb pulled live from iNat's
     * Wikipedia summaries) above a compact grid of the full list.
     */
    lifeList: z
      .object({
        userId: z.string(),
        url: z.string().url(),
        heading: z.string().optional(),
        blurb: z.string().optional(),
        /** iNat iconic taxa filter, e.g. "Aves" for birds. */
        iconicTaxa: z.string().optional(),
        /** How many of the rarest species to feature with a blurb. */
        featured: z.number().int().positive().max(12).optional(),
      })
      .optional(),
    /**
     * Optional "spark" story: a short first-person note about the species that
     * got the author into this hobby, shown alongside the author's real
     * iNaturalist observation of that species.
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
  }),
});

export const collections = { sessions, hobbies };

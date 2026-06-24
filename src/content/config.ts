import { defineCollection, z } from 'astro:content';

/**
 * Sessions collection — one entry per photography session.
 * Populated automatically by scripts/prebuild.mjs (which scans Blob Storage
 * or, with --local-only, the existing src/content/sessions directory).
 *
 * Each session is a JSON file: src/content/sessions/<slug>.json
 * Its referenced images live alongside: src/content/sessions/<slug>/images/*.jpg
 */
const sessions = defineCollection({
  type: 'data',
  schema: z.object({
    title: z.string(),
    date: z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
      message: 'date must be an ISO date string (YYYY-MM-DD)',
    }),
    location: z.string().default(''),
    description: z.string().default(''),
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
const hobbies = defineCollection({
  type: 'data',
  schema: z.object({
    title: z.string(),
    /** Short blurb shown on the hobby card. */
    summary: z.string(),
    /** A sentence or two shown on the hobby page above the interactive. */
    intro: z.string().default(''),
    /** Emoji used as the card icon (keeps the grid asset-free). */
    emoji: z.string().default('•'),
    /** Optional hex accent (e.g. '#0ea5e9') tinting the card icon tile. */
    accent: z.string().optional(),
    /** Explicit ordering on the hobbies landing page (ascending). */
    order: z.number().int().nullable().optional(),
    /**
     * Which interactive island to mount on the hobby page. One island per
     * hobby; null/omitted renders the page without an interactive.
     */
    interactive: z
      .enum(['aquarium', 'travel-map', 'wa-fishing', 'pixel-hike', 'repo-explorer'])
      .nullable()
      .optional(),
  }),
});

export const collections = { sessions, hobbies };

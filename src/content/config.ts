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
        }),
      )
      .min(1),
  }),
});

export const collections = { sessions };

/**
 * Pure helpers behind the admin panel's session editor.
 *
 * Everything here is deliberately DOM-free so it can be unit tested in node
 * (see admin-ui.test.ts). src/lib/admin.ts owns the rendering and event wiring.
 */

export interface AdminSession {
  /** Raw originals/ folder name, used for blob reads and writes. */
  slug: string;
  /** Sanitized slug: thumbnail paths and the public /sessions/<slug> route. */
  thumbSlug: string;
  title: string;
  date: string;
  location: string;
  description: string;
  cover: string;
  /** Photograph cropped into the session page's header. Empty means automatic. */
  banner: string;
  order: number | null;
  images: string[];
  captions: Record<string, string>;
  /** Aspect ratio per image, so pickers can grey out the wrong shapes. */
  ratios?: Record<string, number>;
  /** Photographs chosen for the rotating lead box on the home page. */
  showcase?: string[];
  /** Public URL of the full-size frame, per filename, for the preview. */
  urls?: Record<string, string>;
}

/** How far from 3:2 a frame may be and still fill the lead box exactly.
 *  Matches LEAD_RATIO in src/lib/archive.ts. */
export const LEAD_RATIO = { min: 1.48, max: 1.52 };

/** The session header is a wide crop, so portrait frames lose most of their
 *  height in it. Matches BANNER_MIN_RATIO in src/pages/sessions/[slug].astro. */
export const BANNER_MIN_RATIO = 1.2;

function ratioOf(session: AdminSession, file: string): number | undefined {
  return session.ratios?.[file];
}

/** The lead box is a fixed 3:2, so only frames close to it can go in it. */
export function fitsLeadBox(session: AdminSession, file: string): boolean {
  const ratio = ratioOf(session, file);
  // Without a ratio (older prebuild output) allow it rather than block the user.
  if (ratio === undefined) return true;
  return ratio >= LEAD_RATIO.min && ratio <= LEAD_RATIO.max;
}

/** Whether a frame survives the wide crop at the top of a session page. */
export function fitsBanner(session: AdminSession, file: string): boolean {
  const ratio = ratioOf(session, file);
  if (ratio === undefined) return true;
  return ratio >= BANNER_MIN_RATIO;
}

const COMMON_RATIOS: [number, number][] = [
  [1, 1],
  [5, 4],
  [4, 5],
  [4, 3],
  [3, 4],
  [3, 2],
  [2, 3],
  [16, 9],
  [9, 16],
  [7, 5],
  [5, 7],
  [2, 1],
  [1, 2],
];

/** A shape an admin can read at a glance: "3:2", "4:5", or "1.73:1". */
export function ratioLabel(ratio: number | undefined): string {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return '';
  for (const [w, h] of COMMON_RATIOS) {
    if (Math.abs(ratio - w / h) <= 0.02) return `${w}:${h}`;
  }
  return ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`;
}

/** Counts and gaps the session list shows as badges. */
export interface SessionFlags {
  total: number;
  captioned: number;
  hasDescription: boolean;
  hasCover: boolean;
  hasBanner: boolean;
  inRotation: number;
  /** Frames close enough to 3:2 to be usable in the home page rotation. */
  leadCandidates: number;
}

export function sessionFlags(session: AdminSession): SessionFlags {
  const present = new Set(session.images);
  const captioned = session.images.filter((file) =>
    Boolean(session.captions?.[file]?.trim()),
  ).length;
  return {
    total: session.images.length,
    captioned,
    hasDescription: Boolean(session.description?.trim()),
    hasCover: Boolean(session.cover),
    hasBanner: Boolean(session.banner),
    inRotation: (session.showcase ?? []).filter((file) => present.has(file)).length,
    leadCandidates: session.images.filter((file) => fitsLeadBox(session, file)).length,
  };
}

/** A session is "unfinished" when something the site leans on is still missing. */
export function needsWork(session: AdminSession): boolean {
  const flags = sessionFlags(session);
  return !flags.hasDescription || !flags.hasCover || flags.captioned < flags.total;
}

/** Match every search term against the fields an admin would type. */
export function matchesQuery(session: AdminSession, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [session.title, session.slug, session.location, session.date]
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export type SessionFilter = 'all' | 'needs-work' | 'uncaptioned' | 'rotation';

/** Match the public site's "orderThenDateDesc" policy: explicit order first
 *  (ascending), then by date descending (newest first). */
export function sortSessions(sessions: AdminSession[]): AdminSession[] {
  return [...sessions].sort((a, b) => {
    if (a.order != null && b.order != null) return a.order - b.order;
    if (a.order != null) return -1;
    if (b.order != null) return 1;
    return (b.date || '').localeCompare(a.date || '');
  });
}

export function filterSessions(
  sessions: AdminSession[],
  options: { query?: string; filter?: SessionFilter } = {},
): AdminSession[] {
  const { query = '', filter = 'all' } = options;
  return sortSessions(sessions).filter((session) => {
    if (!matchesQuery(session, query)) return false;
    const flags = sessionFlags(session);
    if (filter === 'needs-work') return needsWork(session);
    if (filter === 'uncaptioned') return flags.captioned < flags.total;
    if (filter === 'rotation') return flags.inRotation > 0;
    return true;
  });
}

/** Tiny pre-generated thumbnails from variants/thumbs/, used by every picker. */
export function thumbUrl(host: string, thumbSlug: string, file: string): string {
  if (!host) return '';
  const base = file.slice(0, file.lastIndexOf('.')) || file;
  return `https://${host}/variants/thumbs/${encodeURIComponent(thumbSlug)}/${encodeURIComponent(`${base}.jpg`)}`;
}

/**
 * Full-size URL for the preview overlay.
 *
 * The build records one per frame (originals for web formats, the JPEG
 * derivative for RAW and HEIC). Before a build with that field lands, fall back
 * to the thumbnail so the preview still opens, just softer.
 */
export function previewUrl(session: AdminSession, file: string, host: string): string {
  return session.urls?.[file] || thumbUrl(host, session.thumbSlug, file);
}

export interface PanelSize {
  width: number;
  height: number;
}

export const PANEL_MIN = { width: 420, height: 380 };

/** Keep a remembered panel size usable on whatever screen it is opened on. */
export function clampPanelSize(size: PanelSize, viewport: PanelSize): PanelSize {
  const maxWidth = Math.max(240, viewport.width - 24);
  const maxHeight = Math.max(240, viewport.height - 24);
  // A phone is narrower than the comfortable minimum, so the screen wins.
  const minWidth = Math.min(PANEL_MIN.width, maxWidth);
  const minHeight = Math.min(PANEL_MIN.height, maxHeight);
  const width = Number.isFinite(size.width) ? size.width : maxWidth;
  const height = Number.isFinite(size.height) ? size.height : maxHeight;
  return {
    width: Math.min(Math.max(width, minWidth), maxWidth),
    height: Math.min(Math.max(height, minHeight), maxHeight),
  };
}

/** The size the panel opens at when nothing has been remembered yet. Wide
 *  enough to judge a photograph, capped so it doesn't swallow a big monitor. */
export function defaultPanelSize(viewport: PanelSize): PanelSize {
  return clampPanelSize(
    {
      width: Math.min(1400, Math.round(viewport.width * 0.94)),
      height: Math.round(viewport.height * 0.92),
    },
    viewport,
  );
}

/** Edge to edge, for the "Fill screen" toggle. */
export function fullPanelSize(viewport: PanelSize): PanelSize {
  return clampPanelSize({ width: viewport.width, height: viewport.height }, viewport);
}

export const TILE_MIN = 120;
export const TILE_MAX = 420;

export function clampTileSize(value: number): number {
  if (!Number.isFinite(value)) return 200;
  return Math.min(Math.max(Math.round(value), TILE_MIN), TILE_MAX);
}

/** What one click in the photo grid does. */
export type EditorMode = 'cover' | 'header' | 'rotation' | 'captions';

export const EDITOR_MODES: EditorMode[] = ['cover', 'header', 'rotation', 'captions'];

export function isEditorMode(value: string): value is EditorMode {
  return (EDITOR_MODES as string[]).includes(value);
}

/** Every editable value in the dialog, as one comparable object. */
export interface Draft {
  title: string;
  location: string;
  description: string;
  order: number | null;
  cover: string;
  banner: string;
  showcase: string[];
  captions: Record<string, string>;
}

export function draftFromSession(session: AdminSession): Draft {
  const captions: Record<string, string> = {};
  for (const file of session.images) {
    const caption = session.captions?.[file];
    if (caption) captions[file] = caption;
  }
  return {
    title: session.title ?? '',
    location: session.location ?? '',
    description: session.description ?? '',
    order: session.order ?? null,
    cover: session.cover ?? '',
    banner: session.banner ?? '',
    showcase: (session.showcase ?? []).filter((file) => session.images.includes(file)),
    captions,
  };
}

/** Stable serialization, so key order and pick order never fake a change. */
export function draftSignature(draft: Draft): string {
  const captions = Object.entries(draft.captions)
    .map(([file, caption]) => [file, caption.trim()] as const)
    .filter(([, caption]) => caption)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({
    title: draft.title.trim(),
    location: draft.location.trim(),
    description: draft.description.trim(),
    order: draft.order,
    cover: draft.cover,
    banner: draft.banner,
    showcase: [...draft.showcase].sort(),
    captions,
  });
}

export function isDirty(original: Draft, draft: Draft): boolean {
  return draftSignature(original) !== draftSignature(draft);
}

/** Captions ride along with the save as an ordered images array. */
export function imagesPayload(
  session: AdminSession,
  captions: Record<string, string>,
): { file: string; caption: string }[] {
  return session.images.map((file) => ({ file, caption: (captions[file] ?? '').trim() }));
}

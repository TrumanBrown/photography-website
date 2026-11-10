import type { CollectionEntry } from 'astro:content';
import { siteConfig } from '../../site.config';

type Session = CollectionEntry<'sessions'>;

/**
 * Apply the sort policy from site.config.ts.
 *
 * - 'orderThenDateDesc' (default): explicit `order` first ascending,
 *   then sessions without `order` by date descending.
 * - 'dateDesc': always date descending.
 */
export function sortSessions(entries: Session[]): Session[] {
  const policy = siteConfig.sessionsSort;
  const list = [...entries];

  if (policy === 'dateDesc') {
    list.sort((a, b) => Date.parse(b.data.date) - Date.parse(a.data.date));
    return list;
  }

  // orderThenDateDesc
  list.sort((a, b) => {
    const ao = a.data.order;
    const bo = b.data.order;
    if (ao != null && bo != null) return ao - bo;
    if (ao != null) return -1;
    if (bo != null) return 1;
    return Date.parse(b.data.date) - Date.parse(a.data.date);
  });
  return list;
}

export function sessionSlug(entry: Session): string {
  return entry.id.replace(/\.(json|ya?ml)$/i, '');
}

export function copyrightLine(): string {
  const startYear = siteConfig.copyrightStartYear;
  const currentYear = new Date().getFullYear();
  const range = currentYear > startYear ? `${startYear}–${currentYear}` : `${startYear}`;
  return `© ${range} ${siteConfig.ownerName}. All rights reserved.`;
}

export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  );
}

export function formatDate(iso: string, locale = siteConfig.defaultLocale): string {
  if (!isIsoDate(iso)) return iso;
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

type ImageExif = NonNullable<Session['data']['images'][number]['exif']>;

const ROMAN = ['', '', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/**
 * A camera as people call it. Sony writes its model codes into EXIF
 * ("ILCE-6700", "ILCE-7M4", "ZV-E10"); everyone else says "Sony a6700",
 * "Sony a7 IV", "Sony ZV-E10". Other makers' names are already readable.
 */
export function cameraName(raw: string | undefined): string {
  const model = (raw ?? '').trim();
  const alpha = /^ILCE-(\d+)([A-Z]*?)(?:M(\d))?$/.exec(model);
  if (alpha) {
    const [, number, letters, mark] = alpha;
    const generation = mark ? ` ${ROMAN[Number(mark)] ?? `Mark ${mark}`}` : '';
    return `Sony a${number}${letters}${generation}`;
  }
  if (/^(?:ZV|DSC|NEX)-/.test(model)) return `Sony ${model}`;
  return model;
}

/**
 * Join the present EXIF capture-setting fields into a single line for display,
 * e.g. "Sony a7 IV · FE 70-200mm · 135mm · f/2.8 · 1/500s · ISO 200". Returns
 * an empty string when no fields are present.
 */
export function formatExif(exif: ImageExif | undefined): string {
  if (!exif) return '';
  return [cameraName(exif.camera), exif.lens, exif.focalLength, exif.aperture, exif.shutter, exif.iso]
    .filter((v): v is string => Boolean(v))
    .join(' · ');
}

const MONTHS =
  '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
/** "Somewhere, Costa Rica, September 2026" or the older em-dashed form. */
const TITLE_PERIOD = new RegExp(`^(.*?)(?:\\s+\u2014\\s*|,\\s*)(${MONTHS}\\s+\\d{4})$`);

/**
 * Split a session title into the place and the period it names.
 *
 * Titles are written "Place, Region, Month Year". Showing the whole string and
 * then printing the date again underneath reads as a stutter, so the two parts
 * are separated here and laid out apart. Titles that don't end in a month are
 * returned whole, with no period.
 */
export function splitSessionTitle(title: string): { label: string; period: string } {
  const match = TITLE_PERIOD.exec(title.trim());
  if (!match) return { label: title.trim(), period: '' };
  return { label: match[1].trim(), period: match[2].trim() };
}

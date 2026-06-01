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
    if (ao !== undefined && bo !== undefined) return ao - bo;
    if (ao !== undefined) return -1;
    if (bo !== undefined) return 1;
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

export function formatDate(iso: string, locale = siteConfig.defaultLocale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

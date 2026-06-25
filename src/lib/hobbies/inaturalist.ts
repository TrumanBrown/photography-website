/**
 * Renders a live grid of a user's iNaturalist observations — the "personal"
 * counterpart to a hobby's pixel game. Lazy: only calls the public iNat API when
 * the section nears the viewport. No dependencies; safe under the site's strict
 * CSP (the API host + iNat photo CDNs are allow-listed in staticwebapp.config.json).
 *
 * Mounted by src/components/hobbies/INatObservations.astro via [data-inat] hooks.
 */
const API = 'https://api.inaturalist.org/v1/observations';
const PHOTO_HOSTS = [
  'https://inaturalist-open-data.s3.amazonaws.com/',
  'https://static.inaturalist.org/',
];

interface INatPhoto {
  url?: string;
}
interface INatTaxon {
  name?: string;
  preferred_common_name?: string;
}
interface INatObs {
  id: number;
  uri?: string;
  taxon?: INatTaxon | null;
  species_guess?: string | null;
  photos?: INatPhoto[];
  place_guess?: string | null;
}

/** square (75px) -> small (240px) for a crisper grid tile. */
function upgrade(url: string): string {
  return url.replace('/square.', '/small.');
}
function allowedHost(url: string): boolean {
  return PHOTO_HOSTS.some((h) => url.startsWith(h));
}

export function initINatObservations(root: HTMLElement): void {
  const grid = root.querySelector<HTMLElement>('[data-inat-grid]');
  const status = root.querySelector<HTMLElement>('[data-inat-status]');
  const userId = root.dataset.inatUser;
  const iconic = root.dataset.inatIconic;
  const taxon = root.dataset.inatTaxon;
  const limit = Math.max(1, Math.min(30, Number(root.dataset.inatLimit) || 12));
  if (!grid || !userId) return;

  let started = false;
  const load = async (): Promise<void> => {
    if (started) return;
    started = true;
    try {
      const q = new URLSearchParams({
        user_id: userId,
        photos: 'true',
        per_page: String(limit),
        order_by: 'observed_on',
        order: 'desc',
        locale: 'en',
      });
      if (iconic) q.set('iconic_taxa', iconic);
      if (taxon) q.set('taxon_id', taxon);
      const res = await fetch(`${API}?${q.toString()}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { results?: INatObs[] };
      const items = (data.results ?? []).filter((o) => o.photos?.[0]?.url);
      grid.replaceChildren();
      if (items.length === 0) {
        if (status) status.textContent = 'No observations to show yet.';
        return;
      }
      for (const o of items.slice(0, limit)) {
        const thumb = upgrade(o.photos![0].url!);
        if (!allowedHost(thumb)) continue;
        const name =
          o.taxon?.preferred_common_name || o.taxon?.name || o.species_guess || 'Observation';
        const a = document.createElement('a');
        a.href = o.uri || `https://www.inaturalist.org/observations/${o.id}`;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className =
          'group block overflow-hidden rounded-md bg-neutral-100 no-underline dark:bg-neutral-900';
        a.title = name + (o.place_guess ? `, ${o.place_guess}` : '');
        a.setAttribute('role', 'listitem');
        const img = document.createElement('img');
        img.src = thumb;
        img.alt = name;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.width = 240;
        img.height = 240;
        img.className =
          'aspect-square w-full object-cover transition-opacity duration-300 group-hover:opacity-90';
        a.appendChild(img);
        grid.appendChild(a);
      }
      if (status) status.textContent = '';
    } catch {
      grid.replaceChildren();
      if (status) {
        status.textContent = 'Could not load observations right now. See them on iNaturalist.';
      }
    }
  };

  const io = new IntersectionObserver(
    (entries, obs) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          obs.disconnect();
          void load();
        }
      }
    },
    { rootMargin: '200px' },
  );
  io.observe(root);
}

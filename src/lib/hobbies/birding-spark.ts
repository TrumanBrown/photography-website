/**
 * Pulls the author's real iNaturalist observation of their "spark" species and
 * drops its photo + a link beside the spark story. Lazy and CSP-safe like the
 * other iNat islands (api.inaturalist.org + the iNat photo CDNs are allow-listed
 * in staticwebapp.config.json). Falls back to hiding the media slot if the API
 * is unavailable, so the written story always stands on its own.
 *
 * Mounted by src/components/hobbies/BirdingSpark.astro via [data-spark] hooks.
 */
const API = "https://api.inaturalist.org/v1/observations";
const PHOTO_HOSTS = [
  "https://inaturalist-open-data.s3.amazonaws.com/",
  "https://static.inaturalist.org/",
];

interface INatPhoto {
  url?: string;
}
interface INatObs {
  id: number;
  uri?: string;
  photos?: INatPhoto[];
  place_guess?: string | null;
  observed_on?: string | null;
}

/** square (75px) -> medium (500px) for a presentable single image. */
function upgrade(url: string): string {
  return url.replace("/square.", "/medium.");
}
function allowedHost(url: string): boolean {
  return PHOTO_HOSTS.some((h) => url.startsWith(h));
}

function formatObservedOn(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function initBirdingSpark(root: HTMLElement): void {
  const media = root.querySelector<HTMLElement>("[data-spark-media]");
  const userId = root.dataset.sparkUser;
  const taxonId = root.dataset.sparkTaxon;
  if (!media || !userId || !taxonId) return;

  let started = false;
  const load = async (): Promise<void> => {
    if (started) return;
    started = true;
    try {
      const q = new URLSearchParams({
        user_id: userId,
        taxon_id: taxonId,
        photos: "true",
        per_page: "1",
        order_by: "observed_on",
        order: "desc",
        locale: "en",
      });
      const res = await fetch(`${API}?${q.toString()}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { results?: INatObs[] };
      const obs = (data.results ?? []).find((o) => o.photos?.[0]?.url);
      const raw = obs?.photos?.[0]?.url;
      const photo = raw ? upgrade(raw) : null;
      if (!obs || !photo || !allowedHost(photo)) {
        media.remove();
        return;
      }

      const link = document.createElement("a");
      link.href =
        obs.uri || `https://www.inaturalist.org/observations/${obs.id}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className =
        "group block overflow-hidden rounded-xl border border-neutral-200 no-underline dark:border-neutral-800";

      const img = document.createElement("img");
      img.src = photo;
      img.alt = "My iNaturalist photo of the spark species";
      img.loading = "lazy";
      img.decoding = "async";
      img.className =
        "block aspect-square w-full bg-neutral-100 object-cover transition-opacity duration-300 group-hover:opacity-95 dark:bg-neutral-900";
      link.appendChild(img);

      const caption = document.createElement("span");
      caption.className =
        "block bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:bg-neutral-900/60 dark:text-neutral-400";
      const where = obs.place_guess ? obs.place_guess : "";
      const when = formatObservedOn(obs.observed_on);
      caption.textContent =
        [where, when].filter(Boolean).join(" · ") ||
        "My observation on iNaturalist";
      link.appendChild(caption);

      media.replaceChildren(link);
    } catch {
      media.remove();
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
    { rootMargin: "200px" },
  );
  io.observe(root);
}

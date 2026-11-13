/**
 * The spark bird's photo when the build couldn't fetch it. Normally the build
 * has already put my latest observation's photo beside the story
 * (BirdingSpark.astro) and this does nothing. Otherwise it asks iNaturalist
 * once the section nears the viewport, and if that fails too it removes the
 * empty slot, so the written story always stands on its own.
 *
 * Mounted by src/components/hobbies/BirdingSpark.astro via [data-spark] hooks.
 */
import { fetchSparkObservation, inatPhoto, sparkCaption } from "./birding-inat";

export function initBirdingSpark(root: HTMLElement): void {
  if (root.dataset.sparkBuilt === "true") return;
  const media = root.querySelector<HTMLElement>("[data-spark-media]");
  const userId = root.dataset.sparkUser;
  const taxonId = root.dataset.sparkTaxon;
  if (!media || !userId || !taxonId) return;

  const load = async (): Promise<void> => {
    try {
      const obs = await fetchSparkObservation(userId, taxonId);
      const photo = inatPhoto(obs?.photo, "medium");
      if (!obs || !photo) {
        media.remove();
        return;
      }

      const link = document.createElement("a");
      link.href = obs.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className =
        "group block overflow-hidden border border-rule no-underline";

      const img = document.createElement("img");
      img.src = photo;
      img.alt = root.dataset.sparkSpecies || "";
      img.width = 500;
      img.height = 500;
      img.decoding = "async";
      img.className =
        "block aspect-square w-full bg-band object-cover transition-opacity duration-300 group-hover:opacity-95";
      link.appendChild(img);

      const caption = document.createElement("span");
      caption.className =
        "block border-t border-rule px-3 py-2 text-xs text-ink-2";
      caption.textContent = sparkCaption(obs);
      link.appendChild(caption);

      media.replaceChildren(link);
    } catch {
      media.remove();
    }
  };

  const io = new IntersectionObserver(
    (entries, observer) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        void load();
      }
    },
    { rootMargin: "200px" },
  );
  io.observe(root);
}

/**
 * One iNaturalist filter for a hobby's observation grid and its "View all"
 * link, so the link opens the same observations the grid shows, in the same
 * order.
 *
 * Both sides read these parameters the same way, with two catches the
 * Explore page adds (app/assets/javascripts/ang in inaturalist/inaturalist):
 * it runs parseInt on `taxon_id`, so several taxa must go as `taxon_ids`, and
 * it only passes parameters it knows, so an observation can't be left out by
 * id (`not_id` is dropped). Leave out a place instead.
 */

/** An iNaturalist taxon or place, named so the JSON can be read. */
export interface INatRef {
  id: number;
  name: string;
}

export interface INatGridFilter {
  userId: string;
  /** Groups to show (`taxon_ids`). */
  taxa: INatRef[];
  /** Groups inside `taxa` to leave out (`without_taxon_id`). */
  withoutTaxa?: INatRef[];
  /** Places to leave out (`not_in_place`). */
  withoutPlaces?: INatRef[];
  /** Coarsest identification to show (`hrank`), so "Bivalves" stays out. */
  maxRank?: string;
  /** Leave out captive animals (`captive=false`). */
  wildOnly?: boolean;
}

const ids = (refs: INatRef[]): string => refs.map((r) => r.id).join(",");

/** The filter as a query string, shared by the grid and its link. */
export function inatFilterQuery(filter: INatGridFilter): string {
  const q = new URLSearchParams({
    user_id: filter.userId,
    taxon_ids: ids(filter.taxa),
  });
  if (filter.withoutTaxa?.length) {
    q.set("without_taxon_id", ids(filter.withoutTaxa));
  }
  if (filter.withoutPlaces?.length) {
    q.set("not_in_place", ids(filter.withoutPlaces));
  }
  if (filter.maxRank) q.set("hrank", filter.maxRank);
  if (filter.wildOnly) q.set("captive", "false");
  q.set("photos", "true");
  q.set("order_by", "observed_on");
  q.set("order", "desc");
  return q.toString();
}

/** The API call that fills the grid. */
export function inatApiUrl(filterQuery: string, perPage: number): string {
  const q = new URLSearchParams(filterQuery);
  q.set("per_page", String(perPage));
  q.set("locale", "en");
  return `https://api.inaturalist.org/v1/observations?${q.toString()}`;
}

/** The same observations on iNaturalist's Explore page. */
export function inatExploreUrl(filterQuery: string): string {
  const q = new URLSearchParams(filterQuery);
  // Explore shows only verifiable observations unless told otherwise, and a
  // signed-in visitor's preferred place narrows a search that names no place.
  // The API applies neither.
  q.set("verifiable", "any");
  q.set("place_id", "any");
  q.set("subview", "grid");
  return `https://www.inaturalist.org/observations?${q.toString()}`;
}

/**
 * Pure stocking math for the aquarium sandbox, split out from the canvas engine
 * so it can be unit tested without a DOM. This is a playful approximation of
 * real bioload heuristics (waste scales with adult size; planted tanks buy a
 * little headroom), not aquarium advice.
 */

/** Bioload units a planted gallon can comfortably carry (tuned for feel). */
export const PLANTED_CAPACITY_PER_GALLON = 0.55;

export type StockingLabel =
  | "Lightly stocked"
  | "Healthy"
  | "Heavily stocked"
  | "Overstocked";

export interface StockingStatus {
  /** Total bioload as a fraction of capacity. 0..n; can exceed 1 (overstocked). */
  pct: number;
  label: StockingLabel;
  /** Meter color (hex) for the label band. */
  color: string;
}

/** Load-unit capacity for a tank of the given size. */
export function stockingCapacity(gallons: number): number {
  return gallons * PLANTED_CAPACITY_PER_GALLON;
}

/**
 * Map tank size + total bioload to the meter percentage, label, and color.
 * Bands: <40% lightly, 40-85% healthy, 85-100% heavily, >100% overstocked.
 */
export function stockingStatus(
  gallons: number,
  totalBioload: number,
): StockingStatus {
  const capacity = stockingCapacity(gallons);
  const pct = capacity > 0 ? totalBioload / capacity : 0;
  if (pct > 1) return { pct, label: "Overstocked", color: "#ef4444" };
  if (pct > 0.85) return { pct, label: "Heavily stocked", color: "#f59e0b" };
  if (pct >= 0.4) return { pct, label: "Healthy", color: "#10b981" };
  return { pct, label: "Lightly stocked", color: "#10b981" };
}

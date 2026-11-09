/**
 * Small pieces of the analytics beacon (src/lib/analytics.ts) that admin.ts
 * and the tests share without running the beacon itself.
 */

/** Set in localStorage by /admin, so Truman's own browsers aren't counted. */
export const OWNER_KEY = "tb_owner";

/**
 * Adds up how long something was really on screen: the clock runs only while
 * `set(true)` holds, so a tab left in the background or the other side of the
 * front door's switch doesn't count.
 */
export interface VisibleTimer {
  set(on: boolean): void;
  total(): number;
}

export function createVisibleTimer(
  now: () => number = () => Date.now(),
): VisibleTimer {
  let total = 0;
  let since: number | null = null;
  return {
    set(on) {
      const time = now();
      if (on && since === null) since = time;
      else if (!on && since !== null) {
        total += time - since;
        since = null;
      }
    },
    total() {
      return total + (since === null ? 0 : now() - since);
    },
  };
}

/** The `via` tag from a link like /?via=resume, or "" when there isn't a usable one. */
export function cleanVia(value: string | null): string {
  const via = (value ?? "").trim().toLowerCase();
  return /^[a-z0-9-]{1,32}$/.test(via) ? via : "";
}

/** Copied text as it's stored: one line, at most 100 characters. */
export function cleanCopy(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 100);
}

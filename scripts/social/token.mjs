/**
 * Access token lifecycle.
 *
 * Facebook Login: the token in IG_ACCESS_TOKEN is used as-is (a Page or system
 * user token, which doesn't expire).
 *
 * Instagram Login: long-lived tokens last 60 days and can be extended. The
 * seed comes from the IG_ACCESS_TOKEN secret; each refreshed copy is sealed
 * with SOCIAL_SECRET_KEY and kept in private storage. Refreshing weekly leaves
 * weeks of slack if the workflow ever stops. Pasting a new seed into the secret
 * always wins over the stored copy.
 */
import { fingerprint, keyFromBase64, seal, unseal } from "./seal.mjs";
import { redact, registerSecret, warn } from "./redact.mjs";

const TOKEN_FILE = "token.json";
const REFRESH_AFTER_MS = 7 * 24 * 3600 * 1000;

export async function resolveToken({
  settings,
  env = process.env,
  store,
  makeClient,
  allowRefresh = false,
  now = new Date(),
}) {
  const seed = env.IG_ACCESS_TOKEN;
  if (!seed) throw new Error("IG_ACCESS_TOKEN is not set.");
  registerSecret(seed);
  if (settings.loginMode === "facebook") return seed;

  const key = keyFromBase64(env.SOCIAL_SECRET_KEY);
  const seedPrint = fingerprint(seed);
  let current = null;
  const stored = await store.readJson(TOKEN_FILE);
  if (stored) {
    try {
      current = unseal(stored.data, key);
    } catch {
      current = null;
    }
  }
  if (!current || current.seed !== seedPrint) {
    current = { token: seed, seed: seedPrint, refreshedAt: null };
  }
  registerSecret(current.token);

  const age = current.refreshedAt
    ? now - new Date(current.refreshedAt)
    : Infinity;
  if (allowRefresh && age > REFRESH_AFTER_MS) {
    try {
      const fresh = await makeClient(current.token).refreshToken();
      registerSecret(fresh.token);
      current = {
        token: fresh.token,
        seed: seedPrint,
        refreshedAt: now.toISOString(),
        expiresAt: new Date(
          now.getTime() + fresh.expiresIn * 1000,
        ).toISOString(),
      };
      await store.writeJson(TOKEN_FILE, seal(current, key));
    } catch (e) {
      // A token under 24 hours old can't be refreshed yet; the next run tries again.
      warn(`Token refresh skipped: ${redact(e)}`);
    }
  }
  return current.token;
}

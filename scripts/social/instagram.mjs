/**
 * Minimal Instagram Graph API client for publishing single images.
 *
 * Two setups (IG_LOGIN_MODE):
 *   instagram - "Instagram API with Instagram Login" (graph.instagram.com).
 *               No Facebook Page needed. Cannot add location or user tags.
 *   facebook  - "Instagram API with Facebook Login" (graph.facebook.com).
 *               Needs a linked Facebook Page; supports location_id and user_tags.
 *
 * Publishing is two steps: create a media container from a URL Meta can fetch,
 * then publish it. Nothing here logs; errors are redacted before they surface.
 */
import { redact } from "../photos/redact.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits between publish attempts when Instagram answers "Media ID is not
 * available" (code 9007, subcode 2207027) for a container it has already
 * reported FINISHED. Its publish side can lag its status side by a few
 * seconds; about a minute of retrying covers it.
 */
export const PUBLISH_RETRY_WAITS = [3000, 5000, 10000, 20000, 30000];

/** Instagram's "the media is not ready for publishing, please wait for a moment". */
export function notReadyToPublish(e) {
  return (
    e?.code === 9007 ||
    e?.subcode === 2207027 ||
    /media id is not available/i.test(e?.message ?? "")
  );
}

export class GraphError extends Error {
  constructor(status, error) {
    super(
      redact(`Instagram API ${status}: ${error?.message ?? "request failed"}`),
    );
    this.name = "GraphError";
    this.status = status;
    this.code = error?.code;
    this.subcode = error?.error_subcode;
  }
}

export function createClient({
  mode = "instagram",
  token,
  apiVersion = "v25.0",
  userId,
  fetchImpl = fetch,
  publishRetryWaits = PUBLISH_RETRY_WAITS,
}) {
  if (!token) throw new Error("No Instagram access token is configured.");
  const host =
    mode === "facebook"
      ? "https://graph.facebook.com"
      : "https://graph.instagram.com";
  const base = `${host}/${apiVersion}`;
  let igUserId = userId || null;

  async function call(method, path, params = {}) {
    const url = new URL(`${base}${path}`);
    const init = { method, headers: { Authorization: `Bearer ${token}` } };
    if (method === "GET") {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      // Meta's documented form; the URL itself is never logged.
      url.searchParams.set("access_token", token);
    } else {
      init.headers["Content-Type"] = "application/x-www-form-urlencoded";
      init.body = new URLSearchParams({
        ...params,
        access_token: token,
      }).toString();
    }
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, init);
      const json = await res.json().catch(() => ({}));
      if (res.ok && !json.error) return json;
      const err = new GraphError(res.status, json.error);
      // 1/2 = transient, 4/17/32/613 = rate limiting; worth a short retry.
      if ([1, 2, 4, 17, 32, 613].includes(err.code) && attempt < 2) {
        await sleep(5000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }

  return {
    mode,
    /** The professional account id publishing goes to. Never logged. */
    async userId() {
      if (igUserId) return igUserId;
      if (mode === "facebook")
        throw new Error("IG_USER_ID is required with Facebook Login.");
      const me = await call("GET", "/me", { fields: "user_id" });
      igUserId = String(me.user_id ?? me.id ?? "");
      if (!igUserId)
        throw new Error("Could not read the account id from the token.");
      return igUserId;
    },

    async publishingLimit() {
      const id = await this.userId();
      const json = await call("GET", `/${id}/content_publishing_limit`, {
        fields: "quota_usage,config",
      });
      const row = json.data?.[0] ?? {};
      return {
        used: row.quota_usage ?? 0,
        total: row.config?.quota_total ?? 100,
      };
    },

    async createImageContainer({
      imageUrl,
      caption,
      altText,
      locationId,
      userTags,
    }) {
      const id = await this.userId();
      const params = { image_url: imageUrl, caption };
      if (altText) params.alt_text = altText;
      if (mode === "facebook") {
        if (locationId) params.location_id = String(locationId);
        if (userTags?.length) params.user_tags = JSON.stringify(userTags);
      }
      const json = await call("POST", `/${id}/media`, params);
      return String(json.id);
    },

    /**
     * A story: just the image. Instagram's API can't add stickers (location,
     * link, poll) or music to a story, and stories take no caption or alt text.
     */
    async createStoryContainer({ imageUrl }) {
      const id = await this.userId();
      const json = await call("POST", `/${id}/media`, {
        image_url: imageUrl,
        media_type: "STORIES",
      });
      return String(json.id);
    },

    async containerStatus(containerId) {
      const json = await call("GET", `/${containerId}`, {
        fields: "status_code",
      });
      return json.status_code ?? "UNKNOWN";
    },

    /** Poll until the container is ready (images usually are within seconds). */
    async waitUntilReady(
      containerId,
      { timeoutMs = 120_000, intervalMs = 4000 } = {},
    ) {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const status = await this.containerStatus(containerId);
        if (status !== "IN_PROGRESS") return status;
        if (Date.now() > until) return status;
        await sleep(intervalMs);
      }
    },

    /**
     * Publish a FINISHED container. Retried while Instagram says it isn't
     * ready yet; if the container turns out to have been published meanwhile,
     * that counts (the post's id isn't known then, so it returns null).
     */
    async publish(containerId) {
      const id = await this.userId();
      for (let attempt = 0; ; attempt++) {
        try {
          const json = await call("POST", `/${id}/media_publish`, {
            creation_id: containerId,
          });
          return String(json.id);
        } catch (e) {
          if (!notReadyToPublish(e) || attempt >= publishRetryWaits.length)
            throw e;
          await sleep(publishRetryWaits[attempt]);
          const status = await this.containerStatus(containerId).catch(
            () => null,
          );
          if (status === "PUBLISHED") return null;
          if (status === "ERROR" || status === "EXPIRED") throw e;
        }
      }
    },

    /** Recent posts on the account, newest first, for "already posted" fingerprinting. */
    async recentMedia({ max = 500 } = {}) {
      const id = await this.userId();
      const out = [];
      let after = null;
      while (out.length < max) {
        const params = {
          fields: "id,media_type,media_url,thumbnail_url,timestamp",
          limit: "50",
        };
        if (after) params.after = after;
        const json = await call("GET", `/${id}/media`, params);
        out.push(...(json.data ?? []));
        after = json.paging?.cursors?.after;
        if (!json.paging?.next || !after) break;
      }
      return out.slice(0, max);
    },

    /** Instagram Login only: extend the long-lived token another 60 days. */
    async refreshToken() {
      if (mode !== "instagram")
        throw new Error("Token refresh only applies to Instagram Login.");
      const url = new URL("https://graph.instagram.com/refresh_access_token");
      url.searchParams.set("grant_type", "ig_refresh_token");
      url.searchParams.set("access_token", token);
      const res = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.access_token)
        throw new GraphError(res.status, json.error);
      return {
        token: json.access_token,
        expiresIn: json.expires_in ?? 60 * 24 * 3600,
      };
    },
  };
}

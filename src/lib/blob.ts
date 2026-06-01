import { siteConfig } from '../../site.config';

/**
 * Single source of truth for constructing Blob Storage URLs.
 *
 * Every reference to a blob — gallery full-res, RAW-derived sidecar, future
 * admin uploads — goes through these helpers. If we later switch to
 * SAS-signed URLs to gate originals behind a login, only this file changes.
 */

const BLOB_BASE = `https://${siteConfig.blobHost}`;

export type BlobContainer = 'originals' | 'derivatives' | 'metadata';

/**
 * Build a public URL for a blob in the given container.
 *
 * @param container - one of the three containers defined in Bicep
 * @param path - blob name (e.g. "2025-china-trip/IMG_4421.jpg")
 */
export function blobUrl(container: BlobContainer, path: string): string {
  const clean = path.replace(/^\/+/, '');
  return `${BLOB_BASE}/${container}/${encodePath(clean)}`;
}

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

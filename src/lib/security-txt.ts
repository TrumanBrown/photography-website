/**
 * security.txt (RFC 9116): where to report a vulnerability. Reports go to
 * GitHub's private vulnerability reporting, the channel SECURITY.md names.
 *
 * RFC 9116 requires an Expires date and advises less than a year ahead. It's
 * set from the build date, and the hourly build keeps moving it forward, so
 * the file never expires while the site is live.
 */
export const SECURITY_REPO =
  "https://github.com/TrumanBrown/photography-website";
export const SECURITY_TXT_DAYS = 180;

export function securityTxt(origin: URL | string, now: Date): string {
  const expires = new Date(now.getTime() + SECURITY_TXT_DAYS * 86_400_000);
  return [
    `Contact: ${SECURITY_REPO}/security/advisories/new`,
    `Expires: ${expires.toISOString()}`,
    `Policy: ${SECURITY_REPO}/security/policy`,
    `Canonical: ${new URL("/.well-known/security.txt", origin).toString()}`,
    "Preferred-Languages: en",
    "",
  ].join("\n");
}

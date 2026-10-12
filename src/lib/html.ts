const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

/**
 * JSON for an inline `<script type="application/ld+json">` block.
 *
 * JSON.stringify leaves `<` alone, so a title or caption containing
 * `</script>` would end the block early and the rest would be parsed as HTML.
 * `\u003c` is the same character to a JSON parser and inert to an HTML one.
 * U+2028 and U+2029 are escaped too, since some JavaScript parsers treat them
 * as line breaks.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

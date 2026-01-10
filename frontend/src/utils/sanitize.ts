/**
 * Text sanitization utilities for defense-in-depth XSS protection.
 *
 * React already escapes text in JSX, but these utilities provide
 * explicit sanitization for additional safety in edge cases.
 */

/**
 * HTML entity escape for untrusted text.
 * Escapes &, <, >, ", and ' characters.
 */
export function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#x27;",
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char] ?? char);
}

/**
 * Sanitize a group name for safe display.
 * Allows alphanumeric, spaces, underscores, hyphens, and dots.
 * Removes any other characters.
 */
export function sanitizeGroupName(name: string): string {
  return name.replace(/[^\w\s\-. ]/g, "").trim();
}

/**
 * Sanitize a participant ID for safe display.
 * Allows alphanumeric, underscores, hyphens, and dots.
 */
export function sanitizeParticipantId(id: string): string {
  return id.replace(/[^\w\-. ]/g, "").trim();
}

/**
 * Sanitize text that came from OCR output.
 * OCR can occasionally produce unexpected characters.
 * Removes control characters but preserves printable text.
 */
export function sanitizeOcrOutput(text: string): string {
  // Remove control characters (except newlines and tabs)
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/**
 * Truncate text to a maximum length with ellipsis.
 * Safe for display - doesn't affect security, just UX.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

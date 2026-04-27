/**
 * Input sanitization utilities.
 *
 * React already escapes JSX output, so these functions focus on:
 *   1. Stripping characters that have no valid place in a given field
 *   2. Enforcing hard length caps so oversized payloads never reach Supabase
 *   3. Normalising whitespace so the database never stores invisible garbage
 */

/** Strip ASCII/Unicode control characters (except normal whitespace). */
function stripControl(s: string): string {
  // Remove C0 controls (0x00–0x1F) except tab/newline, and C1 controls (0x7F–0x9F)
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");
}

/**
 * General text field (names, messages, descriptions).
 * Strips control characters and caps length.
 */
export function sanitizeText(s: string, maxLen: number): string {
  return stripControl(s).slice(0, maxLen);
}

/**
 * Code fields: business code, shop code, M-Pesa ref.
 * Allows letters, digits, dash, and underscore only.
 * Converts to uppercase.
 */
export function sanitizeCode(s: string, maxLen = 30): string {
  return s.replace(/[^A-Za-z0-9\-_]/g, "").toUpperCase().slice(0, maxLen);
}

/**
 * SKU field. Allows letters, digits, and dashes.
 */
export function sanitizeSku(s: string, maxLen = 40): string {
  return s.replace(/[^A-Za-z0-9\-]/g, "").toUpperCase().slice(0, maxLen);
}

/**
 * Phone number field. Allows digits, spaces, dashes, dots, and leading plus.
 */
export function sanitizePhone(s: string, maxLen = 15): string {
  // Allow + only at position 0
  const cleaned = s.replace(/[^0-9+\- ]/g, "").replace(/(?!^)\+/g, "");
  return stripControl(cleaned).slice(0, maxLen);
}

/**
 * Numeric amount fields (KSh values). Allows digits and a single decimal point.
 * Prevents negative sign.
 */
export function sanitizeAmount(s: string): string {
  // Keep only digits and the first decimal point
  const noNegs = s.replace(/[^0-9.]/g, "");
  const parts   = noNegs.split(".");
  if (parts.length <= 1) return noNegs.slice(0, 10);
  return (parts[0] + "." + parts.slice(1).join("")).slice(0, 13);
}

/**
 * Integer-only fields (quantities).
 * Allows only positive integers.
 */
export function sanitizeInteger(s: string, max = 9999): string {
  const n = parseInt(s.replace(/[^0-9]/g, ""), 10);
  if (isNaN(n) || n < 0) return "";
  return String(Math.min(n, max));
}

/**
 * Password field: strip control characters, cap length.
 * Do NOT strip special characters — passwords need them.
 */
export function sanitizePassword(s: string, maxLen = 128): string {
  return stripControl(s).slice(0, maxLen);
}

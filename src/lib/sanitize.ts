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
 * Phone number field. Allows digits, spaces, dashes, and a leading plus.
 * Max 13 chars covers +254XXXXXXXXX (the longest valid Kenyan format).
 */
export function sanitizePhone(s: string, maxLen = 13): string {
  const cleaned = s.replace(/[^0-9+\- ]/g, "").replace(/(?!^)\+/g, "");
  return stripControl(cleaned).slice(0, maxLen);
}

/**
 * Validates a Kenyan phone number.
 * Returns null if valid, or an error string if invalid.
 * Accepts:
 *   - Exactly 10 digits starting with 0  (local: 07XX XXX XXX)
 *   - Exactly 12 digits starting with 254 (intl without +: 2547XXXXXXXX)
 * Spaces, dashes, and a leading + are stripped before counting.
 * Returns null for empty input — "required" is the caller's responsibility.
 */
export function validatePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length === 10 && digits.startsWith("0")) return null;
  if (digits.length === 12 && digits.startsWith("254")) return null;
  if (digits.length < 10) return "Too short — enter 10 digits (07XXXXXXXX)";
  if (digits.length > 12) return "Too long — enter 10 digits (07XXXXXXXX) or 12 with country code (254XXXXXXXXX)";
  return "Enter 10 digits starting with 0, or 12 starting with 254";
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

/**
 * Security & Input Sanitization Utilities
 */

/**
 * Escapes regex special characters to prevent Regular Expression Denial of Service (ReDoS)
 * and NoSQL regex query injection.
 */
function escapeRegex(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

/**
 * Safely sanitizes user input string, trims whitespace, and limits length.
 */
function sanitizeString(str, maxLength = 500) {
  if (str === null || str === undefined) return "";
  const cleaned = String(str).trim();
  return cleaned.length > maxLength ? cleaned.substring(0, maxLength) : cleaned;
}

/**
 * Validates and converts input to a safe positive number.
 */
function parsePositiveNumber(val, fallback = 0) {
  const num = Number(val);
  if (Number.isNaN(num) || !Number.isFinite(num) || num < 0) {
    return fallback;
  }
  return num;
}

module.exports = {
  escapeRegex,
  sanitizeString,
  parsePositiveNumber,
};

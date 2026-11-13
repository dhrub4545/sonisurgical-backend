const NepaliDate = require("nepali-date-converter").default;

// Kathmandu timezone offset: UTC + 5 hours 45 minutes (+05:45)
const KATHMANDU_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

/**
 * Returns the Nepali (BS) date and time converted to Asia/Kathmandu (UTC+05:45).
 * Independent of the server host OS/cloud container timezone (e.g. Render, Vercel, Docker).
 * @param {Date|string|number} [adDate=new Date()]
 * @returns {{ bsDate: string, bsTime: string }} e.g. { bsDate: "2083-07-27", bsTime: "16:24:45" }
 */
function getBSDateTime(adDate = new Date()) {
  const d = adDate instanceof Date ? adDate : new Date(adDate || Date.now());
  const validDate = isNaN(d.getTime()) ? new Date() : d;

  // Shift UTC timestamp to Kathmandu wall-clock time (+05:45)
  const ktmTime = new Date(validDate.getTime() + KATHMANDU_OFFSET_MS);

  const year = ktmTime.getUTCFullYear();
  const month = ktmTime.getUTCMonth(); // 0-based
  const day = ktmTime.getUTCDate();
  const hours = ktmTime.getUTCHours();
  const minutes = ktmTime.getUTCMinutes();
  const seconds = ktmTime.getUTCSeconds();

  // Safe Date at noon (12:00:00) prevents day boundary rollover in nepali-date-converter
  const safeDate = new Date(year, month, day, 12, 0, 0);
  const nd = new NepaliDate(safeDate);
  const bsDate = nd.format("YYYY-MM-DD");

  const pad = (n) => String(n).padStart(2, "0");
  const bsTime = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  return { bsDate, bsTime };
}

/**
 * Full display string in Kathmandu timezone, e.g. "2082-04-28 14:32:05"
 */
function getBSDateTimeString(adDate = new Date()) {
  const { bsDate, bsTime } = getBSDateTime(adDate);
  return `${bsDate} ${bsTime}`;
}

/**
 * Computes remaining calendar days until expiry date for both BS and AD date strings.
 * Returns null if no date provided or unparseable.
 * Returns negative number if already expired.
 */
function getDaysUntilExpiry(expiryStr) {
  if (!expiryStr) return null;
  const clean = String(expiryStr).trim();
  if (!clean) return null;

  const isBS =
    clean.toUpperCase().includes("BS") ||
    (/^\d{4}/.test(clean) && parseInt(clean, 10) >= 2070);

  const match = clean.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return null;

  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);

  let targetDate;
  if (isBS) {
    try {
      const nd = new NepaliDate(y, m - 1, d);
      targetDate = nd.toJsDate();
    } catch {
      return null;
    }
  } else {
    targetDate = new Date(y, m - 1, d);
  }

  const now = new Date();
  const diffMs = targetDate.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

module.exports = {
  getBSDateTime,
  getBSDateTimeString,
  getDaysUntilExpiry,
  KATHMANDU_OFFSET_MS,
};

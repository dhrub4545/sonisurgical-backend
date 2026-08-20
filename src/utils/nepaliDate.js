const NepaliDate = require("nepali-date-converter").default;

/**
 * Returns the current Nepali (BS) date and time.
 * @param {Date} [adDate=new Date()]
 * @returns {{ bsDate: string, bsTime: string }} e.g. { bsDate: "2082-04-28", bsTime: "14:32:05" }
 */
function getBSDateTime(adDate = new Date()) {
  const nd = new NepaliDate(adDate);
  const bsDate = nd.format("YYYY-MM-DD");
  const pad = (n) => String(n).padStart(2, "0");
  const bsTime = `${pad(adDate.getHours())}:${pad(adDate.getMinutes())}:${pad(adDate.getSeconds())}`;
  return { bsDate, bsTime };
}

/**
 * Full display string, e.g. "2082-04-28 14:32:05"
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
};

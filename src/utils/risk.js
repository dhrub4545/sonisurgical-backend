/**
 * Automatic risk / blacklist classification.
 *
 * Based on how many whole months have passed since the person last
 * submitted money (a "payment" transaction), while they still owe money:
 *   >= 12 months  -> blacklisted
 *   >= 9  months  -> high_risk
 *   >= 6  months  -> medium
 *   >= 3  months  -> normal (watch)
 *   <  3  months  -> good
 *
 * If the person has never paid, the clock starts from their first purchase.
 * If the person owes nothing, status is "clear".
 */
function monthsBetween(from, to = new Date()) {
  return (
    (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  );
}

function classifyRisk({ totalDue, lastPaymentAt, firstUnpaidPurchaseAt }) {
  if (!totalDue || totalDue <= 0) {
    return { status: "clear", label: "Clear", monthsInactive: 0 };
  }

  const reference = lastPaymentAt || firstUnpaidPurchaseAt;
  if (!reference) {
    return { status: "good", label: "Good", monthsInactive: 0 };
  }

  const months = monthsBetween(new Date(reference));

  if (months >= 12) return { status: "blacklisted", label: "Blacklisted", monthsInactive: months };
  if (months >= 9) return { status: "high_risk", label: "High Risk", monthsInactive: months };
  if (months >= 6) return { status: "medium", label: "Medium Risk", monthsInactive: months };
  if (months >= 3) return { status: "normal", label: "Normal", monthsInactive: months };
  return { status: "good", label: "Good", monthsInactive: months };
}

module.exports = { classifyRisk, monthsBetween };

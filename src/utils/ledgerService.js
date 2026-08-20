const Person = require("../models/Person");
const Transaction = require("../models/Transaction");

/**
 * Calculates months between two dates.
 */
function monthsBetween(from, to = new Date()) {
  return (
    (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  );
}

/**
 * Classifies customer risk based on unpaid months.
 */
function classifyRisk({ totalDue, lastPaymentAt, firstPurchaseAt }) {
  if (!totalDue || totalDue <= 0) {
    return { status: "clear", label: "Clear", monthsInactive: 0 };
  }

  const reference = lastPaymentAt || firstPurchaseAt;
  if (!reference) {
    return { status: "good", label: "Good", monthsInactive: 0 };
  }

  const months = Math.max(0, monthsBetween(new Date(reference)));

  if (months >= 12) return { status: "blacklisted", label: "Blacklisted", monthsInactive: months };
  if (months >= 9) return { status: "high_risk", label: "High Risk", monthsInactive: months };
  if (months >= 6) return { status: "medium", label: "Medium Risk", monthsInactive: months };
  if (months >= 3) return { status: "normal", label: "Normal", monthsInactive: months };
  return { status: "good", label: "Good", monthsInactive: months };
}

/**
 * Full single-customer recalculation and materialized state update.
 * O(1) indexed operation scoped strictly to one person ID.
 */
async function recalculatePersonBalance(personId) {
  const summary = await Transaction.aggregate([
    { $match: { person: personId } },
    {
      $group: {
        _id: "$person",
        totalPurchases: {
          $sum: { $cond: [{ $eq: ["$type", "purchase"] }, "$amount", 0] },
        },
        totalPaid: {
          $sum: { $cond: [{ $eq: ["$type", "payment"] }, "$amount", 0] },
        },
        lastPaymentAt: {
          $max: { $cond: [{ $eq: ["$type", "payment"] }, "$createdAt", null] },
        },
        firstPurchaseAt: {
          $min: { $cond: [{ $eq: ["$type", "purchase"] }, "$createdAt", null] },
        },
        transactionCount: { $sum: 1 },
      },
    },
  ]);

  const s = summary[0] || {
    totalPurchases: 0,
    totalPaid: 0,
    lastPaymentAt: null,
    firstPurchaseAt: null,
    transactionCount: 0,
  };

  const totalPurchases = s.totalPurchases || 0;
  const totalPaid = s.totalPaid || 0;
  const totalDue = totalPurchases - totalPaid;

  const risk = classifyRisk({
    totalDue,
    lastPaymentAt: s.lastPaymentAt,
    firstPurchaseAt: s.firstPurchaseAt,
  });

  return Person.findByIdAndUpdate(
    personId,
    {
      totalPurchases,
      totalPaid,
      totalDue,
      lastPaymentAt: s.lastPaymentAt,
      firstPurchaseAt: s.firstPurchaseAt,
      riskStatus: risk.status,
      riskLabel: risk.label,
      riskMonths: risk.monthsInactive,
      transactionCount: s.transactionCount || 0,
    },
    { new: true }
  );
}

/**
 * Safe startup synchronization for high-scale databases.
 * Runs in bulk batches to initialize materialized balances for all records without blocking queries.
 */
async function syncAllPersonBalances() {
  try {
    console.log("Checking database schema ledger synchronization...");
    const persons = await Person.find({}, "_id").lean();
    if (persons.length === 0) return;

    // Run parallel batched recalculations in chunks of 50
    const chunkSize = 50;
    for (let i = 0; i < persons.length; i += chunkSize) {
      const chunk = persons.slice(i, i + chunkSize);
      await Promise.all(chunk.map((p) => recalculatePersonBalance(p._id)));
    }
    console.log(`Successfully synchronized ledger balances for ${persons.length} customer accounts.`);
  } catch (err) {
    console.error("Ledger synchronization error:", err.message);
  }
}

/**
 * Calculates FIFO credit settlement up-to-date and remaining due.
 */
async function calculateSettlementStatus(personId) {
  const txns = await Transaction.find({ person: personId })
    .sort({ createdAt: 1 })
    .lean();

  let totalPurchases = 0;
  let totalPaid = 0;
  const purchases = [];

  for (const t of txns) {
    if (t.type === "purchase") {
      totalPurchases += t.amount;
      purchases.push({
        id: t._id,
        amount: t.amount,
        bsDate: t.bsDate,
        bsTime: t.bsTime,
      });
    } else if (t.type === "payment") {
      totalPaid += t.amount;
    }
  }

  const totalDue = Math.max(0, totalPurchases - totalPaid);

  let runningPayment = totalPaid;
  let lastClearedDate = null;
  let oldestUnpaidDate = null;
  let fullyClearedCount = 0;

  for (const p of purchases) {
    if (runningPayment >= p.amount) {
      runningPayment -= p.amount;
      lastClearedDate = p.bsDate;
      fullyClearedCount++;
    } else {
      if (!oldestUnpaidDate) {
        oldestUnpaidDate = p.bsDate;
      }
      break;
    }
  }

  let clearedStatusText = "";
  if (totalDue === 0) {
    if (purchases.length > 0) {
      clearedStatusText = `All dues cleared (Upto ${purchases[purchases.length - 1].bsDate})`;
    } else {
      clearedStatusText = "No pending dues (Zero Due)";
    }
  } else if (lastClearedDate) {
    clearedStatusText = `Dues cleared up to ${lastClearedDate}`;
  } else {
    clearedStatusText = oldestUnpaidDate
      ? `Credit pending since ${oldestUnpaidDate}`
      : "No cleared purchases";
  }

  return {
    totalPurchases,
    totalPaid,
    totalDue,
    lastClearedDate,
    oldestUnpaidDate,
    clearedStatusText,
    fullyClearedPurchases: fullyClearedCount,
    totalPurchasesCount: purchases.length,
  };
}

module.exports = {
  classifyRisk,
  monthsBetween,
  recalculatePersonBalance,
  syncAllPersonBalances,
  calculateSettlementStatus,
};

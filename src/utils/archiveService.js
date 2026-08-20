const Transaction = require("../models/Transaction");
const Person = require("../models/Person");
const { deleteProofPhoto } = require("./cloudinaryService");
const { recalculatePersonBalance } = require("./ledgerService");

/**
 * Scans for 100% fully cleared/settled purchases and matching payments older than the threshold.
 * Strictly guarantees that ZERO unpaid or partially paid credit is ever returned or pruned.
 */
async function previewPruneCleared({ years = 5, personId = null } = {}) {
  const cutoffDate = new Date();
  if (years && years > 0) {
    cutoffDate.setFullYear(cutoffDate.getFullYear() - Number(years));
  } else {
    // If years is 0 or null, consider all historical records up to current date
    cutoffDate.setFullYear(cutoffDate.getFullYear() + 10);
  }

  const personQuery = personId ? { _id: personId } : {};
  const persons = await Person.find(personQuery, "_id name totalDue").lean();

  let eligiblePurchasesCount = 0;
  let eligiblePaymentsCount = 0;
  let clearedAmount = 0;
  let proofPhotosCount = 0;
  let protectedUnpaidCount = 0;
  const affectedPersonIds = new Set();
  const prunableTransactionIds = [];

  for (const person of persons) {
    // Retrieve all customer transactions in strict chronological order
    const txns = await Transaction.find({ person: person._id })
      .sort({ createdAt: 1 })
      .lean();

    const purchases = txns.filter((t) => t.type === "purchase");
    const payments = txns.filter((t) => t.type === "payment");

    let runningPaymentTotal = payments.reduce((sum, p) => sum + p.amount, 0);

    // Track which purchases are 100% covered by cumulative payments
    const fullyClearedPurchases = [];
    const unpaidOrPartialPurchases = [];

    for (const purchase of purchases) {
      if (runningPaymentTotal >= purchase.amount) {
        runningPaymentTotal -= purchase.amount;
        fullyClearedPurchases.push(purchase);
      } else {
        unpaidOrPartialPurchases.push(purchase);
      }
    }

    protectedUnpaidCount += unpaidOrPartialPurchases.length;

    // Filter fully cleared purchases that are strictly older than the cutoff date
    const eligiblePurchasesForPerson = fullyClearedPurchases.filter(
      (p) => new Date(p.createdAt) <= cutoffDate
    );

    if (eligiblePurchasesForPerson.length > 0) {
      affectedPersonIds.add(String(person._id));
      let clearedPurchasesSum = 0;

      for (const p of eligiblePurchasesForPerson) {
        prunableTransactionIds.push(p._id);
        eligiblePurchasesCount++;
        clearedPurchasesSum += p.amount;
        clearedAmount += p.amount;
        if (p.proofPhotoPublicId) {
          proofPhotosCount++;
        }
      }

      // Identify matching historical payments older than cutoff date that covered these pruned purchases
      let paymentBudgetToPrune = clearedPurchasesSum;
      for (const payment of payments) {
        if (new Date(payment.createdAt) <= cutoffDate && paymentBudgetToPrune > 0) {
          if (paymentBudgetToPrune >= payment.amount) {
            prunableTransactionIds.push(payment._id);
            eligiblePaymentsCount++;
            paymentBudgetToPrune -= payment.amount;
          }
        }
      }
    }
  }

  return {
    cutoffDate: cutoffDate.toISOString().split("T")[0],
    yearsThreshold: years,
    eligiblePurchasesCount,
    eligiblePaymentsCount,
    totalEligibleCount: eligiblePurchasesCount + eligiblePaymentsCount,
    clearedAmount,
    proofPhotosCount,
    protectedUnpaidCount,
    affectedPersonsCount: affectedPersonIds.size,
    prunableIds: prunableTransactionIds,
  };
}

/**
 * Executes permanent deletion of strictly cleared records with explicit shopkeeper confirmation.
 */
async function executePruneCleared({ years = 5, personId = null, confirmation = "" } = {}) {
  if (confirmation !== "DELETE_CLEARED" && confirmation !== "CONFIRM") {
    throw new Error(
      "Action rejected: Explicit shopkeeper confirmation input required ('CONFIRM' or 'DELETE_CLEARED')."
    );
  }

  // Generate verified prune list
  const preview = await previewPruneCleared({ years, personId });

  if (preview.prunableIds.length === 0) {
    return {
      success: true,
      deletedCount: 0,
      message: "No cleared historical records match the selected criteria.",
      preview,
    };
  }

  // 1. Fetch transactions to destroy any attached Cloudinary proof assets
  const txnsToDelete = await Transaction.find(
    { _id: { $in: preview.prunableIds } },
    "_id proofPhotoPublicId person"
  ).lean();

  const affectedPersonIds = new Set();

  for (const txn of txnsToDelete) {
    affectedPersonIds.add(String(txn.person));
    if (txn.proofPhotoPublicId) {
      try {
        await deleteProofPhoto(txn.proofPhotoPublicId);
      } catch (e) {
        console.error("Cloudinary cleanup error during prune:", e.message);
      }
    }
  }

  // 2. Permanently delete cleared transactions from database
  const deleteResult = await Transaction.deleteMany({
    _id: { $in: preview.prunableIds },
  });

  // 3. Recalculate balances for all affected customer accounts
  for (const pId of affectedPersonIds) {
    await recalculatePersonBalance(pId);
  }

  return {
    success: true,
    deletedCount: deleteResult.deletedCount,
    deletedPurchasesCount: preview.eligiblePurchasesCount,
    deletedPaymentsCount: preview.eligiblePaymentsCount,
    freedAmount: preview.clearedAmount,
    affectedCustomersCount: affectedPersonIds.size,
    cutoffDate: preview.cutoffDate,
  };
}

module.exports = {
  previewPruneCleared,
  executePruneCleared,
};

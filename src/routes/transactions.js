const express = require("express");
const Person = require("../models/Person");
const Transaction = require("../models/Transaction");
const Medicine = require("../models/Medicine");
const { getBSDateTime } = require("../utils/nepaliDate");
const { recalculatePersonBalance, calculateSettlementStatus } = require("../utils/ledgerService");
const {
  uploadPurchaseProof,
  deleteProofPhoto,
  deleteClearedProofPhotos,
} = require("../utils/cloudinaryService");
const { previewPruneCleared, executePruneCleared } = require("../utils/archiveService");
const { protect } = require("../middleware/auth");
const { escapeRegex, parsePositiveNumber, sanitizeString } = require("../utils/securityUtils");

const router = express.Router();

// Apply JWT authentication guard to all transaction endpoints
router.use(protect);

/**
 * POST /api/transactions
 * Record a purchase (medicines on credit with optional proof photo) or a payment (money submitted).
 * Maintains materialized customer balances in O(1) time and handles Cloudinary lifecycle.
 */
router.post("/", async (req, res, next) => {
  try {
    const {
      personId,
      type,
      items = [],
      amount,
      note = "",
      proofPhoto = null,
      receiverPersonName = "",
    } = req.body;

    const person = await Person.findById(personId);
    if (!person) return res.status(404).json({ message: "Person not found" });

    const { bsDate, bsTime } = getBSDateTime();

    if (type === "purchase") {
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "At least one medicine item is required" });
      }
      const processed = items.map((it) => {
        const quantity = Number(it.quantity) || 1;
        
        let itemTotalNPR = 0;
        if (it.totalPriceNPR !== undefined && it.totalPriceNPR !== "" && it.totalPriceNPR !== null) {
          itemTotalNPR = Number(it.totalPriceNPR) || 0;
        } else if (it.amount !== undefined && it.amount !== "" && it.amount !== null) {
          itemTotalNPR = Number(it.amount) || 0;
        } else if (it.totalPriceINR !== undefined && it.totalPriceINR !== "" && it.totalPriceINR !== null) {
          itemTotalNPR = (Number(it.totalPriceINR) || 0) * 1.6;
        } else if (it.price !== undefined) {
          // If legacy price was sent
          itemTotalNPR = (Number(it.price) || 0) * (it.isTotalDirect ? 1 : quantity);
        }

        const itemTotalINR = (it.totalPriceINR !== undefined && it.totalPriceINR !== "" && it.totalPriceINR !== null)
          ? Number(it.totalPriceINR)
          : (itemTotalNPR / 1.6);

        const perUnitPrice = quantity > 0 ? itemTotalNPR / quantity : itemTotalNPR;

        return {
          medicineName: it.medicineName.trim(),
          quantity,
          price: Math.round(perUnitPrice * 100) / 100,
          amount: itemTotalNPR,
          totalPriceNPR: itemTotalNPR,
          totalPriceINR: Math.round(itemTotalINR * 100) / 100,
        };
      });
      const total = processed.reduce((s, it) => s + it.amount, 0);

      // Upload compressed proof photo to Cloudinary if provided
      let proofPhotoUrl = null;
      let proofPhotoPublicId = null;
      if (proofPhoto) {
        const uploadRes = await uploadPurchaseProof(proofPhoto, person._id);
        proofPhotoUrl = uploadRes.proofPhotoUrl;
        proofPhotoPublicId = uploadRes.proofPhotoPublicId;
      }

      const txn = await Transaction.create({
        person: person._id,
        type: "purchase",
        items: processed,
        amount: total,
        note,
        proofPhotoUrl,
        proofPhotoPublicId,
        receiverPersonName: receiverPersonName.trim(),
        bsDate,
        bsTime,
      });

      // Auto-deduct inventory stock for matching medicines
      for (const item of processed) {
        try {
          const escapedMedName = escapeRegex(item.medicineName);
          const med = await Medicine.findOne({
            name: { $regex: new RegExp(`^${escapedMedName}$`, "i") },
          });
          if (med) {
            med.stockQuantity = Math.max(0, med.stockQuantity - item.quantity);
            await med.save();
          }
        } catch (stockErr) {
          console.warn("Stock deduction error for", item.medicineName, stockErr.message);
        }
      }

      // Materialize balance & calculate updated settlement
      await recalculatePersonBalance(person._id);
      const settlement = await calculateSettlementStatus(person._id);

      return res.status(201).json({
        ...txn.toObject(),
        settlement,
      });
    }

    if (type === "payment") {
      const amt = Number(amount);
      if (!amt || amt <= 0) {
        return res.status(400).json({ message: "Payment amount must be greater than 0" });
      }
      const txn = await Transaction.create({
        person: person._id,
        type: "payment",
        items: [],
        amount: amt,
        note,
        bsDate,
        bsTime,
      });

      // Materialize balance & calculate updated settlement
      await recalculatePersonBalance(person._id);
      const settlement = await calculateSettlementStatus(person._id);

      // Automatically delete proof photos from Cloudinary for fully settled purchases
      await deleteClearedProofPhotos(person._id, Transaction);

      return res.status(201).json({
        ...txn.toObject(),
        settlement,
      });
    }

    res.status(400).json({ message: "type must be 'purchase' or 'payment'" });
  } catch (err) {
    next(err);
  }
});

// GET /api/transactions?personId=...&page=1&limit=50 — paginated history (newest first)
router.get("/", async (req, res, next) => {
  try {
    const { personId, page = 1, limit = 50 } = req.query;
    const query = personId ? { person: personId } : {};

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [txns, totalCount] = await Promise.all([
      Transaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Transaction.countDocuments(query),
    ]);

    // Backward-compatible response (array with pagination headers)
    res.set("X-Total-Count", String(totalCount));
    res.set("X-Page", String(pageNum));
    res.set("X-Total-Pages", String(Math.ceil(totalCount / limitNum)));

    res.json(txns);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/transactions/:id — remove an entry & delete its proof photo from Cloudinary
router.delete("/:id", async (req, res, next) => {
  try {
    const txn = await Transaction.findById(req.params.id);
    if (!txn) return res.status(404).json({ message: "Transaction not found" });

    // If transaction had a proof photo, delete from Cloudinary immediately
    if (txn.proofPhotoPublicId) {
      await deleteProofPhoto(txn.proofPhotoPublicId);
    }

    await Transaction.findByIdAndDelete(req.params.id);

    // Recalculate customer balance
    await recalculatePersonBalance(txn.person);

    res.json({ message: "Transaction deleted" });
  } catch (err) {
    next(err);
  }
});

// GET /api/transactions/archive/preview — inspect strictly cleared records eligible for cleanup
router.get("/archive/preview", async (req, res, next) => {
  try {
    const { years = 5, personId } = req.query;
    const preview = await previewPruneCleared({
      years: parseInt(years, 10) || 5,
      personId: personId || null,
    });
    res.json(preview);
  } catch (err) {
    next(err);
  }
});

// POST /api/transactions/archive/prune — strictly delete cleared records with explicit shopkeeper confirmation
router.post("/archive/prune", async (req, res, next) => {
  try {
    const { years = 5, personId, confirmation } = req.body;
    const result = await executePruneCleared({
      years: parseInt(years, 10) || 5,
      personId: personId || null,
      confirmation: confirmation ? confirmation.trim() : "",
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;

const mongoose = require("mongoose");

const itemSchema = new mongoose.Schema(
  {
    medicine: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine" }, // optional ref
    medicineName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    price: { type: Number, default: 0 }, // optional per-unit calculation
    amount: { type: Number, required: true, min: 0 }, // total item price in NPR
    totalPriceNPR: { type: Number, default: 0 },
    totalPriceINR: { type: Number, default: 0 },
  },
  { _id: false }
);

const transactionSchema = new mongoose.Schema(
  {
    person: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Person",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["purchase", "payment"],
      required: true,
      index: true,
    },
    // For purchases: list of medicines taken
    items: { type: [itemSchema], default: [] },
    // Total amount (purchase total, or payment received)
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true, default: "" },
    // Proof photo taken during purchase (compressed & stored on Cloudinary)
    proofPhotoUrl: { type: String, default: null },
    proofPhotoPublicId: { type: String, default: null },
    receiverPersonName: { type: String, trim: true, default: "" },
    // Nepali (BS) date and time recorded at the moment of the transaction
    bsDate: { type: String, required: true, index: true }, // e.g. "2082-04-28"
    bsTime: { type: String, required: true }, // e.g. "14:32:05"
  },
  { timestamps: true }
);

// High-speed compound indexes for millions of transactions
transactionSchema.index({ person: 1, createdAt: -1 }); // Instant customer transaction history
transactionSchema.index({ bsDate: -1, createdAt: -1 }); // Daily sales and audit logs
transactionSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model("Transaction", transactionSchema);

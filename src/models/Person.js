const mongoose = require("mongoose");

const personSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    rootName: { type: String, trim: true, default: "", required: false }, // optional family root name
    tole: { type: String, trim: true, default: "", required: false, index: true }, // optional area/tole
    phone: { type: String, trim: true, default: "", required: false, index: true }, // optional phone

    // Materialized ledger balances for high-scale O(1) performance
    totalPurchases: { type: Number, default: 0, min: 0, index: true },
    totalPaid: { type: Number, default: 0, min: 0, index: true },
    totalDue: { type: Number, default: 0, index: true }, // totalPurchases - totalPaid

    // Historical milestone timestamps
    lastPaymentAt: { type: Date, default: null, index: true },
    firstPurchaseAt: { type: Date, default: null },

    // Pre-calculated risk state for zero-cost risk & blacklist lookups
    riskStatus: {
      type: String,
      enum: ["clear", "good", "normal", "medium", "high_risk", "blacklisted"],
      default: "clear",
      index: true,
    },
    riskLabel: { type: String, default: "Clear" },
    riskMonths: { type: Number, default: 0 },

    // Total transaction records count
    transactionCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// High-performance compound indexes for scale
personSchema.index({ totalDue: -1, name: 1 });
personSchema.index({ riskStatus: 1, totalDue: -1 });
personSchema.index({ name: 1, phone: 1 });
personSchema.index({
  name: "text",
  rootName: "text",
  phone: "text",
  tole: "text",
});

module.exports = mongoose.model("Person", personSchema);

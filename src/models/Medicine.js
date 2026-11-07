const mongoose = require("mongoose");

const medicineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    genericName: { type: String, trim: true, default: "" },
    category: {
      type: String,
      trim: true,
      default: "Tablet",
      index: true,
    },
    stockQuantity: { type: Number, required: true, min: 0, default: 0 },
    unit: { type: String, default: "tablets", trim: true }, // e.g. tablets, bottles, vials, tubes
    unitPrice: { type: Number, min: 0, default: 0 }, // Selling price per unit (optional)
    costPrice: { type: Number, min: 0, default: 0 }, // Purchase cost price per unit
    lowStockThreshold: { type: Number, default: 15, min: 1 },
    batchNumber: { type: String, trim: true, default: "" },
    expiryDate: { type: String, trim: true, default: "" }, // e.g. "2083-04-15" (BS) or "2026-12-31" (AD)
    rackLocation: { type: String, trim: true, default: "" }, // e.g. "Rack A-3"
    description: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

medicineSchema.index({
  name: "text",
  genericName: "text",
  category: "text",
  rackLocation: "text",
});

module.exports = mongoose.model("Medicine", medicineSchema);

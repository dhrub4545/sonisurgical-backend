const mongoose = require("mongoose");

const medicineSuggestionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
  },
  { timestamps: true }
);

medicineSuggestionSchema.index({ name: "text" });

module.exports = mongoose.model("MedicineSuggestion", medicineSuggestionSchema);

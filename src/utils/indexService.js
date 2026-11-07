const Person = require("../models/Person");
const Transaction = require("../models/Transaction");
const Medicine = require("../models/Medicine");
const Category = require("../models/Category");
const MedicineSuggestion = require("../models/MedicineSuggestion");
const User = require("../models/User");

/**
 * Ensures all MongoDB indexes are created and synced across collections.
 * Runs non-blockingly during server startup or via management scripts.
 */
async function ensureAllIndexes() {
  const models = [
    { name: "Person", model: Person },
    { name: "Transaction", model: Transaction },
    { name: "Medicine", model: Medicine },
    { name: "Category", model: Category },
    { name: "MedicineSuggestion", model: MedicineSuggestion },
    { name: "User", model: User },
  ];

  console.log("[INDEX-SERVICE] Verifying and building database indexes...");
  for (const { name, model } of models) {
    try {
      await model.createIndexes();
      const count = (await model.collection.indexes()).length;
      console.log(`[INDEX-SERVICE] ✓ ${name} indexes verified (${count} active).`);
    } catch (err) {
      console.warn(`[INDEX-SERVICE] Warning building indexes for ${name}:`, err.message);
    }
  }
}

module.exports = {
  ensureAllIndexes,
};

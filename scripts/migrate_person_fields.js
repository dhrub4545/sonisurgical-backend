require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const { syncPersonClassifications } = require("../src/utils/personClassificationService");

async function executeMigration() {
  await connectDB();
  console.log("Connected to MongoDB cluster.");
  
  const db = mongoose.connection.db;
  const beforeCount = await db.collection("people").countDocuments({
    $or: [
      { accountType: { $exists: false } },
      { accountType: null },
      { accountType: "" },
      { section: { $exists: false } },
      { section: null },
      { section: "" },
    ],
  });
  
  console.log(`Documents before migration missing accountType or section: ${beforeCount}`);

  console.log("Running person classification migration...");
  const res = await syncPersonClassifications();
  console.log(`Migration result:`, res);

  const afterMissing = await db.collection("people").countDocuments({
    $or: [
      { accountType: { $exists: false } },
      { accountType: null },
      { accountType: "" },
      { section: { $exists: false } },
      { section: null },
      { section: "" },
    ],
  });

  const total = await db.collection("people").countDocuments({});
  const vendors = await db.collection("people").countDocuments({ accountType: "vendor" });
  const customers = await db.collection("people").countDocuments({ accountType: "customer" });
  const home = await db.collection("people").countDocuments({ section: "home" });
  const market = await db.collection("people").countDocuments({ section: "market" });

  console.log("\n=== POST-MIGRATION VERIFICATION REPORT ===");
  console.log(`Total documents: ${total}`);
  console.log(`Documents missing fields: ${afterMissing} (Expected: 0)`);
  console.log(`AccountType = 'vendor': ${vendors}`);
  console.log(`AccountType = 'customer': ${customers}`);
  console.log(`Section = 'home': ${home}`);
  console.log(`Section = 'market': ${market}`);

  await mongoose.disconnect();
  console.log("\nDatabase update completed successfully.");
}

executeMigration().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

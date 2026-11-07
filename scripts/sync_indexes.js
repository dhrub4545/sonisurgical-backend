require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const { ensureAllIndexes } = require("../src/utils/indexService");

async function main() {
  await connectDB();
  console.log("Connected to MongoDB cluster.");
  await ensureAllIndexes();

  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  
  console.log("\n=== COMPREHENSIVE DATABASE INDEX REPORT ===");
  for (const col of collections) {
    const colName = col.name;
    const indexes = await db.collection(colName).indexes();
    console.log(`\nCollection [${colName}] -> ${indexes.length} total indexes:`);
    for (const idx of indexes) {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)} ${idx.unique ? "[UNIQUE]" : ""}`);
    }
  }

  await mongoose.disconnect();
  console.log("\nDatabase index synchronization completed successfully.");
}

main().catch((err) => {
  console.error("Index synchronization failed:", err);
  process.exit(1);
});

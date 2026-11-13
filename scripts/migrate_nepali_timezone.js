require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const dns = require("dns");
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (e) {}

const mongoose = require("mongoose");
const { getBSDateTime } = require("../src/utils/nepaliDate");

const uri = process.env.MONGO_URI || "mongodb+srv://dhrubpandit2_db_user:PWABrljULUGF1UMI@cluster0.gwq3vsx.mongodb.net/medical_shop?retryWrites=true&w=majority";

async function migrateTransactionsTimezone() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(uri);
  console.log("Connected to MongoDB successfully.");

  const Transaction = mongoose.model("Transaction", new mongoose.Schema({}, { strict: false }));
  const txns = await Transaction.find().lean();
  console.log(`Found ${txns.length} total transactions to evaluate.`);

  let updatedCount = 0;
  let dateShiftCount = 0;
  let timeShiftCount = 0;

  const bulkOps = [];

  for (const t of txns) {
    const createdDate = t.createdAt ? new Date(t.createdAt) : t._id.getTimestamp();
    const { bsDate: newBSDate, bsTime: newBSTime } = getBSDateTime(createdDate);

    const dateChanged = t.bsDate !== newBSDate;
    const timeChanged = t.bsTime !== newBSTime;

    if (dateChanged || timeChanged) {
      if (dateChanged) dateShiftCount++;
      if (timeChanged) timeShiftCount++;
      updatedCount++;

      bulkOps.push({
        updateOne: {
          filter: { _id: t._id },
          update: {
            $set: {
              bsDate: newBSDate,
              bsTime: newBSTime,
            },
          },
          timestamps: false, // Preserve original createdAt and updatedAt timestamps
        },
      });
    }
  }

  console.log(`Transactions to update: ${updatedCount} (Time changed: ${timeShiftCount}, Date changed: ${dateShiftCount})`);

  if (bulkOps.length > 0) {
    const res = await Transaction.bulkWrite(bulkOps);
    console.log("Bulk update complete:", res.modifiedCount, "documents modified.");
  } else {
    console.log("All transactions are already in Nepali timezone. No changes needed.");
  }

  await mongoose.disconnect();
  console.log("Database connection closed. Migration finished successfully.");
}

migrateTransactionsTimezone().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

const path = require("path");
const fs = require("fs");
const dns = require("dns");

// Ensure MongoDB Atlas SRV records resolve cleanly
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (e) {
  console.warn("Could not set custom DNS servers:", e.message);
}

require("dotenv").config({ path: path.join(__dirname, ".env") });
const mongoose = require("mongoose");

const TARGET_DIR = path.resolve(__dirname, "..", "data");

function flattenObject(obj, prefix = "") {
  let result = {};
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (val === null || val === undefined) {
      result[newKey] = "";
    } else if (val instanceof Date) {
      result[newKey] = val.toISOString();
    } else if (typeof val === "object" && !Array.isArray(val) && !(val instanceof mongoose.Types.ObjectId)) {
      Object.assign(result, flattenObject(val, newKey));
    } else if (Array.isArray(val)) {
      result[newKey] = JSON.stringify(val);
    } else {
      result[newKey] = String(val);
    }
  }
  return result;
}

function convertToCSV(items) {
  if (!items || items.length === 0) return "";
  const flattenedItems = items.map((item) => flattenObject(item));
  const headers = Array.from(new Set(flattenedItems.flatMap((i) => Object.keys(i))));

  const escapeCSV = (val) => {
    if (val === undefined || val === null) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = [headers.map(escapeCSV).join(",")];
  for (const item of flattenedItems) {
    const row = headers.map((header) => escapeCSV(item[header]));
    rows.push(row.join(","));
  }
  return rows.join("\r\n");
}

async function exportDatabase() {
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/medical_shop";
  const maskedUri = uri.replace(/\/\/([^:]+):([^@]+)@/, "//$1:****@");
  console.log(`Connecting to MongoDB at: ${maskedUri}`);

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
    });
    console.log("Connected successfully to MongoDB!");

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    console.log(`Found ${collections.length} collections in database.`);

    if (!fs.existsSync(TARGET_DIR)) {
      fs.mkdirSync(TARGET_DIR, { recursive: true });
    }

    const summary = {
      exportTimestamp: new Date().toISOString(),
      databaseName: db.databaseName,
      totalCollections: collections.length,
      collections: {}
    };

    for (const colInfo of collections) {
      const colName = colInfo.name;
      const collection = db.collection(colName);
      const docs = await collection.find({}).toArray();
      const count = docs.length;

      console.log(`Exporting collection '${colName}': ${count} documents...`);

      // 1. Export JSON
      const jsonFilePath = path.join(TARGET_DIR, `${colName}.json`);
      fs.writeFileSync(jsonFilePath, JSON.stringify(docs, null, 2), "utf8");

      // 2. Export CSV (for easy spreadsheet viewing)
      const csvFilePath = path.join(TARGET_DIR, `${colName}.csv`);
      const csvData = convertToCSV(docs);
      fs.writeFileSync(csvFilePath, csvData, "utf8");

      summary.collections[colName] = {
        count: count,
        jsonFile: `${colName}.json`,
        csvFile: `${colName}.csv`
      };
    }

    // Write summary metadata file
    const summaryPath = path.join(TARGET_DIR, "_export_summary.json");
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");

    console.log("\n=================================");
    console.log("Export completed successfully!");
    console.log(`Data saved to: ${TARGET_DIR}`);
    console.log("=================================");
    console.log(JSON.stringify(summary, null, 2));

  } catch (error) {
    console.error("Failed to export database:", error);
    process.exit(1);
  } finally {
    if (mongoose.connection && mongoose.connection.readyState >= 1) {
      await mongoose.disconnect();
      console.log("Disconnected from MongoDB.");
    }
  }
}

exportDatabase();

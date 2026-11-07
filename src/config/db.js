const mongoose = require("mongoose");
const dns = require("dns");

// Fix for Node.js SRV resolution issue on Windows (querySrv ECONNREFUSED)
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (e) {
  // Fallback to default system DNS if not permitted
}

const connectDB = async () => {
  if (mongoose.connection && mongoose.connection.readyState >= 1) {
    return;
  }
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/medical_shop";
  await mongoose.connect(uri);
  console.log("MongoDB connected");
};

module.exports = connectDB;

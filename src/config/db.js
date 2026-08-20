const mongoose = require("mongoose");

const connectDB = async () => {
  if (mongoose.connection && mongoose.connection.readyState >= 1) {
    return;
  }
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/medical_shop";
  await mongoose.connect(uri);
  console.log("MongoDB connected");
};

module.exports = connectDB;

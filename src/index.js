require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const connectDB = require("./config/db");
const Medicine = require("./models/Medicine");
const User = require("./models/User");
const { syncAllPersonBalances } = require("./utils/ledgerService");
const { syncFromDatabase } = require("./utils/medicineNamesService");

const personsRouter = require("./routes/persons");
const transactionsRouter = require("./routes/transactions");
const medicinesRouter = require("./routes/medicines");
const aiRouter = require("./routes/aiExplain");
const authRouter = require("./routes/auth");

const app = express();

// 1. HTTP Security Headers with Helmet
app.use(
  helmet({
    crossOriginResourcePolicy: false, // Allows cross-origin media/photo loading in Expo
    crossOriginEmbedderPolicy: false,
  })
);

// 2. Cross-Origin Resource Sharing
app.use(cors());

// 3. Global API Rate Limiter (Prevents DDoS while allowing smooth app operations)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 mins per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests from this IP. Please slow down and try again.",
  },
});
app.use("/api", globalLimiter);

// 4. Stricter Rate Limiter for AI Endpoints (Protects Gemini API quotas)
const aiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 40, // 40 AI queries per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "AI rate limit reached. Please wait a moment before sending another query.",
  },
});

// 5. Rate Limiter for Authentication Gate
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication requests. Please try again later.",
  },
});

// 6. Request Body Parsing (50MB for camera photo uploads)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Health Check
app.get("/api/health", (req, res) => res.json({ ok: true, status: "healthy" }));

// Routes
app.use("/api/auth", authLimiter, authRouter);
app.use("/api/persons", personsRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/medicines", medicinesRouter);
app.use("/api/ai", aiLimiter, aiRouter);

// 7. Secure Global Error Handler (Sanitizes error responses)
app.use((err, req, res, next) => {
  console.error("[SERVER-ERROR]", err.message || err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: status === 500 ? "An unexpected server error occurred." : (err.message || "Request failed"),
  });
});

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    app.listen(PORT, async () => {
      console.log(`Server running securely on port ${PORT}`);
      await User.seedDefaultAdmin();
      syncAllPersonBalances();
      syncFromDatabase(Medicine);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });

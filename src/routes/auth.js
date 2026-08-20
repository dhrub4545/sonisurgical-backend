const express = require("express");
const User = require("../models/User");
const { generateToken, protect, authorize } = require("../middleware/auth");

const router = express.Router();

// In-Memory rate limiting / brute force guard: ip -> { attempts: number, lockUntil: number }
const loginAttempts = new Map();
const MAX_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes lockout

/**
 * POST /api/auth/login
 * Validates user credentials against MongoDB and returns signed JWT token
 */
router.post("/login", async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || "global";
    const now = Date.now();

    // 1. Check brute force lockout
    const attemptRecord = loginAttempts.get(ip);
    if (attemptRecord && attemptRecord.lockUntil > now) {
      const waitMinutes = Math.ceil((attemptRecord.lockUntil - now) / 60000);
      return res.status(429).json({
        success: false,
        message: `Too many failed login attempts. Please try again in ${waitMinutes} minute(s).`,
        locked: true,
        retryAfterMinutes: waitMinutes,
      });
    }

    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPassword = String(password).trim();

    // 2. Query user from MongoDB database
    const user = await User.findOne({ email: cleanEmail });

    let isMatch = false;
    if (user && user.isActive) {
      isMatch = await user.comparePassword(cleanPassword);
    }

    console.log(`[JWT-AUTH] Login attempt for "${cleanEmail}" -> Found: ${!!user}, PassMatch: ${isMatch}`);

    if (!user || !isMatch) {
      // Record failed attempt
      const prevAttempts = (attemptRecord && attemptRecord.lockUntil <= now) ? 0 : (attemptRecord?.attempts || 0);
      const newAttempts = prevAttempts + 1;

      if (newAttempts >= MAX_ATTEMPTS) {
        loginAttempts.set(ip, { attempts: newAttempts, lockUntil: now + LOCKOUT_MS });
        return res.status(429).json({
          success: false,
          message: "Too many failed attempts. Account locked for 15 minutes.",
          locked: true,
          retryAfterMinutes: 15,
        });
      } else {
        loginAttempts.set(ip, { attempts: newAttempts, lockUntil: 0 });
        const remaining = MAX_ATTEMPTS - newAttempts;
        return res.status(401).json({
          success: false,
          message: `Invalid email or password. (${remaining} attempt${remaining === 1 ? "" : "s"} remaining)`,
          remainingAttempts: remaining,
        });
      }
    }

    // 3. Reset rate limit on success
    loginAttempts.delete(ip);

    // 4. Update lastLogin in DB
    user.lastLogin = new Date();
    await user.save();

    // 5. Generate signed JWT token
    const token = generateToken(user);

    console.log(`[JWT-AUTH] ✓ Authenticated "${user.email}" with JWT token`);

    return res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        lastLogin: user.lastLogin,
      },
    });
  } catch (err) {
    console.error("[JWT-AUTH] Login error:", err);
    return res.status(500).json({ success: false, message: "Internal server error during login." });
  }
});

/**
 * POST /api/auth/register
 * Registers a new user account in MongoDB & returns signed JWT
 */
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role = "admin", phone = "" } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPassword = String(password).trim();
    const cleanName = String(name || "Shopkeeper Admin").trim();

    if (cleanPassword.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
    }

    // Check if user already exists
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(400).json({ success: false, message: "An account with this email already exists." });
    }

    const newUser = new User({
      name: cleanName,
      email: cleanEmail,
      password: cleanPassword,
      role: role === "staff" ? "staff" : "admin",
      phone: String(phone).trim(),
    });

    await newUser.save();
    console.log(`[JWT-AUTH] ✓ Registered user "${cleanEmail}" in MongoDB`);

    // Generate signed JWT
    const token = generateToken(newUser);

    return res.status(201).json({
      success: true,
      message: "Account created successfully.",
      token,
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (err) {
    console.error("[JWT-AUTH] Registration error:", err);
    return res.status(500).json({ success: false, message: "Failed to create user account." });
  }
});

/**
 * GET /api/auth/verify / GET /api/auth/me
 * Validates JWT token and returns fresh user record from DB
 */
router.get("/verify", protect, (req, res) => {
  return res.json({
    valid: true,
    success: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      phone: req.user.phone,
      lastLogin: req.user.lastLogin,
    },
  });
});

router.get("/me", protect, (req, res) => {
  return res.json({
    success: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      phone: req.user.phone,
      lastLogin: req.user.lastLogin,
    },
  });
});

/**
 * POST /api/auth/change-password
 * Changes password in database for protected authenticated user
 */
router.post("/change-password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current and new passwords are required." });
    }

    if (String(newPassword).trim().length < 6) {
      return res.status(400).json({ success: false, message: "New password must be at least 6 characters long." });
    }

    // Need user with password field to compare
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Current password is incorrect." });
    }

    user.password = String(newPassword).trim();
    await user.save();

    console.log(`[JWT-AUTH] ✓ Password changed for "${user.email}"`);
    return res.json({ success: true, message: "Password updated successfully." });
  } catch (err) {
    console.error("[JWT-AUTH] Change password error:", err);
    return res.status(500).json({ success: false, message: "Failed to update password." });
  }
});

/**
 * GET /api/auth/users
 * Admin-only route to list registered users
 */
router.get("/users", protect, authorize("admin"), async (req, res) => {
  try {
    const users = await User.find({}, "name email role phone isActive lastLogin createdAt").sort({ createdAt: 1 });
    return res.json({ success: true, users });
  } catch (err) {
    console.error("[JWT-AUTH] List users error:", err);
    return res.status(500).json({ success: false, message: "Failed to list users." });
  }
});

/**
 * POST /api/auth/logout
 */
router.post("/logout", (req, res) => {
  return res.json({ success: true, message: "Logged out successfully." });
});

module.exports = router;

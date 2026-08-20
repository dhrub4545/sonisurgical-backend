const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "medical_shop_jwt_secure_super_secret_key_2026_x89f";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

/**
 * Generate signed JWT token with user identity and role
 */
function generateToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      role: user.role || "admin",
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * JWT Authentication Guard
 * Extracts and verifies JWT from 'Authorization: Bearer <token>' or 'x-auth-session'
 */
async function protect(req, res, next) {
  try {
    let token = null;

    // Check standard Authorization header
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (req.headers["x-auth-session"]) {
      token = req.headers["x-auth-session"];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token || token === "null" || token === "undefined") {
      return res.status(401).json({
        success: false,
        message: "Access denied. Authentication token required.",
      });
    }

    // Verify token cryptographically
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          expired: true,
          message: "Session has expired. Please log in again.",
        });
      }
      return res.status(401).json({
        success: false,
        message: "Invalid or malformed authorization token.",
      });
    }

    // Verify user exists and is active in MongoDB
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User account no longer exists in database.",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Your account has been deactivated. Please contact admin.",
      });
    }

    // Attach validated DB user to request
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    console.error("[JWT-AUTH] Middleware error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error during authentication verification.",
    });
  }
}

/**
 * Role-Based Access Control (RBAC) Guard
 * e.g. authorize('admin'), authorize('admin', 'staff')
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: '${req.user.role}' role does not have permission for this resource.`,
      });
    }

    next();
  };
}

module.exports = {
  generateToken,
  protect,
  authorize,
  JWT_SECRET,
};

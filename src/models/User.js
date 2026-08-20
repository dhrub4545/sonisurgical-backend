const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      default: "Shopkeeper Admin",
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    role: {
      type: String,
      enum: ["admin", "staff"],
      default: "admin",
    },
    phone: {
      type: String,
      trim: true,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Pre-save hook to hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!candidatePassword || !this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// Seed default admin if no users exist in database
userSchema.statics.seedDefaultAdmin = async function () {
  try {
    const count = await this.countDocuments();
    const defaultEmail = (process.env.ADMIN_EMAIL || "panditdhrib0@gmail.com").trim().toLowerCase();
    const defaultPassword = (process.env.ADMIN_PASSWORD || "Dhrubdcy@123").trim();

    if (count === 0) {
      console.log(`[USER] No users found in database. Seeding default admin (${defaultEmail})...`);
      const defaultUser = new this({
        name: "Shopkeeper Admin",
        email: defaultEmail,
        password: defaultPassword,
        role: "admin",
      });
      await defaultUser.save();
      console.log(`[USER] ✓ Default admin seeded successfully: ${defaultEmail}`);
    } else {
      // Ensure primary admin account exists
      const existing = await this.findOne({ email: defaultEmail });
      if (!existing) {
        console.log(`[USER] Creating primary admin (${defaultEmail}) in database...`);
        const adminUser = new this({
          name: "Shopkeeper Admin",
          email: defaultEmail,
          password: defaultPassword,
          role: "admin",
        });
        await adminUser.save();
        console.log(`[USER] ✓ Primary admin created: ${defaultEmail}`);
      }
    }
  } catch (err) {
    console.error("[USER] Error seeding default admin:", err.message);
  }
};

module.exports = mongoose.model("User", userSchema);

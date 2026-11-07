const express = require("express");
const mongoose = require("mongoose");
const Person = require("../models/Person");
const Transaction = require("../models/Transaction");
const { recalculatePersonBalance, calculateSettlementStatus } = require("../utils/ledgerService");
const { protect } = require("../middleware/auth");
const { escapeRegex, sanitizeString } = require("../utils/securityUtils");
const CacheService = require("../utils/cacheService");

const router = express.Router();

// Apply JWT authentication guard to all persons endpoints
router.use(protect);

// List of known vendor names (as safeguard fallback)
const KNOWN_VENDORS = [
  "dhanusha medico",
  "kunal pharma",
  "samiksha pharmacy",
  "sumitra vet pharma",
];

function isVendorName(name) {
  if (!name || typeof name !== "string") return false;
  const lower = name.trim().toLowerCase();
  return KNOWN_VENDORS.some((v) => lower.includes(v) || v.includes(lower));
}

// Helper to format person with backward-compatible risk object, default section and accountType
function formatPerson(p) {
  const doc = p.toObject ? p.toObject() : p;
  const isHome =
    doc.section === "home" ||
    (typeof doc.tole === "string" && doc.tole.includes("[Home]")) ||
    (typeof doc.rootName === "string" && doc.rootName.includes("[Home]"));
  const isVendor =
    doc.accountType === "vendor" || isVendorName(doc.name);

  return {
    ...doc,
    section: isHome ? "home" : "market",
    accountType: isVendor ? "vendor" : (doc.accountType || "customer"),
    risk: {
      status: doc.riskStatus || "clear",
      label: doc.riskLabel || "Clear",
      monthsInactive: doc.riskMonths || 0,
    },
  };
}

// POST /api/persons — create person or vendor
router.post("/", async (req, res, next) => {
  try {
    const {
      name,
      rootName = "",
      tole = "",
      phone = "",
      section = "market",
      accountType = "customer",
    } = req.body;
    const cleanName = sanitizeString(name, 100);
    if (!cleanName) {
      return res.status(400).json({ message: "Name is required" });
    }
    const cleanTole = sanitizeString(tole, 100);
    const isHome =
      String(section).toLowerCase() === "home" ||
      cleanTole.includes("[Home]");
    const targetSection = isHome ? "home" : "market";
    const targetAccountType =
      String(accountType).toLowerCase() === "vendor" || isVendorName(cleanName)
        ? "vendor"
        : "customer";

    const person = await Person.create({
      name: cleanName,
      rootName: sanitizeString(rootName, 100),
      tole: cleanTole,
      phone: sanitizeString(phone, 30),
      section: targetSection,
      accountType: targetAccountType,
      totalPurchases: 0,
      totalPaid: 0,
      totalDue: 0,
      riskStatus: "clear",
      riskLabel: "Clear",
      riskMonths: 0,
      transactionCount: 0,
    });
    // Invalidate cached person lists & stats
    await CacheService.invalidateGroup("persons");
    res.status(201).json(formatPerson(person));
  } catch (err) {
    next(err);
  }
});

// GET /api/persons — high-performance indexed search & list with optional pagination
router.get("/", CacheService.cacheMiddleware("persons", 60), async (req, res, next) => {
  try {
    const {
      search = "",
      filter = "",
      section = "",
      accountType = "",
      page = 1,
      limit = 100,
      sort = "name",
    } = req.query;

    const query = {};
    const andClauses = [];

    // Safely escaped indexed search across name, rootName, tole, phone
    const cleanSearch = sanitizeString(search, 100);
    if (cleanSearch) {
      const escaped = escapeRegex(cleanSearch);
      andClauses.push({
        $or: [
          { name: { $regex: escaped, $options: "i" } },
          { rootName: { $regex: escaped, $options: "i" } },
          { tole: { $regex: escaped, $options: "i" } },
          { phone: { $regex: escaped, $options: "i" } },
        ],
      });
    }

    // Account type filtering: "vendor" vs "customer"
    if (accountType === "vendor") {
      andClauses.push({
        $or: [
          { accountType: "vendor" },
          { name: { $in: [ /dhanusha medico/i, /kunal pharma/i, /samiksha pharmacy/i, /sumitra vet pharma/i ] } },
        ],
      });
    } else if (accountType === "customer") {
      andClauses.push({
        accountType: { $ne: "vendor" },
        name: { $nin: [ /dhanusha medico/i, /kunal pharma/i, /samiksha pharmacy/i, /sumitra vet pharma/i ] },
      });
    }

    // Section filtering: ONLY apply for customers; vendors are common across Market & Home.
    if (accountType !== "vendor") {
      if (section === "home") {
        andClauses.push({
          $or: [
            { section: "home" },
            { tole: { $regex: "\\[Home\\]", $options: "i" } },
          ],
        });
      } else if (section === "market") {
        andClauses.push({
          $and: [
            { section: { $ne: "home" } },
            { tole: { $not: { $regex: "\\[Home\\]", $options: "i" } } },
          ],
        });
      }
    }

    if (andClauses.length > 0) {
      query.$and = andClauses;
    }

    // Filter
    if (filter === "due") {
      query.totalDue = { $gt: 0 };
    } else if (filter === "risk") {
      query.riskStatus = { $in: ["high_risk", "blacklisted"] };
    } else if (filter === "clear") {
      query.totalDue = { $lte: 0 };
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
    const skip = (pageNum - 1) * limitNum;

    let sortObj = { name: 1 };
    if (sort === "due_desc") sortObj = { totalDue: -1, name: 1 };
    if (sort === "recent") sortObj = { updatedAt: -1 };

    const [persons, totalCount] = await Promise.all([
      Person.find(query).sort(sortObj).skip(skip).limit(limitNum).lean(),
      Person.countDocuments(query),
    ]);

    res.set("X-Total-Count", String(totalCount));
    res.set("X-Page", String(pageNum));
    res.set("X-Total-Pages", String(Math.ceil(totalCount / limitNum)));

    res.json(persons.map(formatPerson));
  } catch (err) {
    next(err);
  }
});

// GET /api/persons/leaderboard — O(1) indexed query sorted by total due
router.get("/leaderboard", CacheService.cacheMiddleware("persons", 60), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, section = "", accountType = "" } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const query = { totalDue: { $gt: 0 } };
    const andClauses = [];

    if (accountType === "vendor") {
      andClauses.push({
        $or: [
          { accountType: "vendor" },
          { name: { $in: [ /dhanusha medico/i, /kunal pharma/i, /samiksha pharmacy/i, /sumitra vet pharma/i ] } },
        ],
      });
    } else if (accountType === "customer") {
      andClauses.push({
        accountType: { $ne: "vendor" },
        name: { $nin: [ /dhanusha medico/i, /kunal pharma/i, /samiksha pharmacy/i, /sumitra vet pharma/i ] },
      });
    }

    if (accountType !== "vendor") {
      if (section === "home") {
        andClauses.push({
          $or: [
            { section: "home" },
            { tole: { $regex: "\\[Home\\]", $options: "i" } },
          ],
        });
      } else if (section === "market") {
        andClauses.push({
          $and: [
            { section: { $ne: "home" } },
            { tole: { $not: { $regex: "\\[Home\\]", $options: "i" } } },
          ],
        });
      }
    }

    if (andClauses.length > 0) {
      query.$and = andClauses;
    }

    const [persons, totalCount] = await Promise.all([
      Person.find(query)
        .sort({ totalDue: -1, name: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Person.countDocuments(query),
    ]);

    const list = persons.map((p, idx) => ({
      rank: skip + idx + 1,
      ...formatPerson(p),
    }));

    res.set("X-Total-Count", String(totalCount));
    res.set("X-Page", String(pageNum));
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// GET /api/persons/risk — O(1) indexed query for risk categories
router.get("/risk", CacheService.cacheMiddleware("persons", 60), async (req, res, next) => {
  try {
    const { level, page = 1, limit = 50, section = "", accountType = "" } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const query = { totalDue: { $gt: 0 } };
    const andClauses = [];

    if (level) {
      query.riskStatus = level;
    }

    if (accountType === "vendor") {
      andClauses.push({
        $or: [
          { accountType: "vendor" },
          { name: { $in: [ /dhanusha medico/i, /kunal pharma/i, /samiksha pharmacy/i, /sumitra vet pharma/i ] } },
        ],
      });
    } else if (accountType === "customer") {
      andClauses.push({
        accountType: { $ne: "vendor" },
        name: { $nin: [ /dhanusha medico/i, /kunal pharma/i, /samiksha pharmacy/i, /sumitra vet pharma/i ] },
      });
    }

    if (accountType !== "vendor") {
      if (section === "home") {
        andClauses.push({
          $or: [
            { section: "home" },
            { tole: { $regex: "\\[Home\\]", $options: "i" } },
          ],
        });
      } else if (section === "market") {
        andClauses.push({
          $and: [
            { section: { $ne: "home" } },
            { tole: { $not: { $regex: "\\[Home\\]", $options: "i" } } },
          ],
        });
      }
    }

    if (andClauses.length > 0) {
      query.$and = andClauses;
    }

    const [persons, totalCount] = await Promise.all([
      Person.find(query)
        .sort({ totalDue: -1, name: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Person.countDocuments(query),
    ]);

    res.set("X-Total-Count", String(totalCount));
    res.json(persons.map(formatPerson));
  } catch (err) {
    next(err);
  }
});

// GET /api/persons/:id — get person details
router.get("/:id", CacheService.cacheMiddleware("persons", 60), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid person id" });
    }
    const person = await Person.findById(req.params.id).lean();
    if (!person) return res.status(404).json({ message: "Person not found" });
    const settlement = await calculateSettlementStatus(person._id);
    res.json({
      ...formatPerson(person),
      settlement,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/persons/:id — update person info
router.put("/:id", async (req, res, next) => {
  try {
    const { name, rootName = "", tole = "", phone = "", section, accountType } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Name is required" });
    }
    const updates = {
      name: name.trim(),
      rootName: (rootName || "").trim(),
      tole: (tole || "").trim(),
      phone: (phone || "").trim(),
    };
    if (section && ["market", "home"].includes(String(section).toLowerCase())) {
      updates.section = String(section).toLowerCase();
    }
    if (accountType && ["customer", "vendor"].includes(String(accountType).toLowerCase())) {
      updates.accountType = String(accountType).toLowerCase();
    }
    const person = await Person.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: false,
    });
    if (!person) return res.status(404).json({ message: "Person not found" });
    // Invalidate persons cache
    await CacheService.invalidateGroup("persons");
    res.json(formatPerson(person));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/persons/:id — delete person and transactions
router.delete("/:id", async (req, res, next) => {
  try {
    const person = await Person.findByIdAndDelete(req.params.id);
    if (!person) return res.status(404).json({ message: "Person not found" });
    await Transaction.deleteMany({ person: person._id });
    // Invalidate persons & transactions cache
    await Promise.all([
      CacheService.invalidateGroup("persons"),
      CacheService.invalidateGroup("transactions"),
    ]);
    res.json({ message: "Person and their transactions deleted" });
  } catch (err) {
    next(err);
  }
});

// POST /api/persons/:id/recalculate — manual reconciliation helper
router.post("/:id/recalculate", async (req, res, next) => {
  try {
    const person = await recalculatePersonBalance(req.params.id);
    if (!person) return res.status(404).json({ message: "Person not found" });
    // Invalidate persons cache
    await CacheService.invalidateGroup("persons");
    res.json(formatPerson(person));
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const express = require("express");
const mongoose = require("mongoose");
const Medicine = require("../models/Medicine");
const {
  getMedicineNameSuggestions,
  addMedicineName,
  syncFromDatabase,
} = require("../utils/medicineNamesService");
const { getDaysUntilExpiry } = require("../utils/nepaliDate");
const { protect } = require("../middleware/auth");
const { escapeRegex, sanitizeString, parsePositiveNumber } = require("../utils/securityUtils");

const router = express.Router();

// Apply JWT authentication guard to all medicine endpoints
router.use(protect);

// Initial starter dataset of popular pharmacy medicines
const SEED_MEDICINES = [
  {
    name: "Paracetamol 500mg",
    genericName: "Acetaminophen",
    category: "Analgesic",
    stockQuantity: 120,
    unit: "tablets",
    unitPrice: 3,
    costPrice: 1.8,
    lowStockThreshold: 25,
    batchNumber: "PAR-2025-01",
    expiryDate: "2083-06-15",
    rackLocation: "Shelf A-1",
    description: "Fever and mild to moderate pain relief",
  },
  {
    name: "Amoxicillin 500mg",
    genericName: "Amoxicillin Trihydrate",
    category: "Antibiotic",
    stockQuantity: 45,
    unit: "capsules",
    unitPrice: 12,
    costPrice: 8.5,
    lowStockThreshold: 20,
    batchNumber: "AMX-2024-11",
    expiryDate: "2083-02-28",
    rackLocation: "Shelf B-2",
    description: "Broad-spectrum penicillin antibiotic",
  },
  {
    name: "Cetirizine 10mg",
    genericName: "Cetirizine Hydrochloride",
    category: "Tablet",
    stockQuantity: 80,
    unit: "tablets",
    unitPrice: 4,
    costPrice: 2.2,
    lowStockThreshold: 20,
    batchNumber: "CET-2025-03",
    expiryDate: "2084-01-10",
    rackLocation: "Shelf A-2",
    description: "Antihistamine for allergic rhinitis, itching & runny nose",
  },
  {
    name: "Pantoprazole 40mg",
    genericName: "Pantoprazole Sodium",
    category: "Antacid",
    stockQuantity: 65,
    unit: "tablets",
    unitPrice: 10,
    costPrice: 6.5,
    lowStockThreshold: 15,
    batchNumber: "PAN-2025-02",
    expiryDate: "2083-11-20",
    rackLocation: "Shelf C-1",
    description: "Proton pump inhibitor for gastritis, GERD & acidity",
  },
  {
    name: "Azithromycin 500mg",
    genericName: "Azithromycin",
    category: "Antibiotic",
    stockQuantity: 12,
    unit: "tablets",
    unitPrice: 35,
    costPrice: 24,
    lowStockThreshold: 15,
    batchNumber: "AZI-2024-09",
    expiryDate: "2082-12-30",
    rackLocation: "Shelf B-1",
    description: "Macrolide antibiotic for respiratory & throat infections",
  },
  {
    name: "Metformin 500mg",
    genericName: "Metformin Hydrochloride",
    category: "Antidiabetic",
    stockQuantity: 90,
    unit: "tablets",
    unitPrice: 6,
    costPrice: 3.8,
    lowStockThreshold: 25,
    batchNumber: "MET-2025-04",
    expiryDate: "2083-09-15",
    rackLocation: "Shelf D-2",
    description: "Blood sugar control for Type 2 Diabetes",
  },
  {
    name: "Amlodipine 5mg",
    genericName: "Amlodipine Besylate",
    category: "Cardiovascular",
    stockQuantity: 70,
    unit: "tablets",
    unitPrice: 5,
    costPrice: 3.0,
    lowStockThreshold: 20,
    batchNumber: "AML-2025-05",
    expiryDate: "2084-03-01",
    rackLocation: "Shelf D-1",
    description: "Calcium channel blocker for hypertension & angina",
  },
  {
    name: "Ibuprofen 400mg",
    genericName: "Ibuprofen",
    category: "Analgesic",
    stockQuantity: 8,
    unit: "tablets",
    unitPrice: 5,
    costPrice: 2.8,
    lowStockThreshold: 20,
    batchNumber: "IBU-2024-10",
    expiryDate: "2082-11-15",
    rackLocation: "Shelf A-3",
    description: "NSAID painkiller & anti-inflammatory",
  },
  {
    name: "Cough Syrup Dextromethorphan",
    genericName: "Dextromethorphan HBr",
    category: "Syrup",
    stockQuantity: 18,
    unit: "bottles",
    unitPrice: 110,
    costPrice: 75,
    lowStockThreshold: 10,
    batchNumber: "CS-2025-02",
    expiryDate: "2083-05-10",
    rackLocation: "Shelf E-1",
    description: "Dry cough suppressant syrup 100ml",
  },
  {
    name: "ORS Electrolyte Sachet",
    genericName: "Oral Rehydration Salts",
    category: "Sachet",
    stockQuantity: 150,
    unit: "sachets",
    unitPrice: 15,
    costPrice: 9.5,
    lowStockThreshold: 30,
    batchNumber: "ORS-2025-06",
    expiryDate: "2084-08-30",
    rackLocation: "Shelf F-1",
    description: "WHO recommended formula for dehydration & diarrhea",
  },
];

// POST /api/medicines/seed — on-demand starter medicines population
router.post("/seed", async (req, res, next) => {
  try {
    const existing = await Medicine.countDocuments();
    if (existing > 0) {
      return res.json({ message: "Inventory already has medicines", count: existing });
    }
    const inserted = await Medicine.insertMany(SEED_MEDICINES);
    res.json({ message: "Seeded initial medicine catalog", count: inserted.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/medicines/stats — Overview stats
router.get("/stats", async (req, res, next) => {
  try {
    const medicines = await Medicine.find();
    let totalItems = medicines.length;
    let totalQuantity = 0;
    let totalValue = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let expiringCount = 0;

    for (const m of medicines) {
      const stock = m.stockQuantity || 0;
      totalQuantity += stock;
      totalValue += stock * (m.costPrice || m.unitPrice || 0);
      if (stock <= 0) {
        outOfStockCount++;
      } else if (stock <= (m.lowStockThreshold || 15)) {
        lowStockCount++;
      }

      // Check if expiring in <= 60 days
      if (stock > 0 && m.expiryDate) {
        const daysLeft = getDaysUntilExpiry(m.expiryDate);
        if (daysLeft !== null && daysLeft <= 60) {
          expiringCount++;
        }
      }
    }

    res.json({
      totalItems,
      totalQuantity,
      totalValue: Math.round(totalValue),
      lowStockCount,
      outOfStockCount,
      expiringCount,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/medicines — list / search / filter
router.get("/", async (req, res, next) => {
  try {
    const {
      search = "",
      category = "",
      lowStock = "",
      expiringSoon = "",
      sort = "name",
    } = req.query;

    const query = {};
    const cleanSearch = sanitizeString(search, 100);
    if (cleanSearch) {
      const escaped = escapeRegex(cleanSearch);
      query.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { genericName: { $regex: escaped, $options: "i" } },
        { rackLocation: { $regex: escaped, $options: "i" } },
        { batchNumber: { $regex: escaped, $options: "i" } },
      ];
    }

    if (category && category !== "All" && category !== "Low Stock ⚠️" && category !== "Expiring Soon ⏳") {
      query.category = sanitizeString(category, 50);
    }

    let list = await Medicine.find(query).lean();

    // Attach computed expiry metrics to each item
    list = list.map((m) => {
      const daysLeft = getDaysUntilExpiry(m.expiryDate);
      const isExpiring =
        (m.stockQuantity || 0) > 0 && daysLeft !== null && daysLeft <= 60;
      return {
        ...m,
        daysUntilExpiry: daysLeft,
        isExpiringSoon: isExpiring,
      };
    });

    if (lowStock === "true") {
      list = list.filter((m) => m.stockQuantity <= (m.lowStockThreshold || 15));
    }

    if (expiringSoon === "true") {
      list = list.filter((m) => m.isExpiringSoon);
    }

    // Sort
    if (sort === "stock_asc") {
      list.sort((a, b) => a.stockQuantity - b.stockQuantity);
    } else if (sort === "stock_desc") {
      list.sort((a, b) => b.stockQuantity - a.stockQuantity);
    } else if (sort === "expiry_asc") {
      list.sort((a, b) => (a.daysUntilExpiry ?? 99999) - (b.daysUntilExpiry ?? 99999));
    } else if (sort === "recent") {
      list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    res.json(list);
  } catch (err) {
    next(err);
  }
});

// GET /api/medicines/suggestions?query=... — fast autocomplete suggestions from MongoDB
router.get("/suggestions", async (req, res, next) => {
  try {
    const { query = "", limit = 15 } = req.query;
    const suggestions = await getMedicineNameSuggestions(
      String(query),
      Math.min(50, Math.max(1, parseInt(limit, 10) || 15))
    );
    res.json(suggestions);
  } catch (err) {
    next(err);
  }
});

// GET /api/medicines/:id — single medicine detail
router.get("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid medicine id" });
    }
    const medicine = await Medicine.findById(req.params.id);
    if (!medicine) return res.status(404).json({ message: "Medicine not found" });
    res.json(medicine);
  } catch (err) {
    next(err);
  }
});

// POST /api/medicines — create new medicine
router.post("/", async (req, res, next) => {
  try {
    const {
      name,
      genericName = "",
      category = "Tablet",
      stockQuantity = 0,
      unit = "tablets",
      unitPrice = 0,
      costPrice = 0,
      lowStockThreshold = 15,
      batchNumber = "",
      expiryDate = "",
      rackLocation = "",
      description = "",
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Medicine name is required" });
    }

    const medicine = await Medicine.create({
      name: name.trim(),
      genericName: genericName.trim(),
      category,
      stockQuantity: Math.max(0, Number(stockQuantity) || 0),
      unit: unit.trim() || "tablets",
      unitPrice: Math.max(0, Number(unitPrice) || 0),
      costPrice: Math.max(0, Number(costPrice) || 0),
      lowStockThreshold: Math.max(1, Number(lowStockThreshold) || 15),
      batchNumber: batchNumber.trim(),
      expiryDate: expiryDate.trim(),
      rackLocation: rackLocation.trim(),
      description: description.trim(),
    });

    // Auto-append new medicine name to MongoDB MedicineSuggestion collection
    await addMedicineName(medicine.name);

    res.status(201).json(medicine);
  } catch (err) {
    next(err);
  }
});

// PUT /api/medicines/:id — update medicine
router.put("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid medicine id" });
    }

    const {
      name,
      genericName,
      category,
      stockQuantity,
      unit,
      unitPrice,
      costPrice,
      lowStockThreshold,
      batchNumber,
      expiryDate,
      rackLocation,
      description,
    } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (genericName !== undefined) updates.genericName = genericName.trim();
    if (category !== undefined) updates.category = category;
    if (stockQuantity !== undefined) updates.stockQuantity = Math.max(0, Number(stockQuantity) || 0);
    if (unit !== undefined) updates.unit = unit.trim();
    if (unitPrice !== undefined) updates.unitPrice = Math.max(0, Number(unitPrice) || 0);
    if (costPrice !== undefined) updates.costPrice = Math.max(0, Number(costPrice) || 0);
    if (lowStockThreshold !== undefined)
      updates.lowStockThreshold = Math.max(1, Number(lowStockThreshold) || 15);
    if (batchNumber !== undefined) updates.batchNumber = batchNumber.trim();
    if (expiryDate !== undefined) updates.expiryDate = expiryDate.trim();
    if (rackLocation !== undefined) updates.rackLocation = rackLocation.trim();
    if (description !== undefined) updates.description = description.trim();

    const updated = await Medicine.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    if (!updated) return res.status(404).json({ message: "Medicine not found" });

    // Auto-sync name to MongoDB if updated
    if (updated.name) {
      await addMedicineName(updated.name);
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/medicines/:id/adjust-stock — quick stock adjustment (+ / - delta or direct set)
router.post("/:id/adjust-stock", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid medicine id" });
    }

    const { delta, newQuantity } = req.body;
    const medicine = await Medicine.findById(req.params.id);
    if (!medicine) return res.status(404).json({ message: "Medicine not found" });

    let finalStock = medicine.stockQuantity;
    if (newQuantity !== undefined) {
      finalStock = Math.max(0, Number(newQuantity) || 0);
    } else if (delta !== undefined) {
      finalStock = Math.max(0, medicine.stockQuantity + Number(delta));
    }

    medicine.stockQuantity = finalStock;
    await medicine.save();

    res.json(medicine);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/medicines/:id — delete medicine
router.delete("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid medicine id" });
    }

    const deleted = await Medicine.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Medicine not found" });

    res.json({ message: "Medicine removed from inventory", id: req.params.id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

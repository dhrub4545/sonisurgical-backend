const MedicineSuggestion = require("../models/MedicineSuggestion");
const Medicine = require("../models/Medicine");

// Starter list of common pharmacy & veterinary medicine names to seed into MongoDB
const INITIAL_MEDICINE_NAMES = [
  "Paracetamol 500mg",
  "Paracetamol 650mg",
  "Paracetamol Syrup",
  "Pantoprazole 40mg",
  "Pantoprazole DSR",
  "Amoxicillin 500mg",
  "Amoxicillin 250mg",
  "Amoxicillin & Potassium Clavulanate (Augmentin 625mg)",
  "Amoxicillin Syrup",
  "Azithromycin 500mg",
  "Azithromycin 250mg",
  "Cetirizine 10mg",
  "Levocetirizine 5mg",
  "Montelukast & Levocetirizine (Montair-LC)",
  "Metformin 500mg",
  "Metformin 850mg",
  "Glimepiride 1mg",
  "Glimepiride 2mg",
  "Ciprofloxacin 500mg",
  "Ofloxacin 200mg",
  "Ofloxacin & Ornidazole (O2)",
  "Ibuprofen 400mg",
  "Ibuprofen & Paracetamol (Combiflam)",
  "Omeprazole 20mg",
  "Rabeprazole 20mg",
  "Amlodipine 5mg",
  "Telmisartan 40mg",
  "Losartan 50mg",
  "Atenolol 50mg",
  "Diclofenac Sodium 50mg",
  "Diclofenac Gel",
  "Aceclofenac & Paracetamol (Zerodol-P)",
  "Doxycycline 100mg",
  "Metronidazole 400mg",
  "Cefixime 200mg",
  "Ceftriaxone 1g Vial Injection",
  "Ceftriaxone 500mg Vial",
  "Ceftriaxone 250mg Vial",
  "Gentamicin 80mg Vial",
  "Amikacin 500mg Vial",
  "Dexamethasone 2ml Vial",
  "Hydrocortisone 100mg Vial",
  "Tramadol 2ml Vial",
  "Diclofenac 2ml Ampoule",
  "B-Complex 2ml Vial",
  "Tetanus Toxoid 0.5ml",
  "Insulin Human Regular (Mixtard / Actrapid)",
  "Oral Rehydration Salts (ORS) Sachet",
  "Cough Syrup (Ascoril-D)",
  "Cough Syrup (Chericof)",
  "Cough Syrup (Benadryl DR)",
  "Cough Syrup (Grilinctus)",
  "Digestive Enzyme Syrup (Aristozyme)",
  "Antacid Syrup (Gelusil / Digene)",
  "Iron & Folic Acid Syrup (Dexorange)",
  "Calcium & Vitamin D3 Syrup",
  "Multivitamin & Zinc Syrup",
  "Povidone Iodine Ointment (Betadine 5%)",
  "Povidone Iodine Ointment (Betadine 10%)",
  "Silver Sulfadiazine Cream (Burnol / Silvazine)",
  "Framycetin Ointment (Soframycin)",
  "Neomycin & Polymyxin Ointment (Neosporin)",
  "Clotrimazole Ointment (Candid-B)",
  "Mupirocin 2% Ointment (T-Bact)",
  "Diclofenac & Linseed Oil Gel (Volini / Moov)",
  "Hydrocortisone 1% Cream",
  "Clobetasol Propionate Cream (Tenovate)",
  "Ketoconazole 2% Cream",
  "Calamine Lotion",
  "Albendazole 400mg Chewable",
  "Albendazole Oral Suspension",
  "Oxytetracycline 50mg/ml Veterinary Vial",
  "Ivermectin 10mg Veterinary Injection",
  "Meloxicam 5mg/ml Veterinary Vial",
  "Enrofloxacin 10% Veterinary Liquid",
  "Fenbendazole Veterinary Bolus",
  "Vitamin H (Biotin) Veterinary Supplement"
];

/**
 * Searches and returns matching medicine name suggestions directly from MongoDB.
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<string[]>}
 */
async function getMedicineNameSuggestions(query = "", limit = 15) {
  try {
    const q = query ? query.trim() : "";
    if (!q) {
      const items = await MedicineSuggestion.find()
        .sort({ name: 1 })
        .limit(limit)
        .lean();
      return items.map((i) => i.name);
    }

    // Escape regex special characters
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // 1. Fetch prefix matches
    const prefixMatches = await MedicineSuggestion.find({
      name: { $regex: `^${escaped}`, $options: "i" },
    })
      .sort({ name: 1 })
      .limit(limit)
      .lean();

    const result = prefixMatches.map((i) => i.name);

    // 2. If fewer than limit, fetch substring matches
    if (result.length < limit) {
      const needed = limit - result.length;
      const subMatches = await MedicineSuggestion.find({
        $and: [
          { name: { $regex: escaped, $options: "i" } },
          { name: { $nin: result } },
        ],
      })
        .sort({ name: 1 })
        .limit(needed)
        .lean();

      result.push(...subMatches.map((i) => i.name));
    }

    return result;
  } catch (err) {
    console.error("Error fetching medicine suggestions from MongoDB:", err.message);
    return [];
  }
}

/**
 * Adds a new medicine name to the MongoDB MedicineSuggestion collection if not already present.
 * @param {string} rawName
 * @returns {Promise<boolean>}
 */
async function addMedicineName(rawName) {
  if (!rawName || typeof rawName !== "string") return false;
  const name = rawName.trim();
  if (!name) return false;

  try {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const existing = await MedicineSuggestion.findOne({
      name: { $regex: `^${escaped}$`, $options: "i" },
    });

    if (!existing) {
      await MedicineSuggestion.create({ name });
      return true;
    }
    return false;
  } catch (err) {
    // Ignore duplicate key error (code 11000)
    if (err.code === 11000) return false;
    console.error("Error adding medicine name to MongoDB:", err.message);
    return false;
  }
}

/**
 * Seeds starter names and syncs registered medicines from MongoDB on startup.
 */
async function syncFromDatabase() {
  try {
    const count = await MedicineSuggestion.countDocuments();
    if (count === 0) {
      console.log("Seeding initial medicine names collection in MongoDB...");
      const docs = INITIAL_MEDICINE_NAMES.map((name) => ({ name }));
      try {
        await MedicineSuggestion.insertMany(docs, { ordered: false });
      } catch (e) {
        // Ignore any duplicate inserts
      }
    }

    // Also sync all existing registered medicines from the Medicine collection
    const registeredMeds = await Medicine.find({}, "name").lean();
    for (const med of registeredMeds) {
      if (med.name) {
        await addMedicineName(med.name);
      }
    }
    const finalCount = await MedicineSuggestion.countDocuments();
    console.log(`MedicineSuggestion collection active in MongoDB (${finalCount} medicine names).`);
  } catch (err) {
    console.error("Error syncing MedicineSuggestion in MongoDB:", err.message);
  }
}

module.exports = {
  getMedicineNameSuggestions,
  addMedicineName,
  syncFromDatabase,
};

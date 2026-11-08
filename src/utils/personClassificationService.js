const Person = require("../models/Person");
const CacheService = require("./cacheService");

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

/**
 * Ensures all person documents in MongoDB have accountType and section populated.
 * Only sets missing or empty fields without altering any other data.
 */
async function syncPersonClassifications() {
  try {
    const unclassified = await Person.find({
      $or: [
        { accountType: { $exists: false } },
        { accountType: null },
        { accountType: "" },
        { section: { $exists: false } },
        { section: null },
        { section: "" },
      ],
    }).lean();

    if (!unclassified || unclassified.length === 0) {
      return { modifiedCount: 0 };
    }

    const bulkOps = unclassified.map((p) => {
      const isVendor = p.accountType === "vendor" || isVendorName(p.name);
      const isHome =
        p.section === "home" ||
        (typeof p.tole === "string" && p.tole.includes("[Home]")) ||
        (typeof p.rootName === "string" && p.rootName.includes("[Home]"));

      const targetAccountType = isVendor ? "vendor" : (p.accountType || "customer");
      const targetSection = isHome ? "home" : "market";

      return {
        updateOne: {
          filter: { _id: p._id },
          update: {
            $set: {
              accountType: targetAccountType,
              section: targetSection,
            },
          },
        },
      };
    });

    if (bulkOps.length > 0) {
      const result = await Person.bulkWrite(bulkOps);
      await CacheService.invalidateGroup("persons");
      console.log(`[CLASSIFICATION] Populated missing accountType & section for ${result.modifiedCount || bulkOps.length} documents.`);
      return { modifiedCount: result.modifiedCount || bulkOps.length };
    }

    return { modifiedCount: 0 };
  } catch (err) {
    console.error("[CLASSIFICATION] Error populating person classifications:", err.message);
    return { error: err.message };
  }
}

module.exports = {
  isVendorName,
  KNOWN_VENDORS,
  syncPersonClassifications,
};

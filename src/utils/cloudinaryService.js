const cloudinary = require("cloudinary").v2;

const cloud_name =
  process.env.cloudanary_name ||
  process.env.CLOUDINARY_CLOUD_NAME ||
  process.env.CLOUDINARY_NAME ||
  "";
const api_key =
  process.env["cloudanary_API-key"] ||
  process.env.cloudanary_api_key ||
  process.env.CLOUDINARY_API_KEY ||
  "";
const api_secret =
  process.env.cloudanary_secret_key ||
  process.env.CLOUDINARY_API_SECRET ||
  process.env.CLOUDINARY_SECRET_KEY ||
  "";

const isConfigured = Boolean(cloud_name && api_key && api_secret);

if (isConfigured) {
  cloudinary.config({
    cloud_name,
    api_key,
    api_secret,
    secure: true,
  });
} else {
  console.warn("[CLOUDINARY] Warning: Cloudinary credentials not fully configured in .env. Photo uploads will be skipped.");
}

/**
 * Upload purchase proof photo to Cloudinary with compression down to ~100-200kb.
 */
async function uploadPurchaseProof(photoBase64OrUri, personId) {
  if (!photoBase64OrUri) return { proofPhotoUrl: null, proofPhotoPublicId: null };

  const dataUri = photoBase64OrUri.startsWith("data:")
    ? photoBase64OrUri
    : `data:image/jpeg;base64,${photoBase64OrUri}`;

  try {
    const result = await cloudinary.uploader.upload(dataUri, {
      folder: "medical_shop_proofs",
      transformation: [
        { width: 1000, height: 1000, crop: "limit", quality: "auto:eco", fetch_format: "auto" },
      ],
      public_id: `proof_${personId}_${Date.now()}`,
      tags: ["medical_shop", `person_${personId}`],
    });

    console.log(`Uploaded compressed proof to Cloudinary: ${result.secure_url} (${result.bytes} bytes)`);
    return {
      proofPhotoUrl: result.secure_url,
      proofPhotoPublicId: result.public_id,
    };
  } catch (err) {
    console.error("Cloudinary upload error:", err.message);
    return { proofPhotoUrl: null, proofPhotoPublicId: null };
  }
}

/**
 * Delete a single proof photo from Cloudinary by public ID.
 */
async function deleteProofPhoto(publicId) {
  if (!publicId) return;
  try {
    const res = await cloudinary.uploader.destroy(publicId);
    console.log(`Cloudinary destroyed photo ${publicId}:`, res?.result);
    return res;
  } catch (err) {
    console.warn(`Failed to delete Cloudinary photo ${publicId}:`, err.message);
  }
}

/**
 * Deletes photos from Cloudinary for all purchases of personId that are fully cleared up-to date.
 */
async function deleteClearedProofPhotos(personId, TransactionModel) {
  try {
    const txns = await TransactionModel.find({ person: personId })
      .sort({ createdAt: 1 });

    let totalPaid = 0;
    const purchases = [];

    for (const t of txns) {
      if (t.type === "payment") {
        totalPaid += t.amount;
      } else if (t.type === "purchase") {
        purchases.push(t);
      }
    }

    let runningPaid = totalPaid;
    for (const p of purchases) {
      if (runningPaid >= p.amount) {
        runningPaid -= p.amount;
        // This purchase is fully cleared!
        if (p.proofPhotoPublicId) {
          console.log(`Deleting cleared proof photo ${p.proofPhotoPublicId} for settled purchase ${p._id}`);
          await deleteProofPhoto(p.proofPhotoPublicId);
          p.proofPhotoPublicId = null;
          p.proofPhotoUrl = null;
          await p.save();
        }
      } else {
        break; // Stop at oldest active/unpaid purchase
      }
    }
  } catch (err) {
    console.error("Error in deleteClearedProofPhotos:", err.message);
  }
}

module.exports = {
  cloudinary,
  uploadPurchaseProof,
  deleteProofPhoto,
  deleteClearedProofPhotos,
};

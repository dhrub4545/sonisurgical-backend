const express = require("express");
const { protect } = require("../middleware/auth");

const router = express.Router();

// Apply JWT authentication guard to AI endpoints
router.use(protect);

// Helper to provide realistic medicine photo URLs for Human, Veterinary, and Herbal drugs
function getMedicinePhotoUrl(name = "", category = "", targetType = "") {
  const n = name.toLowerCase();
  const c = category.toLowerCase();
  const t = (targetType || "").toLowerCase();

  // Veterinary / Animal specific
  if (t.includes("vet") || n.includes("bolus") || n.includes("cattle") || n.includes("livestock") || n.includes("poultry") || n.includes("vet")) {
    if (n.includes("ivermectin") || n.includes("deworm")) {
      return "https://images.unsplash.com/photo-1548767797-d8c844163c4c?w=800&auto=format&fit=crop&q=80";
    }
    if (n.includes("oxytetracycline") || n.includes("inject") || n.includes("la")) {
      return "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800&auto=format&fit=crop&q=80";
    }
    return "https://images.unsplash.com/photo-1548767797-d8c844163c4c?w=800&auto=format&fit=crop&q=80";
  }

  // Human pharmaceuticals
  if (n.includes("paracetamol") || n.includes("acetaminophen") || n.includes("crocin") || n.includes("calpol") || n.includes("dolo")) {
    return "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800&auto=format&fit=crop&q=80";
  }
  if (n.includes("amoxicillin") || n.includes("augmentin") || n.includes("clav") || n.includes("mox")) {
    return "https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=800&auto=format&fit=crop&q=80";
  }
  if (n.includes("cetirizine") || n.includes("zyrtec") || n.includes("okacet") || n.includes("alerid") || n.includes("levocetirizine")) {
    return "https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=800&auto=format&fit=crop&q=80";
  }
  if (n.includes("pantoprazole") || n.includes("pantocid") || n.includes("pan-40") || n.includes("omeprazole") || n.includes("rabeprazole")) {
    return "https://images.unsplash.com/photo-1576602976047-174e57a47881?w=800&auto=format&fit=crop&q=80";
  }
  if (n.includes("azithromycin") || n.includes("azith") || n.includes("zithromax") || n.includes("azi")) {
    return "https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=800&auto=format&fit=crop&q=80";
  }
  if (n.includes("metformin") || n.includes("glycomet") || n.includes("glimepiride") || n.includes("sugar")) {
    return "https://images.unsplash.com/photo-1550572017-edb79a8f2766?w=800&auto=format&fit=crop&q=80";
  }
  if (n.includes("amlodipine") || n.includes("stamlo") || n.includes("amlopres") || n.includes("telmisartan") || n.includes("atenolol")) {
    return "https://images.unsplash.com/photo-1563213126-a4273aed2016?w=800&auto=format&fit=crop&q=80";
  }
  if (n.includes("ibuprofen") || n.includes("brufen") || n.includes("combiflam") || n.includes("diclofenac") || n.includes("aceclofenac")) {
    return "https://images.unsplash.com/photo-1585435557343-3b092031a831?w=800&auto=format&fit=crop&q=80";
  }
  if (n.includes("syrup") || n.includes("cough") || n.includes("dextromethorphan") || n.includes("benadryl") || n.includes("koflet") || n.includes("suspension")) {
    return "https://images.unsplash.com/photo-1631549916768-4119b2e5f926?w=800&auto=format&fit=crop&q=80";
  }
  if (n.includes("ors") || n.includes("electrolyte") || n.includes("sachet") || n.includes("electral") || n.includes("jeevan")) {
    return "https://images.unsplash.com/photo-1607613009820-a29f7bb81c04?w=800&auto=format&fit=crop&q=80";
  }

  // Fallbacks by category
  if (c.includes("syrup") || c.includes("liquid")) {
    return "https://images.unsplash.com/photo-1631549916768-4119b2e5f926?w=800&auto=format&fit=crop&q=80";
  }
  if (c.includes("capsule")) {
    return "https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=800&auto=format&fit=crop&q=80";
  }
  return "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=800&auto=format&fit=crop&q=80";
}

// Function to call Google Gemini API for Universal Medicine Analysis with Multi-Photo support
async function callGeminiExplain({ medicineName = "", context = "", images = [] }) {
  const keys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
  ].filter(Boolean);

  if (keys.length === 0) {
    throw new Error("No GEMINI_API_KEY configured in environment");
  }

  const systemPrompt = `You are an expert clinical pharmacology and veterinary medicine AI assistant for Soni Surgical in Nepal. You evaluate ALL types of medicines: Human pharmaceuticals, Surgical supplies, Veterinary/Animal medicines (cattle, buffalo, sheep, goats, poultry, dogs, cats, horses, pigs), Ayurvedic/Herbal formulations, and OTC products.

Examine the user's medicine query and ALL attached photos (e.g. front packaging, back blister strip, ingredient list, batch/expiry label, bolus/tablet appearance, injectable vial label).

If the input is completely unidentifiable, gibberish, or not a real medicine, set "isAvailable": false and explain politely in "description" and "nepaliExplanation".

Output valid JSON strictly following this schema:
{
  "isAvailable": true or false,
  "name": "Full Trade / Brand Name with Strength (e.g., Ivermectin 100mg Bolus, Amoxicillin 500mg)",
  "genericName": "Active chemical/botanical ingredient formula",
  "category": "Pharmacological / Therapeutic class",
  "targetType": "Target species (e.g., 'Human', 'Veterinary (Cattle & Buffalo)', 'Veterinary (Poultry)', 'Veterinary (Dogs & Cats)', 'Ayurvedic / Herbal', 'Universal')",
  "description": "Clear 2-sentence clinical description of the drug, its classification, and primary purpose.",
  "visualAppearance": {
    "form": "Dosage form (e.g., Tablet, Capsule, Bolus, Injectable Solution, Oral Liquid, Sachet)",
    "color": "Visual appearance, color and shape",
    "packaging": "Packaging format (e.g., Alu-Alu strip of 10, 100ml amber bottle, 4-bolus blister pack)",
    "imprint": "Imprint, score lines, or strength label markings",
    "verificationTips": [
      "Physical inspection check 1 (e.g. Verify packaging seal & tamper evidence)",
      "Physical inspection check 2 (e.g. Check strength & target species appropriateness)",
      "Physical inspection check 3 (e.g. Verify batch number, expiry date, withdrawal period)"
    ]
  },
  "uses": ["Key Indication 1", "Key Indication 2", "Key Indication 3"],
  "dosage": "Clear dosage instructions (human: adult/pediatric guidelines & meal timing; veterinary: weight-based dosage like mg/kg or bolus/animal and route IM/SC/Oral)",
  "sideEffects": ["Common side effect 1", "Side effect 2", "Severe alert"],
  "precautions": ["Important precautions, contraindications, and withdrawal period for milk/meat if food-producing animal"],
  "interactions": ["Important drug or feed interactions to avoid"],
  "nepaliExplanation": "A clear, natural Nepali explanation (देवनागरी लिपि) explaining what the medicine does, how to administer it (मात्रा, समय र विधि), and essential safety rules for the patient or animal owner."
}`;

  let userText = "";
  if (medicineName) {
    userText += `Medicine to explain: "${medicineName}". `;
  }
  if (context) {
    userText += `Additional Context: "${context}". `;
  }
  if (images.length > 0) {
    userText += `Please inspect the ${images.length} attached photo(s) carefully to read the label, formula, strength, and packaging. `;
  }
  userText += `Return valid JSON only.`;

  const parts = [{ text: `${systemPrompt}\n\n${userText}` }];

  // Attach all image parts (multi-photo support)
  for (const img of images) {
    if (img && img.base64) {
      const cleanBase64 = img.base64.replace(/^data:image\/\w+;base64,/, "");
      parts.push({
        inlineData: {
          mimeType: img.mimeType || "image/jpeg",
          data: cleanBase64,
        },
      });
    }
  }

  const GEMINI_MODELS = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
  ];

  let lastError = null;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    for (const model of GEMINI_MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          }),
          signal: AbortSignal.timeout(25000),
        });

        if (!response.ok) {
          const errBody = await response.text();
          console.warn(`Gemini [${model}] Key ${i + 1} returned status ${response.status}:`, errBody.substring(0, 120));
          lastError = new Error(`Model ${model} Key ${i + 1} HTTP ${response.status}: ${errBody}`);
          continue;
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
          lastError = new Error(`Model ${model} Key ${i + 1} returned empty candidate text`);
          continue;
        }

        const parsed = JSON.parse(rawText);
        if (parsed && parsed.name) {
          const photoUrl = getMedicinePhotoUrl(parsed.name, parsed.category, parsed.targetType);
          return {
            ...parsed,
            isAvailable: parsed.isAvailable !== false,
            imageUrl: photoUrl,
            source: model,
            keyUsed: `Key ${i + 1}`,
          };
        }
      } catch (err) {
        console.warn(`Error using Gemini [${model}] Key ${i + 1}:`, err.message);
        lastError = err;
      }
    }
  }

  throw lastError || new Error("All Gemini API keys and models failed");
}

// Function to call Gemini for Interactive Chat on a Medicine
async function callGeminiChat({ message, medicineContext = {}, conversationHistory = [], images = [] }) {
  const keys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
  ].filter(Boolean);

  if (!message || !message.trim()) {
    throw new Error("Message is required for chat");
  }

  const contextStr = typeof medicineContext === "string"
    ? medicineContext
    : JSON.stringify(medicineContext, null, 2);

  const systemInstruction = `You are an expert Clinical Pharmacist and Veterinary Consultant AI in Nepal. You are conversing with the licensed shopkeeper of Soni Surgical who is asking follow-up questions about a specific medicine or surgical supply.

Active Medicine Context:
${contextStr || "General Pharmaceutical Inquiry"}

Guidelines:
1. Answer the question accurately, directly, and practically.
2. If the question is about veterinary use (cattle, goats, poultry, pets), provide exact body-weight dosages, administration routes (SC/IM/Oral), and milk/meat withdrawal periods.
3. If the question is about human use, provide precise dosage, pediatric/adult guidelines, pregnancy/lactation safety, meal timing, or alternatives if out of stock.
4. When relevant, provide a brief, clear explanation in Nepali (नेपालीमा) so the shopkeeper can advise the customer or livestock farmer with confidence.
5. Format your answer with clean markdown bullet points or bold headers for readability.`;

  // Build conversation history contents
  const contents = [
    {
      role: "user",
      parts: [{ text: `${systemInstruction}\n\n[Initial Context Loaded]` }],
    },
    {
      role: "model",
      parts: [{ text: "Understood. I am ready to answer any clinical or veterinary questions about this medicine." }],
    },
  ];

  // Append previous turns
  if (Array.isArray(conversationHistory)) {
    for (const turn of conversationHistory) {
      if (turn.text) {
        contents.push({
          role: turn.role === "user" ? "user" : "model",
          parts: [{ text: turn.text }],
        });
      }
    }
  }

  // Current turn
  const currentParts = [{ text: message.trim() }];
  for (const img of images) {
    if (img && img.base64) {
      const cleanBase64 = img.base64.replace(/^data:image\/\w+;base64,/, "");
      currentParts.push({
        inlineData: {
          mimeType: img.mimeType || "image/jpeg",
          data: cleanBase64,
        },
      });
    }
  }

  contents.push({
    role: "user",
    parts: currentParts,
  });

  const GEMINI_CHAT_MODELS = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
  ];

  let lastError = null;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    for (const model of GEMINI_CHAT_MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents,
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 1000,
            },
          }),
          signal: AbortSignal.timeout(20000),
        });

        if (!response.ok) {
          const errBody = await response.text();
          console.warn(`Gemini Chat [${model}] Key ${i + 1} returned status ${response.status}:`, errBody.substring(0, 120));
          lastError = new Error(`Model ${model} Key ${i + 1} HTTP ${response.status}: ${errBody}`);
          continue;
        }

        const data = await response.json();
        const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (replyText) {
          return {
            reply: replyText.trim(),
            source: model,
            keyUsed: `Key ${i + 1}`,
          };
        }
      } catch (err) {
        console.warn(`Error using Gemini Chat [${model}] Key ${i + 1}:`, err.message);
        lastError = err;
      }
    }
  }

  throw lastError || new Error("All Gemini API keys failed for chat");
}

// POST /api/ai/explain — Universal Explainer with Multi-Photo Support
router.post("/explain", async (req, res) => {
  const { medicineName, query, context, imageBase64, imageMime, images } = req.body;
  const targetName = (medicineName || query || "").trim();

  // Normalize images array (support multiple images or single imageBase64)
  let normalizedImages = [];
  if (Array.isArray(images) && images.length > 0) {
    normalizedImages = images.filter((img) => img && img.base64);
  } else if (imageBase64) {
    normalizedImages = [{ base64: imageBase64, mimeType: imageMime || "image/jpeg" }];
  }

  if (!targetName && normalizedImages.length === 0) {
    return res.status(400).json({ message: "Medicine name or at least one photo is required" });
  }

  try {
    const result = await callGeminiExplain({
      medicineName: targetName,
      context,
      images: normalizedImages,
    });
    return res.json({
      success: true,
      data: result,
      source: result.source || "gemini",
    });
  } catch (err) {
    console.error("Gemini API explain error:", err.message);
    return res.status(503).json({
      success: false,
      message: "Server busy, please try again later.",
    });
  }
});

// POST /api/ai/chat — Interactive Follow-Up Chat on Medicine
router.post("/chat", async (req, res) => {
  const { message, medicineContext, conversationHistory, images } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ message: "Message is required" });
  }

  try {
    const result = await callGeminiChat({
      message: message.trim(),
      medicineContext,
      conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : [],
      images: Array.isArray(images) ? images : [],
    });
    return res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error("Gemini API chat error:", err.message);
    return res.status(503).json({
      success: false,
      message: "Server busy, please try again later.",
    });
  }
});

module.exports = router;

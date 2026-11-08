/**
 * Dynamic Gemini Model Discovery & Resolution Service
 * Automatically discovers, verifies, and uses the latest live Google Gemini models.
 * Automatically adapts when Google releases new models or deprecates older versions.
 */

let cachedModels = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// High-confidence fallback models in order of newest/latest
const FALLBACK_MODELS = [
  "gemini-flash-latest",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
];

/**
 * Returns prioritized list of active Gemini models, leading with the latest.
 * Discovers newly released models dynamically from Google's API catalog.
 */
async function getPrioritizedGeminiModels(apiKey) {
  const now = Date.now();
  if (cachedModels && cachedModels.length > 0 && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedModels;
  }

  if (apiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (res.ok) {
        const data = await res.json();
        const all = data.models || [];
        const liveFlash = all
          .filter((m) => {
            const name = m.name?.replace("models/", "") || "";
            const methods = m.supportedGenerationMethods || [];
            return (
              methods.includes("generateContent") &&
              !name.includes("tts") &&
              !name.includes("transcribe") &&
              !name.includes("clip") &&
              !name.includes("robotics") &&
              !name.includes("computer-use") &&
              !name.includes("experimental") &&
              (name.includes("flash") || name === "gemini-flash-latest")
            );
          })
          .map((m) => m.name.replace("models/", ""));

        // Sort: 'gemini-flash-latest' first, then highest version descending
        liveFlash.sort((a, b) => {
          if (a === "gemini-flash-latest") return -1;
          if (b === "gemini-flash-latest") return 1;
          return b.localeCompare(a, undefined, { numeric: true });
        });

        const combined = Array.from(new Set([...liveFlash, ...FALLBACK_MODELS]));
        if (combined.length > 0) {
          cachedModels = combined;
          lastFetchTime = now;
          return combined;
        }
      }
    } catch (err) {
      console.warn("[GEMINI-MODELS] Dynamic model discovery notice:", err.message);
    }
  }

  return FALLBACK_MODELS;
}

/**
 * Invalidates the cached model list (e.g. if a model returns 404 or deprecation).
 */
function invalidateModelCache() {
  cachedModels = null;
  lastFetchTime = 0;
}

module.exports = {
  getPrioritizedGeminiModels,
  invalidateModelCache,
  FALLBACK_MODELS,
};


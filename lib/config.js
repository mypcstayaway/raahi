// Settings. Put your values in a file called ".env" next to server.js (see .env.example).
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const e = process.env;
module.exports = {
  ROOT,
  PORT: +e.PORT || 3000,
  DB_FILE: e.DB_FILE || path.join(ROOT, "data", "raahi.db"),
  // AI: "gemini" (free key, no card), "anthropic" (Claude, paid), or "openai" (any OpenAI-style server: Groq, OpenRouter, Ollama...)
  AI_PROVIDER: (e.AI_PROVIDER || (e.GEMINI_API_KEY ? "gemini" : e.ANTHROPIC_API_KEY ? "anthropic" : e.OPENAI_API_KEY || e.OPENAI_BASE_URL ? "openai" : "")).toLowerCase(),
  GEMINI_API_KEY: e.GEMINI_API_KEY || "",
  GEMINI_URL: e.GEMINI_URL || "https://generativelanguage.googleapis.com",
  ANTHROPIC_API_KEY: e.ANTHROPIC_API_KEY || "",
  ANTHROPIC_URL: e.ANTHROPIC_URL || "https://api.anthropic.com",
  OPENAI_API_KEY: e.OPENAI_API_KEY || "",
  OPENAI_BASE_URL: e.OPENAI_BASE_URL || "https://api.groq.com/openai/v1",
  AI_MODEL: e.AI_MODEL || "",
  AI_SEARCH_MODEL: e.AI_SEARCH_MODEL || "",
  AI_MODEL_FAST_OFF: e.AI_FAST === "0",
  GOOGLE_CLIENT_ID: e.GOOGLE_CLIENT_ID || "",
  GOOGLE_TOKENINFO: e.GOOGLE_TOKENINFO || "https://oauth2.googleapis.com/tokeninfo",
  PHOTON_URL: e.PHOTON_URL || "https://photon.komoot.io",
  NOMINATIM_URL: e.NOMINATIM_URL || "https://nominatim.openstreetmap.org",
  OSRM_URL: e.OSRM_URL || "https://router.project-osrm.org",
  OVERPASS_URL: e.OVERPASS_URL || "https://overpass-api.de/api/interpreter",
  WEATHER_URL: e.WEATHER_URL || "https://api.open-meteo.com",
  TINYFISH_API_KEY: e.TINYFISH_API_KEY || "",
  TINYFISH_SEARCH_URL: e.TINYFISH_SEARCH_URL || "https://api.search.tinyfish.ai",
  TINYFISH_FETCH_URL: e.TINYFISH_FETCH_URL || "https://api.fetch.tinyfish.ai",
  TINYFISH_AGENT_URL: e.TINYFISH_AGENT_URL || "https://agent.tinyfish.ai",
  TURSO_URL: e.TURSO_URL || e.TURSO_DATABASE_URL || "",
  TURSO_TOKEN: e.TURSO_TOKEN || e.TURSO_AUTH_TOKEN || "",
  SECURE_COOKIES: e.SECURE_COOKIES === "1",
};

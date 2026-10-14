// One small wrapper around the AI providers.
//   gemini    – free key from Google AI Studio, no card. Can search Google for fresh info.
//   anthropic – Claude (paid API credits). Can search the web.
//   openai    – any OpenAI-style server (Groq free tier, OpenRouter, Ollama on your computer). No web search.
const cfg = require("./config");

class AIError extends Error { constructor(msg, code) { super(msg); this.code = code; this.user = true; } }
const enabled = () => !!(cfg.AI_PROVIDER === "gemini" ? cfg.GEMINI_API_KEY : cfg.AI_PROVIDER === "anthropic" ? cfg.ANTHROPIC_API_KEY : cfg.AI_PROVIDER === "openai" ? cfg.OPENAI_BASE_URL : "");
// Google Search grounding isn't on Gemini's free tier for newer models. If a search request is refused,
// switch searching off for a few hours and answer without it (TinyFish still brings in fresh web info).
let searchOffUntil = 0;
const canSearch = () => enabled() && cfg.AI_PROVIDER !== "openai" && process.env.AI_SEARCH !== "0" && Date.now() > searchOffUntil;
const searchRefused = (status, j) => [400, 403, 429].includes(status) && !/api key/i.test(JSON.stringify(j || ""));

function model(search) {
  if (cfg.AI_PROVIDER === "gemini") return (search && cfg.AI_SEARCH_MODEL) || cfg.AI_MODEL || "gemini-flash-latest";
  if (cfg.AI_PROVIDER === "anthropic") return cfg.AI_MODEL || "claude-haiku-5-5";
  return cfg.AI_MODEL || "llama-3.3-70b-versatile";
}

function fail(status, body) {
  const msg = (body && (body.error && (body.error.message || body.error.type) || body.message)) || "";
  if (status === 429 || /quota|rate/i.test(msg)) return new AIError("The free AI limit is used up for now. It resets every day around midday India time. Your plan can still be made without the extra AI details.", "quota");
  if (status === 401 || status === 403 || /api key|permission|auth/i.test(msg)) return new AIError("The AI key in your .env file isn't working. Check it and restart the server.", "key");
  if (status === 404 && /model/i.test(msg)) return new AIError(`The AI model "${model()}" wasn't found. Set AI_MODEL in .env to a current model name.`, "model");
  if ([500, 502, 503, 504].includes(status) || /high demand|overload|unavailable/i.test(msg)) return new AIError("Google's free AI is very busy right now. Wait a minute and tap Try again.", "busy");
  return new AIError("The AI service had a problem (" + (msg || status) + "). Try again in a moment.", "ai");
}

async function post(url, headers, body, ms) {
  let r;
  try { r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) }); }
  catch (e) { throw new AIError(e.name === "TimeoutError" ? "The AI took too long to answer. Try again." : "Can't reach the AI service. Check your internet.", "net"); }
  return r;
}

// ---------- request builders ----------
// Free Gemini models are sometimes "busy" (high demand) or retired. Then Raahi quietly tries the next one.
const GEMINI_BACKUPS = ["gemini-flash-latest", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest"];
const geminiModels = search => [...new Set([model(search), ...GEMINI_BACKUPS])];
const tryNext = (status, j) => {
  const msg = JSON.stringify((j && j.error) || "");
  return [404, 500, 502, 503, 504].includes(status) || /high demand|overload|unavailable|not found|not supported/i.test(msg);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
function geminiReq(system, messages, { search, json, think }, m = model(search)) {
  const body = {
    contents: messages.map(x => ({ role: x.role === "assistant" ? "model" : "user", parts: [{ text: x.text }] })),
    generationConfig: { temperature: 0.4, maxOutputTokens: 16384 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (search) body.tools = [{ google_search: {} }];
  else if (json) body.generationConfig.responseMimeType = "application/json";
  if (/^gemini-2\.5-flash/.test(m)) body.generationConfig.thinkingConfig = { thinkingBudget: think ? 2048 : 0 };
  else if (!think && /^gemini-(3|flash-latest)/.test(m)) body.generationConfig.thinkingConfig = { thinkingLevel: "low" };
  return { m, body };
}
function geminiSources(cand) {
  const ch = (cand && cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
  const seen = new Set();
  return ch.map(c => c.web).filter(w => w && w.uri && !seen.has(w.title + w.uri) && seen.add(w.title + w.uri)).map(w => ({ title: w.title || "source", url: w.uri })).slice(0, 8);
}
function anthropicReq(system, messages, { search }) {
  const body = { model: model(search), max_tokens: 8000, system, messages: messages.map(x => ({ role: x.role === "assistant" ? "assistant" : "user", content: x.text })) };
  if (search) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
  return body;
}
function anthropicOut(j) {
  const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  const sources = [];
  for (const b of j.content || []) if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url && sources.length < 8) sources.push({ title: r.title || r.url, url: r.url });
  return { text, sources };
}
function openaiReq(system, messages, { json }) {
  const body = { model: model(), temperature: 0.4, messages: [...(system ? [{ role: "system", content: system }] : []), ...messages.map(x => ({ role: x.role === "assistant" ? "assistant" : "user", content: x.text }))] };
  if (json) body.response_format = { type: "json_object" };
  return body;
}

// ---------- one-shot answer ----------
async function ask({ system = "", messages, prompt, search = false, json = false, think = false, ms = 90000 }) {
  if (!enabled()) throw new AIError("AI is not set up yet. Add a free Gemini key to the .env file (see README).", "noai");
  messages = messages || [{ role: "user", text: prompt }];
  search = search && canSearch();
  if (cfg.AI_PROVIDER === "gemini") {
    let r, j;
    for (const [i, mm] of geminiModels(search).entries()) {
      const { body } = geminiReq(system, messages, { search, json, think }, mm);
      r = await post(`${cfg.GEMINI_URL}/v1beta/models/${mm}:generateContent`, { "x-goog-api-key": cfg.GEMINI_API_KEY }, body, ms);
      j = await r.json().catch(() => null);
      if (r.ok || !tryNext(r.status, j)) break;
      if (i === 0) await sleep(1500);
    }
    if (!r.ok && search && searchRefused(r.status, j)) {
      const out = await ask({ system, messages, search: false, json, think, ms }); // throws if the whole AI quota is used up
      searchOffUntil = Date.now() + 6 * 3600e3; // only searching was refused
      return out;
    }
    if (!r.ok) throw fail(r.status, j);
    const c = j && j.candidates && j.candidates[0];
    const text = ((c && c.content && c.content.parts) || []).map(p => p.text || "").join("");
    if (!text) throw new AIError("The AI returned an empty answer. Try again.", "empty");
    return { text, sources: geminiSources(c), searched: search };
  }
  if (cfg.AI_PROVIDER === "anthropic") {
    const r = await post(`${cfg.ANTHROPIC_URL}/v1/messages`, { "x-api-key": cfg.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, anthropicReq(system + (json ? "\nReply with JSON only." : ""), messages, { search }), ms);
    const j = await r.json().catch(() => null);
    if (!r.ok) throw fail(r.status, j);
    return { ...anthropicOut(j), searched: search };
  }
  const r = await post(`${cfg.OPENAI_BASE_URL.replace(/\/$/, "")}/chat/completions`, cfg.OPENAI_API_KEY ? { Authorization: "Bearer " + cfg.OPENAI_API_KEY } : {}, openaiReq(system, messages, { json }), ms);
  const j = await r.json().catch(() => null);
  if (!r.ok) throw fail(r.status, j);
  return { text: (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "", sources: [], searched: false };
}

// Pull a JSON object out of an answer (handles ```json fences and extra words around it).
function parseJSON(text) {
  const t = String(text).replace(/```(?:json)?/gi, "").trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  const c = t.indexOf("["), d = t.lastIndexOf("]");
  if (c >= 0 && d > c) { try { return JSON.parse(t.slice(c, d + 1)); } catch {} }
  return null;
}
async function askJSON(opts) {
  const r = await ask({ ...opts, json: true });
  let data = parseJSON(r.text);
  if (!data) { // one retry, asking more firmly
    const r2 = await ask({ ...opts, json: true, search: false, messages: [...(opts.messages || [{ role: "user", text: opts.prompt }]), { role: "assistant", text: r.text.slice(0, 4000) }, { role: "user", text: "That was not valid JSON. Reply again with only the JSON object, nothing else." }] });
    data = parseJSON(r2.text);
    if (!data) throw new AIError("The AI answer couldn't be read. Try again.", "json");
  }
  return { data, sources: r.sources, searched: r.searched };
}

// ---------- streaming answer (for the chat box) ----------
async function* stream({ system = "", messages, search = false }) {
  if (!enabled()) throw new AIError("AI is not set up yet. Add a free Gemini key to the .env file (see README).", "noai");
  search = search && canSearch();
  if (cfg.AI_PROVIDER !== "gemini") { const r = await ask({ system, messages, search }); yield { text: r.text }; yield { sources: r.sources }; return; }
  let r, j;
  for (const [i, mm] of geminiModels(search).entries()) {
    const { body } = geminiReq(system, messages, { search }, mm);
    r = await post(`${cfg.GEMINI_URL}/v1beta/models/${mm}:streamGenerateContent?alt=sse`, { "x-goog-api-key": cfg.GEMINI_API_KEY }, body, 90000);
    if (r.ok) break;
    j = await r.json().catch(() => null);
    if (!tryNext(r.status, j)) break;
    if (i === 0) await sleep(1500);
  }
  if (!r.ok) {
    if (search && searchRefused(r.status, j)) {
      let first = true;
      for await (const part of stream({ system, messages, search: false })) { if (first) { searchOffUntil = Date.now() + 6 * 3600e3; first = false; } yield part; }
      return;
    }
    throw fail(r.status, j);
  }
  const dec = new TextDecoder();
  let buf = "", sources = [];
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      let j; try { j = JSON.parse(line.slice(5)); } catch { continue; }
      const c = j.candidates && j.candidates[0];
      const text = ((c && c.content && c.content.parts) || []).map(p => p.text || "").join("");
      if (text) yield { text };
      const s = geminiSources(c);
      if (s.length) sources = s;
    }
  }
  yield { sources };
}

module.exports = { ask, askJSON, stream, parseJSON, enabled, canSearch, AIError, model };

// TinyFish: live web access for Raahi.
//   Search API – fresh news / Reddit / blog results (free daily allowance)
//   Fetch API  – read any page (e.g. a monument's official site) as clean text
//   Agent API  – a real browser that goes to Google Maps and reads what's there right now
// Docs: https://docs.tinyfish.ai
const cfg = require("./config");
const { cache } = require("./db");

class TFError extends Error { constructor(msg, code) { super(msg); this.code = code; this.user = true; } }
const enabled = () => !!cfg.TINYFISH_API_KEY;
const H = () => ({ "X-API-Key": cfg.TINYFISH_API_KEY, "Content-Type": "application/json" });

function fail(status, j) {
  const msg = (j && (j.error && (j.error.message || j.error) || j.message)) || "";
  if (status === 401) return new TFError("The TinyFish key in .env isn't working.", "key");
  if (status === 402) return new TFError("TinyFish credits are used up. Live web checks are paused.", "credits");
  if (status === 429) return new TFError("TinyFish is busy (rate limit). Try again in a minute.", "rate");
  return new TFError("TinyFish had a problem (" + (typeof msg === "string" ? msg : status) + ").", "tf");
}
async function req(url, init, ms = 30000) {
  if (!enabled()) throw new TFError("TinyFish isn't set up. Add TINYFISH_API_KEY to .env.", "notf");
  let r;
  try { r = await fetch(url, { ...init, headers: { ...H(), ...(init && init.headers) }, signal: AbortSignal.timeout(ms) }); }
  catch (e) { throw new TFError(e.name === "TimeoutError" ? "TinyFish took too long." : "Can't reach TinyFish.", "net"); }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw fail(r.status, j);
  return j;
}

// ---------- Search ----------
async function search(query, { recencyDays, domains, type, location = "IN", purpose } = {}) {
  const p = new URLSearchParams({ query, language: "en", location });
  if (recencyDays) p.set("recency_minutes", String(Math.round(recencyDays * 1440)));
  if (domains) p.set("include_domains", domains.join(","));
  if (type) p.set("domain_type", type);
  if (purpose) p.set("purpose", purpose.slice(0, 2000));
  const key = "tfs:" + p.toString();
  const hit = cache.get(key);
  if (hit) return hit;
  let j;
  try { j = await req(`${cfg.TINYFISH_SEARCH_URL}?${p}`, { method: "GET" }, 20000); }
  catch (e) { // if India isn't an accepted search location, search without it
    if (e.code !== "tf" || !p.has("location")) throw e;
    p.delete("location"); j = await req(`${cfg.TINYFISH_SEARCH_URL}?${p}`, { method: "GET" }, 20000);
  }
  const out = ((j && j.results) || []).map(r => ({ title: r.title, url: r.url, site: r.site_name, snippet: r.snippet, date: r.date || null }));
  cache.set(key, out, 3 * 3600e3);
  return out;
}

// Everything said about a place on the web in the past week: news + Reddit + general.
async function recentBuzz(name, city, days = 7) {
  const q = `"${name}" ${city}`;
  const why = `A traveller is deciding whether to visit ${name} in ${city} today. Find recent news, crowd reports, closures, accidents, safety warnings and visitor experiences.`;
  const settle = p => p.then(x => x, () => []);
  const [news, reddit, web] = await Promise.all([
    settle(search(q, { recencyDays: days, type: "news", purpose: why })),
    settle(search(`${name} ${city}`, { recencyDays: days, domains: ["reddit.com"], purpose: why })),
    settle(search(`${q} crowd OR closed OR review`, { recencyDays: days, purpose: why })),
  ]);
  const seen = new Set();
  return [...news.map(x => ({ ...x, kind: "news" })), ...reddit.map(x => ({ ...x, kind: "reddit" })), ...web.map(x => ({ ...x, kind: "web" }))]
    .filter(x => x.url && !seen.has(x.url) && seen.add(x.url)).slice(0, 12);
}

// ---------- Fetch ----------
async function fetchPages(urls, purpose) {
  const j = await req(cfg.TINYFISH_FETCH_URL, { method: "POST", body: JSON.stringify({ urls: urls.slice(0, 10), format: "markdown", purpose }) }, 60000);
  return ((j && j.results) || []).map(r => ({ url: r.final_url || r.url, title: r.title, text: String(r.text || "").slice(0, 12000) }));
}

// ---------- Agent ----------
async function agentStart(url, goal, schema) {
  const body = { url, goal, browser_profile: "stealth" }; // custom step limits need TinyFish beta access, so use their defaults
  if (schema) body.output_schema = schema;
  const j = await req(`${cfg.TINYFISH_AGENT_URL}/v1/automation/run-async`, { method: "POST", body: JSON.stringify(body) });
  if (!j || !j.run_id) throw new TFError("TinyFish didn't start the run" + (j && j.error ? `: ${j.error.message || j.error}` : "."), "tf");
  return j.run_id;
}
async function agentGet(runId) { return req(`${cfg.TINYFISH_AGENT_URL}/v1/runs/${encodeURIComponent(runId)}`, { method: "GET" }); }
async function agentWait(runId, { every = 4000, maxMs = 300000, onTick } = {}) {
  const until = Date.now() + maxMs;
  for (;;) {
    const r = await agentGet(runId);
    if (onTick) onTick(r);
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(r.status)) return r;
    if (Date.now() > until) throw new TFError("The live check took too long.", "timeout");
    await new Promise(ok => setTimeout(ok, every));
  }
}

// What the browser agent reads from Google Maps for one place.
const PLACE_SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    name: { type: "string" },
    status: { type: "string", nullable: true },
    hours_today: { type: "string", nullable: true },
    busy_now: { type: "string", nullable: true },
    entry_fee: { type: "string", nullable: true },
    rating: { type: "number", nullable: true },
    review_count: { type: "number", nullable: true },
    newest_reviews: {
      type: "array",
      items: { type: "object", properties: { when: { type: "string" }, stars: { type: "number" }, summary: { type: "string" } } },
    },
  },
};
function placeGoal(name, city) {
  return `This is a Google Maps search for "${name}" in ${city}. If a list of results is shown, open the right one (the tourist attraction, not a shop with a similar name). If a cookie or sign-in prompt appears, dismiss it.
Read: the current open/closed status (e.g. "Open", "Closed", "Temporarily closed", "Closes soon"), TODAY's opening hours exactly as shown (e.g. "6 am–6:30 pm" or "Closed"), the live "Popular times" text if shown (e.g. "Busier than usual"), any entry fee shown, the star rating and number of reviews.
Then open the Reviews tab, sort by "Newest", and read up to 10 of the newest reviews: for each give how long ago it was posted (exactly as shown), its star rating, and a one-line summary.
If the place can't be found, set found to false. Return only the JSON.`;
}

// "2 days ago", "a week ago", "5 hours ago" → days (or null)
function daysAgo(s) {
  s = String(s || "").toLowerCase();
  if (/just now|minute|hour|today/.test(s)) return 0;
  const n = /^(a|an|one)\b/.test(s) ? 1 : parseInt(s, 10);
  if (/day/.test(s)) return isFinite(n) ? n : 1;
  if (/week/.test(s)) return (isFinite(n) ? n : 1) * 7;
  if (/month/.test(s)) return (isFinite(n) ? n : 1) * 30;
  if (/year/.test(s)) return 365;
  return null;
}
// "6 am–6:30 pm" / "9:00 AM – 5:30 PM" / "Open 24 hours" / "Closed" → [open, close] minutes
function parseToday(s) {
  s = String(s || "").toLowerCase().replace(/ | /g, " ");
  if (/24 hours/.test(s)) return [0, 1440];
  if (/^closed|closed today|temporarily closed/.test(s)) return [];
  const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[–\-—to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return null;
  const conv = (h, mm, ap, fallback) => { h = +h % 12; ap = ap || fallback; if (ap === "pm") h += 12; return h * 60 + (+mm || 0); };
  const close = conv(m[4], m[5], m[6], "pm");
  let open = conv(m[1], m[2], m[3], m[6] === "pm" && +m[1] < +m[4] ? "pm" : "am");
  return [open, close > open ? close : close + 1440];
}

module.exports = { enabled, search, recentBuzz, fetchPages, agentStart, agentGet, agentWait, PLACE_SCHEMA, placeGoal, daysAgo, parseToday, TFError };

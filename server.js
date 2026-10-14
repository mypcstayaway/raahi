// Raahi – trip planner. Start with:  node server.js   then open http://localhost:3000
// Needs Node.js 22.13 or newer. No packages to install.
const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 22 || (maj === 22 && min < 13)) { console.error(`Raahi needs Node.js 22.13 or newer (you have ${process.versions.node}). Install the LTS version from https://nodejs.org`); process.exit(1); }

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const cfg = require("./lib/config");
const db = require("./lib/db");
const auth = require("./lib/auth");
const ai = require("./lib/ai");
const tf = require("./lib/tinyfish");
const P = require("./lib/prompts");
const places = require("./lib/places");
const trips = require("./lib/trips");
const { explore, advice } = require("./lib/explore");
const { plan: routePlan } = require("./lib/route");
const { parseGmaps, parsePlace, expand, findUrl, isFullMapsUrl, userErr, MAX } = require("./lib/google");

const PUBLIC = path.join(__dirname, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".ico": "image/x-icon" };

// ---------- helpers ----------
function send(req, res, status, body, type = "application/json; charset=utf-8", extra = {}) {
  let data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  const headers = { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", ...extra };
  if (data.length > 1024 && /\bgzip\b/.test(req.headers["accept-encoding"] || "") && !/image\/png/.test(type)) { data = zlib.gzipSync(data); headers["Content-Encoding"] = "gzip"; headers.Vary = "Accept-Encoding"; }
  headers["Content-Length"] = data.length;
  res.writeHead(status, headers);
  res.end(req.method === "HEAD" ? undefined : data);
}
function readBody(req) {
  return new Promise((ok, bad) => {
    let s = "";
    req.on("data", c => { s += c; if (s.length > 300000) { bad(userErr("Request too large.")); req.destroy(); } });
    req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch { bad(userErr("Bad request.")); } });
    req.on("error", bad);
  });
}
const num = v => (v === "" || v == null || !isFinite(+v) ? null : +v);
const validPt = p => p && num(p.lat) != null && num(p.lng) != null && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

const hits = new Map();
function limited(ip, cost) {
  const now = Date.now(), h = hits.get(ip) || { n: 0, t: now };
  if (now - h.t > 60000) { h.n = 0; h.t = now; }
  h.n += cost; hits.set(ip, h);
  return h.n > (+process.env.RATE_LIMIT || 240);
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now - h.t > 120000) hits.delete(k); }, 60000).unref();

function need(user) { if (!user) { const e = userErr("Please sign in (or continue as guest) first."); e.status = 401; throw e; } return user; }
function tripOut(t) { return { id: t.id, title: t.title, share: t.share, data: t.data, updated: t.updated, planning: trips.running.has(t.id) }; }

// ---------- route optimiser (Thread) ----------
async function locateAll(stops) {
  const bias = stops.find(validPt) || null;
  const out = await Promise.all(stops.map(async s => {
    const label = String(s.label || "").trim().slice(0, 300);
    if (validPt(s)) return { label: label || `${s.lat},${s.lng}`, lat: +s.lat, lng: +s.lng, name: s.name || label };
    if (!label) throw userErr("Fill in every stop, or remove the empty ones.");
    const r = await places.geocode(label, bias);
    return r ? { label, ...r } : { label, missing: true };
  }));
  return { stops: out, missing: out.filter(s => s.missing).map(s => s.label) };
}
const ropts = b => ({ fixed: b.fixed !== false, round: !!b.round });

// ---------- API table: "METHOD /path/:param" ----------
const routes = {
  "GET /api/config": async () => ({ version: "2026-10-14d", googleClientId: cfg.GOOGLE_CLIENT_ID || null, ai: ai.enabled(), aiSearch: ai.canSearch() || tf.enabled(), tinyfish: tf.enabled(), provider: cfg.AI_PROVIDER || null, model: ai.enabled() ? ai.model() : null }),
  "GET /api/me": async ({ user }) => ({ user }),
  "POST /api/auth/register": async ({ req, res, body, user, ip }) => auth.api.register(req, res, body, user, ip),
  "POST /api/auth/login": async ({ req, res, body, user, ip }) => auth.api.login(req, res, body, user, ip),
  "POST /api/auth/google": async ({ req, res, body, user }) => auth.api.google(req, res, body, user),
  "POST /api/auth/guest": async ({ req, res, body, user }) => auth.api.guest(req, res, body, user),
  "POST /api/auth/logout": async ({ req, res }) => auth.api.logout(req, res),
  "PUT /api/me": async ({ user, body }) => {
    need(user);
    const f = {};
    if (body.name != null) f.name = String(body.name).trim().slice(0, 60) || null;
    if (body.prefs && typeof body.prefs === "object") f.prefs = { ...user.prefs, ...body.prefs, onboarded: true };
    db.users.update(user.id, f);
    return { user: db.users.byId(user.id) };
  },
  "DELETE /api/me": async ({ req, res, user }) => { need(user); db.users.remove(user.id); auth.api.logout(req, res); return { ok: true }; },

  // places
  "GET /api/suggest": async ({ url }) => {
    const q = (url.searchParams.get("q") || "").trim();
    if (q.length < 2) return [];
    const lat = num(url.searchParams.get("lat")), lng = num(url.searchParams.get("lng"));
    return places.suggest(q.slice(0, 200), lat != null && lng != null ? { lat, lng } : null);
  },
  "POST /api/geocode": async ({ body }) => {
    const q = String(body.q || "").trim();
    if (!q) throw userErr("Type a place.");
    return { place: await places.geocode(q.slice(0, 300), validPt(body.bias) ? body.bias : null) };
  },
  "GET /api/reverse": async ({ url }) => {
    const lat = num(url.searchParams.get("lat")), lng = num(url.searchParams.get("lng"));
    if (lat == null || lng == null) throw userErr("Bad position.");
    return places.reverse(lat, lng);
  },

  // route optimiser
  // Paste a Google Maps link of one place (hotel, apartment, shop...) instead of typing it.
  "POST /api/place-link": async ({ body }) => {
    let link = findUrl(body.url);
    if (!link) throw userErr("Paste a Google Maps link first.");
    if (!isFullMapsUrl(link)) {
      try { link = await expand(link); }
      catch (e) { if (e.net) throw e; throw userErr("That link didn't open a Google Maps place. In Google Maps, open the place, tap Share, then Copy link."); }
    }
    const p = parsePlace(link);
    if (p.lat == null) {
      const g = await places.geocode(p.name);
      if (!g) throw userErr(`I couldn't find "${p.name}" on the map.`);
      Object.assign(p, { lat: g.lat, lng: g.lng });
    }
    let sub = "", country = "";
    try { const r = await places.reverse(p.lat, p.lng); sub = r.city || ""; country = r.country || ""; if (!p.name) p.name = r.name; } catch {}
    return { title: p.name || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`, sub, lat: p.lat, lng: p.lng, country };
  },
  "POST /api/route/import": async ({ body }) => {
    let link = findUrl(body.url);
    if (!link) throw userErr("Paste a Google Maps link first.");
    if (!isFullMapsUrl(link)) link = await expand(link);
    const { stops: parsed, startsHere } = parseGmaps(link);
    if (startsHere) {
      if (validPt(body.here)) parsed.unshift({ label: "Your location", lat: +body.here.lat, lng: +body.here.lng, name: "Your location" });
      else if (body.here !== false) return { needHere: true, count: parsed.length + 1 };
    }
    if (parsed.length < 2) throw userErr("I found fewer than 2 stops in that link.");
    const { stops, missing } = await locateAll(parsed);
    if (missing.length) return { stops, missing };
    return { stops, missing, result: await routePlan(stops, ropts(body)) };
  },
  "POST /api/route/optimize": async ({ body }) => {
    const list = Array.isArray(body.stops) ? body.stops : [];
    if (list.length < 2) throw userErr("Add at least 2 stops.");
    if (list.length > MAX) throw userErr(`The limit is ${MAX} stops.`);
    const { stops, missing } = await locateAll(list);
    if (missing.length) return { stops, missing };
    return { stops, missing, result: await routePlan(stops, ropts(body)) };
  },

  // road line for drawing a day on the map
  "POST /api/route/line": async ({ body }) => {
    const pts = (Array.isArray(body.points) ? body.points : []).filter(validPt).slice(0, 25);
    if (pts.length < 2) return { geometry: null };
    try { const r = await places.route(pts); return { geometry: r.geometry, distance: r.distance, duration: r.duration }; }
    catch { return { geometry: null, straight: true }; }
  },

  // trips
  "GET /api/trips": async ({ user }) => (user ? db.trips.list(user.id) : []),
  "POST /api/trips": async ({ user, body }) => ({ id: trips.create(need(user), body) }),
  "GET /api/trips/:id": async ({ user, params }) => tripOut(trips.owned(need(user), params.id)),
  "PATCH /api/trips/:id": async ({ user, params, body }) => {
    const t = trips.owned(need(user), params.id);
    db.trips.save(t.id, t.data, String(body.title || t.title).slice(0, 100));
    return tripOut(db.trips.get(t.id));
  },
  "DELETE /api/trips/:id": async ({ user, params }) => { trips.owned(need(user), params.id); db.trips.remove(params.id); return { ok: true }; },
  "POST /api/trips/:id/retry": async ({ user, params }) => {
    const t = trips.owned(need(user), params.id);
    const full = !Object.keys(t.data.places || {}).length;
    t.data.status = "planning"; t.data.error = null; db.trips.save(t.id, t.data);
    trips.run(t.id, user, full ? "full" : "plan");
    return { ok: true };
  },
  "POST /api/trips/:id/select": async ({ user, params, body }) => { await trips.select(need(user), params.id, body); return { ok: true }; },
  "POST /api/trips/:id/replan": async ({ user, params, body }) => { await trips.replan(need(user), params.id, body); return tripOut(db.trips.get(params.id)); },
  "POST /api/trips/:id/places": async ({ user, params, body }) => { await trips.addPlace(need(user), params.id, body); return tripOut(db.trips.get(params.id)); },
  "POST /api/trips/:id/food": async ({ user, params, body }) => { await trips.addFood(need(user), params.id, body); return tripOut(db.trips.get(params.id)); },
  "POST /api/trips/:id/food/dismiss": async ({ user, params, body }) => { trips.dismissFood(need(user), params.id, body); return tripOut(db.trips.get(params.id)); },
  "POST /api/trips/:id/checkin": async ({ user, params, body }) => ({ checkins: trips.checkin(need(user), params.id, body) }),
  "POST /api/trips/:id/live": async ({ user, params, body }) => trips.live(need(user), params.id, body),
  "POST /api/trips/:id/today": async ({ user, params, body }) => { trips.applyToday(need(user), params.id, body); return tripOut(db.trips.get(params.id)); },
  "POST /api/trips/:id/pulse": async ({ user, params, body }) => ({ pulse: await trips.pulse(need(user), params.id, body) }),
  "POST /api/trips/:id/verify": async ({ user, params, body }) => trips.verify(need(user), params.id, body),
  "POST /api/trips/:id/verify/status": async ({ user, params, body }) => trips.verifyStatus(need(user), params.id, body),
  "POST /api/trips/:id/decide": async ({ user, params, body }) => {
    const r = await trips.decide(need(user), params.id, body);
    if (body.apply && body.replan) { await trips.replan(user, params.id, {}); return { ...r, trip: tripOut(db.trips.get(params.id)) }; }
    return r;
  },
  "POST /api/trips/:id/share": async ({ user, params, body }) => {
    const t = trips.owned(need(user), params.id);
    const s = body.off ? null : t.share || crypto.randomBytes(9).toString("base64url");
    db.trips.setShare(t.id, s);
    if (body.live != null) { t.data.liveShare = !!body.live; db.trips.save(t.id, t.data); }
    return { share: s, live: !!t.data.liveShare };
  },
  "POST /api/trips/:id/expenses": async ({ user, params, body }) => {
    const t = trips.owned(need(user), params.id);
    const amt = +body.amount;
    if (!(amt > 0)) throw userErr("Enter an amount.");
    const e = { id: crypto.randomBytes(5).toString("hex"), amount: Math.round(amt * 100) / 100, note: String(body.note || "").slice(0, 100), cat: String(body.cat || "other").slice(0, 20), day: num(body.day), at: Date.now() };
    const people = t.data.people || [];
    if (body.paidBy && people.includes(String(body.paidBy))) e.paidBy = String(body.paidBy);
    if (Array.isArray(body.split)) { const sp = body.split.map(String).filter(x => people.includes(x)); if (sp.length) e.split = sp; }
    t.data.expenses = [...(t.data.expenses || []), e];
    db.trips.save(t.id, t.data);
    return { expenses: t.data.expenses, settle: trips.settle(t.data) };
  },
  "DELETE /api/trips/:id/expenses/:eid": async ({ user, params }) => {
    const t = trips.owned(need(user), params.id);
    t.data.expenses = (t.data.expenses || []).filter(e => e.id !== params.eid);
    db.trips.save(t.id, t.data);
    return { expenses: t.data.expenses, settle: trips.settle(t.data) };
  },
  "PUT /api/trips/:id/people": async ({ user, params, body }) => {
    const people = trips.setPeople(need(user), params.id, body);
    const t = db.trips.get(params.id);
    return { people, settle: trips.settle(t.data) };
  },
  "GET /api/trips/:id/settle": async ({ user, params }) => trips.settle(trips.owned(need(user), params.id).data),
  "POST /api/trips/:id/position": async ({ user, params, body }) => trips.position(need(user), params.id, body),
  "POST /api/trips/:id/rainplan": async ({ user, params, body }) => trips.rainPlan(need(user), params.id, body),
  "POST /api/trips/:id/lunch": async ({ user, params, body }) => {
    const t = trips.owned(need(user), params.id);
    t.data.lunchDone = !!body.done; db.trips.save(t.id, t.data);
    return { lunchDone: t.data.lunchDone };
  },
  "GET /api/help": async ({ url }) => {
    const lat = num(url.searchParams.get("lat")), lng = num(url.searchParams.get("lng"));
    if (lat == null || lng == null) throw userErr("Bad position.");
    return places.helpNearby({ lat, lng });
  },
  "PUT /api/trips/:id/packed": async ({ user, params, body }) => {
    const t = trips.owned(need(user), params.id);
    t.data.packed = { ...(t.data.packed || {}), [String(body.item).slice(0, 100)]: !!body.done };
    db.trips.save(t.id, t.data);
    return { packed: t.data.packed };
  },
  "GET /api/share/:token": async ({ params }) => {
    const t = db.trips.byShare(params.token);
    if (!t) throw userErr("This shared trip link isn't active.");
    // Family live share shows check-ins and the current stop only when the owner turned it on.
    const { expenses, people, lastSeen, presence, checkins, ...data } = t.data;
    if (t.data.liveShare) { data.checkins = checkins; data.presence = presence ? { placeId: presence.placeId, since: presence.since } : null; data.lastSeen = lastSeen || null; }
    else data.checkins = {};
    return { id: null, title: t.title, data, shared: true, live: !!t.data.liveShare };
  },

  // ideas & advice
  "POST /api/explore": async ({ user, body }) => explore(need(user), body),
  "POST /api/advice": async ({ user, body }) => advice(need(user), body),

  // chat
  "GET /api/chat": async ({ user, url }) => (user ? db.chats.recent(user.id, url.searchParams.get("tripId") || "") : []),
  "DELETE /api/chat": async ({ user, url }) => { need(user); db.chats.clear(user.id, url.searchParams.get("tripId") || ""); return { ok: true }; },
};

// Chat answers stream in word by word (Server-Sent Events).
async function chat(req, res, user, body) {
  need(user);
  const text = String(body.message || "").trim().slice(0, 4000);
  if (!text) throw userErr("Type a message.");
  let tripId = String(body.tripId || ""), tripText = "";
  if (tripId) { const t = db.trips.get(tripId); if (t && t.userId === user.id) tripText = trips.summaryForChat(t.data); else tripId = ""; }
  if (body.context) tripText += (tripText ? "\n" : "") + "Page context: " + String(body.context).slice(0, 1500);
  const history = db.chats.recent(user.id, tripId, 16).map(m => ({ role: m.role, text: m.text }));
  db.chats.add(user.id, tripId, "user", text);
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const ev = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  let full = "", sources = [];
  try {
    for await (const part of ai.stream({ system: P.chatSystem(user, tripText), messages: [...history, { role: "user", text }], search: body.search !== false })) {
      if (part.text) { full += part.text; ev({ t: part.text }); }
      if (part.sources) sources = part.sources;
    }
    if (sources.length) ev({ sources });
    db.chats.add(user.id, tripId, "assistant", full, sources);
    ev({ done: true });
  } catch (e) {
    ev({ error: e.user ? e.message : "The assistant had a problem. Try again." });
    if (!e.user) console.error(e);
  }
  res.end();
}

// ---------- server ----------
const compiled = Object.entries(routes).map(([k, fn]) => {
  const [method, p] = k.split(" ");
  const names = [];
  const re = new RegExp("^" + p.replace(/:(\w+)/g, (_, n) => { names.push(n); return "([^/]+)"; }) + "$");
  return { method, re, names, fn };
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (url.pathname.startsWith("/api/")) {
    const started = Date.now();
    try {
      if (limited(ip, url.pathname === "/api/suggest" ? 1 : 2)) return send(req, res, 429, { error: "Too many requests. Wait a minute and try again." });
      // Simple protection against other websites posting to this one.
      if (req.method !== "GET" && !/^application\/json/.test(req.headers["content-type"] || "")) return send(req, res, 415, { error: "Send JSON." });
      const user = auth.currentUser(req);
      const body = req.method === "GET" ? {} : await readBody(req);
      if (req.method === "POST" && url.pathname === "/api/chat") return await chat(req, res, user, body);
      for (const r of compiled) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
        const out = await r.fn({ req, res, url, body, user, ip, params });
        return send(req, res, 200, out, undefined, { "Cache-Control": url.pathname === "/api/suggest" ? "private, max-age=3600" : "no-store", "Server-Timing": `total;dur=${Date.now() - started}` });
      }
      return send(req, res, 404, { error: "Not found" });
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e.user) return send(req, res, e.status || 400, { error: e.message, code: e.code });
      if (e instanceof places.NetError || e.net) return send(req, res, 502, { error: "The free map services are not answering right now (" + e.message + "). Please try again in a minute.", net: true });
      console.error(e);
      return send(req, res, 500, { error: "Something went wrong on the server. Try again." });
    }
  }
  if (req.method !== "GET" && req.method !== "HEAD") return send(req, res, 405, "Not allowed", "text/plain");
  let p = decodeURIComponent(url.pathname);
  if (p === "/" || p === "/route" || p.startsWith("/t/")) p = "/index.html";
  const file = path.join(PUBLIC, path.normalize(p));
  if (!file.startsWith(PUBLIC)) return send(req, res, 403, "Forbidden", "text/plain");
  fs.readFile(file, (err, data) => {
    if (err) return send(req, res, 404, "Not found", "text/plain");
    const ext = path.extname(file);
    send(req, res, 200, data, TYPES[ext] || "application/octet-stream", { "Cache-Control": ext === ".html" || p === "/sw.js" ? "no-cache" : "public, max-age=3600" });
  });
});

// Render's free plan sleeps after 15 min without visitors, and waking takes ~1 min.
// Visiting our own public address every 10 min keeps Raahi awake, so it always opens instantly.
// (Render sets RENDER_EXTERNAL_URL itself. Set KEEP_AWAKE=0 to turn this off.)
function keepAwake() {
  const url = process.env.KEEP_AWAKE_URL || process.env.RENDER_EXTERNAL_URL;
  if (!url || process.env.KEEP_AWAKE === "0") return;
  const every = (+process.env.KEEP_AWAKE_MINUTES || 10) * 60e3;
  const ping = () => fetch(url.replace(/\/$/, "") + "/api/config", { headers: { "User-Agent": "Raahi-keep-awake" }, signal: AbortSignal.timeout(20000) }).catch(() => {});
  setInterval(ping, every);
  console.log(`  Keep-awake: visiting ${url} every ${Math.round(every / 60e3 * 10) / 10} min so Raahi never sleeps.`);
}

if (require.main === module) {
  (async () => {
    if (db.remote.enabled()) {
      try { const r = await db.restore(); console.log(r.restored ? `  Loaded ${r.rows} saved rows from Turso.` : "  Turso connected (permanent storage)."); }
      catch (e) { console.error("  Couldn't reach Turso:", e.message, "– starting with local data only."); }
    }
    server.listen(cfg.PORT, () => {
      keepAwake();
      console.log(`\n  Raahi is running → open http://localhost:${cfg.PORT}\n`);
      console.log(`  AI: ${ai.enabled() ? `${cfg.AI_PROVIDER} (${ai.model()})${ai.canSearch() ? " with live web search" : ""}` : "not set up – plans use OpenStreetMap only. Add GEMINI_API_KEY to .env for the full experience."}`);
      console.log(`  TinyFish live web: ${tf.enabled() ? "on (search, fetch, browser agent)" : "off – add TINYFISH_API_KEY to .env"}`);
      console.log(`  Storage: ${db.remote.enabled() ? "local + Turso (permanent)" : "local file only (data/raahi.db)"}`);
      console.log(`  Google sign-in: ${cfg.GOOGLE_CLIENT_ID ? "on" : "off (email/phone + password and guest still work)"}\n`);
    });
  })();
  // Render stops the app with SIGTERM: send the last changes to Turso first.
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, async () => { if (db.remote.pending()) await db.remote.drain(10000); process.exit(0); });
}
module.exports = server;

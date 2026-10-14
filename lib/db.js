// Small SQLite database built into Node.js (no installs). File: data/raahi.db
const origEmit = process.emitWarning;
process.emitWarning = (w, ...a) => { if (String(w).includes("SQLite")) return; return origEmit.call(process, w, ...a); };
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const cfg = require("./config");
const remote = require("./remote");

fs.mkdirSync(path.dirname(cfg.DB_FILE), { recursive: true });
const db = new DatabaseSync(cfg.DB_FILE);
const SCHEMA = `CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE, phone TEXT UNIQUE, google_sub TEXT UNIQUE,
  name TEXT, pass TEXT, picture TEXT, prefs TEXT DEFAULT '{}', stats TEXT DEFAULT '{}',
  guest INTEGER DEFAULT 0, created INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, expires INTEGER);
CREATE TABLE IF NOT EXISTS trips(
  id TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, title TEXT,
  data TEXT, share TEXT UNIQUE, created INTEGER, updated INTEGER);
CREATE INDEX IF NOT EXISTS trips_user ON trips(user_id, updated);
CREATE TABLE IF NOT EXISTS chats(
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, trip_id TEXT,
  role TEXT, text TEXT, sources TEXT, ts INTEGER);
CREATE INDEX IF NOT EXISTS chats_user ON chats(user_id, trip_id, id);
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT, exp INTEGER);`;
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;\n" + SCHEMA);

const q = sql => db.prepare(sql);
// A write that is also copied to the permanent Turso database (when set up).
const w = sql => { const st = db.prepare(sql); return { run: (...a) => { const r = st.run(...a); remote.push(sql, a); return r; } }; };
const J = s => { try { return JSON.parse(s); } catch { return null; } };

// ---------- cache ----------
const kvGet = q("SELECT v, exp FROM kv WHERE k=?"), kvSet = q("INSERT OR REPLACE INTO kv(k,v,exp) VALUES(?,?,?)");
const cache = {
  get(k) { const r = kvGet.get(k); if (!r) return undefined; if (r.exp && r.exp < Date.now()) return undefined; return J(r.v); },
  set(k, v, ttlMs) { kvSet.run(k, JSON.stringify(v), ttlMs ? Date.now() + ttlMs : 0); },
};
setInterval(() => { try { q("DELETE FROM kv WHERE exp>0 AND exp<?").run(Date.now()); q("DELETE FROM sessions WHERE expires<?").run(Date.now()); } catch {} }, 3600e3).unref();

// ---------- users ----------
function userRow(r) {
  if (!r) return null;
  return { id: r.id, email: r.email, phone: r.phone, name: r.name, picture: r.picture, google: !!r.google_sub, guest: !!r.guest, hasPassword: !!r.pass, prefs: J(r.prefs) || {}, stats: J(r.stats) || {}, created: r.created };
}
const users = {
  byId: id => userRow(q("SELECT * FROM users WHERE id=?").get(id)),
  raw: (col, v) => q(`SELECT * FROM users WHERE ${col}=?`).get(v),
  create(f) {
    const a = [f.email || null, f.phone || null, f.google_sub || null, f.name || null, f.pass || null, f.picture || null, f.guest ? 1 : 0, Date.now()];
    const r = q("INSERT INTO users(email,phone,google_sub,name,pass,picture,guest,created) VALUES(?,?,?,?,?,?,?,?)").run(...a);
    const id = Number(r.lastInsertRowid);
    remote.push("INSERT OR REPLACE INTO users(id,email,phone,google_sub,name,pass,picture,guest,created) VALUES(?,?,?,?,?,?,?,?,?)", [id, ...a]);
    return id;
  },
  update(id, f) {
    const cols = Object.keys(f);
    if (!cols.length) return;
    w(`UPDATE users SET ${cols.map(c => c + "=?").join(",")} WHERE id=?`).run(...cols.map(c => (f[c] && typeof f[c] === "object" ? JSON.stringify(f[c]) : f[c])), id);
  },
  remove: id => { for (const t of ["sessions", "trips", "chats"]) remote.push(`DELETE FROM ${t} WHERE user_id=?`, [id]); return w("DELETE FROM users WHERE id=?").run(id); },
};

// ---------- sessions ----------
const sessions = {
  create(token, userId, days = 60) { w("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)").run(token, userId, Date.now() + days * 864e5); },
  user(token) { const r = q("SELECT user_id FROM sessions WHERE token=? AND expires>?").get(token, Date.now()); return r ? r.user_id : null; },
  remove: token => w("DELETE FROM sessions WHERE token=?").run(token),
};

// ---------- trips ----------
const trips = {
  list: userId => q("SELECT id,title,data,updated FROM trips WHERE user_id=? ORDER BY updated DESC").all(userId).map(r => {
    const d = J(r.data) || {};
    return { id: r.id, title: r.title, updated: r.updated, status: d.status, start: d.input && d.input.start, days: d.days ? d.days.length : (d.input && d.input.totalDays) || 0, destination: d.input && d.input.segments && d.input.segments.map(s => s.destination && s.destination.label).join(" → ") };
  }),
  get(id) { const r = q("SELECT * FROM trips WHERE id=?").get(id); return r ? { id: r.id, userId: r.user_id, title: r.title, share: r.share, data: J(r.data) || {}, updated: r.updated } : null; },
  byShare(s) { const r = q("SELECT id FROM trips WHERE share=?").get(s); return r ? trips.get(r.id) : null; },
  create(id, userId, title, data) { const now = Date.now(); w("INSERT INTO trips(id,user_id,title,data,created,updated) VALUES(?,?,?,?,?,?)").run(id, userId, title, JSON.stringify(data), now, now); },
  save(id, data, title) {
    if (title != null) w("UPDATE trips SET data=?, title=?, updated=? WHERE id=?").run(JSON.stringify(data), title, Date.now(), id);
    else w("UPDATE trips SET data=?, updated=? WHERE id=?").run(JSON.stringify(data), Date.now(), id);
  },
  setShare: (id, s) => w("UPDATE trips SET share=? WHERE id=?").run(s, id),
  remove: id => w("DELETE FROM trips WHERE id=?").run(id),
  moveOwner: (from, to) => w("UPDATE trips SET user_id=? WHERE user_id=?").run(to, from),
};

// ---------- chat ----------
const chats = {
  add: (userId, tripId, role, text, sources) => {
    const a = [userId, tripId || "", role, text, sources ? JSON.stringify(sources) : null, Date.now()];
    const r = q("INSERT INTO chats(user_id,trip_id,role,text,sources,ts) VALUES(?,?,?,?,?,?)").run(...a);
    remote.push("INSERT OR REPLACE INTO chats(id,user_id,trip_id,role,text,sources,ts) VALUES(?,?,?,?,?,?,?)", [Number(r.lastInsertRowid), ...a]);
    return r;
  },
  recent: (userId, tripId, n = 40) => q("SELECT role,text,sources,ts FROM (SELECT * FROM chats WHERE user_id=? AND trip_id=? ORDER BY id DESC LIMIT ?) ORDER BY id").all(userId, tripId || "", n).map(r => ({ role: r.role, text: r.text, sources: J(r.sources) || [], ts: r.ts })),
  clear: (userId, tripId) => w("DELETE FROM chats WHERE user_id=? AND trip_id=?").run(userId, tripId || ""),
  moveOwner: (from, to) => w("UPDATE chats SET user_id=? WHERE user_id=?").run(to, from),
};

// ---------- permanent copy (Turso) ----------
// On start-up: make sure the tables exist there, and if this machine's database is empty
// (a fresh Render instance), load everything back from Turso.
const TABLES = { users: ["id", "email", "phone", "google_sub", "name", "pass", "picture", "prefs", "stats", "guest", "created"], sessions: ["token", "user_id", "expires"], trips: ["id", "user_id", "title", "data", "share", "created", "updated"], chats: ["id", "user_id", "trip_id", "role", "text", "sources", "ts"] };
async function restore() {
  if (!remote.enabled()) return { restored: false };
  await remote.exec(SCHEMA.split(";").map(x => x.trim()).filter(x => x && !/^CREATE TABLE IF NOT EXISTS kv/.test(x)).map(sql => ({ sql })));
  const local = q("SELECT COUNT(*) AS n FROM users").get().n;
  if (local > 0) {
    // This machine already has data (e.g. running on a laptop): make sure Turso has it too.
    const n = (await remote.exec([{ sql: "SELECT COUNT(*) AS n FROM users" }]))[0][0].n;
    if (n === 0) for (const [t, cols] of Object.entries(TABLES)) for (const r of q(`SELECT ${cols.join(",")} FROM ${t}`).all()) remote.push(`INSERT OR REPLACE INTO ${t}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`, cols.map(c => r[c]));
    return { restored: false, local };
  }
  const res = await remote.exec(Object.entries(TABLES).map(([t, cols]) => ({ sql: `SELECT ${cols.join(",")} FROM ${t}` })), 60000);
  let count = 0;
  db.exec("BEGIN");
  try {
    Object.entries(TABLES).forEach(([t, cols], i) => {
      const ins = db.prepare(`INSERT OR REPLACE INTO ${t}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`);
      for (const r of res[i]) { ins.run(...cols.map(c => r[c])); count++; }
    });
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return { restored: true, rows: count };
}

module.exports = { db, cache, users, sessions, trips, chats, restore, remote };

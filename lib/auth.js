// Sign-in: Google (free, needs a Client ID), email or phone + password, or guest.
const crypto = require("crypto");
const cfg = require("./config");
const db = require("./db");
const { userErr } = require("./google");

const COOKIE = "raahi_s";
function hash(pass) { const salt = crypto.randomBytes(16).toString("hex"); return salt + ":" + crypto.scryptSync(pass, salt, 64).toString("hex"); }
function verify(pass, stored) {
  if (!stored) return false;
  const [salt, h] = stored.split(":");
  const a = Buffer.from(h, "hex"), b = crypto.scryptSync(pass, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) { const i = part.indexOf("="); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
function currentUser(req) {
  const tok = cookies(req)[COOKIE];
  if (!tok) return null;
  const id = db.sessions.user(tok);
  return id ? db.users.byId(id) : null;
}
function startSession(res, userId) {
  const tok = crypto.randomBytes(32).toString("hex");
  db.sessions.create(tok, userId);
  res.setHeader("Set-Cookie", `${COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 86400}${cfg.SECURE_COOKIES ? "; Secure" : ""}`);
}
function endSession(req, res) {
  const tok = cookies(req)[COOKIE];
  if (tok) db.sessions.remove(tok);
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// "98765 43210" → "+919876543210"; email → lower case.
function identity(raw) {
  const s = String(raw || "").trim();
  if (/@/.test(s)) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw userErr("That email address doesn't look right.");
    return { col: "email", value: s.toLowerCase() };
  }
  let digits = s.replace(/[^\d+]/g, "");
  if (/^\d{10}$/.test(digits)) digits = "+91" + digits;
  else if (/^0\d{10}$/.test(digits)) digits = "+91" + digits.slice(1);
  else if (/^91\d{10}$/.test(digits)) digits = "+" + digits;
  if (!/^\+\d{8,15}$/.test(digits)) throw userErr("Enter an email address or a phone number.");
  return { col: "phone", value: digits };
}

// Login attempts are limited per visitor to stop password guessing.
const tries = new Map();
function slowDown(ip) {
  const now = Date.now(), t = tries.get(ip) || { n: 0, at: now };
  if (now - t.at > 15 * 60e3) { t.n = 0; t.at = now; }
  t.n++; tries.set(ip, t);
  if (t.n > 20) throw userErr("Too many sign-in attempts. Wait 15 minutes and try again.");
}

// When a guest signs up, keep their trips and chats.
function absorbGuest(guest, userId) {
  if (!guest || !guest.guest || guest.id === userId) return;
  db.trips.moveOwner(guest.id, userId);
  db.chats.moveOwner(guest.id, userId);
  const u = db.users.byId(userId);
  if (u && !Object.keys(u.prefs || {}).length && Object.keys(guest.prefs || {}).length) db.users.update(userId, { prefs: guest.prefs });
  db.users.remove(guest.id);
}

const api = {
  register(req, res, b, me, ip) {
    slowDown(ip);
    const id = identity(b.id);
    const pass = String(b.password || "");
    if (pass.length < 6) throw userErr("Choose a password of at least 6 characters.");
    if (db.users.raw(id.col, id.value)) throw userErr(`An account with this ${id.col} already exists. Sign in instead.`);
    const name = String(b.name || "").trim().slice(0, 60) || null;
    let uid;
    if (me && me.guest) { db.users.update(me.id, { [id.col]: id.value, pass: hash(pass), name, guest: 0 }); uid = me.id; }
    else uid = db.users.create({ [id.col]: id.value, pass: hash(pass), name });
    startSession(res, uid);
    return { user: db.users.byId(uid), isNew: true };
  },
  login(req, res, b, me, ip) {
    slowDown(ip);
    const id = identity(b.id);
    const row = db.users.raw(id.col, id.value);
    if (!row || !verify(String(b.password || ""), row.pass)) throw userErr("Wrong email/phone or password.");
    absorbGuest(me, row.id);
    startSession(res, row.id);
    return { user: db.users.byId(row.id) };
  },
  async google(req, res, b, me) {
    if (!cfg.GOOGLE_CLIENT_ID) throw userErr("Google sign-in isn't set up on this server yet (see README).");
    let info;
    try {
      const r = await fetch(`${cfg.GOOGLE_TOKENINFO}?id_token=${encodeURIComponent(String(b.credential || ""))}`, { signal: AbortSignal.timeout(8000) });
      info = await r.json();
      if (!r.ok) throw 0;
    } catch { throw userErr("Google sign-in failed. Try again."); }
    if (info.aud !== cfg.GOOGLE_CLIENT_ID || !/accounts\.google\.com$/.test(info.iss || "") || +info.exp * 1000 < Date.now()) throw userErr("Google sign-in couldn't be verified.");
    const email = info.email_verified === "true" || info.email_verified === true ? String(info.email || "").toLowerCase() : null;
    let row = db.users.raw("google_sub", info.sub) || (email && db.users.raw("email", email));
    let isNew = false;
    if (row) db.users.update(row.id, { google_sub: info.sub, picture: info.picture || row.picture, name: row.name || info.name || null, guest: 0 });
    else if (me && me.guest) { db.users.update(me.id, { google_sub: info.sub, email, name: info.name || null, picture: info.picture || null, guest: 0 }); row = { id: me.id }; isNew = true; }
    else { row = { id: db.users.create({ google_sub: info.sub, email, name: info.name, picture: info.picture }) }; isNew = true; }
    absorbGuest(me, row.id);
    startSession(res, row.id);
    return { user: db.users.byId(row.id), isNew };
  },
  guest(req, res, b, me) {
    if (me) return { user: me };
    const uid = db.users.create({ guest: true, name: null });
    startSession(res, uid);
    return { user: db.users.byId(uid), isNew: true };
  },
  logout(req, res) { endSession(req, res); return { ok: true }; },
};

module.exports = { api, currentUser, identity, hash, verify };

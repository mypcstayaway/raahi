// Reads opening hours written in OpenStreetMap style, e.g.
//   "Mo-Su 09:00-17:30"   "Tu-Su 10:00-17:00; Mo off"   "Sa-Th 06:00-19:00; Fr off"
//   "Mo-Fr 09:00-13:00,14:00-18:00"   "24/7"   "sunrise-sunset"
// Returns 7 lists of [open, close] minutes (index 0 = Sunday), or null if it can't be read safely.
const DAYS = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mo..Su

function tm(s) {
  s = s.trim().toLowerCase();
  if (s === "sunrise") return 6 * 60;
  if (s === "sunset") return 18 * 60 + 30;
  if (s === "dawn") return 5 * 60 + 30;
  if (s === "dusk") return 19 * 60;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return +m[1] * 60 + +m[2];
}
function dayList(sel) {
  const out = new Set();
  for (const part of sel.split(",")) {
    const p = part.trim().toLowerCase();
    if (p === "ph" || p === "sh") continue;
    const r = p.match(/^([a-z]{2})(?:\[[^\]]*\])?(?:\s*-\s*([a-z]{2}))?$/);
    if (!r || !(r[1] in DAYS) || (r[2] && !(r[2] in DAYS))) return null;
    if (!r[2]) { out.add(DAYS[r[1]]); continue; }
    let i = ORDER.indexOf(DAYS[r[1]]);
    const end = ORDER.indexOf(DAYS[r[2]]);
    for (let k = 0; k < 7; k++) { out.add(ORDER[i]); if (i === end) break; i = (i + 1) % 7; }
  }
  return [...out];
}
function times(sel) {
  const out = [];
  for (const part of sel.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const plus = p.match(/^(\S+)\+$/);
    if (plus) { const a = tm(plus[1]); if (a == null) return null; out.push([a, Math.max(a + 60, 23 * 60)]); continue; }
    const r = p.split("-");
    if (r.length !== 2) return null;
    const a = tm(r[0]); let b = tm(r[1]);
    if (a == null || b == null) return null;
    if (b <= a) b += 24 * 60; // past midnight
    out.push([a, b]);
  }
  return out;
}

function parseHours(str) {
  if (!str || typeof str !== "string") return null;
  const s = str.trim().replace(/\s+/g, " ");
  if (/^24\/7$/i.test(s)) return Array.from({ length: 7 }, () => [[0, 24 * 60]]);
  const week = Array.from({ length: 7 }, () => null);
  let any = false;
  for (let rule of s.split(";")) {
    rule = rule.trim().replace(/^"|"$/g, "");
    if (!rule) continue;
    // Seasonal / date-specific rules can't be applied reliably; give up so the caller can fall back.
    if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|week|easter|\d{4})\b/i.test(rule)) return null;
    if (/^ph\b/i.test(rule)) continue; // public holidays
    rule = rule.replace(/\s*,\s*/g, ",").replace(/\s*-\s*/g, "-");
    const sp = rule.indexOf(" ");
    const head = sp > 0 ? rule.slice(0, sp) : rule, tail = sp > 0 ? rule.slice(sp + 1) : "";
    let days, rest;
    const dl = /^[A-Za-z]/.test(head) && !/^(sunrise|sunset|dawn|dusk|off|closed)/i.test(head) ? dayList(head) : null;
    if (dl && dl.length && tail) { days = dl; rest = tail.trim(); }
    else if (/^[A-Za-z]{2}/.test(head) && !/^(sunrise|sunset|dawn|dusk|off|closed)/i.test(head) && !tail) return null;
    else { days = [0, 1, 2, 3, 4, 5, 6]; rest = rule; }
    rest = rest.replace(/"[^"]*"/g, "").trim();
    if (/^(off|closed)$/i.test(rest)) { for (const d of days) week[d] = []; any = true; continue; }
    if (/^24\/7$|^00:00-24:00$/.test(rest)) { for (const d of days) week[d] = [[0, 1440]]; any = true; continue; }
    const t = times(rest);
    if (!t || !t.length) return null;
    for (const d of days) week[d] = t; // later rules override earlier ones, as in OSM
    any = true;
  }
  if (!any) return null;
  // Days never mentioned are closed (OSM convention).
  return week.map(x => x || []);
}

const hhmm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const DNAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// "Open 09:00–17:30 · Closed Mon" style summary.
function describe(week) {
  if (!week) return "Hours not known";
  const sig = week.map(iv => iv.map(([a, b]) => `${hhmm(a)}–${hhmm(b)}`).join(", "));
  const open = sig.filter(Boolean);
  if (!open.length) return "Closed";
  const common = open.sort((a, b) => open.filter(x => x === b).length - open.filter(x => x === a).length)[0];
  const closed = week.map((iv, i) => (iv.length ? null : DNAMES[i])).filter(Boolean);
  const other = sig.map((x, i) => (x && x !== common ? `${DNAMES[i]} ${x}` : null)).filter(Boolean);
  if (common === "00:00–00:00") return "Open 24 hours";
  return [`Open ${common}`, other.length ? other.join("; ") : null, closed.length ? `Closed ${closed.join(", ")}` : null].filter(Boolean).join(" · ");
}

module.exports = { parseHours, describe, hhmm, tm };

// "I live in Agra, I have 6 days and ₹30,000. Where can I go?"  and quick advice.
const ai = require("./ai");
const P = require("./prompts");
const places = require("./places");
const { userErr } = require("./google");
const { cache } = require("./db");
const tf = require("./tinyfish");
const { solve, pathCost } = require("./solver");
const within = (p, ms, fallback) => Promise.race([p, new Promise(r => setTimeout(() => r(fallback), ms))]);
const str = (v, n = 300) => String(v == null ? "" : v).slice(0, n);

async function explore(user, b) {
  if (!ai.enabled()) throw userErr("Trip ideas need the free AI key (see README).");
  if (!b.home || !b.home.label) throw userErr("Tell me where you are starting from.");
  const days = Math.max(1, Math.min(30, Math.round(+b.days || 3)));
  const req = { ...b, days, baby: user.prefs && user.prefs.baby && user.prefs.baby.on ? user.prefs.baby : null };
  const key = "explore:" + JSON.stringify([(user.prefs || {}).lang || "en", !!req.baby, b.home.label, days, b.start, b.month, b.travellers, b.budget, b.per, b.transport, b.scope, b.interests, b.pace, b.diet]);
  const hit = cache.get(key);
  if (hit) return hit;
  let home = b.home;
  if (home.lat == null) { const g = await places.geocode(home.label); if (!g) throw userErr("I couldn't find your home city."); home = { ...g, label: home.label }; }
  const r = await ai.askJSON({ ...P.explorePrompt({ ...req, home }, user.prefs || {}), search: ai.canSearch(), think: true, ms: 150000 });
  const options = ((r.data && r.data.options) || []).slice(0, 8);
  // Locate each option's first stop and get real road distance from home.
  await Promise.all(options.map(async o => {
    o.destinations = (o.destinations || []).slice(0, 6);
    await Promise.all(o.destinations.map(async dst => {
      let g = null;
      try { g = await places.geocode(dst.search || dst.name); } catch {}
      if (g) { dst.lat = g.lat; dst.lng = g.lng; dst.country = g.country; }
    }));
  }));
  const firsts = options.map(o => o.destinations.find(x => isFinite(x.lat))).filter(Boolean);
  if (firsts.length) {
    try {
      const near = firsts.filter(x => places.haversine(home, x) < 2500e3);
      const mx = near.length ? await places.table([home, ...near]) : null;
      near.forEach((x, i) => { const dm = mx.d[0][i + 1], tm = mx.t[0][i + 1]; if (dm < 1e11) { x.roadKm = Math.round(dm / 1000); x.roadMin = Math.round((tm / 60) * 1.15); } });
    } catch {}
    for (const x of firsts) if (x.roadKm == null) x.straightKm = Math.round(places.haversine(home, x) / 1000);
  }
  const out = { home, options, sources: r.sources || [] };
  cache.set(key, out, 12 * 3600e3);
  return out;
}

// ---------- Thread trip: a loop through several places, from home and back ----------
const MODES = ["car", "bus", "train", "flight", "ferry", "walk"];
function cleanLeg(l) {
  if (!l || typeof l !== "object") return null;
  const mode = MODES.find(m => String(l.mode || "").toLowerCase().includes(m)) || (l.mode ? "car" : "");
  return { from: str(l.from, 80), to: str(l.to, 80), mode, hours: isFinite(+l.hours) ? Math.max(0, +l.hours) : null, km: isFinite(+l.km) ? Math.round(+l.km) : null, fare: str(l.fare, 60), depart: str(l.depart, 30), tip: str(l.tip, 200) };
}
function cleanStop(x) {
  const list = (a, n, f) => (Array.isArray(a) ? a : []).slice(0, n).map(f).filter(Boolean);
  return {
    name: str(x.name, 80), search: str(x.search || x.name, 120), lat: +x.lat, lng: +x.lng, nights: Math.max(0, Math.min(10, Math.round(+x.nights || 0))),
    leg: cleanLeg(x.leg), arriveBy: str(x.arriveBy, 30), why: str(x.why, 200),
    plan: list(x.plan, 8, p => p && p.what ? { time: str(p.time, 30), what: str(p.what, 140), tip: str(p.tip, 200) } : null),
    timings: list(x.timings, 6, t => t && t.what ? { what: str(t.what, 100), time: str(t.time, 60) } : null),
    fees: list(x.fees, 6, f => f && f.what ? { what: str(f.what, 100), price: str(f.price, 60) } : null),
    warnings: list(x.warnings, 4, w => (w ? str(w, 200) : null)),
    stay: str(x.stay, 200), food: str(x.food, 200),
  };
}

async function thread(user, b) {
  if (!ai.enabled()) throw userErr("Thread trips need the free AI key (see README).");
  if (!b.home || !b.home.label) throw userErr("Tell me where you are starting from.");
  const days = Math.max(2, Math.min(30, Math.round(+b.days || 7)));
  const baby = user.prefs && user.prefs.baby && user.prefs.baby.on ? user.prefs.baby : null;
  const req = { ...b, days, include: str(b.include, 300), region: str(b.region, 120), loop: b.loop !== false, flexible: !!b.flexible, around: !!b.around, baby };
  const key = "thread:" + JSON.stringify([(user.prefs || {}).lang || "en", b.home.label, days, req.include, req.region, req.loop, req.flexible, req.around, !!baby, b.start, b.travellers, b.budget, b.per, b.transport, b.interests, b.pace, b.diet, b.variant || 0]);
  const hit = cache.get(key);
  if (hit) return hit;
  let home = b.home;
  if (home.lat == null) { const g = await within(places.geocode(home.label).catch(() => null), 6000, null); if (!g) throw userErr("I couldn't find your home city."); home = { ...g, label: home.label }; }

  // TinyFish: fresh web facts (ritual timings, fees) for the places the traveller named. At most 5 s.
  let evidence = [];
  const named = req.include.split(/,|\n|\band\b|;/i).map(x => x.trim()).filter(x => x.length > 2).slice(0, 4);
  if (tf.enabled() && named.length) {
    const res = await within(Promise.all(named.map(n => tf.search(`${n} temple timings aarti darshan entry fee`, { purpose: `Visiting ${n}: opening and ritual timings, entry fees, tips` }).catch(() => []))), 5000, []);
    evidence = res.map(r => r.slice(0, 4)).flat();
  }
  const prompt = P.threadPrompt({ ...req, home }, user.prefs || {}, evidence);
  if (b.variant) prompt.prompt += `\n\nThe traveller has already seen ${b.variant} other loop(s) and wants a DIFFERENT one this time (different places or direction).`;
  const r = await ai.askJSON({ ...prompt, think: true, ms: 120000 });
  const t = r.data || {};
  const out = {
    title: str(t.title, 100) || `${days}-day loop from ${home.label.split(",")[0]}`, summary: str(t.summary, 400), flexNote: str(t.flexNote, 200),
    totalDays: Math.max(2, Math.min(30, Math.round(+t.totalDays || days))),
    around: req.around,
    gateway: !req.around && t.gateway && t.gateway.name ? { name: str(t.gateway.name, 80), search: str(t.gateway.search || t.gateway.name, 120), how: str(t.gateway.how, 300) } : null,
    stops: (Array.isArray(t.stops) ? t.stops : []).slice(0, 7).map(cleanStop).filter(x => x.name),
    returnLeg: cleanLeg(t.returnLeg), loop: req.loop,
    cost: t.cost && typeof t.cost === "object" ? { total: +t.cost.total || null, perPerson: +t.cost.perPerson || null, note: str(t.cost.note, 200) } : null,
    season: str(t.season, 200), rating: +t.rating ? Math.max(0, Math.min(10, +t.rating)) : null,
  };
  if (!out.stops.length) throw userErr("Raahi couldn't build a loop this time. Try again, or add a place you want to include.");

  // Put every stop on the map (in parallel, max 6 s); fall back to the AI's coordinates.
  const locate = async x => {
    const g = await within(places.geocode(x.search).catch(() => null), 6000, null);
    if (g) { x.lat = g.lat; x.lng = g.lng; } else if (!(isFinite(x.lat) && isFinite(x.lng) && (x.lat || x.lng))) { x.lat = null; x.lng = null; }
  };
  await Promise.all([...out.stops.map(locate), out.gateway ? locate(out.gateway) : null]);
  out.stops = out.stops.filter(x => x.lat != null);
  if (!out.stops.length) throw userErr("I couldn't find the loop's places on the map. Try again.");

  // Real road distances along the loop, and a shorter order if there is one.
  const startPt = out.gateway && out.gateway.lat != null ? out.gateway : home;
  const pts = [startPt, ...out.stops];
  try {
    const near = pts.every(p => places.haversine(startPt, p) < 2500e3);
    const mx = near ? await within(places.table(pts, 10000), 11000, null) : null;
    if (mx) {
      out.stops.forEach((x, i) => {
        const dm = mx.d[i][i + 1], tm = mx.t[i][i + 1];
        if (dm < 1e11 && x.leg && /car|bus/.test(x.leg.mode || "car")) { x.leg.km = Math.round(dm / 1000); x.leg.roadHours = Math.round((tm / 3600) * 1.15 * 10) / 10; }
      });
      const round = out.loop;
      const cur = pts.map((_, i) => i);
      const best = pts.length >= 4 ? solve(mx.d, { fixed: true, round }) : null;
      if (best) {
        const a = pathCost(mx.d, cur, round), c = pathCost(mx.d, best.order, round);
        if (a - c > 40000 && (a - c) / a > 0.1) out.betterOrder = { names: best.order.slice(1).map(i => pts[i].name), savesKm: Math.round((a - c) / 1000) };
      }
    }
  } catch {}
  out.home = { label: home.label, lat: home.lat, lng: home.lng };
  out.checked = evidence.length ? named : [];
  const res = { home, thread: out, sources: [...(r.sources || []), ...evidence.filter(e => e.url).slice(0, 6).map(e => ({ title: e.title, url: e.url }))] };
  cache.set(key, res, 12 * 3600e3);
  return res;
}

async function advice(user, b) {
  if (!ai.enabled()) throw userErr("Suggestions need the free AI key (see README).");
  const kind = b.kind === "howlong" ? "howlong" : "when";
  if (!b.destination) throw userErr("Pick a destination first.");
  const key = `adv:${(user.prefs || {}).lang || "en"}:${kind}:${String(b.destination).toLowerCase()}:${b.days || ""}:${b.pace || ""}:${(b.interests || []).join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = await ai.askJSON({ ...P.advicePrompt(kind, b, user.prefs || {}), search: kind === "when" && ai.canSearch(), fast: true, ms: 60000 });
  const out = { kind, ...(r.data || {}), sources: r.sources || [] };
  cache.set(key, out, 7 * 86400e3);
  return out;
}

module.exports = { explore, advice, thread };

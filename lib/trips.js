// Builds and updates trip plans.
const crypto = require("crypto");
const ai = require("./ai");
const tf = require("./tinyfish");
const P = require("./prompts");
const places = require("./places");
const { parseHours, describe, tm, hhmm } = require("./hours");
const { schedule, feasibility } = require("./scheduler");
const db = require("./db");
const { userErr } = require("./google");

const PACE = {
  fast: { maxStops: 7, visitF: 0.75, start: "07:30", end: "20:30", lunch: 45 },
  balanced: { maxStops: 5, visitF: 1, start: "09:00", end: "19:30", lunch: 60 },
  slow: { maxStops: 3, visitF: 1.35, start: "10:00", end: "18:30", lunch: 75 },
};
const VISIT = { monument: 90, temple: 45, mosque: 40, gurudwara: 45, church: 30, museum: 90, fort: 120, palace: 90, nature: 90, lake: 60, waterfall: 60, viewpoint: 30, market: 75, beach: 120, park: 60, zoo: 150, adventure: 150, food: 60, experience: 90, other: 60 };
const MAX_KM = 90;

const id8 = () => crypto.randomBytes(6).toString("base64url");
// Wait at most `ms` for a slow free service; then carry on without it.
const within = (p, ms, fallback) => Promise.race([p, new Promise(r => setTimeout(() => r(fallback), ms))]);
const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekday = d => (d ? new Date(d + "T00:00:00Z").getUTCDay() : 7);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cityOf = seg => String(seg.destination.label || "").split(",")[0].trim();

function paceFor(input, user) {
  const prefs = (user && user.prefs) || {}, stats = (user && user.stats) || {};
  let key = input.pace || prefs.pace || "balanced", p;
  if (key === "auto") {
    const f = clamp(stats.paceFactor || 1, 0.6, 1.6);
    p = { maxStops: f < 0.85 ? 6 : f < 1.15 ? 5 : 4, visitF: f, start: "09:00", end: "19:30", lunch: 60, auto: true, learned: !!stats.paceFactor };
  } else p = { ...(PACE[key] || PACE.balanced) };
  if (prefs.early || input.early) p.start = key === "slow" ? "08:30" : "07:00";
  if (input.startTime) p.start = input.startTime;
  if (input.endTime) p.end = input.endTime;
  return { key, ...p };
}

// ---------- progress (kept in memory and in the trip) ----------
const STEPS = ["Understanding your trip", "Asking Raahi for the best places", "Finding them on the map", "Checking real opening hours", "Working out the shortest order", "Finding places to eat", "Checking the weather"];
function progress(trip, step, extra) {
  trip.data.status = "planning";
  trip.data.progress = { step, text: STEPS[step], total: STEPS.length, ...extra };
  db.trips.save(trip.id, trip.data);
}

// ---------- create ----------
function cleanInput(b) {
  const pt = x => (x && isFinite(+x.lat) && isFinite(+x.lng) ? { label: String(x.label || x.name || "").slice(0, 200), lat: +x.lat, lng: +x.lng, country: x.country || "" } : x && x.label ? { label: String(x.label).slice(0, 200) } : null);
  // Thread trips carry, for each stop, how you get there and the must-do list (kept small and plain).
  const S = (v, n = 200) => String(v == null ? "" : v).slice(0, n);
  const arr = (a, n, f) => (Array.isArray(a) ? a : []).slice(0, n).map(f).filter(Boolean);
  const leg = l => (l && typeof l === "object" ? { from: S(l.from, 80), to: S(l.to, 80), mode: S(l.mode, 12), hours: isFinite(+l.hours) ? +l.hours : null, roadHours: isFinite(+l.roadHours) ? +l.roadHours : null, km: isFinite(+l.km) ? Math.round(+l.km) : null, fare: S(l.fare, 60), depart: S(l.depart, 30), tip: S(l.tip) } : null);
  const tStop = x => (x && typeof x === "object" ? { name: S(x.name, 80), leg: leg(x.leg), arriveBy: S(x.arriveBy, 30), why: S(x.why), plan: arr(x.plan, 8, p => p && p.what ? { time: S(p.time, 30), what: S(p.what, 140), tip: S(p.tip) } : null), timings: arr(x.timings, 6, t => t && t.what ? { what: S(t.what, 100), time: S(t.time, 60) } : null), fees: arr(x.fees, 6, f => f && f.what ? { what: S(f.what, 100), price: S(f.price, 60) } : null), warnings: arr(x.warnings, 4, w => (w ? S(w) : null)), stay: S(x.stay), food: S(x.food) } : null);
  const segs = (Array.isArray(b.segments) ? b.segments : []).slice(0, 8).map(s => ({ destination: pt(s.destination), days: clamp(Math.round(+s.days || 1), 1, 15), stay: s.stay && s.stay.decide ? { decide: true, label: "Let Raahi decide" } : pt(s.stay), thread: tStop(s.thread) })).filter(s => s.destination && s.destination.label);
  segs.forEach(s => { if (!s.thread) delete s.thread; });
  const th = b.thread && typeof b.thread === "object" ? { title: S(b.thread.title, 100), summary: S(b.thread.summary, 400), home: pt(b.thread.home), gateway: b.thread.gateway && b.thread.gateway.name ? { name: S(b.thread.gateway.name, 80), how: S(b.thread.gateway.how, 300) } : null, returnLeg: leg(b.thread.returnLeg), loop: b.thread.loop !== false, flexNote: S(b.thread.flexNote) } : null;
  if (!segs.length) throw userErr("Tell me where you are going.");
  const total = segs.reduce((a, s) => a + s.days, 0);
  if (total > 30) throw userErr("Trips can be up to 30 days.");
  const time = v => (/^\d{1,2}:\d{2}$/.test(v || "") ? v : null);
  const date = v => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : null);
  return {
    segments: segs, totalDays: total, start: date(b.start), hereNow: !!b.hereNow,
    here: b.here && isFinite(+b.here.lat) ? { label: "Where you are now", lat: +b.here.lat, lng: +b.here.lng } : null,
    nowMin: isFinite(+b.nowMin) ? clamp(+b.nowMin, 0, 1439) : null,
    startTime: time(b.startTime), endTime: time(b.endTime), arriveTime: time(b.arriveTime), leaveTime: time(b.leaveTime),
    pace: ["fast", "balanced", "slow", "auto"].includes(b.pace) ? b.pace : null, early: !!b.early,
    travellers: clamp(Math.round(+b.travellers || 1), 1, 50), group: String(b.group || "").slice(0, 40),
    budget: b.budget && +b.budget.amount > 0 ? { amount: Math.round(+b.budget.amount), per: b.budget.per === "person" ? "person" : "total", currency: "₹" } : null,
    interests: (Array.isArray(b.interests) ? b.interests : []).map(String).slice(0, 25),
    avoid: (Array.isArray(b.avoid) ? b.avoid : []).map(String).slice(0, 10),
    diet: String(b.diet || "").slice(0, 30), transport: String(b.transport || "").slice(0, 40),
    detail: ["quick", "review", "max"].includes(b.detail) ? b.detail : "review",
    notes: String(b.notes || "").slice(0, 600),
    ...(th ? { thread: th } : {}),
  };
}

function titleOf(input) {
  const names = input.segments.map(cityOf);
  return `${input.totalDays} day${input.totalDays > 1 ? "s" : ""} in ${names.join(" → ")}`;
}

function create(user, body) {
  const input = cleanInput(body);
  const id = id8();
  const data = { status: "planning", progress: { step: 0, text: STEPS[0], total: STEPS.length }, input, places: {}, info: [], days: [], dropped: [], checkins: {}, expenses: [], packed: {}, pulse: {}, created: Date.now() };
  db.trips.create(id, user.id, titleOf(input), data);
  run(id, user, "full");
  return id;
}

const running = new Set();
function run(id, user, phase) {
  if (running.has(id)) return;
  running.add(id);
  (async () => {
    const trip = db.trips.get(id);
    try {
      if (phase === "full") await gather(trip, user);
      if (trip.data.status !== "review") await plan(trip, user);
    } catch (e) {
      console.error("plan failed:", e);
      trip.data.status = "error";
      trip.data.error = e.user || e instanceof places.NetError ? e.message : "Something went wrong while planning. Try again.";
      if (e instanceof places.NetError) trip.data.error = `The free map services are not answering right now (${e.message}). Please try again in a minute.`;
      db.trips.save(trip.id, trip.data);
    } finally { running.delete(id); }
  })();
}

// ---------- step 1-4: find candidate places ----------
async function gather(trip, user) {
  const d = trip.data, input = d.input, prefs = user.prefs || {};
  progress(trip, 0);
  // Locate destination and stay for each part of the trip.
  let offset = 0;
  for (const seg of input.segments) {
    if (seg.destination.lat == null) {
      const g = await places.geocode(seg.destination.label).catch(async e => {
        if (!(e instanceof places.NetError)) throw e;
        await new Promise(r => setTimeout(r, 3000)); // the free map server was busy: wait and try once more
        return places.geocode(seg.destination.label);
      });
      if (!g) throw userErr(`I couldn't find "${seg.destination.label}" on the map. Try adding the state or country.`);
      Object.assign(seg.destination, g, { label: seg.destination.label });
    }
    if (seg.stay && !seg.stay.decide && seg.stay.lat == null) {
      const g = await places.geocode(seg.stay.label, seg.destination).catch(() => null);
      seg.stay = g ? { ...g, label: seg.stay.label } : null;
    }
    seg.startDate = input.start ? addDays(input.start, offset) : null;
    seg.endDate = input.start ? addDays(input.start, offset + seg.days - 1) : null;
    seg.offset = offset;
    offset += seg.days;
  }
  const pace = paceFor(input, user);
  d.pace = pace;

  progress(trip, 1);
  d.info = [];
  d.aiUsed = ai.enabled();
  const found = await Promise.all(input.segments.map(async (seg, si) => {
    const count = clamp(Math.ceil(seg.days * pace.maxStops * 1.6) + 3, 8, 36);
    if (ai.enabled()) {
      try {
        const pr = P.planPrompt(seg, input, prefs, count);
        let r;
        try { r = await ai.askJSON({ ...pr, search: ai.canSearch(), think: true, ms: 150000 }); }
        catch (e) { if (e.code === "net") throw e; r = await ai.askJSON({ ...pr, think: true, ms: 120000 }); }
        return { si, ai: r.data, sources: r.sources };
      } catch (e) {
        d.aiError = e.message;
      }
    }
    // Free fallback without AI: well-known attractions from OpenStreetMap.
    const els = await places.osmAttractions(seg.destination, input.interests).catch(() => []);
    return { si, osm: els.slice(0, count) };
  }));

  progress(trip, 2);
  const all = {};
  await Promise.all(found.map(async f => {
    const seg = input.segments[f.si], city = cityOf(seg);
    let list;
    if (f.ai) {
      const { places: pl = [], ...info } = f.ai;
      d.info[f.si] = { ...info, sources: f.sources || [] };
      list = pl.filter(p => p && p.name).slice(0, 40).map(p => ({
        name: String(p.name), search: p.search || `${p.name}, ${city}`, aiLat: +p.lat, aiLng: +p.lng,
        category: VISIT[p.category] ? p.category : "other", why: p.why || "", highlights: (p.highlights || []).slice(0, 5),
        hoursText: p.hours || null, hoursSource: p.hours ? "AI estimate" : null, hoursNote: p.hoursNote || "",
        ticket: p.ticket || null, visitMin: clamp(Math.round(+p.visitMin || VISIT[p.category] || 60), 15, 480),
        bestTimeOfDay: p.bestTimeOfDay || "", priority: clamp(+p.priority || 3, 1, 5), rating: +p.rating ? clamp(+p.rating, 0, 10) : null, tips: p.tips || "", nearbyFood: p.nearbyFood || "",
      }));
    } else {
      d.info[f.si] = { summary: "", noAI: true };
      list = (f.osm || []).map(e => {
        const t = e.tags, cat = t.amenity === "place_of_worship" ? ({ hindu: "temple", muslim: "mosque", sikh: "gurudwara", christian: "church" }[t.religion] || "temple") : t.tourism === "museum" ? "museum" : t.tourism === "viewpoint" ? "viewpoint" : /castle|fort/.test(t.historic || "") ? "fort" : t.historic ? "monument" : t.leisure ? "park" : "other";
        return { name: t["name:en"] || t.name, search: t.name, lat: e.lat, lng: e.lng, category: cat, why: "", highlights: [], hoursText: t.opening_hours || null, hoursSource: t.opening_hours ? "OpenStreetMap" : null, hoursNote: "", ticket: t.fee === "no" ? { indian: "Free" } : null, visitMin: VISIT[cat], bestTimeOfDay: "", priority: clamp(Math.round(e.score / 2), 1, 5), rating: null, tips: "", website: t.website || null, wikipedia: t.wikipedia || null };
      });
    }
    // Put each place on the map (in parallel), keeping only those near the destination.
    // Map search runs in parallel with a time limit: if the free server is slow, use the AI's coordinates.
    const geoBudget = Date.now() + 6000;
    const located = await Promise.all(list.map(async p => {
      if (p.lat != null) return p;
      let g = null;
      try { g = await within(places.geocode(p.search, seg.destination), Math.max(500, geoBudget - Date.now()), null); } catch {}
      const aiPt = isFinite(p.aiLat) && isFinite(p.aiLng) && (p.aiLat || p.aiLng) ? { lat: p.aiLat, lng: p.aiLng } : null;
      if (g && places.haversine(g, seg.destination) / 1000 < MAX_KM && (!aiPt || places.haversine(g, aiPt) < 25000)) return { ...p, lat: g.lat, lng: g.lng, mapName: g.name };
      if (aiPt && places.haversine(aiPt, seg.destination) / 1000 < MAX_KM) return { ...p, ...aiPt, approx: true };
      return null;
    }));
    const kept = [];
    for (const p of located.filter(Boolean)) {
      if (kept.some(k => places.similar(k.name, p.name) >= 0.99 || places.haversine(k, p) < 40)) continue;
      kept.push(p);
    }
    for (const p of kept) { const pid = id8(); delete p.aiLat; delete p.aiLng; all[pid] = { id: pid, seg: f.si, ...p }; }
  }));

  progress(trip, 3);
  const det = await within(places.osmDetails(Object.values(all)).catch(() => ({})), 8000, {}); // OSM opening hours: max 8 s
  for (const [pid, o] of Object.entries(det)) {
    const p = all[pid];
    if (o.hours && parseHours(o.hours)) { p.hoursText = o.hours; p.hoursSource = "OpenStreetMap"; }
    p.website = p.website || o.website; p.wikipedia = p.wikipedia || o.wikipedia;
  }
  for (const p of Object.values(all)) { if (p.hoursText && !parseHours(p.hoursText)) { p.hoursNote = [p.hoursNote, p.hoursText].filter(Boolean).join(" · "); p.hoursText = null; p.hoursSource = null; } p.hoursDesc = describe(parseHours(p.hoursText)); }

  // Pre-select the best places to fill the days; the rest are "more ideas".
  d.places = all;
  input.segments.forEach((seg, si) => {
    const capacity = seg.days * pace.maxStops;
    const list = Object.values(all).filter(p => p.seg === si).sort((a, b) => b.priority - a.priority || (b.rating || 0) - (a.rating || 0));
    list.forEach((p, i) => { p.selected = i < Math.ceil(capacity * 1.15); });
  });
  if (!Object.keys(all).length) throw userErr(d.aiError ? `The AI couldn't make the list: ${d.aiError}` : "I couldn't find places to visit there. Try a bigger town or city nearby, or add places yourself.");
  d.status = input.detail === "quick" ? "planning" : "review";
  db.trips.save(trip.id, d);
}

// ---------- step 5-7: schedule ----------
// fromDay: days before this one are kept as they are (used when re-planning during the trip).
async function plan(trip, user, { fromDay = 0, quick = false } = {}) {
  const d = trip.data, input = d.input;
  const oldDays = d.days || [];
  const pace = d.pace || paceFor(input, user);
  progress(trip, 4);
  const lockedDays = d.days.slice(0, fromDay);
  const lockedIds = new Set(lockedDays.flatMap(day => day.items.filter(i => i.type === "visit").map(i => i.id)));
  const newDays = [];
  const dropped = [];
  let estimated = false;
  for (const [si, seg] of input.segments.entries()) {
    const stay = seg.stay && seg.stay.decide ? (quick && seg.suggestedStay ? { ...seg.suggestedStay, suggested: true } : await pickStay(d, seg, si)) : seg.stay || { label: cityOf(seg) + " (city centre)", lat: seg.destination.lat, lng: seg.destination.lng, guessed: true };
    const nodes = [stay];
    const prevSeg = input.segments[si - 1];
    const prevStay = prevSeg && (prevSeg.stay || prevSeg.destination);
    if (prevStay) nodes.push(prevStay);
    const hereNode = input.hereNow && si === 0 && input.here ? nodes.push(input.here) - 1 : null;
    const prevNode = prevStay ? 1 : null;
    const plist = Object.values(d.places).filter(p => p.seg === si && p.selected && !lockedIds.has(p.id) && !(d.checkins[p.id] && d.checkins[p.id].done && fromDay > 0));
    const base = nodes.length;
    plist.forEach((p, i) => { p._node = base + i; });
    const mx = await places.tableOrEstimate([...nodes, ...plist], quick ? 8000 : 20000);
    estimated = estimated || mx.estimated;
    // Days in this part of the trip
    const days = [];
    for (let k = 0; k < seg.days; k++) {
      const g = seg.offset + k;
      if (g < fromDay) continue;
      const date = input.start ? addDays(input.start, g) : null;
      let start = tm(pace.start), end = tm(pace.end), from = 0, note = "";
      if (g === 0 && input.arriveTime) { start = Math.max(start, tm(input.arriveTime) + 45); note = `Arriving ${input.arriveTime}`; }
      if (g === 0 && input.hereNow && input.nowMin != null) { start = Math.ceil((input.nowMin + 10) / 15) * 15; if (hereNode != null) from = hereNode; }
      if (k === 0 && prevNode != null && g >= fromDay) {
        const drive = Math.round(mx.t[prevNode][0] / 60 * 1.15);
        start = Math.max(start, tm(pace.start) + drive);
        const L = seg.thread && seg.thread.leg;
        note = L && L.mode && !/car|bus/.test(L.mode)
          ? `Travel day: ${cityOf(prevSeg)} → ${cityOf(seg)} by ${L.mode}${L.hours ? `, about ${fmtMin(Math.round(L.hours * 60))}` : ""}${L.depart ? `, leave ${L.depart}` : ""}${L.tip ? `. ${L.tip}` : ""}`
          : `Travel day: ${cityOf(prevSeg)} → ${cityOf(seg)}, about ${fmtMin(drive)} by road (${Math.round(mx.d[prevNode][0] / 1000)} km)${L && L.depart ? `, leave ${L.depart}` : ""}${L && L.tip ? `. ${L.tip}` : ""}`;
        from = 0;
      }
      if (input.thread && g === 0 && si === 0 && !input.hereNow) {
        const first = (input.thread.gateway && input.thread.gateway.how) || (seg.thread && seg.thread.leg && seg.thread.leg.tip) || "";
        if (first) note = [note, `Getting here: ${first}`].filter(Boolean).join(" · ");
      }
      if (input.thread && g === input.totalDays - 1 && input.thread.returnLeg && (input.thread.returnLeg.to || input.thread.returnLeg.mode)) {
        const R = input.thread.returnLeg;
        note = [note, `Head home: ${R.from || cityOf(seg)} → ${R.to || "home"}${R.mode ? ` by ${R.mode}` : ""}${R.depart ? `, leave ${R.depart}` : ""}${R.tip ? `. ${R.tip}` : ""}`].filter(Boolean).join(" · ");
      }
      if (g === input.totalDays - 1 && input.leaveTime) { end = Math.min(end, tm(input.leaveTime) - 60); note = [note, `Leaving ${input.leaveTime}`].filter(Boolean).join(" · "); }
      days.push({ g, k, date, weekday: weekday(date), start, end, from, to: 0, maxStops: end - start < 90 ? 0 : pace.maxStops, note, noLunch: false });
    }
    if (!days.length) continue;
    const sp = plist.map(p => {
      let h = parseHours(p.hoursText);
      if (h && !input.start) { // no dates yet: use the most common opening hours
        const sig = h.map(x => JSON.stringify(x)).filter(x => x !== "[]");
        const best = sig.sort((a, b) => sig.filter(x => x === b).length - sig.filter(x => x === a).length)[0];
        h = [...h, best ? JSON.parse(best) : []];
      } else if (h) h = [...h, h[2]];
      const pin = p.pinDay != null ? days.findIndex(x => x.g === p.pinDay) : -1;
      return { id: p.id, node: p._node, visit: Math.max(15, Math.round((p.userVisit || p.visitMin) * (p.userVisit ? 1 : pace.visitF) / 5) * 5), ideal: p.userVisit || p.visitMin, hours: h, priority: p.priority + ((p.rating || 7) - 7) / 3 + (p.must ? 3 : 0), must: !!p.must, pinDay: pin >= 0 ? pin : null, prefer: /sunrise|morning|early/i.test(p.bestTimeOfDay || "") ? "am" : /sunset|evening|night/i.test(p.bestTimeOfDay || "") ? "pm" : null };
    });
    const res = schedule(sp, days, mx.t, mx.d, { lunch: { dur: pace.lunch } });
    const nodePt = n => (n < base ? nodes[n] : plist[n - base]);
    res.days.forEach((r, i) => {
      const day = days[i];
      newDays[day.g] = {
        date: day.date, weekday: day.weekday, seg: si, start: day.start, end: day.end, finish: r.finish, back: r.back, travel: r.travel, km: r.km, note: day.note,
        from: pick(nodePt(day.from)), to: pick(nodePt(day.to)), stayGuessed: !!stay.guessed,
        items: r.items.map(it => it.type === "meal" ? { type: "meal", meal: "lunch", start: it.start, end: it.end, near: it.node >= base ? plist[it.node - base].id : null } : it),
      };
    });
    for (const x of res.dropped) dropped.push({ ...x, seg: si });
  }
  for (const p of Object.values(d.places)) delete p._node;
  d.days = [...lockedDays, ...newDays.slice(fromDay)].map((x, i) => x || { date: input.start ? addDays(input.start, i) : null, items: [], seg: 0, empty: true });
  d.dropped = dropped;
  d.estimatedTimes = estimated;

  progress(trip, 5);
  try {
    const pts = [];
    d.days.forEach((day, i) => {
      if (i < fromDay) return;
      const lunch = day.items.find(x => x.type === "meal");
      const near = lunch && lunch.near && d.places[lunch.near];
      day._l = near ? pts.push(near) - 1 : null;
      day._d = day.to && day.to.lat != null ? pts.push(day.to) - 1 : null;
    });
    const diet = /jain/i.test(input.diet) ? "jain" : /^veg|vegetarian|pure/i.test(input.diet) ? "veg" : "";
    const fill = (days, rest) => days.forEach((day, i) => {
      if (i < fromDay || day._l === undefined) return;
      day.meals = { lunch: day._l != null ? rest[day._l] || [] : [], dinner: day._d != null ? rest[day._d] || [] : [] };
      delete day._l; delete day._d;
    });
    const job = places.restaurantsNear(pts, diet);
    const rest = await within(job, quick ? 4000 : 7000, null);
    if (rest) fill(d.days, rest);
    else {
      // Edits shouldn't wait for the restaurant lookup: keep the old lists now, update them when it arrives.
      const marks = d.days.map(day => ({ l: day._l, d: day._d }));
      d.days.forEach((day, i) => { if (i >= fromDay) { day.meals = (oldDays[i] && oldDays[i].meals) || day.meals; delete day._l; delete day._d; } });
      const stamp = Date.now(); d._mealsStamp = stamp;
      job.then(r => {
        const t2 = db.trips.get(trip.id);
        if (!t2 || t2.data._mealsStamp !== stamp) return;
        t2.data.days.forEach((day, i) => { day._l = marks[i] ? marks[i].l : undefined; day._d = marks[i] ? marks[i].d : undefined; });
        fill(t2.data.days, r);
        t2.data.days.forEach(day => { delete day._l; delete day._d; });
        db.trips.save(trip.id, t2.data);
      }).catch(() => {});
    }
  } catch (e) { console.warn("restaurants:", e.message); }

  progress(trip, 6);
  for (const [si, seg] of input.segments.entries()) {
    const wx = seg.startDate ? await within(places.weather(seg.destination, seg.startDate, seg.endDate).catch(() => null), quick ? 3000 : 6000, null) : null;
    d.days.forEach(day => { if (day.seg === si && day.date) day.weather = wx && wx[day.date] || null; });
  }
  d.days.forEach((day, i) => { day.maps = mapsLinks(day, d); day.index = i; });
  d.status = "ready";
  d.progress = null;
  d.plannedAt = Date.now();
  db.trips.save(trip.id, d);
}
const pick = p => p && { label: p.label || p.name, lat: p.lat, lng: p.lng };

// "Let Raahi decide where to stay": the AI's suggested area if it's central to the plan,
// otherwise the spot closest to all chosen places.
async function pickStay(d, seg, si) {
  const sel = Object.values(d.places).filter(p => p.seg === si && p.selected && places.haversine(p, seg.destination) < 40000);
  const list = sel.length ? sel : [seg.destination];
  let best = list[0], bs = Infinity;
  for (const a of list) { const s = list.reduce((t, b) => t + places.haversine(a, b), 0); if (s < bs) { bs = s; best = a; } }
  let out = { label: `Near ${best.name || cityOf(seg)}, ${cityOf(seg)}`, lat: best.lat, lng: best.lng, why: "Closest to all the places on your plan." };
  const area = d.info[si] && d.info[si].stayArea;
  if (area && area.name) {
    try {
      const g = await places.geocode(`${area.name}, ${cityOf(seg)}`, seg.destination);
      if (g && places.haversine(g, best) < 12000) out = { label: `${area.name}, ${cityOf(seg)}`, lat: g.lat, lng: g.lng, why: area.why || out.why };
    } catch {}
  }
  seg.suggestedStay = { ...out };
  return { ...out, suggested: true };
}
const fmtMin = m => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);

// Google Maps directions links for a day (Google allows 9 stops between start and end).
function mapsLinks(day, d) {
  const city = cityOf(d.input.segments[day.seg] || d.input.segments[0]);
  const lab = x => (x.label && !/where you are|city centre/i.test(x.label) ? x.label : `${x.lat},${x.lng}`);
  const seq = [day.from && lab(day.from), ...day.items.filter(i => i.type === "visit").map(i => { const p = d.places[i.id]; return p.approx ? `${p.lat},${p.lng}` : `${p.name}, ${city}`; }), day.to && lab(day.to)].filter(Boolean);
  if (seq.length < 2) return [];
  const parts = [];
  for (let i = 0; i < seq.length - 1; i += 10) parts.push(seq.slice(i, i + 11));
  return parts.map(p => {
    const u = new URL("https://www.google.com/maps/dir/");
    u.searchParams.set("api", "1"); u.searchParams.set("origin", p[0]); u.searchParams.set("destination", p[p.length - 1]);
    if (p.length > 2) u.searchParams.set("waypoints", p.slice(1, -1).join("|"));
    u.searchParams.set("travelmode", "driving");
    return u.href;
  });
}

// ---------- editing ----------
function owned(user, id) {
  const t = db.trips.get(id);
  if (!t || t.userId !== user.id) throw userErr("Trip not found.");
  return t;
}
async function select(user, id, b) {
  const t = owned(user, id);
  const sel = new Set(b.selected || []), must = new Set(b.must || []);
  for (const p of Object.values(t.data.places)) {
    p.selected = sel.has(p.id); p.must = must.has(p.id);
    if (b.visit && +b.visit[p.id] > 0) p.userVisit = clamp(Math.round(+b.visit[p.id]), 10, 600);
    if (b.pins && b.pins[p.id] != null && b.pins[p.id] !== "") p.pinDay = clamp(+b.pins[p.id], 0, t.data.input.totalDays - 1); else if (b.pins) delete p.pinDay;
  }
  if (!Object.values(t.data.places).some(p => p.selected)) throw userErr("Pick at least one place.");
  t.data.status = "planning";
  db.trips.save(t.id, t.data);
  run(t.id, user, "plan");
}
async function replan(user, id, b = {}) {
  const t = owned(user, id);
  if (running.has(t.id)) throw userErr("Already planning, give it a moment.");
  const d = t.data;
  if (b.remove) for (const pid of b.remove) if (d.places[pid]) { d.places[pid].selected = false; d.places[pid].must = false; }
  if (b.restore) for (const pid of b.restore) if (d.places[pid]) d.places[pid].selected = true;
  if (b.pin && d.places[b.pin.id]) { d.places[b.pin.id].pinDay = b.pin.day; d.places[b.pin.id].selected = true; d.places[b.pin.id].must = true; }
  if (b.visit && d.places[b.visit.id]) d.places[b.visit.id].userVisit = clamp(Math.round(+b.visit.min), 10, 600);
  if (b.pace && PACE[b.pace]) { d.input.pace = b.pace; d.pace = paceFor(d.input, user); }
  if (b.stay && isFinite(+b.stay.lat)) { const s = d.input.segments[clamp(+b.seg || 0, 0, d.input.segments.length - 1)]; s.stay = { label: String(b.stay.label || "Stay").slice(0, 200), lat: +b.stay.lat, lng: +b.stay.lng }; }
  const fromDay = clamp(+b.fromDay || 0, 0, d.days.length);
  await plan(t, user, { fromDay, quick: true });
  return db.trips.get(t.id).data;
}
async function addPlace(user, id, b) {
  const t = owned(user, id), d = t.data;
  const si = clamp(+b.seg || 0, 0, d.input.segments.length - 1), seg = d.input.segments[si];
  let pt = isFinite(+b.lat) ? { lat: +b.lat, lng: +b.lng } : await places.geocode(String(b.label || ""), seg.destination);
  if (!pt) throw userErr("I couldn't find that place. Try adding the area or city.");
  const name = String(b.name || b.label || "").split(",")[0].trim().slice(0, 120);
  const p = { id: id8(), seg: si, name, search: b.label || name, lat: pt.lat, lng: pt.lng, category: "other", why: "Added by you", highlights: [], hoursText: null, hoursSource: null, hoursNote: "", ticket: null, visitMin: clamp(+b.visit || 60, 10, 600), priority: 5, rating: null, tips: "", selected: true, must: true, userAdded: true };
  if (b.day != null && b.day !== "") p.pinDay = clamp(+b.day, 0, d.input.totalDays - 1);
  if (b.food) {
    // A famous food stop: scheduled in the time window it's best eaten in.
    const f = b.food;
    Object.assign(p, { category: "food", why: `Famous for ${f.dish}`, highlights: [f.dish], hoursText: FOOD_WINDOWS[f.when] || FOOD_WINDOWS.any, hoursSource: "best time to eat", hoursNote: "Timing is when it's best to go; check the shop's hours.", ticket: f.price ? { indian: f.price, note: "per plate (approx.)" } : null, visitMin: clamp(+f.mins || 25, 10, 90), tips: f.tip || "", food: { dish: f.dish, price: f.price, tip: f.tip, veg: f.veg } });
    if (b.approx) p.hoursNote += " The map pin is approximate; Navigate searches the shop by name.";
    p.hoursDesc = describe(parseHours(p.hoursText));
    d.places[p.id] = p;
    db.trips.save(t.id, d);
    return replan(user, id, { fromDay: b.fromDay });
  }
  if (ai.enabled()) {
    try {
      const r = await ai.askJSON({ ...P.placeInfoPrompt(name, cityOf(seg)), fast: true, ms: 40000 });
      const x = r.data || {};
      Object.assign(p, { category: VISIT[x.category] ? x.category : "other", why: x.why || p.why, highlights: x.highlights || [], hoursText: x.hours || null, hoursSource: x.hours ? "AI estimate" : null, hoursNote: x.hoursNote || "", ticket: x.ticket || null, visitMin: b.visit ? p.visitMin : clamp(+x.visitMin || 60, 10, 600), bestTimeOfDay: x.bestTimeOfDay || "", rating: +x.rating || null, tips: x.tips || "" });
    } catch {}
  }
  const det = await places.osmDetails([p]).catch(() => ({}));
  if (det[p.id] && det[p.id].hours && parseHours(det[p.id].hours)) { p.hoursText = det[p.id].hours; p.hoursSource = "OpenStreetMap"; }
  if (p.hoursText && !parseHours(p.hoursText)) p.hoursText = null;
  p.hoursDesc = describe(parseHours(p.hoursText));
  d.places[p.id] = p;
  db.trips.save(t.id, d);
  return replan(user, id, { fromDay: b.fromDay });
}

// "Want to try Malaiyyo at Blue Lassi Shop?" → add it to the plan at the right time of day.
const FOOD_WINDOWS = { breakfast: "Mo-Su 07:00-11:00", lunch: "Mo-Su 12:00-15:30", snack: "Mo-Su 10:30-19:30", evening: "Mo-Su 16:00-22:00", dinner: "Mo-Su 19:00-22:30", any: "Mo-Su 08:00-22:00" };
async function addFood(user, id, b) {
  const t = owned(user, id), d = t.data;
  const si = clamp(+b.seg || 0, 0, d.input.segments.length - 1);
  const list = (d.info[si] && d.info[si].foodStops) || [];
  let k = b.index;
  if (b.decide || k == null) { // Let Raahi pick: the first famous stop not added yet that suits the diet
    const veg = /veg|jain/i.test(d.input.diet) && !/non/i.test(d.input.diet);
    k = list.findIndex(f => !f.added && !f.dismissed && (!veg || f.veg !== false));
    if (k < 0) throw userErr("No more food stops to suggest here.");
  }
  const f = list[clamp(+k, 0, list.length - 1)];
  if (!f) throw userErr("That food stop isn't available.");
  const seg = d.input.segments[si];
  const label = f.search || `${f.shop}, ${f.area || ""}, ${cityOf(seg)}`;
  // Find the shop on the map. If the free map search is down or doesn't know it, use the AI's
  // position, then the area, then the place closest to it on the plan, so adding never fails.
  const near = (pt, km) => pt && isFinite(+pt.lat) && isFinite(+pt.lng) && (+pt.lat || +pt.lng) && places.haversine(pt, seg.destination) / 1000 < km;
  let pt = null, approx = false;
  const g = await within(places.geocode(label, seg.destination).catch(() => null), 3000, null); // never wait long
  if (near(g, MAX_KM)) pt = g;
  if (!pt && near(f, MAX_KM)) { pt = { lat: +f.lat, lng: +f.lng }; approx = true; }
  if (!pt) {
    const dayPlaces = (b.day != null && d.days && d.days[+b.day] ? d.days[+b.day].items : []).map(x => d.places[x.id]).filter(Boolean);
    const anchor = dayPlaces[0] || Object.values(d.places).find(p => p.seg === si && p.selected) || seg.stay || seg.destination;
    pt = { lat: anchor.lat, lng: anchor.lng }; approx = true;
  }
  const out = await addPlace(user, id, { label, lat: pt.lat, lng: pt.lng, name: f.shop || f.dish, seg: si, day: b.day, food: f, approx });
  const fresh = db.trips.get(id);
  const added = Object.values(fresh.data.places).filter(p => p.food && p.food.dish === f.dish).pop();
  fresh.data.info[si].foodStops[k].added = added ? added.id : true;
  db.trips.save(id, fresh.data);
  return fresh.data;
}
function dismissFood(user, id, b) {
  const t = owned(user, id), d = t.data, list = (d.info[+b.seg || 0] && d.info[+b.seg || 0].foodStops) || [];
  if (list[+b.index]) list[+b.index].dismissed = true;
  db.trips.save(t.id, d);
  return d;
}

// ---------- during the trip ----------
function recordCheckin(user, d, p, state, at, auto) {
  const c = d.checkins[p.id] || {};
  if (state === "undo") { delete d.checkins[p.id]; return; }
  if (state === "arrived") c.arrived = at;
  if (state === "done") { c.done = at; if (!c.arrived) c.arrived = at; }
  if (state === "skipped") c.skipped = at;
  if (auto) c.auto = true;
  d.checkins[p.id] = c;
  // Learn how long this person really spends at places (used by "Let Raahi decide" pace).
  if (state === "done" && c.arrived && c.done > c.arrived) {
    const mins = (c.done - c.arrived) / 60000;
    if (mins > 5 && mins < 600 && p.visitMin) {
      const u = db.users.byId(user.id), st = u.stats || {};
      st.paceSamples = [...(st.paceSamples || []), +(mins / p.visitMin).toFixed(2)].slice(-30);
      const sorted = st.paceSamples.slice().sort((x, y) => x - y);
      st.paceFactor = sorted.length >= 3 ? sorted[Math.floor(sorted.length / 2)] : null;
      st.visits = (st.visits || 0) + 1;
      db.users.update(user.id, { stats: st });
    }
  }
}
function checkin(user, id, b) {
  const t = owned(user, id), d = t.data, p = d.places[b.placeId];
  if (!p) throw userErr("Place not found.");
  recordCheckin(user, d, p, b.state, isFinite(+b.at) ? +b.at : Date.now(), false);
  if (b.state === "undo" && d.presence && d.presence.placeId === p.id) d.presence = null;
  db.trips.save(t.id, d);
  return d.checkins;
}

// ---------- automatic check-in / check-out from the phone's GPS ----------
const GEO_IN = 150, GEO_OUT = 300, DWELL = 3 * 60e3;
function todayIndex(d, b) {
  if (b.day != null && b.day !== "") return clamp(+b.day, 0, d.days.length - 1);
  return d.days.findIndex(x => x.date === b.date);
}
function position(user, id, b) {
  const t = owned(user, id), d = t.data;
  const lat = +b.lat, lng = +b.lng;
  if (!isFinite(lat) || !isFinite(lng)) throw userErr("Bad position.");
  const at = isFinite(+b.at) ? +b.at : Date.now(), acc = clamp(+b.acc || 30, 5, 300);
  const di = todayIndex(d, b), day = d.days[di];
  if (!day) return { event: null, checkins: d.checkins, presence: null, alert: null };
  const here = { lat, lng };
  const visits = day.items.filter(i => i.type === "visit").map(i => d.places[i.id]).filter(Boolean);
  let near = null, nd = Infinity;
  for (const p of visits) { const dist = places.haversine(here, p); if (dist < nd) { nd = dist; near = p; } }
  let event = null;
  const pres = d.presence && d.presence.day === di ? d.presence : null;
  if (near && nd <= GEO_IN + Math.min(acc, 100)) {
    if (!pres || pres.placeId !== near.id) {
      // Walking straight from one stop to the next: close the previous one first.
      if (pres) { const prev = d.places[pres.placeId], c = d.checkins[pres.placeId] || {}; if (prev && c.arrived && !c.done && !c.skipped) recordCheckin(user, d, prev, "done", pres.last, true); }
      d.presence = { placeId: near.id, since: at, last: at, day: di };
    } else d.presence.last = at;
    const c = d.checkins[near.id] || {};
    if (!c.arrived && !c.done && !c.skipped && at - d.presence.since >= DWELL) { recordCheckin(user, d, near, "arrived", d.presence.since, true); event = { type: "arrived", placeId: near.id, name: near.name }; }
  } else if (pres) {
    const p = d.places[pres.placeId], dist = p ? places.haversine(here, p) : Infinity;
    if (dist > GEO_OUT) {
      const c = d.checkins[pres.placeId] || {};
      if (p && c.arrived && !c.done && !c.skipped) { recordCheckin(user, d, p, "done", pres.last, true); event = { type: "left", placeId: p.id, name: p.name }; }
      d.presence = null;
    }
  }
  d.lastSeen = at;
  db.trips.save(t.id, d);
  return { event, checkins: d.checkins, presence: d.presence || null, alert: leaveAlert(d, di, isFinite(+b.nowMin) ? +b.nowMin : null) };
}

// "Leave in 10 min to reach the Taj before it closes" / "Lunch time".
function leaveAlert(d, di, now) {
  const day = d.days[di];
  if (!day || now == null) return null;
  const done = id => d.checkins[id] && (d.checkins[id].done || d.checkins[id].skipped);
  const its = day.items;
  const curIdx = d.presence ? its.findIndex(i => i.id === d.presence.placeId) : -1;
  const nextIdx = its.findIndex((i, k) => i.type === "visit" && k > curIdx && !done(i.id) && !(d.presence && d.presence.placeId === i.id));
  const meal = its.find(i => i.type === "meal");
  if (meal && !d.lunchDone && now >= meal.start - 5 && now <= meal.start + 25 && curIdx < 0) {
    const r = day.meals && day.meals.lunch && day.meals.lunch[0];
    return { kind: "lunch", key: `lunch:${di}`, title: "Lunch time 🍛", text: r ? `${r.name}${r.veg === "pure-veg" ? " (pure veg)" : ""}, ${r.distance < 1000 ? r.distance + " m" : (r.distance / 1000).toFixed(1) + " km"} away` : "Find a place to eat nearby" };
  }
  if (nextIdx < 0) return null;
  const nx = its[nextIdx], p = d.places[nx.id];
  if (!p) return null;
  const wd = weekday(day.date);
  let h = parseHours(p.hoursText);
  const v = d.verified && d.verified[p.id];
  if (v && v.date === day.date && v.todayWindow) { h = (h || Array.from({ length: 7 }, () => [[360, 1200]])).slice(); h[wd] = v.todayWindow.length ? [v.todayWindow] : []; }
  const win = h ? (h[wd] || []).find(([o, c]) => c > nx.start) : null;
  const minStay = Math.max(20, Math.round((p.userVisit || p.visitMin) * 0.6));
  const planLeave = nx.start - nx.travel;
  const closeLeave = win ? win[1] - minStay - nx.travel : Infinity;
  const leaveBy = Math.min(curIdx >= 0 ? planLeave + 15 : Infinity, closeLeave);
  if (!isFinite(leaveBy)) return null;
  const left = Math.round(leaveBy - now);
  const byClose = closeLeave <= leaveBy;
  if (left < -5) return byClose ? { kind: "late", key: `late:${nx.id}`, title: `Too late for ${p.name}?`, text: `It closes at ${hhmm(win[1])}. Check what's still possible and let Raahi re-plan.`, placeId: p.id } : null;
  if (left > 12) return null;
  return { kind: byClose ? "close" : "plan", key: `leave:${nx.id}`, title: left <= 0 ? "Time to leave" : `Leave in ${left} min`, text: byClose ? `to reach ${p.name} before it closes at ${hhmm(win[1])} (${nx.travel} min away).` : `to stay on plan. Next: ${p.name}, ${nx.travel} min away.`, placeId: p.id, leaveBy };
}

// ---------- rain plan ----------
const OUTDOOR = new Set(["park", "nature", "lake", "waterfall", "viewpoint", "beach", "zoo", "market", "monument", "adventure"]);
async function rainPlan(user, id, b) {
  const t = owned(user, id), d = t.data;
  const di = clamp(+b.day || 0, 0, d.days.length - 1), day = d.days[di];
  if (!day.date) throw userErr("Add dates to the trip to get a rain plan.");
  const seg = d.input.segments[day.seg] || d.input.segments[0];
  const hours = await places.hourlyRain(seg.destination, day.date);
  if (!hours) throw userErr("Couldn't get the rain forecast for that day (it's only available up to 16 days ahead).");
  const wins = [];
  for (const x of hours) if (x.p >= 50) { const last = wins[wins.length - 1]; if (last && last[1] === x.h * 60) last[1] += 60; else wins.push([x.h * 60, x.h * 60 + 60]); }
  const peak = Math.max(...hours.map(x => x.p));
  if (!wins.length) return { rain: false, peak, text: peak >= 30 ? `Only a small chance of rain (up to ${peak}%). Your plan is fine.` : "No rain expected. Your plan is fine." };
  const done = id2 => d.checkins[id2] && (d.checkins[id2].done || d.checkins[id2].skipped);
  const list = day.items.filter(i => i.type === "visit" && !done(i.id)).map(i => d.places[i.id]).filter(Boolean);
  const outdoor = list.filter(p => OUTDOOR.has(p.category));
  if (!outdoor.length) return { rain: true, windows: wins, peak, text: "Rain is likely, but today's stops are mostly indoors. No change needed." };
  const nodes = [day.from, day.to, ...list];
  const mx = await places.tableOrEstimate(nodes);
  const wd = weekday(day.date);
  const isToday = b.date === day.date && isFinite(+b.nowMin);
  const start = isToday ? Math.max(day.start, +b.nowMin) : day.start;
  const hp = list.map((p, i) => ({ id: p.id, node: i + 2, visit: Math.max(15, Math.round((p.userVisit || p.visitMin) * ((d.pace && d.pace.visitF) || 1))), hours: parseHours(p.hoursText), priority: p.priority + 4, must: true, avoid: OUTDOOR.has(p.category) ? wins : null }));
  const res = schedule(hp, [{ date: day.date, weekday: wd, start, end: Math.max(day.end, start + 60), from: 0, to: 1, maxStops: 12 }], mx.t, mx.d, { lunch: { dur: (d.pace && d.pace.lunch) || 60 } });
  const items = res.days[0].items.map(it => (it.type === "meal" ? { type: "meal", meal: "lunch", start: it.start, end: it.end } : it));
  const old = Object.fromEntries(day.items.filter(i => i.type === "visit").map(i => [i.id, i.start]));
  const moves = items.filter(i => i.type === "visit" && OUTDOOR.has(d.places[i.id].category)).map(i => ({ id: i.id, name: d.places[i.id].name, from: old[i.id], to: i.start, wet: wins.some(([a, b2]) => i.start < b2 && i.end > a) }));
  return { rain: true, windows: wins, peak, items, finish: res.days[0].finish, dropped: res.dropped.map(x => ({ ...x, name: d.places[x.id].name })), moves, text: `Rain likely ${wins.map(([a, b2]) => `${hhmm(a)}–${hhmm(b2)}`).join(", ")} (up to ${peak}%).` };
}

// ---------- travellers & split expenses ----------
function setPeople(user, id, b) {
  const t = owned(user, id), d = t.data;
  const names = (Array.isArray(b.names) ? b.names : []).map(x => String(x || "").trim().slice(0, 30)).filter(Boolean).slice(0, 20);
  if (!names.length) throw userErr("Add at least one name.");
  d.people = [...new Set(names)];
  db.trips.save(t.id, d);
  return d.people;
}
// Fewest payments that settle everyone up.
function settle(d) {
  const people = d.people && d.people.length ? d.people : ["You"];
  const bal = Object.fromEntries(people.map(p => [p, 0]));
  for (const e of d.expenses || []) {
    const among = (e.split && e.split.length ? e.split : people).filter(p => p in bal);
    if (!among.length) continue;
    const payer = e.paidBy && e.paidBy in bal ? e.paidBy : people[0];
    bal[payer] += e.amount;
    for (const p of among) bal[p] -= e.amount / among.length;
  }
  const debt = Object.entries(bal).filter(([, v]) => v < -0.5).map(([n, v]) => [n, -v]).sort((a, b) => b[1] - a[1]);
  const cred = Object.entries(bal).filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]);
  const out = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const m = Math.min(debt[i][1], cred[j][1]);
    out.push({ from: debt[i][0], to: cred[j][0], amount: Math.round(m) });
    debt[i][1] -= m; cred[j][1] -= m;
    if (debt[i][1] < 0.5) i++;
    if (cred[j][1] < 0.5) j++;
  }
  return { balances: Object.fromEntries(Object.entries(bal).map(([k, v]) => [k, Math.round(v)])), payments: out };
}

// Where am I, what time is it, what's still possible today?
async function live(user, id, b) {
  const t = owned(user, id), d = t.data;
  const di = b.day != null ? clamp(+b.day, 0, d.days.length - 1) : Math.max(0, d.days.findIndex(x => x.date === b.date));
  const day = d.days[di];
  if (!day) throw userErr("No plan for that day.");
  const nowMin = clamp(+b.nowMin || 0, 0, 1439);
  const here = isFinite(+b.lat) ? { lat: +b.lat, lng: +b.lng } : day.from;
  const remaining = day.items.filter(i => i.type === "visit" && !(d.checkins[i.id] && (d.checkins[i.id].done || d.checkins[i.id].skipped))).map(i => d.places[i.id]);
  // Also consider this trip's unvisited "more ideas" nearby, in case there is spare time.
  const extras = Object.values(d.places).filter(p => p.seg === day.seg && !remaining.includes(p) && !d.checkins[p.id] && !d.days.some(x => x.items.some(i => i.id === p.id)));
  const list = [...remaining, ...extras].slice(0, 40);
  if (!list.length) return { day: di, nowMin, items: [], replan: null };
  const nodes = [here, day.to || here, ...list];
  const mx = await places.tableOrEstimate(nodes);
  const wd = day.date ? weekday(day.date) : weekday(new Date().toISOString().slice(0, 10));
  const realDate = day.date || new Date().toISOString().slice(0, 10);
  const liveHours = p => {
    const h = parseHours(p.hoursText), v = d.verified && d.verified[p.id];
    if (!v || v.date !== realDate || !v.todayWindow) return h;
    const w = (h || Array.from({ length: 7 }, () => [[360, 1200]])).slice();
    w[wd] = v.todayWindow.length ? [v.todayWindow] : [];
    return w;
  };
  const hp = list.map((p, i) => ({ id: p.id, node: i + 2, visit: Math.max(15, Math.round((p.userVisit || p.visitMin) * (d.pace ? d.pace.visitF : 1))), hours: liveHours(p), priority: p.priority + (remaining.includes(p) ? 4 : 0), must: false }));
  const feas = feasibility(nowMin, wd, 0, hp, mx.t);
  const pace = d.pace || paceFor(d.input, user);
  const res = schedule(hp.slice(0, remaining.length), [{ date: day.date, weekday: wd, start: nowMin, end: Math.max(day.end, nowMin + 60), from: 0, to: 1, maxStops: 12, noLunch: !!b.hadLunch || nowMin > 15 * 60 }], mx.t, mx.d, { lunch: { dur: pace.lunch } });
  const r = res.days[0];
  return {
    day: di, nowMin, estimated: mx.estimated,
    items: feas.map((f, i) => ({ ...f, planned: i < remaining.length, name: list[i].name })),
    replan: { items: r.items.map(it => (it.type === "meal" ? { type: "meal", meal: "lunch", start: it.start, end: it.end } : it)), finish: r.finish, dropped: res.dropped.map(x => ({ ...x, name: d.places[x.id].name })) },
  };
}
function applyToday(user, id, b) {
  const t = owned(user, id), d = t.data, day = d.days[+b.day];
  if (!day || !Array.isArray(b.items)) throw userErr("Nothing to apply.");
  const done = day.items.filter(i => i.type === "visit" && d.checkins[i.id] && (d.checkins[i.id].done || d.checkins[i.id].skipped));
  day.items = [...done, ...b.items.filter(i => i.type === "meal" || d.places[i.id])];
  day.replannedAt = Date.now();
  day.maps = mapsLinks(day, d);
  db.trips.save(t.id, d);
  return d;
}

// Fresh news, crowds and safety for places: TinyFish searches the past week, the AI scores it.
async function pulse(user, id, b) {
  const t = owned(user, id), d = t.data;
  if (!ai.enabled() && !tf.enabled()) throw userErr("Live checks need the TinyFish key or the free AI key (see README).");
  const ids = (b.placeIds || []).filter(x => d.places[x]).slice(0, 10);
  if (!ids.length) throw userErr("No places to check.");
  const out = {}, need = [];
  const ck = p => "pulse2:" + p.name.toLowerCase() + "@" + cityOf(d.input.segments[p.seg]).toLowerCase();
  for (const pid of ids) { const p = d.places[pid], hit = db.cache.get(ck(p)); if (hit && !b.force) out[pid] = hit; else need.push(p); }
  if (need.length) {
    const city = cityOf(d.input.segments[need[0].seg]);
    let evidence = null;
    if (tf.enabled()) {
      evidence = {};
      await Promise.all(need.map(async p => { evidence[p.id] = await tf.recentBuzz(p.name, city).catch(() => []); }));
    }
    let got = [], grounded = [];
    if (ai.enabled()) {
      const r = await ai.askJSON({ ...P.pulsePrompt(need, city, evidence), search: !evidence, fast: !!evidence, ms: 120000 });
      got = (r.data && r.data.places) || []; grounded = r.sources || [];
    }
    need.forEach((p, i) => {
      const ev = evidence ? evidence[p.id] || [] : null;
      const g = got.find(x => places.similar(x.name, p.name) >= 0.5) || got[i] || {};
      const v = {
        score: g.score != null ? clamp(+g.score, 0, 10) : null, verdict: g.verdict || (ev && !ai.enabled() ? "" : "go"), crowd: g.crowd || "unknown",
        summary: g.summary || (ev ? (ev.length ? `${ev.length} news / Reddit / web mentions in the past week.` : "Nothing posted about it in the past week.") : ""),
        alerts: (g.alerts || []).slice(0, 4), recent: g.recent != null ? !!g.recent : !!(ev && ev.length),
        sources: ev ? ev.slice(0, 6).map(e => ({ title: `${e.kind === "reddit" ? "Reddit" : e.site || "web"}${e.date ? " · " + e.date : ""}`, url: e.url, headline: e.title })) : grounded,
        via: ev ? "TinyFish" : "Google search", at: Date.now(),
      };
      out[p.id] = v;
      db.cache.set(ck(p), v, 6 * 3600e3);
    });
  }
  const fresh = db.trips.get(t.id);
  Object.assign(fresh.data.pulse, out);
  db.trips.save(t.id, fresh.data);
  return out;
}

// TinyFish's browser agent opens each place on Google Maps and reads it as it is right now:
// open/closed, today's hours, live crowd level, and the newest reviews (last 5 days).
const verifying = new Map(); // `${tripId}:${placeId}` -> {status, step}
function verify(user, id, b) {
  const t = owned(user, id), d = t.data;
  if (!tf.enabled()) throw userErr("Live Google Maps checks need a TinyFish key (see README).");
  const ids = (b.placeIds || []).filter(x => d.places[x]).slice(0, 6);
  if (!ids.length) throw userErr("No places to check.");
  for (const pid of ids) {
    const key = `${t.id}:${pid}`;
    if (verifying.has(key) && verifying.get(key).status === "running") continue;
    const p = d.places[pid], city = cityOf(d.input.segments[p.seg]);
    const hit = !b.force && db.cache.get("verify:" + p.name.toLowerCase() + "@" + city.toLowerCase());
    if (hit) { saveVerify(t.id, pid, hit); verifying.set(key, { status: "done" }); continue; }
    verifying.set(key, { status: "running", step: "Opening Google Maps…", started: Date.now() });
    (async () => {
      try {
        const off = p.website && ai.enabled() ? officialInfo(p, city).catch(() => null) : null;
        // Start the browser straight on the place's search page: fewer steps, faster, fewer failures.
        const start = "https://www.google.com/maps/search/?api=1&hl=en&query=" + encodeURIComponent(`${p.name}, ${city}`);
        const run = await tf.agentStart(start, tf.placeGoal(p.name, city), tf.PLACE_SCHEMA);
        const r = await tf.agentWait(run, { maxMs: 8 * 60e3, onTick: x => { const v = verifying.get(key); if (v) v.step = x.status === "RUNNING" ? "Reading the place page and newest reviews…" : "Waiting for a browser…"; } });
        if (r.status !== "COMPLETED") { console.warn("tinyfish run", run, r.status, JSON.stringify(r.error)); throw new Error("The browser check didn't finish" + (r.error && r.error.message ? ` (${r.error.message})` : "") + ". Tap Check live to try again."); }
        let res = r.result;
        if (typeof res === "string") res = ai.parseJSON(res) || {};
        const v = summariseVerify(res || {});
        if (off) v.official = await off;
        db.cache.set("verify:" + p.name.toLowerCase() + "@" + city.toLowerCase(), v, 3 * 3600e3);
        saveVerify(t.id, pid, v);
        verifying.set(key, { status: "done" });
      } catch (e) {
        console.warn("live check failed:", p.name, e.message);
        verifying.set(key, { status: "error", error: e.message });
      }
    })();
  }
  return verifyStatus(user, id, { placeIds: ids });
}
// TinyFish Fetch reads the place's official website; the AI pulls out prices and notices.
async function officialInfo(p, city) {
  const [page] = await tf.fetchPages([p.website], `Find visiting hours, ticket prices and any closure notice for ${p.name}, ${city}.`);
  if (!page || !page.text) return null;
  const r = await ai.askJSON({ system: `Extract visitor information from an official website. Today is ${P.today()}. Reply with JSON only.`, prompt: `Page: ${page.url}\n\n${page.text.slice(0, 9000)}\n\nJSON: { "ticket": "prices as written, or empty", "hours": "timings as written, or empty", "notice": "any closure/renovation/special notice, or empty" }`, fast: true, ms: 40000 });
  return { ...(r.data || {}), url: page.url };
}
function summariseVerify(res) {
  const reviews = (res.newest_reviews || []).slice(0, 10).map(r => ({ when: String(r.when || ""), stars: +r.stars || null, summary: String(r.summary || "").slice(0, 200), days: tf.daysAgo(r.when) }));
  const last5 = reviews.filter(r => r.days != null && r.days <= 5 && r.stars);
  const today = tf.parseToday(res.hours_today);
  return {
    found: res.found !== false, status: res.status || "", hoursToday: res.hours_today || "", todayWindow: today, date: new Date().toISOString().slice(0, 10),
    busyNow: res.busy_now || "", fee: res.entry_fee || "", rating: +res.rating || null, reviewCount: +res.review_count || null,
    reviews, last5: last5.length ? { count: last5.length, avg: +(last5.reduce((a, r) => a + r.stars, 0) / last5.length).toFixed(1) } : null,
    at: Date.now(), via: "TinyFish browser agent on Google Maps",
  };
}
function saveVerify(tid, pid, v) {
  const t = db.trips.get(tid);
  if (!t) return;
  t.data.verified = { ...(t.data.verified || {}), [pid]: v };
  db.trips.save(tid, t.data);
}
function verifyStatus(user, id, b) {
  const t = owned(user, id);
  const ids = b.placeIds || Object.keys(t.data.places);
  const status = {};
  for (const pid of ids) { const s = verifying.get(`${t.id}:${pid}`); if (s) status[pid] = { status: s.status, step: s.step, error: s.error }; }
  return { status, verified: t.data.verified || {} };
}

// "I can only do one: Agra Fort or Taj Mahal?"  → Raahi picks.
async function decide(user, id, b) {
  const t = owned(user, id), d = t.data;
  const cands = (b.placeIds || []).map(x => d.places[x]).filter(Boolean).slice(0, 12);
  if (cands.length < 2) throw userErr("Pick at least two places to choose between.");
  const need = clamp(Math.round(+b.keep || 1), 1, cands.length - 1);
  let pick = null, why = "", skipWhy = {};
  if (ai.enabled()) {
    try {
      const ctx = `pace ${d.input.pace || "balanced"}, likes ${d.input.interests.join(", ") || "anything"}, ${d.input.travellers} people${d.input.group ? " (" + d.input.group + ")" : ""}, avoid ${d.input.avoid.join(", ") || "nothing"}. ${d.input.notes || ""}`;
      const r = await ai.askJSON({ ...P.decidePrompt(cands, need, ctx), fast: true, ms: 45000 });
      const names = (r.data && r.data.pick) || [];
      pick = cands.filter(p => names.some(n => places.similar(n, p.name) >= 0.6)).slice(0, need);
      why = (r.data && r.data.why) || ""; skipWhy = (r.data && r.data.skipWhy) || {};
    } catch {}
  }
  if (!pick || pick.length !== need) { // no AI: best rated & most important, shorter visits as tie-break
    pick = cands.slice().sort((a, b2) => (b2.priority + (b2.rating || 7) / 2) - (a.priority + (a.rating || 7) / 2) || a.visitMin - b2.visitMin).slice(0, need);
    why = `${pick.map(p => p.name).join(" and ")} ${need > 1 ? "are" : "is"} the most loved and most important here.`;
  }
  const keep = new Set(pick.map(p => p.id));
  if (b.apply) {
    for (const p of cands) { p.selected = keep.has(p.id); if (!keep.has(p.id)) p.must = false; }
    db.trips.save(t.id, d);
  }
  return { pick: [...keep], why, skipped: cands.filter(p => !keep.has(p.id)).map(p => ({ id: p.id, name: p.name, why: Object.entries(skipWhy).find(([n]) => places.similar(n, p.name) >= 0.6)?.[1] || "" })) };
}

// Short text version of a trip, for the chat assistant.
function summaryForChat(d) {
  if (!d || !d.input) return "";
  const lines = [`${d.input.totalDays} days: ${d.input.segments.map(s => `${s.destination.label} (${s.days} days${s.stay ? ", staying at " + s.stay.label : ""})`).join(" → ")}`];
  if (d.input.start) lines.push(`Starts ${d.input.start}`);
  lines.push(`Travellers ${d.input.travellers}, pace ${d.input.pace || "profile default"}, food ${d.input.diet || "any"}, likes ${d.input.interests.join(", ")}`);
  (d.days || []).forEach((day, i) => {
    const v = day.items.filter(x => x.type === "visit").map(x => `${hhmm(x.start)} ${d.places[x.id] ? d.places[x.id].name : "?"}${d.checkins[x.id] && d.checkins[x.id].done ? " (visited)" : ""}`);
    lines.push(`Day ${i + 1}${day.date ? " " + day.date : ""}: ${v.join(", ") || "free day"}`);
  });
  if (d.dropped && d.dropped.length) lines.push("Not fitted: " + d.dropped.map(x => d.places[x.id] && d.places[x.id].name).filter(Boolean).join(", "));
  return lines.join("\n");
}

module.exports = { position, leaveAlert, rainPlan, setPeople, settle, OUTDOOR, create, run, select, replan, addPlace, addFood, dismissFood, checkin, live, applyToday, pulse, verify, verifyStatus, decide, summaryForChat, owned, cleanInput, paceFor, PACE, STEPS, mapsLinks, running };

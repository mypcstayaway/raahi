// Day planner: puts places into days and orders them so that travel is shortest while every
// place is reached while it is open, with a lunch break, inside the day's start and end times.
// Works on minutes since midnight. Travel times come from a road-time matrix (seconds).

const DEFAULTS = {
  lunch: { from: 13 * 60, to: 14 * 60 + 30, dur: 60 },
  travelFactor: 1.15, // real roads are slower than the map says (traffic, stops)
  parkMin: 10,        // parking, tickets, walking in
  minVisitFrac: 0.6,  // a visit can be cut to 60% of the ideal time if needed
  unknownHours: [[6 * 60, 20 * 60]],
  loadPenalty: 6,     // small push to spread places across days
};

function makeScheduler(places, days, dur, dist, opts = {}) {
  const O = { ...DEFAULTS, ...opts, lunch: { ...DEFAULTS.lunch, ...(opts.lunch || {}) } };
  const P = new Map(places.map(p => [p.id, p]));
  const tmin = (a, b) => (a === b ? 0 : (dur[a][b] / 60) * O.travelFactor + O.parkMin);
  const km = (a, b) => (a === b ? 0 : dist[a][b] / 1000);
  const win = (p, wd) => (p.hours ? p.hours[wd] || [] : O.unknownHours);

  function simulate(day, order) {
    let t = day.start, pos = day.from, lunch = day.noLunch || day.end - day.start < 300, travel = 0, wait = 0, short = 0, dk = 0, pref = 0;
    const items = [];
    const eat = () => { items.push({ type: "meal", meal: "lunch", start: Math.round(t), end: Math.round(t + O.lunch.dur), node: pos }); t += O.lunch.dur; lunch = true; };
    for (const id of order) {
      const p = P.get(id);
      // Eat between stops: at lunch time, or a bit early if the next visit would run past lunch.
      if (!lunch && (t >= O.lunch.from - 20 || (t >= O.lunch.from - 90 && t + tmin(pos, p.node) + p.visit > O.lunch.to))) eat();
      const tt = tmin(pos, p.node), arr = t + tt;
      const need = p.visit, minNeed = Math.max(20, Math.round(need * O.minVisitFrac));
      let start = null, end = null;
      for (const [o, c] of win(p, day.weekday)) {
        const s = Math.max(arr, o);
        if (s + minNeed <= c) { start = s; end = Math.min(s + need, c); break; }
      }
      if (start == null) return { ok: false, failId: id, reason: win(p, day.weekday).length ? "hours" : "closed" };
      travel += tt; dk += km(pos, p.node); wait += start - arr; short += need - (end - start);
      // Soft wish: sunrise/morning places early, sunset/evening places late.
      if (p.prefer === "am" && start > 11 * 60) pref += Math.min(60, (start - 11 * 60) / 3);
      if (p.prefer === "pm" && end < 16 * 60 + 30) pref += Math.min(60, (16 * 60 + 30 - end) / 3);
      // Rain plan: outdoor places pay a price for every minute spent in rainy hours.
      if (p.avoid) for (const [a, b] of p.avoid) pref += Math.max(0, Math.min(end, b) - Math.max(start, a)) * 2;
      items.push({ type: "visit", id, travel: Math.round(tt), km: +km(pos, p.node).toFixed(1), arrive: Math.round(arr), start: Math.round(start), end: Math.round(end), short: end - start < need - 5 });
      t = end; pos = p.node;
    }
    if (!lunch && t >= O.lunch.from - 20 && t + O.lunch.dur + tmin(pos, day.to) <= day.end) eat();
    const back = tmin(pos, day.to);
    const finish = t + back;
    if (finish > day.end + 10) return { ok: false, reason: "time" };
    travel += back; dk += km(pos, day.to);
    return { ok: true, items, travel, wait, short, km: dk, back: Math.round(back), finish: Math.round(finish), cost: travel + 0.6 * wait + 1.5 * short + pref + O.loadPenalty * order.length * order.length };
  }

  const orders = days.map(() => []);
  // A day that is all travel (e.g. a long drive between cities) has no time left for stops: keep it empty.
  const sims = days.map(d => { const r = simulate(d, []); return r.ok ? r : { ok: true, items: [], travel: 0, wait: 0, short: 0, km: 0, back: 0, finish: d.start, cost: 0 }; });
  const dayOk = (p, di) => p.pinDay == null || p.pinDay === di;
  const full = (p, di) => orders[di].length >= days[di].maxStops && !p.must;

  function bestInsert(p) {
    let best = null;
    days.forEach((d, di) => {
      if (!dayOk(p, di) || full(p, di)) return;
      for (let k = 0; k <= orders[di].length; k++) {
        const o = orders[di].slice(); o.splice(k, 0, p.id);
        const r = simulate(d, o);
        if (r.ok) { const delta = r.cost - sims[di].cost; if (!best || delta < best.delta) best = { di, o, r, delta }; }
      }
    });
    return best;
  }
  function apply(b) { orders[b.di] = b.o; sims[b.di] = b.r; }

  // Highest priority first: must-sees, then by rating, then shorter visits.
  const sorted = places.slice().sort((a, b) => (b.must ? 1 : 0) - (a.must ? 1 : 0) || (b.pinDay != null) - (a.pinDay != null) || b.priority - a.priority || a.visit - b.visit);
  let left = [];
  for (const p of sorted) { const b = bestInsert(p); if (b) apply(b); else left.push(p); }

  // Improve: move stops inside a day and between days while it keeps getting better.
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    days.forEach((d, di) => {
      const n = orders[di].length;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const o = orders[di].slice(0, i).concat(orders[di].slice(i, j + 1).reverse(), orders[di].slice(j + 1));
        const r = simulate(d, o);
        if (r.ok && r.cost < sims[di].cost - 0.5) { orders[di] = o; sims[di] = r; improved = true; }
      }
    });
    for (let a = 0; a < days.length; a++) for (const id of orders[a].slice()) {
      const p = P.get(id);
      const without = orders[a].filter(x => x !== id), ra = simulate(days[a], without);
      if (!ra.ok) continue;
      for (let b = 0; b < days.length; b++) {
        if (b === a || !dayOk(p, b) || full(p, b)) continue;
        for (let k = 0; k <= orders[b].length; k++) {
          const o = orders[b].slice(); o.splice(k, 0, id);
          const rb = simulate(days[b], o);
          if (rb.ok && ra.cost + rb.cost < sims[a].cost + sims[b].cost - 0.5) { orders[a] = without; sims[a] = ra; orders[b] = o; sims[b] = rb; improved = true; break; }
        }
        if (!orders[a].includes(id)) break;
      }
    }
    // Places that didn't fit before may fit now.
    const still = [];
    for (const p of left) { const b = bestInsert(p); if (b) { apply(b); improved = true; } else still.push(p); }
    left = still;
    if (!improved) break;
  }

  // If a day has spare time, give places their full ideal time instead of the shortened one.
  days.forEach((d, di) => {
    const ids = orders[di].filter(id => P.get(id).ideal > P.get(id).visit);
    if (!ids.length) return;
    const old = ids.map(id => P.get(id).visit);
    ids.forEach(id => { P.get(id).visit = P.get(id).ideal; });
    const r = simulate(d, orders[di]);
    if (r.ok && r.finish <= d.end - 15) sims[di] = r;
    else ids.forEach((id, k) => { P.get(id).visit = old[k]; });
  });

  // Why each leftover place couldn't be fitted.
  const dropped = left.map(p => {
    const alone = days.map((d, di) => (dayOk(p, di) ? simulate(d, [p.id]) : { ok: false, reason: "pinned" }));
    let reason = "time";
    if (alone.every(r => !r.ok && r.reason === "closed")) reason = "closed";
    else if (alone.every(r => !r.ok && (r.reason === "closed" || r.reason === "hours"))) reason = "hours";
    else if (alone.every(r => !r.ok)) reason = "far";
    return { id: p.id, reason };
  });

  // Time freed if a stop is skipped (keeping the rest in the same order).
  const out = days.map((d, di) => {
    const s = sims[di], o = orders[di];
    const items = s.items.map(it => {
      if (it.type !== "visit") return it;
      const r = simulate(d, o.filter(x => x !== it.id));
      return { ...it, skipSaves: r.ok ? Math.max(0, Math.round(s.finish - r.finish)) : null, skipKm: r.ok ? Math.max(0, +(s.km - r.km).toFixed(1)) : null };
    });
    return { order: o, items, travel: Math.round(s.travel), km: +s.km.toFixed(1), finish: s.finish, back: s.back };
  });
  return { days: out, dropped, simulate };
}

function schedule(places, days, dur, dist, opts) {
  const s = makeScheduler(places, days, dur, dist, opts);
  return { days: s.days, dropped: s.dropped };
}

// "Can I still make it?" for each place, starting now from where you are.
function feasibility(now, weekday, here, places, dur, opts = {}) {
  const O = { ...DEFAULTS, ...opts };
  return places.map(p => {
    const tt = Math.round((dur[here][p.node] / 60) * O.travelFactor + O.parkMin), arr = now + tt;
    const w = p.hours ? p.hours[weekday] || [] : O.unknownHours;
    if (!w.length) return { id: p.id, verdict: "closed", travel: tt, arrive: arr };
    const minNeed = Math.max(20, Math.round(p.visit * O.minVisitFrac));
    for (const [o, c] of w) {
      if (arr + minNeed > c) continue;
      const start = Math.max(arr, o), avail = c - start;
      return { id: p.id, verdict: avail >= p.visit ? "ok" : "tight", travel: tt, arrive: arr, opensAt: start > arr ? start : null, closesAt: c, available: Math.round(Math.min(avail, 600)), known: !!p.hours };
    }
    const last = w[w.length - 1];
    return { id: p.id, verdict: arr >= last[1] ? "late" : "toolate", travel: tt, arrive: arr, closesAt: last[1], available: Math.max(0, Math.round(last[1] - arr)), known: !!p.hours };
  });
}

module.exports = { schedule, feasibility, makeScheduler, DEFAULTS };

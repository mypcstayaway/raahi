// "I live in Agra, I have 6 days and ₹30,000. Where can I go?"  and quick advice.
const ai = require("./ai");
const P = require("./prompts");
const places = require("./places");
const { userErr } = require("./google");
const { cache } = require("./db");

async function explore(user, b) {
  if (!ai.enabled()) throw userErr("Trip ideas need the free AI key (see README).");
  if (!b.home || !b.home.label) throw userErr("Tell me where you are starting from.");
  const days = Math.max(1, Math.min(30, Math.round(+b.days || 3)));
  const req = { ...b, days };
  const key = "explore:" + JSON.stringify([b.home.label, days, b.start, b.month, b.travellers, b.budget, b.per, b.transport, b.scope, b.interests, b.pace, b.diet]);
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

async function advice(user, b) {
  if (!ai.enabled()) throw userErr("Suggestions need the free AI key (see README).");
  const kind = b.kind === "howlong" ? "howlong" : "when";
  if (!b.destination) throw userErr("Pick a destination first.");
  const key = `adv:${kind}:${String(b.destination).toLowerCase()}:${b.days || ""}:${b.pace || ""}:${(b.interests || []).join(",")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = await ai.askJSON({ ...P.advicePrompt(kind, b), search: kind === "when" && ai.canSearch(), ms: 60000 });
  const out = { kind, ...(r.data || {}), sources: r.sources || [] };
  cache.set(key, out, 7 * 86400e3);
  return out;
}

module.exports = { explore, advice };

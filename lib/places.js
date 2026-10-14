// Free map services: Photon + Nominatim (place search), OSRM (road distances),
// Overpass (OpenStreetMap details: opening hours, restaurants), Open-Meteo (weather).
// Everything is cached in the database so repeat lookups are instant.
const cfg = require("./config");
const { cache } = require("./db");
const { userErr } = require("./google");

const UA = "Raahi-trip-planner/1.0 (personal, non-commercial)";
const DAY = 864e5;

class NetError extends Error {}
async function getJSON(url, ms = 10000, init = {}) {
  let r;
  try { r = await fetch(url, { ...init, headers: { "User-Agent": UA, "Accept-Language": "en", ...(init.headers || {}) }, signal: AbortSignal.timeout(ms) }); }
  catch (e) { throw new NetError(`${new URL(url).hostname} ${e.name === "TimeoutError" ? "timed out" : "unreachable"}`); }
  if (r.status === 429 || r.status === 504) throw new NetError(`${new URL(url).hostname} is busy`);
  const body = await r.json().catch(() => null);
  if (!body && !r.ok) throw new NetError(`${new URL(url).hostname} returned ${r.status}`);
  return body;
}

// Nominatim allows 1 request per second, so queue them.
let nomiChain = Promise.resolve();
function nomiQueued(url) {
  const p = nomiChain.then(() => getJSON(url));
  nomiChain = p.catch(() => {}).then(() => new Promise(r => setTimeout(r, 1050)));
  return p;
}

// ---------- place search ----------
const photonName = p => [p.name || [p.street, p.housenumber].filter(Boolean).join(" "), p.city || p.county || p.state, p.country].filter(Boolean).join(", ");
async function photon(q, bias, limit = 1) {
  let url = `${cfg.PHOTON_URL}/api/?limit=${limit}&q=${encodeURIComponent(q)}`;
  if (bias) url += `&lat=${(+bias.lat).toFixed(4)}&lon=${(+bias.lng).toFixed(4)}`;
  const j = await getJSON(url, 8000);
  return ((j && j.features) || []).map(f => ({
    lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], name: photonName(f.properties),
    title: f.properties.name || [f.properties.street, f.properties.housenumber].filter(Boolean).join(" ") || q,
    sub: [f.properties.city || f.properties.county, f.properties.state, f.properties.country].filter(Boolean).join(", "),
    country: f.properties.countrycode || "", osm: f.properties.osm_key ? `${f.properties.osm_key}=${f.properties.osm_value}` : "",
  }));
}
async function nominatim(q) {
  const j = await nomiQueued(`${cfg.NOMINATIM_URL}/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(q)}`);
  return Array.isArray(j) && j.length ? { lat: +j[0].lat, lng: +j[0].lon, name: j[0].display_name, country: (j[0].address && j[0].address.country_code || "").toUpperCase() } : null;
}
function variants(q) {
  const q2 = q.replace(/\b\d{5,6}\b/g, "").replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/,\s*$/, "").trim();
  const parts = q2.split(",").map(x => x.trim()).filter(Boolean);
  const vs = [q2];
  if (parts.length > 3) vs.push(parts[0] + ", " + parts.slice(-3).join(", "));
  if (parts.length > 2) vs.push(parts.slice(0, 2).join(", "));
  if (parts.length > 1) vs.push(parts.slice(-3).join(", "));
  if (parts.length > 1) vs.push(parts[0]);
  return [...new Set(vs)].filter(Boolean);
}
async function geocode(q, bias) {
  const key = "geo:" + q.trim().toLowerCase() + (bias ? `@${(+bias.lat).toFixed(1)},${(+bias.lng).toFixed(1)}` : "");
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const vs = variants(q.trim());
  let netFails = 0;
  const res = await Promise.all(vs.map(v => photon(v, bias).then(a => a[0] || null).catch(e => { if (e instanceof NetError) netFails++; return null; })));
  let found = res.find(Boolean) || null;
  if (!found) for (const v of vs.slice(0, 2)) {
    try { found = await nominatim(v); } catch (e) { if (e instanceof NetError) netFails++; }
    if (found) break;
  }
  if (!found && netFails >= vs.length) throw new NetError("place search unreachable");
  if (found) found = { lat: found.lat, lng: found.lng, name: found.name, country: found.country || "" };
  if (found || netFails === 0) cache.set(key, found, found ? 90 * DAY : 3 * DAY);
  return found;
}
async function suggest(q, bias) {
  const key = "sug:" + q.trim().toLowerCase() + (bias ? `@${(+bias.lat).toFixed(1)},${(+bias.lng).toFixed(1)}` : "");
  const hit = cache.get(key);
  if (hit) return hit;
  const out = (await photon(q, bias, 6)).map(({ lat, lng, title, sub, country }) => ({ lat, lng, title, sub, country }));
  cache.set(key, out, 30 * DAY);
  return out;
}
async function reverse(lat, lng) {
  const key = `rev:${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const j = await getJSON(`${cfg.PHOTON_URL}/reverse?lat=${lat}&lon=${lng}&limit=1`, 6000).catch(() => null);
  const f = j && j.features && j.features[0];
  const out = f ? { name: photonName(f.properties), city: f.properties.city || f.properties.county || f.properties.state || "", country: f.properties.countrycode || "" } : { name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`, city: "", country: "" };
  if (f) cache.set(key, out, 90 * DAY);
  return out;
}

// ---------- road distances (OSRM) ----------
const ck = pts => pts.map(p => `${(+p.lng).toFixed(5)},${(+p.lat).toFixed(5)}`).join(";");
const haversine = (a, b) => { const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(h)); };

async function table(pts) {
  const key = "tab:" + ck(pts);
  const hit = cache.get(key);
  if (hit) return hit;
  if (pts.length > 100) throw userErr("Too many places for one distance lookup.");
  const j = await getJSON(`${cfg.OSRM_URL}/table/v1/driving/${ck(pts)}?annotations=distance,duration`, 20000);
  if (!j || j.code !== "Ok") throw userErr("The road-distance service could not handle these places. " + ((j && j.message) || ""));
  const fix = m => m.map(r => r.map(v => (v == null ? 1e12 : v)));
  const out = { d: fix(j.distances), t: fix(j.durations) };
  cache.set(key, out, 14 * DAY);
  return out;
}
// Falls back to straight-line estimates if the road service is down, so plans still work.
async function tableOrEstimate(pts) {
  try { return { ...(await table(pts)), estimated: false }; }
  catch (e) {
    if (!(e instanceof NetError)) throw e;
    const d = pts.map(a => pts.map(b => haversine(a, b) * 1.35));
    return { d, t: d.map(r => r.map(v => v / 9)), estimated: true }; // ~32 km/h average
  }
}
async function route(pts) {
  const key = "rt:" + ck(pts);
  const hit = cache.get(key);
  if (hit) return hit;
  const j = await getJSON(`${cfg.OSRM_URL}/route/v1/driving/${ck(pts)}?overview=full&geometries=polyline`, 20000);
  if (!j || j.code !== "Ok") throw userErr("Could not draw the road route.");
  const r = j.routes[0];
  const out = { distance: r.distance, duration: r.duration, geometry: r.geometry, legs: r.legs.map(l => ({ distance: l.distance, duration: l.duration })) };
  cache.set(key, out, 14 * DAY);
  return out;
}

// ---------- OpenStreetMap details (Overpass) ----------
async function overpass(query, ttl = 14 * DAY) {
  const key = "ovp:" + query;
  const hit = cache.get(key);
  if (hit) return hit;
  // The main Overpass server is often busy; fall back to free public mirrors.
  const urls = [...new Set([cfg.OVERPASS_URL, "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"])];
  let j, err;
  for (const u of urls) {
    try { j = await getJSON(u, 30000, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(query) }); err = null; break; }
    catch (e) { err = e; if (cfg.OVERPASS_URL !== "https://overpass-api.de/api/interpreter") break; }
  }
  if (err) throw err;
  const els = (j && j.elements) || [];
  const out = els.map(e => ({ id: `${e.type}/${e.id}`, lat: e.lat != null ? e.lat : e.center && e.center.lat, lng: e.lon != null ? e.lon : e.center && e.center.lon, tags: e.tags || {} })).filter(e => e.lat != null);
  cache.set(key, out, ttl);
  return out;
}
const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").replace(/\b(the|of|and|shri|sri|temple|mandir|fort|museum|park|ji)\b/g, " ").replace(/\s+/g, " ").trim();
function similar(a, b) {
  const A = new Set(norm(a).split(" ").filter(Boolean)), B = new Set(norm(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return norm(a) && norm(a) === norm(b) ? 1 : 0;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}

// Finds the OpenStreetMap entry for each place (to read real opening hours, website, etc).
async function osmDetails(places) {
  const pts = places.filter(p => p.lat != null);
  if (!pts.length) return {};
  const body = pts.map(p => `nwr(around:300,${(+p.lat).toFixed(5)},${(+p.lng).toFixed(5)})[name];`).join("");
  let els;
  try { els = await overpass(`[out:json][timeout:25];(${body});out center tags 400;`); } catch { return {}; }
  const out = {};
  for (const p of pts) {
    let best = null, bs = 0.5;
    for (const e of els) {
      const s = Math.max(similar(p.name, e.tags.name), similar(p.name, e.tags["name:en"]));
      if (s > bs || (s === bs && best && !best.tags.opening_hours && e.tags.opening_hours)) {
        if (haversine(p, e) < 400) { best = e; bs = s; }
      }
    }
    if (best) out[p.id] = { osm: best.id, hours: best.tags.opening_hours || null, website: best.tags.website || best.tags["contact:website"] || null, wikipedia: best.tags.wikipedia || null, fee: best.tags.fee || null, phone: best.tags.phone || null };
  }
  return out;
}

// Interest name → OpenStreetMap tags, used when no AI key is set.
const OSM_INTEREST = {
  temples: `nwr["amenity"="place_of_worship"]["religion"~"hindu|jain|buddhist"]`,
  mosques: `nwr["amenity"="place_of_worship"]["religion"="muslim"]`,
  gurudwaras: `nwr["amenity"="place_of_worship"]["religion"="sikh"]`,
  churches: `nwr["amenity"="place_of_worship"]["religion"="christian"]`,
  museums: `nwr["tourism"~"museum|gallery"]`,
  history: `nwr["historic"~"monument|castle|fort|palace|memorial|archaeological_site|ruins|tomb"]`,
  forts: `nwr["historic"~"castle|fort|palace"]`,
  nature: `nwr["leisure"~"park|garden|nature_reserve"]`,
  viewpoints: `nwr["tourism"="viewpoint"]`,
  lakes: `nwr["natural"~"water|waterfall|beach"]`,
  beaches: `nwr["natural"="beach"]`,
  wildlife: `nwr["tourism"="zoo"]`,
  markets: `nwr["amenity"="marketplace"]`,
  kids: `nwr["tourism"~"theme_park|zoo|aquarium"]`,
};
async function osmAttractions(center, interests, radiusKm = 15) {
  const r = Math.round(radiusKm * 1000), at = `(around:${r},${center.lat},${center.lng})`;
  const parts = [`nwr["tourism"~"attraction|museum|viewpoint|zoo|theme_park|gallery"]["name"]${at};`, `nwr["historic"]["name"]["wikidata"]${at};`];
  for (const i of interests || []) if (OSM_INTEREST[i]) parts.push(`${OSM_INTEREST[i]}["name"]["wikidata"]${at};`);
  const els = await overpass(`[out:json][timeout:25];(${parts.join("")});out center tags 300;`, 30 * DAY);
  const seen = new Set();
  return els.filter(e => { const k = norm(e.tags.name); if (!k || seen.has(k)) return false; seen.add(k); return true; })
    .map(e => ({ ...e, score: (e.tags.wikipedia ? 3 : 0) + (e.tags.wikidata ? 2 : 0) + (e.tags.tourism === "attraction" ? 2 : 0) + (e.tags.tourism === "museum" ? 1 : 0) + (e.tags.heritage ? 2 : 0) + (e.tags.opening_hours ? 1 : 0) }))
    .sort((a, b) => b.score - a.score);
}

// Real restaurants near a point, best matches for the diet first.
async function restaurantsNear(points, diet, radius = 1500) {
  if (!points.length) return [];
  const body = points.map(p => `nwr(around:${radius},${(+p.lat).toFixed(4)},${(+p.lng).toFixed(4)})["amenity"~"restaurant|cafe|fast_food"]["name"];`).join("");
  let els;
  try { els = await overpass(`[out:json][timeout:25];(${body});out center tags 600;`); } catch { return points.map(() => []); }
  const vegOk = t => t["diet:vegetarian"] === "yes" || t["diet:vegetarian"] === "only" || t["diet:vegan"] === "yes" || /veg|jain|bhojnalaya|sweets/i.test(t.name || "");
  const pure = t => t["diet:vegetarian"] === "only" || /pure veg|jain|bhojnalaya/i.test(t.name || "");
  return points.map(p => els.map(e => {
    const t = e.tags, dist = haversine(p, e);
    if (dist > radius * 1.2) return null;
    let s = 0;
    if (diet === "veg" || diet === "jain") { if (pure(t)) s += 4; else if (vegOk(t)) s += 2; else s -= 3; }
    if (t.amenity === "restaurant") s += 2;
    if (t.cuisine) s += 1;
    if (t.opening_hours) s += 1;
    if (t.website || t.phone || t["contact:phone"]) s += 1;
    if (t.wikidata || t.brand) s += 1;
    s -= dist / 800;
    return { name: t.name, lat: e.lat, lng: e.lng, cuisine: (t.cuisine || "").replace(/;/g, ", ").replace(/_/g, " "), veg: pure(t) ? "pure-veg" : vegOk(t) ? "veg-options" : "", hours: t.opening_hours || "", distance: Math.round(dist), score: s };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 3));
}

// ---------- weather (Open-Meteo, free, no key) ----------
const WMO = { 0: ["Clear", "☀️"], 1: ["Mostly clear", "🌤️"], 2: ["Partly cloudy", "⛅"], 3: ["Cloudy", "☁️"], 45: ["Fog", "🌫️"], 48: ["Fog", "🌫️"], 51: ["Drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Drizzle", "🌦️"], 61: ["Rain", "🌧️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"], 71: ["Snow", "🌨️"], 73: ["Snow", "🌨️"], 75: ["Heavy snow", "❄️"], 80: ["Showers", "🌦️"], 81: ["Showers", "🌧️"], 82: ["Heavy showers", "⛈️"], 95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm", "⛈️"], 99: ["Thunderstorm", "⛈️"] };
async function weather(pt, start, end) {
  const today = new Date().toISOString().slice(0, 10), maxDay = new Date(Date.now() + 15 * DAY).toISOString().slice(0, 10);
  if (!start || start > maxDay || end < today) return null;
  const s = start < today ? today : start, e = end > maxDay ? maxDay : end;
  const key = `wx:${(+pt.lat).toFixed(2)},${(+pt.lng).toFixed(2)}:${s}:${e}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const j = await getJSON(`${cfg.WEATHER_URL}/v1/forecast?latitude=${pt.lat}&longitude=${pt.lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=auto&start_date=${s}&end_date=${e}`, 8000);
    if (!j || !j.daily) return null;
    const d = j.daily, out = {};
    d.time.forEach((t, i) => { const w = WMO[d.weather_code[i]] || ["", "🌡️"]; out[t] = { text: w[0], icon: w[1], max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]), rain: d.precipitation_probability_max[i], sunrise: (d.sunrise[i] || "").slice(11), sunset: (d.sunset[i] || "").slice(11) }; });
    cache.set(key, out, 3 * 3600e3);
    return out;
  } catch { return null; }
}

// Hourly chance of rain for one day: [{h, p}] (h = hour 0-23, p = %)
async function hourlyRain(pt, date) {
  const key = `rainh:${(+pt.lat).toFixed(2)},${(+pt.lng).toFixed(2)}:${date}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const j = await getJSON(`${cfg.WEATHER_URL}/v1/forecast?latitude=${pt.lat}&longitude=${pt.lng}&hourly=precipitation_probability&timezone=auto&start_date=${date}&end_date=${date}`, 8000);
    const h = j && j.hourly;
    if (!h || !h.time) return null;
    const out = h.time.map((t, i) => ({ h: +t.slice(11, 13), p: h.precipitation_probability[i] || 0 }));
    cache.set(key, out, 2 * 3600e3);
    return out;
  } catch { return null; }
}

// Nearest hospitals, police stations and pharmacies (for SOS).
async function helpNearby(pt) {
  const at = `(around:6000,${(+pt.lat).toFixed(4)},${(+pt.lng).toFixed(4)})`;
  let els = [];
  try { els = await overpass(`[out:json][timeout:20];(nwr["amenity"~"hospital|clinic"]["name"]${at};nwr["amenity"="police"]${at};nwr["amenity"="pharmacy"]["name"]${at};);out center tags 120;`, 7 * DAY); } catch {}
  const pick = re => els.filter(e => re.test(e.tags.amenity || "")).map(e => ({ name: e.tags.name || e.tags["name:en"] || (e.tags.amenity === "police" ? "Police station" : "Unnamed"), lat: e.lat, lng: e.lng, phone: e.tags.phone || e.tags["contact:phone"] || e.tags.emergency_phone || null, distance: Math.round(haversine(pt, e)), emergency: e.tags.emergency === "yes" }))
    .sort((a, b) => (b.emergency - a.emergency) || a.distance - b.distance).slice(0, 3);
  return { hospitals: pick(/hospital|clinic/), police: pick(/police/), pharmacies: pick(/pharmacy/) };
}

module.exports = { hourlyRain, helpNearby, geocode, suggest, reverse, table, tableOrEstimate, route, osmDetails, osmAttractions, restaurantsNear, weather, haversine, similar, variants, NetError };

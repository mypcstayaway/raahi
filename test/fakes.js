// Stand-ins for Photon, Nominatim, OSRM, Overpass, Open-Meteo, Gemini and Google sign-in,
// so the whole app can be tested without the internet.
const http = require("http");

const PLACES = {
  agra: [78.0081, 27.1767], "taj mahal": [78.0421, 27.1751], "agra fort": [78.0211, 27.1795], "mehtab bagh": [78.0422, 27.1795],
  "itimad-ud-daulah": [78.0311, 27.1929], "akbar's tomb": [77.9506, 27.2203], "fatehpur sikri": [77.6611, 27.0945],
  "kinari bazaar": [78.0158, 27.1849], "jama masjid": [78.0156, 27.1830], "guru ka taal": [77.9783, 27.2256],
  "hotel": [78.0300, 27.1650], "jaipur": [75.7873, 26.9124], "amber fort": [75.8513, 26.9855], "hawa mahal": [75.8267, 26.9239],
  mathura: [77.6737, 27.4924], vrindavan: [77.7006, 27.5650], delhi: [77.209, 28.6139], rishikesh: [78.2676, 30.0869],
};
const find = q => Object.entries(PLACES).filter(([k]) => q.toLowerCase().includes(k)).sort((a, b) => b[0].length - a[0].length);
const calls = { photon: 0, osrm: 0, overpass: 0, gemini: 0, geminiSearch: 0, weather: 0 };
let geminiMode = "ok";
const runs = {};
let _tdb = null;
const tursoDb = () => { if (!_tdb) { const { DatabaseSync } = require("node:sqlite"); _tdb = new DatabaseSync(":memory:"); } return _tdb; };

const AI_PLACES = [
  ["Taj Mahal", "monument", "Sa-Th 06:00-18:30; Fr off", 150, 5, 9.6],
  ["Agra Fort", "fort", "Mo-Su 06:00-18:00", 120, 5, 9.0],
  ["Mehtab Bagh", "park", "Mo-Su 06:00-19:00", 45, 3, 8.2],
  ["Itimad-ud-Daulah", "monument", "Mo-Su 06:00-18:00", 60, 4, 8.7],
  ["Akbar's Tomb", "monument", "Mo-Su 06:00-18:00", 75, 4, 8.5],
  ["Kinari Bazaar", "market", "Tu-Su 11:00-21:00; Mo off", 75, 3, 7.6],
  ["Jama Masjid", "mosque", "Mo-Su 07:00-19:00", 30, 3, 8.0],
  ["Guru Ka Taal", "gurudwara", "24/7", 40, 3, 8.4],
  ["Fatehpur Sikri", "fort", "Mo-Su 06:00-18:00", 150, 4, 8.9],
];

function aiReply(prompt, system) {
  if (/travel companion/.test(system)) return "Namaste! **October to March** is the best time for Agra.\n- Start early to beat crowds\n- Carry water";
  if (/Suggest about/.test(prompt)) {
    const city = (prompt.match(/Destination: ([^\n,]+)/) || [])[1] || "Agra";
    const list = /jaipur/i.test(city) ? [["Amber Fort", "fort", "Mo-Su 08:00-17:30", 150, 5, 9.2], ["Hawa Mahal", "palace", "Mo-Su 09:00-17:00", 45, 4, 8.6]] : AI_PLACES;
    return JSON.stringify({
      summary: `${city} is great for history lovers.`, bestTime: { months: "October to March", note: "Pleasant winters", forYourDates: "Good" }, idealDays: 2,
      places: list.map(([name, category, hours, visitMin, priority, rating]) => ({ name, search: `${name}, ${city}`, lat: 0, lng: 0, category, why: "Classic sight", highlights: ["Main hall", "Gardens"], hours, hoursNote: "", ticket: { indian: "₹50", foreigner: "₹1100", note: "" }, visitMin, bestTimeOfDay: "morning", priority, rating, tips: "Go early.", nearbyFood: "Bedai-jalebi at Deviram Sweets, 500 m, ₹60" })),
      food: [{ dish: "Petha", where: "Panchhi Petha", veg: true }],
      foodStops: [{ dish: "Bedai & jalebi", shop: "Deviram Sweets", area: "Pratap Pura", search: "Kinari Bazaar, Agra", price: "₹60–100", tip: "Go before 10 am, ask for the jalebi straight from the kadhai", veg: true, when: "breakfast", mins: 25 },
        { dish: "Mughlai korma", shop: "Pinch of Spice", area: "Fatehabad Road", search: "Agra Fort, Agra", price: "₹450", tip: "Order the dal makhani too", veg: false, when: "dinner", mins: 60 },
        { dish: "Malai lassi", shop: "Lassi Wala", area: "Sadar", search: "Jama Masjid, Agra", price: "₹70", tip: "Ask for extra malai on top", veg: true, when: "snack", mins: 15 }],
      souvenirs: [{ item: "Marble inlay coaster set", where: "Shilpgram", price: "₹800–2,500", tip: "Shine a torch: real marble glows" }, { item: "Petha", where: "Panchhi Petha, Sadar", price: "₹200/kg", tip: "Buy sealed boxes for travel" }], restaurants: [{ name: "Pinch of Spice", area: "Fatehabad Road", veg: "veg-options", price: "₹₹", famousFor: "North Indian" }],
      transport: "Autos ₹100–200.", budget: { currency: "INR", perPersonPerDay: { stay: 2000, food: 800, localTransport: 500, tickets: 400 }, note: "Mid-range" },
      packing: ["Sunscreen", "Comfortable shoes"], safety: ["Ignore touts at the gates"], etiquette: ["Cover shoulders in mosques"], emergency: [{ label: "Police", number: "112" }],
    });
  }
  if (/live travel checker/.test(system)) {
    const names = [...prompt.matchAll(/^\d+\. (.+)$/gm)].map(m => m[1]);
    return "Here is what I found:\n```json\n" + JSON.stringify({ places: names.map((n, i) => ({ name: n, score: i === 0 ? 4 : 8, verdict: i === 0 ? "caution" : "go", crowd: i === 0 ? "high" : "moderate", summary: i === 0 ? "Very crowded this week due to a festival." : "Normal crowds.", alerts: i === 0 ? ["Long queues at East Gate"] : [], recent: true })) }) + "\n```";
  }
  if (/Suggest 6 different trip options/.test(prompt)) {
    return JSON.stringify({ options: [
      { title: "Krishna trail", destinations: [{ name: "Mathura", search: "Mathura, Uttar Pradesh", lat: 27.49, lng: 77.67, nights: 1 }, { name: "Vrindavan", search: "Vrindavan", nights: 1 }], why: "Close and spiritual", highlights: ["Banke Bihari"], season: "good – pleasant", getThere: "1 h by road", cost: { total: 8000, perPerson: 4000, note: "stay+food" }, pace: "relaxed", rating: 8.4 },
      { title: "Pink City", destinations: [{ name: "Jaipur", search: "Jaipur, Rajasthan", nights: 3 }], why: "Forts and food", highlights: ["Amber Fort"], season: "good", getThere: "4 h by road", cost: { total: 25000, perPerson: 12500, note: "" }, pace: "moderate", rating: 9 },
    ] });
  }
  if (/best time to visit/i.test(prompt)) return JSON.stringify({ answer: "October to March is best.", months: "October to March", suggestStart: "2026-11-14" });
  if (/How many days are ideal/i.test(prompt)) return JSON.stringify({ answer: "2 days is ideal.", days: 2, minDays: 1, maxDays: 3 });
  if (/Choose the best/.test(prompt)) { const n = [...prompt.matchAll(/^\d+\. ([^–]+?) –/gm)].map(m => m[1]); return JSON.stringify({ pick: [n.find(x => /Taj/.test(x)) || n[0]], why: "The Taj Mahal is one of a kind; Agra Fort is similar to forts you'll see elsewhere.", skipWhy: {} }); }
  if (/Extract visitor information/.test(system)) return JSON.stringify({ ticket: "Indians ₹50, foreigners ₹1100", hours: "6 am – 6:30 pm, closed Friday", notice: "" });
  if (/Give visitor details/.test(prompt)) return JSON.stringify({ name: "x", category: "temple", why: "Local favourite", highlights: [], hours: "Mo-Su 05:00-21:00", ticket: { indian: "Free" }, visitMin: 40, priority: 3, rating: 8.1, tips: "" });
  return "Namaste! October to March is the best time for Agra. Carry water and start early.";
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const json = (j, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    // Photon
    if (u.pathname === "/api/" || u.pathname === "/api") {
      calls.photon++;
      const q = u.searchParams.get("q") || "";
      const hits = find(q).slice(0, +u.searchParams.get("limit") || 1);
      return json({ features: hits.map(([k, c]) => ({ geometry: { coordinates: c }, properties: { name: k.replace(/\b\w/g, x => x.toUpperCase()), city: "Agra", state: "Uttar Pradesh", country: "India", countrycode: "IN" } })) });
    }
    if (u.pathname === "/reverse") return json({ features: [{ geometry: { coordinates: [78.03, 27.17] }, properties: { name: "Tajganj", city: "Agra", country: "India", countrycode: "IN" } }] });
    if (u.pathname === "/search") return json([]);
    // OSRM
    if (u.pathname.startsWith("/table/") || u.pathname.startsWith("/route/")) {
      calls.osrm++;
      const coords = decodeURIComponent(u.pathname.split("/").pop()).split(";").map(s => s.split(",").map(Number));
      const dist = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos(a[1] * Math.PI / 180), a[1] - b[1]) * 111000 * 1.3;
      if (u.pathname.startsWith("/table/")) return json({ code: "Ok", distances: coords.map(a => coords.map(b => dist(a, b))), durations: coords.map(a => coords.map(b => dist(a, b) / 8)) });
      const legs = coords.slice(1).map((b, i) => ({ distance: dist(coords[i], b), duration: dist(coords[i], b) / 8 }));
      return json({ code: "Ok", routes: [{ distance: legs.reduce((s, l) => s + l.distance, 0), duration: legs.reduce((s, l) => s + l.duration, 0), geometry: "_p~iF~ps|U_ulLnnqC", legs }] });
    }
    // Overpass
    if (u.pathname === "/interpreter") {
      calls.overpass++;
      const q = decodeURIComponent(body.replace(/^data=/, "").replace(/\+/g, " "));
      if (/hospital/.test(q)) return json({ elements: [
        { type: "node", id: 21, lat: 27.18, lon: 78.01, tags: { amenity: "hospital", name: "District Hospital", emergency: "yes", phone: "+91 562 000 0000" } },
        { type: "node", id: 22, lat: 27.172, lon: 78.035, tags: { amenity: "police", name: "Tajganj Police Station" } },
        { type: "node", id: 23, lat: 27.171, lon: 78.036, tags: { amenity: "pharmacy", name: "City Chemist" } } ] });
      if (/restaurant/.test(q)) return json({ elements: [
        { type: "node", id: 1, lat: 27.172, lon: 78.04, tags: { amenity: "restaurant", name: "Shree Bhojnalaya", "diet:vegetarian": "only", cuisine: "indian" } },
        { type: "node", id: 2, lat: 27.175, lon: 78.03, tags: { amenity: "restaurant", name: "Kebab Corner", cuisine: "mughlai" } },
        { type: "node", id: 3, lat: 27.18, lon: 78.02, tags: { amenity: "cafe", name: "Sheroes Hangout", "diet:vegetarian": "yes" } } ] });
      // Real hours for Taj Mahal from "OpenStreetMap"
      return json({ elements: [{ type: "way", id: 9, center: { lat: 27.1751, lon: 78.0421 }, tags: { name: "Taj Mahal", tourism: "attraction", wikidata: "Q9141", wikipedia: "en:Taj Mahal", opening_hours: "Sa-Th 06:00-18:30; Fr off", historic: "monument" } },
        { type: "way", id: 10, center: { lat: 27.1795, lon: 78.0211 }, tags: { name: "Agra Fort", historic: "castle", wikidata: "Q1", wikipedia: "en:Agra Fort", tourism: "attraction" } }] });
    }
    // Open-Meteo
    if (u.pathname === "/v1/forecast" && u.searchParams.get("hourly")) {
      const d = u.searchParams.get("start_date"), t = [], pr = [];
      for (let h = 0; h < 24; h++) { t.push(`${d}T${String(h).padStart(2, "0")}:00`); pr.push(h >= 14 && h < 17 ? 80 : 10); }
      return json({ hourly: { time: t, precipitation_probability: pr } });
    }
    if (u.pathname === "/v1/forecast") {
      calls.weather++;
      const s = new Date(u.searchParams.get("start_date")), e = new Date(u.searchParams.get("end_date")), t = [];
      for (let d = s; d <= e; d = new Date(+d + 864e5)) t.push(d.toISOString().slice(0, 10));
      return json({ daily: { time: t, weather_code: t.map(() => 1), temperature_2m_max: t.map(() => 31), temperature_2m_min: t.map(() => 18), precipitation_probability_max: t.map(() => 5), sunrise: t.map(x => x + "T06:15"), sunset: t.map(x => x + "T17:45") } });
    }
    // Google token check
    if (u.pathname === "/tokeninfo") {
      const tok = u.searchParams.get("id_token");
      if (tok !== "good-token") return json({ error: "invalid" }, 400);
      return json({ aud: "test-client", iss: "https://accounts.google.com", sub: "g-123", email: "yug@example.com", email_verified: "true", name: "Yug", exp: String(Math.floor(Date.now() / 1000) + 3600) });
    }
    // Gemini
    const gm = u.pathname.match(/^\/v1beta\/models\/([^:]+):(generateContent|streamGenerateContent)$/);
    if (gm) {
      calls.gemini++;
      if (geminiMode === "quota") return json({ error: { code: 429, message: "Resource exhausted (quota)" } }, 429);
      const b = JSON.parse(body || "{}");
      if (b.tools) calls.geminiSearch++;
      const prompt = b.contents.map(c => c.parts.map(p => p.text).join("")).join("\n");
      const system = b.systemInstruction ? b.systemInstruction.parts[0].text : "";
      const text = aiReply(b.contents[b.contents.length - 1].parts[0].text, system + prompt.slice(0, 0));
      const gmeta = b.tools ? { groundingChunks: [{ web: { uri: "https://www.reddit.com/r/india/x", title: "reddit.com" } }] } : undefined;
      if (gm[2] === "streamGenerateContent") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const words = text.split(/(?<= )/);
        let i = 0;
        const tick = () => {
          if (i >= words.length) { res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "" }] }, groundingMetadata: gmeta }] })}\n\n`); return res.end(); }
          res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: words[i++] }] } }] })}\n\n`);
          setTimeout(tick, 5);
        };
        return tick();
      }
      return json({ candidates: [{ content: { parts: [{ text }] }, groundingMetadata: gmeta }] });
    }
    // TinyFish Search
    if (u.pathname === "/tfsearch") {
      calls.tfSearch = (calls.tfSearch || 0) + 1;
      if (req.headers["x-api-key"] !== "tf-key") return json({ error: "bad key" }, 401);
      const q = u.searchParams.get("query");
      const reddit = (u.searchParams.get("include_domains") || "").includes("reddit");
      if (/Taj Mahal/.test(q)) return json({ query: q, results: [reddit ? { position: 1, site_name: "reddit.com", title: "Visited Taj today – insane crowds, 2 hr queue", snippet: "East gate queue was 2 hours because of the long weekend.", url: "https://reddit.com/r/india/taj1", date: "2026-10-12" } : { position: 1, site_name: "timesofindia.com", title: "Taj Mahal sees record footfall", snippet: "Over 80,000 visitors on Sunday.", url: "https://toi.in/taj", date: "2026-10-11" }], total_results: 1, page: 0 });
      return json({ query: q, results: [], total_results: 0, page: 0 });
    }
    // TinyFish Fetch
    if (u.pathname === "/tffetch") {
      calls.tfFetch = (calls.tfFetch || 0) + 1;
      const b = JSON.parse(body || "{}");
      return json({ results: b.urls.map(x => ({ url: x, final_url: x, title: "Official site", text: "Timings: 6 am to 6:30 pm. Closed Friday. Tickets: Indians Rs 50, foreigners Rs 1100." })), errors: [] });
    }
    // TinyFish Agent
    if (u.pathname === "/v1/automation/run-async") { calls.tfAgent = (calls.tfAgent || 0) + 1; runs[`run_${calls.tfAgent}`] = 0; return json({ run_id: `run_${calls.tfAgent}`, error: null }); }
    const rm = u.pathname.match(/^\/v1\/runs\/(\w+)$/);
    if (rm) {
      runs[rm[1]] = (runs[rm[1]] || 0) + 1;
      if (runs[rm[1]] < 2) return json({ run_id: rm[1], status: "RUNNING" });
      return json({ run_id: rm[1], status: "COMPLETED", result: { found: true, name: "Taj Mahal", status: "Open", hours_today: "6 am–5 pm", busy_now: "Busier than usual", entry_fee: "₹50", rating: 4.6, review_count: 250000,
        newest_reviews: [{ when: "2 days ago", stars: 3, summary: "Huge queues" }, { when: "4 days ago", stars: 4, summary: "Beautiful but crowded" }, { when: "3 weeks ago", stars: 5, summary: "Magical" }] } });
    }
    // Turso (libSQL over HTTP), backed by an in-memory SQLite database
    if (u.pathname === "/v2/pipeline") {
      if (req.headers.authorization !== "Bearer turso-token") return json({ message: "unauthorized" }, 401);
      calls.turso = (calls.turso || 0) + 1;
      const b = JSON.parse(body || "{}");
      const conv = a => (a.type === "null" ? null : a.type === "integer" ? Number(a.value) : a.type === "float" ? a.value : a.value);
      const out = (b.requests || []).map(r => {
        if (r.type === "close") return { type: "close" };
        try {
          const st = tursoDb().prepare(r.stmt.sql), args = (r.stmt.args || []).map(conv);
          if (st.columns().length) {
            const rows = st.all(...args), cols = st.columns().map(c => ({ name: c.name, decltype: null }));
            const enc = v => (v === null ? { type: "null" } : typeof v === "number" ? (Number.isInteger(v) ? { type: "integer", value: String(v) } : { type: "float", value: v }) : { type: "text", value: String(v) });
            return { type: "ok", response: { type: "execute", result: { cols, rows: rows.map(row => cols.map(c => enc(row[c.name]))), affected_row_count: 0 } } };
          }
          const res = st.run(...args);
          return { type: "ok", response: { type: "execute", result: { cols: [], rows: [], affected_row_count: Number(res.changes) } } };
        } catch (e) { return { type: "error", error: { message: e.message } }; }
      });
      return json({ baton: null, results: out });
    }
    // Short links
    if (u.pathname === "/short") { res.writeHead(302, { Location: "https://www.google.com/maps/dir/Taj+Mahal,+Agra/Agra+Fort/Mehtab+Bagh/@27.17,78.03,13z/data=!4m2!4m1!3e0?entry=ttu&g_st=ic" }); return res.end(); }
    if (u.pathname === "/short-html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(`<html><head><meta property="og:url" content="https://maps.google.com/?saddr=Agra+Fort&amp;daddr=Taj+Mahal+to:Mehtab+Bagh"></head></html>`); }
    res.writeHead(404); res.end();
  });
});

function start() {
  return new Promise(r => server.listen(0, "127.0.0.1", () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    r({ base, calls, setGemini: m => (geminiMode = m), close: () => server.close(), env: { PHOTON_URL: base, NOMINATIM_URL: base, OSRM_URL: base, OVERPASS_URL: base + "/interpreter", WEATHER_URL: base, GEMINI_URL: base, GEMINI_API_KEY: "test-key", GOOGLE_CLIENT_ID: "test-client", GOOGLE_TOKENINFO: base + "/tokeninfo", TINYFISH_API_KEY: "tf-key", TINYFISH_SEARCH_URL: base + "/tfsearch", TINYFISH_FETCH_URL: base + "/tffetch", TINYFISH_AGENT_URL: base } });
  }));
}
module.exports = { start, PLACES };

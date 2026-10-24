// Demo mode: the real Raahi app, but every outside service (AI, maps, road times, weather, TinyFish)
// answers instantly from prepared SAMPLE data. Made for live presentations, where waiting 20 s for an
// AI answer is too long. It is switched on per browser (visit /demo) and shows a "Demo · sample data"
// badge everywhere, so nobody mistakes the sample data for live data.
const { AsyncLocalStorage } = require("async_hooks");
const als = new AsyncLocalStorage();
const isDemo = () => !!(als.getStore() && als.getStore().demo);
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---------- sample places (approximate real coordinates) ----------
const P = (name, lat, lng, category, o = {}) => ({ name, search: name, lat, lng, category, why: "", highlights: [], hours: "Mo-Su 06:00-19:00", hoursNote: "", ticket: { indian: "Free" }, visitMin: 60, bestTimeOfDay: "any", priority: 3, rating: 8.2, tips: "", nearbyFood: "", babyNote: "", ...o });
const CITIES = {
  varanasi: {
    label: "Varanasi, Uttar Pradesh, India", lat: 25.3176, lng: 82.9739,
    summary: "The oldest living city on the Ganga: dawn boat rides, ancient temples and the evening Aarti. Plan early starts and keep evenings for the ghats.",
    stayArea: { name: "Dashashwamedh / Godowlia", why: "Walk to the main ghats, Kashi Vishwanath and the food lanes." },
    places: [
      P("Dashashwamedh Ghat (Ganga Aarti)", 25.3069, 83.0104, "experience", { why: "The grand evening Ganga Aarti: lamps, bells and chants on the river.", highlights: ["Evening Ganga Aarti", "Boat view of the Aarti", "Ghat steps at dusk"], hours: "Mo-Su 05:00-21:30", visitMin: 90, bestTimeOfDay: "evening", priority: 5, rating: 9.6, tips: "Reach by 6 pm for a front spot on the steps, or watch from a boat.", nearbyFood: "Tamatar chaat at Kashi Chat Bhandar, 400 m, ₹60", babyNote: "Very crowded at Aarti time; a boat view is calmer for a baby." }),
      P("Kashi Vishwanath Temple", 25.3109, 83.0107, "temple", { why: "One of the 12 Jyotirlingas, now with the wide new corridor to the river.", highlights: ["Golden spire", "Kashi Vishwanath Corridor", "Mangala Aarti at dawn"], hours: "Mo-Su 03:00-23:00", hoursNote: "Phones and bags must be deposited at the lockers.", ticket: { indian: "Free", note: "Sugam darshan ₹300, official counter only" }, visitMin: 75, bestTimeOfDay: "morning", priority: 5, rating: 9.3, tips: "Go before 7 am or after 8 pm. Ignore anyone selling “special darshan” outside the gate.", nearbyFood: "Blue Lassi Shop, 300 m, ₹80 (per glass)", babyNote: "Long queues at midday; carry the baby in a sling, strollers are not allowed." }),
      P("Assi Ghat sunrise boat ride", 25.2869, 83.0066, "experience", { why: "Calm sunrise on the Ganga and the morning Subah-e-Banaras programme.", highlights: ["Sunrise boat", "Subah-e-Banaras music", "Morning yoga"], hours: "Mo-Su 05:00-21:00", ticket: { indian: "Boat ₹300–600 per boat" }, visitMin: 90, bestTimeOfDay: "sunrise", priority: 5, rating: 9.4, tips: "Fix the boat price before you get in; ₹500 for an hour is fair." }),
      P("Dhamek Stupa, Sarnath", 25.3810, 83.0230, "monument", { why: "Where the Buddha gave his first sermon; peaceful lawns and ruins.", highlights: ["Dhamek Stupa", "Mulagandha Kuti Vihar", "Deer park"], hours: "Mo-Su 07:00-18:00", ticket: { indian: "₹25", foreigner: "₹300" }, visitMin: 120, bestTimeOfDay: "morning", priority: 4, rating: 8.9, tips: "Combine with the Sarnath Museum next door (closed on Fridays)." }),
      P("Sarnath Museum", 25.3800, 83.0247, "museum", { why: "Home of the Lion Capital of Ashoka, India's national emblem.", highlights: ["Lion Capital of Ashoka", "Buddha sculptures"], hours: "Sa-Th 09:00-17:00; Fr off", ticket: { indian: "₹5" }, visitMin: 60, priority: 4, rating: 8.7, tips: "Closed on Fridays." }),
      P("Ramnagar Fort", 25.2685, 83.0262, "fort", { why: "18th-century sandstone fort of the Kashi royal family across the river.", highlights: ["Vintage car collection", "River view"], hours: "Mo-Su 10:00-17:00", ticket: { indian: "₹75" }, visitMin: 75, priority: 3, rating: 7.9 }),
      P("Bharat Kala Bhavan, BHU", 25.2677, 82.9913, "museum", { why: "A rich art museum inside the leafy Banaras Hindu University campus.", highlights: ["Miniature paintings", "Banarasi textiles"], hours: "Mo-Sa 10:30-17:00; Su off", ticket: { indian: "₹20" }, visitMin: 75, priority: 3, rating: 8.1 }),
      P("Manikarnika Ghat", 25.3109, 83.0137, "experience", { why: "The sacred cremation ghat: intense, but central to understanding Kashi.", highlights: ["Eternal flame", "View from a boat"], hours: "Mo-Su 00:00-24:00", visitMin: 30, priority: 3, rating: 8.4, tips: "Be respectful; no photos of rites. Ignore 'guides' asking for wood donations." }),
      P("Tulsi Manas Mandir", 25.2899, 82.9993, "temple", { why: "White-marble temple where the Ramcharitmanas is inscribed on the walls.", hours: "Mo-Su 05:30-12:00,15:30-21:00", visitMin: 40, priority: 3, rating: 8.3 }),
      P("Godowlia & Vishwanath Gali market", 25.3093, 83.0058, "market", { why: "Banarasi silk, brass, bangles and street food in narrow lanes.", highlights: ["Banarasi sarees", "Wooden toys", "Paan"], hours: "Mo-Su 10:00-21:30", visitMin: 75, bestTimeOfDay: "evening", priority: 3, rating: 8.2, tips: "Ask for the Silk Mark tag when buying silk." }),
    ],
    foodStops: [
      { dish: "Lassi", shop: "Blue Lassi Shop", area: "Kachori Gali", lat: 25.3106, lng: 83.0125, price: "₹80 (per glass)", tip: "Ask for extra malai on top.", veg: true, when: "snack", mins: 20 },
      { dish: "Kachori-sabzi and jalebi", shop: "Ram Bhandar", area: "Thatheri Bazaar", lat: 25.3120, lng: 83.0060, price: "₹40", tip: "Go before 10 am, it sells out.", veg: true, when: "breakfast", mins: 20 },
      { dish: "Malaiyyo (winter milk foam)", shop: "Pakka Mahal stalls", area: "Chowk", lat: 25.3135, lng: 83.0080, price: "₹50", tip: "Only on winter mornings, gone by 10 am.", veg: true, when: "breakfast", mins: 15 },
      { dish: "Tamatar chaat", shop: "Kashi Chat Bhandar", area: "Godowlia", lat: 25.3090, lng: 83.0050, price: "₹60", tip: "Ask for it less spicy if you're new to Banarasi chaat.", veg: true, when: "evening", mins: 25 },
      { dish: "Banarasi paan", shop: "Keshav Tambul Bhandar", area: "Lanka", lat: 25.2805, lng: 82.9990, price: "₹30", tip: "Say “meetha paan” for the sweet one.", veg: true, when: "evening", mins: 10 },
    ],
    souvenirs: [
      { item: "Banarasi silk saree", where: "Chowk & Thatheri Bazaar", price: "from ₹3,000; pure silk ₹8,000+", tip: "Ask for the Silk Mark tag." },
      { item: "Lacquered wooden toys", where: "Kashmiriganj", price: "₹150–500", tip: "Hand-painted ones have tiny brush marks." },
      { item: "Rudraksha beads", where: "Vishwanath Gali", price: "₹100–1,000", tip: "Real beads sink in water." },
    ],
    restaurants: [{ name: "Shree Cafe", area: "Assi", veg: "pure-veg", price: "₹₹", famousFor: "Thali" }, { name: "Brown Bread Bakery", area: "Dashashwamedh", veg: "veg-options", price: "₹₹", famousFor: "Breakfast, rooftop" }, { name: "Deena Chaat Bhandar", area: "Dashashwamedh", veg: "pure-veg", price: "₹", famousFor: "Chaat" }],
  },
  agra: {
    label: "Agra, Uttar Pradesh, India", lat: 27.1767, lng: 78.0081,
    summary: "The Taj Mahal and two more UNESCO sites in one city. Go to the Taj at sunrise and keep sunset for Mehtab Bagh across the river.",
    stayArea: { name: "Tajganj", why: "Walk to the Taj Mahal's East Gate at sunrise." },
    places: [
      P("Taj Mahal", 27.1751, 78.0421, "monument", { why: "The world's most famous monument to love.", highlights: ["Main mausoleum", "Sunrise light on marble", "Mosque and gardens"], hours: "Sa-Th 06:00-18:30; Fr off", hoursNote: "Closed on Fridays.", ticket: { indian: "₹50", foreigner: "₹1100", note: "₹200 extra for the main mausoleum" }, visitMin: 150, bestTimeOfDay: "sunrise", priority: 5, rating: 9.8, tips: "Enter by the East Gate at 6 am; the queue is shortest.", nearbyFood: "Bedai-jalebi at Deviram Sweets, 1.5 km, ₹60" }),
      P("Agra Fort", 27.1795, 78.0211, "fort", { why: "The red Mughal fortress where Shah Jahan watched the Taj.", highlights: ["Musamman Burj", "Diwan-i-Khas", "Taj view"], hours: "Mo-Su 06:00-18:00", ticket: { indian: "₹50", foreigner: "₹650" }, visitMin: 120, bestTimeOfDay: "morning", priority: 5, rating: 9.1 }),
      P("Mehtab Bagh", 27.1795, 78.0422, "park", { why: "Garden across the river with the best sunset view of the Taj.", hours: "Mo-Su 06:00-18:30", ticket: { indian: "₹25" }, visitMin: 45, bestTimeOfDay: "sunset", priority: 4, rating: 8.7 }),
      P("Itimad-ud-Daulah (Baby Taj)", 27.1929, 78.0311, "monument", { why: "A jewel-box tomb with fine marble inlay, the Taj's inspiration.", hours: "Mo-Su 06:00-18:00", ticket: { indian: "₹30" }, visitMin: 45, priority: 4, rating: 8.6 }),
      P("Akbar's Tomb, Sikandra", 27.2203, 77.9506, "monument", { why: "Grand tomb of Emperor Akbar with deer in the gardens.", hours: "Mo-Su 06:00-18:00", ticket: { indian: "₹30" }, visitMin: 60, priority: 3, rating: 8.3 }),
      P("Kinari Bazaar", 27.1849, 78.0158, "market", { why: "Old-city market for marble inlay, petha and silver.", hours: "Mo-Su 11:00-21:00", visitMin: 60, bestTimeOfDay: "evening", priority: 3, rating: 7.8 }),
      P("Jama Masjid, Agra", 27.1830, 78.0156, "mosque", { why: "Shah Jahan's red-sandstone mosque by the old market.", hours: "Mo-Su 07:00-19:00", visitMin: 30, priority: 3, rating: 8.0 }),
    ],
    foodStops: [
      { dish: "Petha", shop: "Panchhi Petha", area: "Sadar Bazaar", lat: 27.1612, lng: 78.0143, price: "₹200/kg", tip: "Try the angoori petha.", veg: true, when: "any", mins: 15 },
      { dish: "Bedai and jalebi", shop: "Deviram Sweets", area: "Pratap Pura", lat: 27.1650, lng: 78.0110, price: "₹60", tip: "Breakfast only, before 11 am.", veg: true, when: "breakfast", mins: 20 },
    ],
    souvenirs: [{ item: "Marble inlay coaster set", where: "Shilpgram", price: "₹800–2,500", tip: "Shine a torch: real marble glows." }, { item: "Petha", where: "Panchhi Petha, Sadar", price: "₹200/kg", tip: "Buy sealed boxes for travel." }],
    restaurants: [{ name: "Pinch of Spice", area: "Fatehabad Road", veg: "veg-options", price: "₹₹", famousFor: "North Indian" }],
  },
  coimbatore: { label: "Coimbatore, Tamil Nadu, India", lat: 11.0168, lng: 76.9558, summary: "Gateway to the Western Ghats, with the Isha Yoga Centre and Adiyogi at the edge of the hills.", stayArea: { name: "RS Puram", why: "Central, good food." },
    places: [P("Isha Yoga Centre & Adiyogi", 10.9724, 76.7387, "experience", { why: "The 112-ft Adiyogi statue at the foot of the Velliangiri hills.", hours: "Mo-Su 06:00-20:00", visitMin: 150, bestTimeOfDay: "evening", priority: 5, rating: 9.2, tips: "Stay for the Adiyogi light show at 7 pm." }), P("Marudamalai Temple", 11.0466, 76.8510, "temple", { hours: "Mo-Su 06:00-20:30", visitMin: 75, priority: 4, rating: 8.6 }), P("Gass Forest Museum", 11.0142, 76.9364, "museum", { hours: "Mo-Sa 09:00-17:00; Su off", ticket: { indian: "₹10" }, priority: 3, rating: 7.6 })],
    foodStops: [{ dish: "Filter coffee & ghee roast", shop: "Annapoorna", area: "RS Puram", lat: 11.0090, lng: 76.9500, price: "₹120", tip: "Order the ghee roast crisp.", veg: true, when: "breakfast", mins: 30 }], souvenirs: [], restaurants: [] },
  palani: { label: "Palani, Tamil Nadu, India", lat: 10.4500, lng: 77.5200, summary: "Hill temple of Lord Murugan; the dawn aarti is magical before the crowds.", stayArea: { name: "Near Adivaram (foothills)", why: "Walk to the steps or the rope car." },
    places: [P("Palani Murugan Temple", 10.4386, 77.5203, "temple", { why: "Arulmigu Dhandayuthapani Swamy temple on the hill.", hours: "Mo-Su 06:00-20:00", ticket: { indian: "Free", note: "Rope car ₹50; special darshan at the counter only" }, visitMin: 150, bestTimeOfDay: "sunrise", priority: 5, rating: 9.3, tips: "Start up at 5 am: you'll be ahead of the crowds and back by 8." }), P("Idumban Temple", 10.4405, 77.5290, "temple", { visitMin: 60, priority: 3, rating: 8.0 })],
    foodStops: [{ dish: "Panchamirtham", shop: "Temple prasadam counter", area: "Palani hill", lat: 10.4390, lng: 77.5205, price: "₹40", tip: "Buy the sealed tin for travel.", veg: true, when: "any", mins: 10 }], souvenirs: [], restaurants: [] },
  kodaikanal: { label: "Kodaikanal, Tamil Nadu, India", lat: 10.2381, lng: 77.4892, summary: "The 'princess of hill stations': a star-shaped lake, pine forests and cliff walks.", stayArea: { name: "Near Kodai Lake", why: "Walk to the lake and Coaker's Walk." },
    places: [P("Kodai Lake", 10.2337, 77.4892, "lake", { hours: "Mo-Su 06:00-18:00", ticket: { indian: "Boating ₹200+" }, visitMin: 90, bestTimeOfDay: "morning", priority: 5, rating: 8.9 }), P("Coaker's Walk", 10.2297, 77.4949, "viewpoint", { hours: "Mo-Su 07:00-19:00", ticket: { indian: "₹20" }, visitMin: 45, bestTimeOfDay: "morning", priority: 4, rating: 8.7 }), P("Pillar Rocks", 10.2120, 77.4740, "viewpoint", { hours: "Mo-Su 09:00-17:00", ticket: { indian: "₹10" }, visitMin: 40, priority: 4, rating: 8.5 }), P("Bryant Park", 10.2327, 77.4960, "park", { hours: "Mo-Su 09:00-18:00", ticket: { indian: "₹30" }, visitMin: 45, priority: 3, rating: 8.1 })],
    foodStops: [{ dish: "Homemade chocolate", shop: "Chocolate shops by the lake", area: "Lake Road", lat: 10.2350, lng: 77.4900, price: "₹100–300", tip: "Try the fruit-and-nut slab.", veg: true, when: "any", mins: 15 }], souvenirs: [{ item: "Eucalyptus oil", where: "Lake Road", price: "₹100–250", tip: "Buy from shops, not roadside bottles." }], restaurants: [] },
  madurai: { label: "Madurai, Tamil Nadu, India", lat: 9.9252, lng: 78.1198, summary: "The temple city of Meenakshi; stay for the night-time Palliyarai (Shayana) ceremony.", stayArea: { name: "Around the Meenakshi Temple", why: "Walk in for the night ceremony." },
    places: [P("Meenakshi Amman Temple", 9.9195, 78.1193, "temple", { why: "Towering painted gopurams and the bedtime Shayana Aarti.", highlights: ["Hall of a thousand pillars", "Golden lotus tank", "Shayana Aarti at night"], hours: "Mo-Su 05:00-12:30,16:00-22:00", ticket: { indian: "Free", note: "Special darshan ₹100 at the counter only" }, visitMin: 120, bestTimeOfDay: "evening", priority: 5, rating: 9.5, tips: "Stay for the Shayana (Palliyarai) Aarti around 9:30 pm. Pay only at the counter." }), P("Thirumalai Nayakkar Mahal", 9.9150, 78.1239, "palace", { hours: "Mo-Su 09:00-17:00", ticket: { indian: "₹10" }, visitMin: 60, priority: 4, rating: 8.4 }), P("Gandhi Memorial Museum", 9.9300, 78.1380, "museum", { hours: "Sa-Th 10:00-17:45; Fr off", visitMin: 60, priority: 3, rating: 8.2 })],
    foodStops: [{ dish: "Jigarthanda", shop: "Famous Jigarthanda", area: "Vilakkuthoon", lat: 9.9170, lng: 78.1210, price: "₹60", tip: "The 'special' has an extra scoop of ice cream.", veg: true, when: "evening", mins: 15 }], souvenirs: [{ item: "Sungudi cotton saree", where: "Near the temple", price: "₹800–2,000", tip: "Look for the tie-dye dots." }], restaurants: [] },
};
const PLACES_EXTRA = { delhi: [28.6139, 77.209], jaipur: [26.9124, 75.7873], bengaluru: [12.9716, 77.5946], bangalore: [12.9716, 77.5946], mumbai: [19.076, 72.8777], goa: [15.4909, 73.8278], rishikesh: [30.0869, 78.2676], nainital: [29.3803, 79.4636], shimla: [31.1048, 77.1734], manali: [32.2432, 77.1892], udaipur: [24.5854, 73.7125], lucknow: [26.8467, 80.9462], kolkata: [22.5726, 88.3639], chennai: [13.0827, 80.2707], hyderabad: [17.385, 78.4867], mathura: [27.4924, 77.6737], vrindavan: [27.565, 77.7006], kochi: [9.9312, 76.2673], munnar: [10.0889, 77.0595], rameswaram: [9.2876, 79.3129], bangkok: [13.7563, 100.5018], pattaya: [12.9236, 100.8825], phuket: [7.8804, 98.3923], krabi: [8.0863, 98.9063], amsterdam: [52.3676, 4.9041], paris: [48.8566, 2.3522], london: [51.5072, -0.1276], dubai: [25.2048, 55.2708], singapore: [1.3521, 103.8198] };

const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const title = s => String(s).replace(/\b\w/g, c => c.toUpperCase());
function cityKey(q) { const n = norm(q); return Object.keys(CITIES).find(k => n.includes(k)) || Object.keys(PLACES_EXTRA).find(k => n.includes(k)) || null; }
function cityPt(k) { return CITIES[k] ? { lat: CITIES[k].lat, lng: CITIES[k].lng, name: CITIES[k].label } : PLACES_EXTRA[k] ? { lat: PLACES_EXTRA[k][0], lng: PLACES_EXTRA[k][1], name: title(k) } : null; }
const hash = s => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

// Generic but believable places for a city we have no sample list for.
// Sample places made up for demo cities, so the map lookup finds each one at its own spot.
const GEN = new Map();
const reg = p => (GEN.set(norm(p.name), p), p);
const GENERIC_TITLES = ["Old Town heritage walk", "City Museum", "Central Market", "Sunset Point", "Botanical Garden", "Heritage Temple", "Food Street"];
function genericCity(name, pt) {
  const n = title(name.split(",")[0]);
  const at = (dx, dy) => [+(pt.lat + dy).toFixed(4), +(pt.lng + dx).toFixed(4)];
  const list = [["Old Town heritage walk", "experience", 0.004, 0.003, 9.0, "morning"], ["City Museum", "museum", -0.01, 0.006, 8.4, "any"], ["Central Market", "market", 0.006, -0.004, 8.1, "evening"], ["Sunset Point", "viewpoint", 0.02, 0.015, 8.8, "sunset"], ["Botanical Garden", "park", -0.015, -0.01, 8.2, "morning"], ["Heritage Temple", "temple", 0.012, -0.012, 8.6, "morning"], ["Food Street", "food", -0.004, 0.009, 8.5, "evening"]];
  return { label: name, lat: pt.lat, lng: pt.lng, summary: `${n} sample itinerary (demo data): heritage in the morning, markets and food in the evening.`, stayArea: { name: `${n} centre`, why: "Central for every stop." },
    places: list.map(([t, c, dx, dy, r, b], i) => { const [lat, lng] = at(dx, dy); return reg(P(`${n} ${t}`, lat, lng, c, { why: `A highlight of ${n}.`, rating: r, priority: 5 - Math.floor(i / 2), bestTimeOfDay: b, visitMin: c === "museum" ? 75 : 60, ticket: { indian: c === "museum" ? "₹50" : "Free" } })); }),
    foodStops: [{ dish: `${n} street-food platter`, shop: `${n} Food Street`, area: "Centre", lat: pt.lat - 0.004, lng: pt.lng + 0.009, price: "₹150", tip: "Go hungry, share plates.", veg: true, when: "evening", mins: 30 }],
    souvenirs: [{ item: `Local handicraft from ${n}`, where: `${n} Central Market`, price: "₹300–1,500", tip: "Bargain politely, start at half." }], restaurants: [] };
}
function cityData(label) {
  const k = cityKey(label);
  if (k && CITIES[k]) return CITIES[k];
  const pt = cityPt(k) || { lat: 28.6139 + (hash(label) % 100) / 1000, lng: 77.209 + (hash(label) % 77) / 1000 };
  return genericCity(label, pt);
}
const allPlaces = () => Object.values(CITIES).flatMap(c => [...c.places, ...c.foodStops.map(f => ({ name: f.shop, lat: f.lat, lng: f.lng, sub: f.area + ", " + c.label }))]);

// ---------- maps, roads, weather ----------
const hav = (a, b) => { const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(h)); };
function geocode(q, bias) {
  const n = norm(q);
  let gen = GEN.get(n) || GEN.get(norm(String(q).split(",")[0]));
  if (!gen) { // a sample place from a cached plan (e.g. after a restart): rebuild its city's sample places
    const base = String(q).split(",")[0].trim();
    const t = [...FILLERS.map(f => f[0]), ...GENERIC_TITLES].find(t => norm(base).endsWith(norm(t)) && norm(base) !== norm(t));
    if (t) { const city = base.slice(0, base.length - t.length).trim(); fillPlaces(cityData(city), city, 99); gen = GEN.get(norm(base)); }
  }
  if (gen) return { lat: gen.lat, lng: gen.lng, name: gen.name, country: "IN" };
  const hit = allPlaces().find(p => n && (norm(p.name).includes(n.split(" ").slice(0, 3).join(" ")) || n.includes(norm(p.name))));
  if (hit) return { lat: hit.lat, lng: hit.lng, name: hit.name + (hit.sub ? ", " + hit.sub : ""), country: "IN" };
  const k = cityKey(q), c = k && cityPt(k);
  if (c) return { lat: c.lat, lng: c.lng, name: c.name, country: /bangkok|pattaya|phuket|krabi/.test(k) ? "TH" : /amsterdam/.test(k) ? "NL" : /paris/.test(k) ? "FR" : /london/.test(k) ? "GB" : /dubai/.test(k) ? "AE" : /singapore/.test(k) ? "SG" : "IN" };
  if (bias && isFinite(bias.lat)) { const h = hash(q); return { lat: +bias.lat + ((h % 40) - 20) / 2000, lng: +bias.lng + ((h % 60) - 30) / 2000, name: q, country: "IN" }; }
  return { lat: 28.6139, lng: 77.209, name: q, country: "IN" };
}
function suggest(q) {
  const n = norm(q); if (n.length < 2) return [];
  const cities = [...Object.keys(CITIES).map(k => ({ title: CITIES[k].label.split(",")[0], sub: CITIES[k].label.split(",").slice(1).join(",").trim(), lat: CITIES[k].lat, lng: CITIES[k].lng })), ...Object.entries(PLACES_EXTRA).map(([k, v]) => ({ title: title(k), sub: "Demo place", lat: v[0], lng: v[1] }))];
  const pl = allPlaces().map(p => ({ title: p.name, sub: p.sub || "Sample place", lat: p.lat, lng: p.lng }));
  const out = [...cities, ...pl].filter(x => norm(x.title).startsWith(n) || norm(x.title).includes(" " + n) || norm(x.title).includes(n)).slice(0, 6).map(x => ({ ...x, country: "in" }));
  return out.length ? out : [{ title: title(q), sub: "Demo place", lat: 28.6139, lng: 77.209, country: "in" }];
}
const table = pts => { const d = pts.map(a => pts.map(b => hav(a, b) * 1.35)); return { d, t: d.map(r => r.map(v => v / (26 / 3.6))), estimated: false }; };
function encode(points) { let out = "", pl = 0, pg = 0; const enc = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ""; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); }; for (const [la, lg] of points) { const a = Math.round(la * 1e5), b = Math.round(lg * 1e5); out += enc(a - pl) + enc(b - pg); pl = a; pg = b; } return out; }
function route(pts) { const m = table(pts); const legs = pts.slice(1).map((b, i) => ({ distance: m.d[i][i + 1], duration: m.t[i][i + 1] })); return { distance: legs.reduce((s, l) => s + l.distance, 0), duration: legs.reduce((s, l) => s + l.duration, 0), geometry: encode(pts.map(p => [+p.lat, +p.lng])), legs }; }
function weather(pt, start, end) {
  if (!start) return null; const out = {}; let d = new Date(start + "T00:00:00Z"); const e = new Date((end || start) + "T00:00:00Z");
  for (let i = 0; d <= e && i < 30; i++, d = new Date(d.getTime() + 864e5)) { const k = d.toISOString().slice(0, 10); out[k] = i % 3 === 1 ? { text: "Partly cloudy", icon: "⛅", max: 30, min: 19, rain: 20, sunrise: "06:12", sunset: "17:38" } : { text: "Clear", icon: "☀️", max: 31, min: 18, rain: 5, sunrise: "06:12", sunset: "17:38" }; }
  return out;
}
const hourlyRain = () => Array.from({ length: 24 }, (_, h) => ({ h, p: h >= 13 && h <= 16 ? 65 : 8 }));
const restaurantsNear = pts => pts.map((p, i) => [["Shree Annapurna Bhojnalaya", "pure-veg", "North Indian, thali"], ["Green Leaf Café", "veg-options", "Café, snacks"], ["Royal Spice Kitchen", "", "Mughlai"]].map(([name, veg, cuisine], j) => ({ name, lat: +p.lat + 0.002 * (j + 1), lng: +p.lng - 0.0015 * (j + 1), cuisine, veg, hours: "Mo-Su 11:00-23:00", distance: 250 * (j + 1) + 40 * i, score: 5 - j })));
const helpNearby = pt => ({ hospitals: [{ name: "City District Hospital (sample)", lat: pt.lat + 0.01, lng: pt.lng + 0.008, phone: "108", distance: 1400, emergency: true }], police: [{ name: "Police Station (sample)", lat: pt.lat - 0.006, lng: pt.lng + 0.004, phone: "112", distance: 800 }], pharmacies: [{ name: "24×7 Pharmacy (sample)", lat: pt.lat + 0.003, lng: pt.lng - 0.003, phone: null, distance: 350 }] });

// ---------- AI answers ----------
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const nextSat = () => { const d = new Date(today() + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7)); return d.toISOString().slice(0, 10); };
// Extra sample stops so every demo day is full (roughly 7 am to 9 pm), not just a few hours.
const FILLERS = [
  ["Riverside promenade", "viewpoint", 0.011, 0.007, 8.3, "morning", 60, "Mo-Su 05:00-21:00", "Free"],
  ["Old ramparts walk", "fort", -0.018, 0.012, 8.6, "morning", 90, "Mo-Su 08:00-18:00", "₹50"],
  ["Art & craft museum", "museum", 0.009, -0.016, 8.2, "any", 75, "Tu-Su 10:00-17:30", "₹40"],
  ["Heritage mansion", "palace", -0.007, -0.019, 8.4, "any", 60, "Mo-Su 09:00-18:00", "₹30"],
  ["Lakeside park", "park", 0.021, -0.006, 8.0, "any", 60, "Mo-Su 06:00-20:00", "Free"],
  ["Crafts village", "experience", -0.024, -0.004, 8.1, "any", 75, "Mo-Su 10:00-19:00", "Free"],
  ["Hilltop shrine", "temple", 0.016, 0.02, 8.5, "morning", 60, "Mo-Su 05:30-20:00", "Free"],
  ["Science centre", "museum", -0.013, 0.022, 7.9, "any", 60, "Tu-Su 10:00-18:00", "₹60"],
  ["Waterfront at sunset", "viewpoint", 0.026, 0.011, 8.7, "sunset", 45, "Mo-Su 06:00-21:00", "Free"],
  ["Old bazaar lanes", "market", -0.005, 0.014, 8.3, "evening", 75, "Mo-Su 10:00-21:30", "Free"],
  ["Evening light & sound show", "experience", 0.004, -0.011, 8.4, "evening", 60, "Mo-Su 18:30-21:30", "₹150"],
  ["Night food market", "market", -0.01, 0.004, 8.6, "evening", 60, "Mo-Su 18:00-23:00", "Free"],
];
function fillPlaces(c, label, want) {
  const n = title(String(label).split(",")[0]);
  const have = new Set(c.places.map(p => norm(p.name)));
  const extra = FILLERS.map(([t, cat, dx, dy, r, best, mins, hours, fee], i) => reg(P(`${n} ${t}`, +(c.lat + dy).toFixed(4), +(c.lng + dx).toFixed(4), cat, { why: `A popular stop in ${n} (sample data).`, rating: r, priority: i < 6 ? 3 : 2, bestTimeOfDay: best, visitMin: mins, hours, ticket: { indian: fee } })))
    .filter(p => !have.has(norm(p.name)));
  return [...c.places, ...extra].slice(0, Math.max(c.places.length, want));
}
function planAnswer(prompt) {
  const label = (prompt.match(/^Destination: (.+)$/m) || [])[1] || "Varanasi";
  const c = cityData(label);
  const want = +((prompt.match(/Suggest about (\d+) places/) || [])[1] || 10);
  return { summary: c.summary, bestTime: { months: "October to March", note: "Pleasant days, cool mornings.", forYourDates: "Good: dry and pleasant." }, idealDays: 2,
    places: fillPlaces(c, label, want).map(p => ({ ...p, hours: p.hours })), foodStops: c.foodStops, souvenirs: c.souvenirs, restaurants: c.restaurants, stayArea: c.stayArea,
    transport: "E-rickshaws for short hops (₹20–50); app cabs for longer rides. Old-city lanes are best on foot.",
    budget: { currency: "INR", perPersonPerDay: { stay: 1800, food: 600, localTransport: 300, tickets: 200 }, note: "Mid-range sample estimate." },
    packing: ["Comfortable walking shoes", "Scarf to cover head in temples", "Light jacket for early mornings", "Power bank", "Cash for small shops", "Sunscreen"],
    safety: ["Fix boat and auto prices before you get in.", "Pay temple fees only at official counters."], etiquette: ["Remove shoes at temples.", "Ask before photographing people."],
    emergency: [{ label: "Police", number: "112" }, { label: "Ambulance", number: "108" }, { label: "Tourist helpline", number: "1363" }] };
}
function threadAnswer(prompt) {
  const days = +((prompt.match(/^Days available: (\d+)/m) || [])[1] || 6);
  const home = ((prompt.match(/^Home \/ start: (.+)$/m) || [])[1] || "Agra").split(",")[0];
  const around = /AROUND-ONE-PLACE MODE/.test(prompt);
  const text = norm(prompt.replace(/\(e\.g\.[^)]*\)/g, "")); // ignore the instructions' own examples (they mention Thailand)
  const legOf = (from, mode, hours, depart, tip) => ({ from, mode, hours, depart, tip });
  const stopOf = (k, nights, leg, arriveBy, plan, extra = {}) => { const c = CITIES[k] || genericCity(title(k), cityPt(k)); return { name: title(k), search: c.label, lat: c.lat, lng: c.lng, nights, leg, arriveBy, why: c.summary, plan, timings: extra.timings || [], fees: extra.fees || [], warnings: extra.warnings || [], stay: c.stayArea ? `${c.stayArea.name}: ${c.stayArea.why}` : "", food: c.foodStops[0] ? `${c.foodStops[0].dish} at ${c.foodStops[0].shop}, ${c.foodStops[0].price}` : "" }; };
  let stops, gateway = null, title_ = "", ret;
  if (/thailand|bangkok|pattaya|phuket/.test(text)) {
    gateway = { name: "Bangkok", search: "Bangkok, Thailand", how: `Fly ${home} → Bangkok via Delhi, ~6–8 h, ₹18,000–28,000 return. Visa on arrival / e-visa for Indians: check before you fly.` };
    stops = [stopOf("bangkok", 2, legOf("Bangkok airport", "car", 0.8, "", "Take the Airport Rail Link to Phaya Thai."), "14:00", [{ time: "09:00", what: "Grand Palace & Wat Pho", tip: "Shoulders and knees covered." }, { time: "18:00", what: "Chinatown street food", tip: "" }]),
      stopOf("pattaya", 1, legOf("Bangkok", "bus", 2.5, "08:00", "Ekkamai bus terminal, ~฿130 (₹320)."), "11:00", [{ time: "10:00", what: "Sanctuary of Truth", tip: "" }]),
      stopOf("phuket", 2, legOf("Pattaya", "flight", 1.5, "09:30", "Fly from U-Tapao (UTP)."), "13:00", [{ time: "08:00", what: "Phi Phi islands day trip", tip: "Book the early boat." }]),
      stopOf("krabi", Math.max(1, days - 6), legOf("Phuket", "ferry", 2, "08:30", "Ferry via Koh Yao, ~฿600."), "11:00", [{ time: "09:00", what: "Railay beach & Four Islands", tip: "" }])];
    title_ = "Thailand loop: city, beaches and islands"; ret = { from: "Krabi", to: home, mode: "flight", hours: 7, fare: "", depart: "", tip: "Fly back via Bangkok." };
  } else {
    stops = [stopOf("coimbatore", 1, legOf(around ? "Coimbatore" : "Bengaluru", "car", around ? 0 : 3.5, "05:00", "Leave early to beat Hosur traffic."), "09:00", [{ time: "16:00", what: "Isha Yoga Centre & Adiyogi", tip: "Stay for the 7 pm light show." }], { fees: [{ what: "Isha entry", price: "Free" }] }),
      stopOf("palani", 1, legOf("Coimbatore", "car", 2.5, "17:30", "Reach Palani by night and sleep near the hill."), "21:00", [{ time: "05:00", what: "Climb to the Murugan temple for the first aarti", tip: "Start at 5: nobody else does, you'll be back by 8." }], { timings: [{ what: "Vizha Pooja (first aarti)", time: "around 06:30, confirm locally" }], fees: [{ what: "Rope car", price: "₹50" }, { what: "Special darshan", price: "₹100 at the counter" }], warnings: ["Ignore touts offering paid 'fast darshan' at the foothills."] }),
      stopOf("kodaikanal", Math.max(1, days - 4), legOf("Palani", "car", 2.5, "09:30", "Ghat road with hairpin bends: no heavy breakfast."), "12:30", [{ time: "07:00", what: "Kodai Lake walk and boating", tip: "Boating counters open at 9." }, { time: "16:00", what: "Coaker's Walk at sunset", tip: "" }]),
      stopOf("madurai", 1, legOf("Kodaikanal", "car", 3.5, "08:00", "Descend via Batlagundu."), "13:00", [{ time: "17:00", what: "Meenakshi Temple", tip: "Pay only at the counter." }, { time: "21:30", what: "Shayana (Palliyarai) Aarti", tip: "The bedtime ceremony is very beautiful." }], { timings: [{ what: "Shayana Aarti", time: "around 21:30, confirm locally" }], fees: [{ what: "Special darshan", price: "₹100" }], warnings: ["Phones must be deposited; carry no bags."] })];
    if (!around) gateway = { name: "Bengaluru", search: "Bengaluru, Karnataka", how: `Fly ${home} → Bengaluru, ~2 h 30 min, ₹4,500–7,000. Early-morning flights are cheapest.` };
    title_ = around ? "Around Coimbatore: hills, temples and Madurai" : "Temples & hills of Tamil Nadu";
    ret = around ? { from: "Madurai", to: "Coimbatore", mode: "car", hours: 4.5, fare: "", depart: "09:00", tip: "Or take the morning train." } : { from: "Madurai", to: home, mode: "flight", hours: 4, fare: "₹6,000–9,000", depart: "", tip: "Via Bengaluru or Delhi." };
  }
  return { title: title_, summary: "A sample loop (demo data) that moves through several places instead of staying in one.", totalDays: days, flexNote: "", gateway, stops, returnLeg: ret, cost: { total: 42000, perPerson: 21000, note: "Sample estimate." }, season: "good – pleasant this month", rating: 9.1 };
}
function exploreAnswer(prompt) {
  const days = +((prompt.match(/^Days available: (\d+)/m) || [])[1] || 4);
  const o = (t, dests, why, hi, cost, r) => ({ title: t, destinations: dests.map(([n, nights]) => ({ name: title(n), search: (CITIES[n] || {}).label || title(n), nights })), why, highlights: hi, season: "good – pleasant days, cool mornings", getThere: "By road or train from home.", cost: { total: cost, perPerson: Math.round(cost / 2), note: "Sample estimate." }, pace: "moderate", rating: r });
  return { options: [o("Kashi: ghats and aartis", [["varanasi", Math.min(days, 3)]], "Dawn boats, temples and the evening Ganga Aarti.", ["Ganga Aarti", "Sunrise boat", "Kashi Vishwanath"], 18000, 9.4), o("Taj and the Mughals", [["agra", 2]], "Three UNESCO sites in one city.", ["Taj Mahal at sunrise", "Agra Fort", "Mehtab Bagh sunset"], 12000, 9.2), o("Krishna trail", [["mathura", 1], ["vrindavan", 1]], "Temples, ghats and pedas.", ["Banke Bihari", "Prem Mandir lights"], 8000, 8.6), o("Pink City", [["jaipur", 3]], "Forts, palaces and food.", ["Amber Fort", "Hawa Mahal"], 22000, 9.0), o("Hills of Kumaon", [["nainital", 3]], "Lakes, cool air and views.", ["Naini Lake", "Snow View Point"], 20000, 8.7), o("Temple towns of Tamil Nadu", [["coimbatore", 1], ["palani", 1], ["kodaikanal", 2], ["madurai", 1]], "A loop through hills and temples.", ["Adiyogi", "Palani dawn aarti", "Meenakshi Temple"], 40000, 9.1)] };
}
function decideAnswer(prompt) {
  const cands = [...prompt.matchAll(/^\d+\. (.+?) – .*?rating ([\d.?]+)\/10/gm)].map(m => ({ name: m[1], r: +m[2] || 7 }));
  const need = +((prompt.match(/Choose the best (\d+)/) || [])[1] || 1);
  const pick = cands.slice().sort((a, b) => b.r - a.r).slice(0, need);
  return { pick: pick.map(p => p.name), why: `${pick.map(p => p.name).join(" and ")} ${need > 1 ? "are" : "is"} the more unique experience and better rated (${pick[0] ? pick[0].r : ""}/10), and it fits your pace.`, skipWhy: Object.fromEntries(cands.filter(c => !pick.includes(c)).map(c => [c.name, "Similar experiences elsewhere on your trip."])) };
}
function pulseAnswer(prompt) {
  const names = [...prompt.matchAll(/^\d+\. (.+)$/gm)].map(m => m[1]).filter(n => !/^\[/.test(n));
  return { places: names.map(n => /vishwanath|taj/i.test(n) ? { name: n, score: 6.8, verdict: "caution", crowd: "high", summary: "Sample data: busier than usual this week; go early morning.", alerts: ["Long queues 10 am–2 pm"], recent: true } : { name: n, score: 8.6, verdict: "go", crowd: "moderate", summary: "Sample data: open as usual, normal crowds.", alerts: [], recent: true }) };
}
function aiAnswer(prompt, system) {
  const all = system + "\n" + prompt;
  if (/designs multi-city circuits|AROUND-ONE-PLACE MODE/.test(all)) return threadAnswer(prompt);
  if (/Suggest about \d+ places to visit/.test(prompt)) return planAnswer(prompt);
  if (/Suggest 6 different trip options/.test(prompt)) return exploreAnswer(prompt);
  if (/best time to visit/i.test(prompt)) return { answer: "October to March is best: pleasant days and cool mornings. Avoid May–June heat.", months: "October to March", suggestStart: nextSat() };
  if (/How many days are ideal/i.test(prompt)) { const k = cityKey(prompt); return { answer: "Enough for the highlights without rushing.", days: k === "varanasi" ? 3 : 2, minDays: 1, maxDays: 4 }; }
  if (/Choose the best/.test(prompt)) return decideAnswer(prompt);
  if (/"go now" score/.test(prompt)) return pulseAnswer(prompt);
  if (/Give visitor details/.test(prompt)) return { name: "", category: "other", why: "Local favourite", highlights: [], hours: "Mo-Su 09:00-19:00", ticket: { indian: "Free" }, visitMin: 45, priority: 3, rating: 8.0, tips: "" };
  if (/Extract visitor information/.test(system)) return { ticket: "As shown at the counter", hours: "As listed", notice: "" };
  return {};
}
const CHAT = [
  [/aarti|ganga/i, "The Ganga Aarti at Dashashwamedh Ghat starts around 6:45 pm (sample data). Reach by 6 pm for a front spot on the steps, or book a boat for ₹500–800 to watch from the river. After it ends, walk 5 minutes to Blue Lassi Shop: lassi, ₹80 (per glass), and ask for extra malai."],
  [/eat|food|lassi|lunch|dinner/i, "In Varanasi, don't miss: kachori-sabzi at Ram Bhandar for breakfast (₹40), lassi at Blue Lassi Shop (₹80 per glass, ask for extra malai), and tamatar chaat at Kashi Chat Bhandar in the evening (₹60). All are pure veg (sample data)."],
  [/safe|scam|priest|tout/i, "Two rules keep you safe: pay temple fees only at the official counter (special darshan is ₹100–300, never ₹2,000), and fix boat or auto prices before you get in. Keep the SOS button handy: one tap calls 112 and shares your location."],
  [/decide|choose|which/i, "I'd pick the Taj Mahal at sunrise: it's one of a kind, and Agra Fort is similar to forts you'll see elsewhere. Enter by the East Gate at 6 am for the shortest queue."],
];
async function* chatStream(messages) {
  const q = (messages && messages.length ? messages[messages.length - 1].text : "") || "";
  const a = (CHAT.find(([re]) => re.test(q)) || [null, "Here's my suggestion (demo mode, sample data): start early, keep the big sight for the morning, take a long lunch, and save the evening for the riverside or the market. Tell me the place and I'll make it specific."])[1];
  for (const w of a.split(/(\s+)/)) { yield { text: w }; await wait(12); }
  yield { sources: [] };
}

// ---------- TinyFish answers ----------
const runs = new Map();
function agentResult(goal) {
  const name = (goal.match(/"([^"]+)"/) || [])[1] || "this place";
  const p = allPlaces().find(x => norm(x.name) === norm(name)) || {};
  const busy = /vishwanath|taj|aarti/i.test(name);
  const ago = ["3 hours ago", "1 day ago", "2 days ago", "3 days ago", "4 days ago", "1 week ago"];
  const lines = ["Sample review: beautiful and well managed.", "Sample review: go early, it gets crowded by noon.", "Sample review: helpful staff, clean.", "Sample review: worth every minute.", "Sample review: queue moved fast in the morning.", "Sample review: a little crowded but special."];
  return { found: true, name, status: "Open", hours_today: (p.hours || "6 am–7 pm").replace(/^Mo-Su |^Sa-Th |^Mo-Sa /, "").split(";")[0].replace(/(\d\d):(\d\d)/g, (m, h, mm) => `${+h % 12 || 12}${mm !== "00" ? ":" + mm : ""} ${+h < 12 ? "am" : "pm"}`).replace("-", "–"), busy_now: busy ? "Busier than usual" : "Usually not too busy", entry_fee: p.ticket ? p.ticket.indian : "", rating: p.rating ? +(p.rating / 2).toFixed(1) : 4.5, review_count: 1000 + (hash(name) % 40000), newest_reviews: ago.map((w, i) => ({ when: w, stars: i === 1 ? 4 : 5, summary: lines[i] })) };
}

// ---------- switch every outside service to demo answers while a demo request is running ----------
function install({ places, ai, tf, db }) {
  const wrap = (mod, name, fn) => { const real = mod[name]; mod[name] = function (...a) { return isDemo() ? fn(...a) : real.apply(this, a); }; };
  wrap(places, "geocode", async (q, b) => geocode(q, b));
  wrap(places, "suggest", async q => suggest(q));
  wrap(places, "reverse", async (lat, lng) => { const near = allPlaces().sort((a, b) => hav(a, { lat, lng }) - hav(b, { lat, lng }))[0]; return { name: near ? near.name : "Demo location", city: "Varanasi", country: "in" }; });
  wrap(places, "table", async pts => table(pts));
  wrap(places, "tableOrEstimate", async pts => table(pts));
  wrap(places, "route", async pts => route(pts));
  wrap(places, "osmDetails", async () => ({}));
  wrap(places, "osmAttractions", async () => []);
  wrap(places, "restaurantsNear", async pts => restaurantsNear(pts));
  wrap(places, "weather", async (pt, s, e) => weather(pt, s, e));
  wrap(places, "hourlyRain", async () => hourlyRain());
  wrap(places, "helpNearby", async pt => helpNearby(pt));
  wrap(ai, "enabled", () => true);
  wrap(ai, "canSearch", () => true);
  wrap(ai, "ask", async o => ({ text: JSON.stringify(aiAnswer(o.prompt || (o.messages || []).map(m => m.text).join("\n"), o.system || "")), sources: [], searched: false }));
  wrap(ai, "askJSON", async o => { await wait(150); return { data: aiAnswer(o.prompt || (o.messages || []).map(m => m.text).join("\n"), o.system || ""), sources: [], searched: false }; });
  wrap(ai, "stream", o => chatStream(o.messages));
  wrap(tf, "enabled", () => true);
  wrap(tf, "search", async () => []);
  wrap(tf, "recentBuzz", async () => []);
  wrap(tf, "fetchPages", async () => []);
  wrap(tf, "agentStart", async (url, goal) => { const id = "demo-" + Math.random().toString(36).slice(2); runs.set(id, agentResult(goal)); return id; });
  wrap(tf, "agentWait", async (id, o = {}) => { if (o.onTick) o.onTick({ status: "RUNNING" }); await wait(1500); return { status: "COMPLETED", result: runs.get(id) || {} }; });
  // Keep demo answers in their own corner of the cache, so real users never see them.
  for (const m of ["get", "set"]) { const real = db.cache[m].bind(db.cache); db.cache[m] = (k, ...a) => real(isDemo() ? "demo:" + k : k, ...a); }
}

module.exports = { als, isDemo, install };

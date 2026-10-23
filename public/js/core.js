// Shared helpers for every page.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const state = { user: null, config: {}, page: null };

// ---------- server ----------
export async function api(path, body, { method, signal } = {}) {
  let r;
  try {
    r = await fetch(path, { method: method || (body ? "POST" : "GET"), headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, signal, credentials: "same-origin" });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new Error(location.protocol === "file:" ? "Raahi needs its server. In the Raahi folder run:  node server.js  then open http://localhost:3000" : navigator.onLine === false ? "You're offline. Showing what was saved on this device." : "Raahi couldn't be reached just now. Check your internet and try again in a moment.");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || "Something went wrong. Try again."); e.status = r.status; e.code = j.code; throw e; }
  return j;
}

// ---------- small UI bits ----------
export function toast(msg, bad) {
  const t = document.createElement("div");
  t.className = "toast" + (bad ? " bad" : "");
  t.textContent = msg;
  const box = $("#toasts");
  while (box.children.length >= 2) box.firstChild.remove();
  box.appendChild(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3500);
}
export function busy(btn, on, text) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${esc(text || "Working…")}`; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}
export function tiles(el, { multi = false, value, onChange } = {}) {
  const set = new Set([].concat(value ?? []).filter(v => v != null));
  const sync = () => $$("[data-v]", el).forEach(b => b.setAttribute("aria-pressed", set.has(b.dataset.v)));
  el.addEventListener("click", e => {
    const b = e.target.closest("[data-v]"); if (!b) return;
    const v = b.dataset.v;
    // "Let Raahi decide" can't be combined with other picks.
    if (multi && v === "decide") { const on = set.has(v); set.clear(); if (!on) set.add(v); }
    else if (multi) { set.delete("decide"); set.has(v) ? set.delete(v) : set.add(v); }
    else { set.clear(); set.add(v); }
    sync(); onChange && onChange(multi ? [...set] : v);
  });
  sync();
  return { get: () => (multi ? [...set] : [...set][0]), set: v => { set.clear(); [].concat(v ?? []).forEach(x => set.add(x)); sync(); } };
}

// ---------- formatting ----------
export const hhmm = m => { if (m == null) return ""; m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
export const ampm = m => { if (m == null) return ""; m = ((Math.round(m) % 1440) + 1440) % 1440; const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, "0"); return `${h % 12 || 12}:${mm} ${h < 12 ? "am" : "pm"}`; };
export const dur = m => { m = Math.round(m || 0); if (m < 60) return `${m} min`; const h = Math.floor(m / 60), r = m % 60; return r ? `${h} h ${r} min` : `${h} h`; };
export const km = v => (v == null ? "" : v < 10 ? `${(+v).toFixed(1)} km` : `${Math.round(v)} km`);
export const inr = n => "₹" + Math.round(n || 0).toLocaleString("en-IN");
export const dayName = d => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : "");
export const longDate = d => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "");
export const todayISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
export const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
export const scoreClass = s => (s == null ? "" : s >= 7.5 ? "good" : s >= 5 ? "warn" : "bad");
export const initials = u => (u && u.name ? u.name.split(/\s+/).map(x => x[0]).slice(0, 2).join("").toUpperCase() : "🙂");

// Very small, safe markdown for chat answers: **bold**, lists, links, paragraphs.
export function md(text) {
  const lines = esc(text).split("\n");
  let html = "", list = false;
  for (let l of lines) {
    l = l.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|\s)\*(?!\s)(.+?)\*(?=\s|$|[.,!?])/g, "$1<i>$2</i>").replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const li = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (li) { if (!list) { html += "<ul>"; list = true; } html += `<li>${li[1]}</li>`; continue; }
    if (list) { html += "</ul>"; list = false; }
    if (/^#{1,4}\s/.test(l)) l = `<b>${l.replace(/^#+\s/, "")}</b>`;
    if (l.trim()) html += `<p>${l}</p>`;
  }
  return html + (list ? "</ul>" : "");
}

// ---------- "Let Raahi decide" ----------
export const decideTile = (sub = "Raahi picks what suits you best") => `<button type="button" class="tile decide" data-v="decide"><span class="em">✨</span><b>Let Raahi decide</b><span>${sub}</span></button>`;
export const decideChip = (t = "✨ Let Raahi decide") => `<button type="button" class="chip decide" data-v="decide">${t}</button>`;

// ---------- choices used across pages ----------
export const INTERESTS = [
  ["history", "🏛️ History & monuments"], ["forts", "🏰 Forts & palaces"], ["temples", "🛕 Temples"], ["mosques", "🕌 Mosques & dargahs"],
  ["gurudwaras", "🙏 Gurudwaras"], ["churches", "⛪ Churches"], ["museums", "🖼️ Museums & art"], ["nature", "🌳 Nature & parks"],
  ["lakes", "💧 Lakes & waterfalls"], ["viewpoints", "🌄 Viewpoints & sunsets"], ["wildlife", "🐯 Wildlife"], ["adventure", "🧗 Adventure"],
  ["beaches", "🏖️ Beaches"], ["markets", "🛍️ Markets & shopping"], ["food", "🍛 Street food & local food"], ["nightlife", "🌃 Nightlife & cafés"],
  ["photography", "📷 Photo spots"], ["kids", "🧒 Kid-friendly"], ["offbeat", "🧭 Offbeat & hidden gems"], ["spiritual", "🕉️ Spiritual & yoga"],
];
export const AVOID = [["long walks", "Long walks"], ["stairs and climbs", "Stairs & climbs"], ["big crowds", "Big crowds"], ["very early starts", "Very early starts"], ["expensive places", "Expensive places"]];
export const PACES = [
  ["fast", "⚡", "Fast tracker", "See as many places as possible. Early starts, short stops."],
  ["balanced", "🚶", "Balanced", "A good mix of sights and breaks. 4–5 places a day."],
  ["slow", "🌿", "Slow traveller", "On holiday to relax. 1–3 places a day, long lunches."],
  ["auto", "✨", "Let Raahi decide", "Starts balanced, then learns from how long you really spend at places."],
];
export const DIETS = [["veg", "🥦 Vegetarian"], ["nonveg", "🍗 Non-vegetarian"], ["egg", "🥚 Eggetarian"], ["jain", "🌱 Jain"], ["vegan", "🌿 Vegan"], ["any", "🍽️ Anything works"]];
export const DIET_TEXT = { veg: "vegetarian", nonveg: "non-vegetarian", egg: "eggetarian (veg + eggs)", jain: "Jain (no onion, garlic or root vegetables)", vegan: "vegan", any: "anything" };
export const CAT_ICON = { monument: "🏛️", temple: "🛕", mosque: "🕌", gurudwara: "🙏", church: "⛪", museum: "🖼️", fort: "🏰", palace: "👑", nature: "🌳", lake: "💧", waterfall: "🌊", viewpoint: "🌄", market: "🛍️", beach: "🏖️", park: "🌳", zoo: "🐯", adventure: "🧗", food: "🍛", experience: "✨", other: "📍" };

// ---------- place search box with suggestions ----------
// Returns { el, get(), set(place), input }. place = {label, lat, lng}
export function placeSearch({ placeholder = "Search a place or paste a Google Maps link", value = null, bias, onPick, allowHere = false, id } = {}) {
  const el = document.createElement("div");
  el.className = "ps";
  el.innerHTML = `<div class="row" style="gap:6px;flex-wrap:nowrap"><input type="text" ${id ? `id="${id}"` : ""} placeholder="${esc(placeholder)}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false">${allowHere ? `<button type="button" class="btn ghost small here" title="Use my current location" aria-label="Use my current location" style="min-height:44px">📍</button>` : ""}</div><div class="found"></div>`;
  const inp = $("input", el), found = $(".found", el);
  let picked = value || null, timer, ctrl, list = null, items = [], sel = -1;
  if (value) { inp.value = value.label || ""; found.textContent = value.lat != null ? "✓ Found on the map" : ""; }
  const show = (txt, bad) => { found.textContent = txt || ""; found.className = "found" + (bad ? " bad" : ""); };
  const close = () => { list && list.remove(); list = null; items = []; sel = -1; inp.setAttribute("aria-expanded", "false"); };
  const choose = it => {
    const area = (it.sub || "").split(",").map(x => x.trim()).find(x => x && x.toLowerCase() !== String(it.title).toLowerCase());
    picked = { label: it.title + (area ? ", " + area : ""), lat: it.lat, lng: it.lng, country: it.country || "" };
    inp.value = picked.label; show("✓ " + [it.title, it.sub].filter(Boolean).join(", "));
    close(); onPick && onPick(picked);
  };
  const render = () => {
    if (list) list.remove();
    list = null;
    if (!items.length) { inp.setAttribute("aria-expanded", "false"); return; }
    list = document.createElement("ul");
    list.className = "sug"; list.setAttribute("role", "listbox");
    list.innerHTML = items.map((it, i) => `<li role="option" aria-selected="${i === sel}">${esc(it.title)}<small class="mute">${esc(it.sub)}</small></li>`).join("");
    $$("li", list).forEach((li, i) => li.addEventListener("mousedown", e => { e.preventDefault(); choose(items[i]); }));
    el.appendChild(list); inp.setAttribute("aria-expanded", "true");
  };
  inp.addEventListener("input", () => {
    picked = inp.value.trim() ? { label: inp.value.trim() } : null; show("");
    clearTimeout(timer); ctrl && ctrl.abort();
    const q = inp.value.trim();
    if (/https?:\/\/\S*(google\.|goo\.gl|g\.co)/i.test(q)) { // a pasted Google Maps link
      close(); show("Reading your Google Maps link…");
      timer = setTimeout(async () => {
        try {
          const it = await api("/api/place-link", { url: q });
          if (inp.value.trim() !== q) return;
          choose(it); show("✓ From your Google Maps link: " + [it.title, it.sub].filter(Boolean).join(", "));
        } catch (e) { if (inp.value.trim() === q) show(e.message, true); }
      }, 100);
      return;
    }
    if (q.length < 2) return close();
    timer = setTimeout(async () => {
      ctrl = new AbortController();
      const b = typeof bias === "function" ? bias() : bias;
      try {
        const got = await api(`/api/suggest?q=${encodeURIComponent(q)}${b && b.lat != null ? `&lat=${(+b.lat).toFixed(3)}&lng=${(+b.lng).toFixed(3)}` : ""}`, null, { signal: ctrl.signal });
        if (inp.value.trim() !== q) return;
        items = got; sel = -1; render();
      } catch (e) { if (e.name !== "AbortError") close(); }
    }, 200);
  });
  inp.addEventListener("keydown", e => {
    if (list && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      $$("li", list).forEach((li, i) => li.setAttribute("aria-selected", i === sel));
    } else if (e.key === "Enter") { if (list && items.length) { e.preventDefault(); choose(items[Math.max(sel, 0)]); } }
    else if (e.key === "Escape") close();
  });
  inp.addEventListener("blur", () => setTimeout(close, 150));
  const hereBtn = $(".here", el);
  if (hereBtn) hereBtn.onclick = async () => {
    busy(hereBtn, true, "");
    try {
      const pos = await locate();
      const r = await api(`/api/reverse?lat=${pos.lat}&lng=${pos.lng}`).catch(() => ({ name: "My location" }));
      picked = { label: r.name || "My location", lat: pos.lat, lng: pos.lng, country: r.country || "" };
      inp.value = picked.label; show("✓ Your current location");
      onPick && onPick(picked);
    } catch (e) { show(e.message, true); }
    busy(hereBtn, false);
  };
  return { el, input: inp, get: () => picked, set: p => { picked = p; inp.value = p ? p.label : ""; show(p && p.lat != null ? "✓ Found on the map" : ""); }, error: m => show(m, true) };
}

export function locate() {
  return new Promise((ok, bad) => {
    if (!navigator.geolocation) return bad(new Error("This browser can't share your location."));
    navigator.geolocation.getCurrentPosition(p => ok({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }), e => bad(new Error(e.code === 1 ? "Location permission was denied. Allow it in your browser settings, or type the place." : "Couldn't get your location. Try again or type the place.")), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}

// ---------- maps ----------
export function makeMap(el, center = [27.18, 78.02], zoom = 6) {
  if (!window.L) { el.innerHTML = `<div class="note" style="margin:12px">The map couldn't load (no internet?). Everything else still works.</div>`; return null; }
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(center, zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  return map;
}
export const pinIcon = (txt, cls = "") => window.L && L.divIcon({ className: "", html: `<div class="pin ${cls}">${esc(txt)}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
export function decode(str) {
  let i = 0, lat = 0, lng = 0; const out = [];
  while (i < str.length) {
    for (const k of [0, 1]) {
      let b, shift = 0, res = 0;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32);
      const v = res & 1 ? ~(res >> 1) : res >> 1;
      if (k) lng += v; else lat += v;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
export function gmapsPlace(name, lat, lng) {
  const u = new URL("https://www.google.com/maps/search/");
  u.searchParams.set("api", "1"); u.searchParams.set("query", lat != null ? `${name}` : name);
  return u.href;
}
export function gmapsGo(lat, lng, label) {
  const u = new URL("https://www.google.com/maps/dir/");
  u.searchParams.set("api", "1"); u.searchParams.set("destination", label || `${lat},${lng}`); u.searchParams.set("travelmode", "driving");
  return u.href;
}

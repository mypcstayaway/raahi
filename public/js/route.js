// Route optimiser (Thread): the shortest order through all your stops.
import { $, $$, api, esc, toast, busy, placeSearch, locate, makeMap, pinIcon, decode, km, dur } from "./core.js";

const L2 = i => String.fromCharCode(65 + i);
const MAX = 25;

export async function render(view) {
  view.innerHTML = `
    <div class="split">
      <div>
        <h1>Route optimiser</h1>
        <p class="mute">Add your stops and get the shortest road route through all of them. Or paste a Google Maps route, including the <b>Share</b> link from the app.</p>
        <div class="card" style="margin-bottom:14px">
          <label class="f" style="margin-top:0" for="link">Paste a Google Maps link</label>
          <div class="row" style="flex-wrap:nowrap"><input id="link" type="text" inputmode="url" placeholder="maps.app.goo.gl/… or google.com/maps/dir/…"><button class="btn" id="imp">Optimise</button></div>
          <div class="err" id="lerr" role="alert"></div>
          <p class="help">Works with share links, the address bar link, or a whole "Check out this route…" message.</p>
        </div>
        <div class="card">
          <label class="f" style="margin-top:0">Or type your stops <small>(drag the letters to reorder)</small></label>
          <div id="stops"></div>
          <div class="row"><button class="btn small ghost" id="add">+ Add stop</button><span class="mute" id="cnt" style="font-size:13px"></span><button class="btn link" id="clr">Clear all</button></div>
          <label class="row" style="gap:8px;margin-top:12px;color:var(--mute)"><input type="checkbox" id="fixed" checked style="accent-color:var(--thread)"> Start at stop A (otherwise any stop can be the start)</label>
          <label class="row" style="gap:8px;margin-top:6px;color:var(--mute)"><input type="checkbox" id="round" style="accent-color:var(--thread)"> Come back to the start</label>
          <div class="actionbar"><button class="btn main big" id="go">Find shortest route →</button></div>
          <div class="err" id="err" role="alert"></div>
        </div>
        <div id="out" style="margin-top:16px" aria-live="polite"></div>
        <p class="help">Maps & places: © OpenStreetMap contributors. Road times: OSRM (driving, no live traffic).</p>
      </div>
      <div class="mapbox"><div class="map" id="map"></div></div>
    </div>`;
  const map = makeMap($("#map"));
  const layer = map && L.layerGroup().addTo(map), pins = map && L.layerGroup().addTo(map);
  let result = null, dragging = null;
  const rows = () => [...$("#stops").children];

  function addStop(p = null) {
    if (rows().length >= MAX) return;
    const d = document.createElement("div");
    d.className = "rt-stop";
    d.innerHTML = `<span class="lt" draggable="true" title="Drag to reorder"></span><div class="slot"></div><button class="icon-btn" aria-label="Remove stop">×</button>`;
    const ps = placeSearch({ placeholder: "Search a place", value: p, bias: () => { const f = rows().map(r => r.ps.get()).find(x => x && x.lat != null); return f || (map ? map.getCenter() : null); }, onPick: () => { clear(); changed(); const nx = d.nextElementSibling; if (nx && !nx.ps.get()) nx.ps.input.focus(); } });
    ps.input.addEventListener("input", clear);
    d.ps = ps; $(".slot", d).appendChild(ps.el);
    $(".icon-btn", d).onclick = () => { if (rows().length > 2) d.remove(); else ps.set(null); clear(); changed(); };
    const lt = $(".lt", d);
    lt.addEventListener("dragstart", e => { dragging = d; d.classList.add("drag"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); });
    lt.addEventListener("dragend", () => { d.classList.remove("drag"); dragging = null; clear(); changed(); });
    d.addEventListener("dragover", e => { if (!dragging || dragging === d) return; e.preventDefault(); const r = d.getBoundingClientRect(); d.parentNode.insertBefore(dragging, e.clientY < r.top + r.height / 2 ? d : d.nextSibling); });
    $("#stops").appendChild(d);
    changed();
    return d;
  }
  function changed() {
    rows().forEach((d, i) => ($(".lt", d).textContent = L2(i)));
    $("#cnt").textContent = `${rows().length} of ${MAX}`;
    $("#add").disabled = rows().length >= MAX;
    if (!result && pins) {
      pins.clearLayers();
      const pts = rows().map((d, i) => { const p = d.ps.get(); return p && p.lat != null ? L.marker([p.lat, p.lng], { icon: pinIcon(L2(i), i === 0 ? "home" : "") }).addTo(pins) : null; }).filter(Boolean);
      if (pts.length > 1) map.fitBounds(L.featureGroup(pts).getBounds(), { padding: [40, 40], maxZoom: 13 });
      else if (pts.length) map.setView(pts[0].getLatLng(), 12);
    }
    save();
  }
  function clear() { if (!result) return; result = null; $("#out").innerHTML = ""; layer && layer.clearLayers(); changed(); }
  const opts = () => ({ fixed: $("#fixed").checked, round: $("#round").checked });

  function applyStops(list, missing) {
    rows().forEach((d, i) => { const s = list[i]; if (!s) return; if (s.missing) d.ps.error("No match. Add the city, or pick from the list."); else if (!d.ps.get() || d.ps.get().lat == null) d.ps.set({ label: s.label, lat: s.lat, lng: s.lng }); });
    if (missing && missing.length) throw new Error(`Couldn't find: ${missing.join("; ")}. Edit ${missing.length > 1 ? "those stops" : "that stop"} (add the city, or pick from the suggestions), then try again.`);
  }

  async function solve(btn) {
    $("#err").textContent = "";
    rows().forEach(d => { if (!d.ps.get() && rows().length > 2) d.remove(); });
    changed();
    if (rows().filter(d => d.ps.get()).length < 2) { $("#err").textContent = "Add at least 2 stops."; return; }
    busy(btn, true, rows().some(d => !d.ps.get() || d.ps.get().lat == null) ? "Finding your places…" : "Working out the best order…");
    try {
      const j = await api("/api/route/optimize", { stops: rows().map(d => d.ps.get()), ...opts() });
      applyStops(j.stops, j.missing);
      show(j.result);
    } catch (e) { $("#err").textContent = e.message; }
    busy(btn, false);
  }

  async function importLink(btn, here) {
    $("#lerr").textContent = ""; $("#err").textContent = "";
    const url = $("#link").value.trim();
    if (!url) { $("#lerr").textContent = "Paste a Google Maps link first."; return; }
    busy(btn, true, "Reading your link…");
    try {
      let j = await api("/api/route/import", { url, ...opts(), here });
      if (j.needHere) {
        busy(btn, false); busy(btn, true, "Your route starts at “Your location”. Getting it…");
        let pos = null; try { pos = await locate(); } catch (e) { toast("Couldn't get your location, so the route starts at the next stop.", true); }
        j = await api("/api/route/import", { url, ...opts(), here: pos || false });
      }
      $("#stops").innerHTML = ""; result = null;
      j.stops.forEach(s => addStop(s.missing ? { label: s.label } : { label: s.label, lat: s.lat, lng: s.lng }));
      applyStops(j.stops, j.missing);
      show(j.result);
    } catch (e) { $("#lerr").textContent = e.message; }
    busy(btn, false);
  }

  function show(r) {
    if (!r) return;
    result = r;
    if (layer) {
      layer.clearLayers(); pins.clearLayers();
      const line = L.polyline(decode(r.geometry), { color: "#c8362f", weight: 5, opacity: 0.9 }).addTo(layer);
      r.stops.forEach((s, k) => L.marker([s.lat, s.lng], { icon: pinIcon(L2(s.index), k === 0 && r.fixed ? "home" : "") }).bindTooltip(`${k + 1}. ${esc(s.label)}`).addTo(layer));
      map.fitBounds(line.getBounds(), { padding: [40, 40] });
    }
    let h = `<div class="card"><div class="between"><div><div style="font-size:24px;font-weight:800">${km(r.distance / 1000)} · ${dur(r.duration / 60)}</div>
      ${r.saved.distance > 500 ? `<div class="ok" style="font-weight:600">Saves ${km(r.saved.distance / 1000)} and ${dur(r.saved.duration / 60)} compared with your order.</div>` : `<div class="mute">Your order was already the best one.</div>`}</div></div>
      ${!r.exact ? `<p class="help">With this many stops this is a very good order, though not guaranteed to be the single best.</p>` : ""}<ol class="tl" style="margin-top:14px">`;
    r.stops.forEach((s, k) => {
      let info = "";
      if (s.next) info += `<div class="help" style="margin:0">Next stop: ${km(s.next.distance / 1000)}, ${dur(s.next.duration / 60)}, heading ${esc(s.next.heading)}</div>`;
      if (s.start) info += `<div class="help" style="margin:0;color:var(--ink)">Starting point</div>`;
      if (s.skip) info += `<div class="help" style="margin:0;color:var(--ink)">Skip this stop and save ${km(s.skip.distance / 1000)} and ${dur(s.skip.duration / 60)}</div>`;
      if (s.flag) info += `<div class="help" style="margin:0;color:var(--bad);font-weight:600">${esc(s.flag)}</div>`;
      h += `<li><span class="dot ${k === 0 && r.fixed ? "home" : ""}">${L2(s.index)}</span><div class="stop" style="padding:8px 0 12px"><b>${esc(s.label)}</b>${info}</div></li>`;
    });
    if (r.round) h += `<li><span class="dot home">${L2(r.stops[0].index)}</span><div class="stop" style="padding:8px 0"><b>Back to start</b></div></li>`;
    h += `</ol><p class="help">Savings assume you drop only that stop and keep the others in the same order.</p><div class="row" id="gm"></div></div>`;
    $("#out").innerHTML = h;
    const seq = r.stops.map(s => (/^your location$/i.test(s.label) ? `${s.lat},${s.lng}` : s.label));
    if (r.round) seq.push(seq[0]);
    const parts = [];
    for (let i = 0; i < seq.length - 1; i += 10) parts.push(seq.slice(i, i + 11));
    $("#gm").innerHTML = parts.map((p, i) => { const u = new URL("https://www.google.com/maps/dir/"); u.searchParams.set("api", "1"); u.searchParams.set("origin", p[0]); u.searchParams.set("destination", p[p.length - 1]); if (p.length > 2) u.searchParams.set("waypoints", p.slice(1, -1).join("|")); u.searchParams.set("travelmode", "driving"); return `<a class="btn main" href="${esc(u.href)}" target="_blank" rel="noopener">Open in Google Maps${parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : ""}</a>`; }).join("");
    if (matchMedia("(max-width:980px)").matches) $("#out").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function save() { try { localStorage.setItem("raahi.route", JSON.stringify({ stops: rows().map(d => d.ps.get()), ...opts() })); } catch {} }
  let saved = null; try { saved = JSON.parse(localStorage.getItem("raahi.route") || "null"); } catch {}
  if (saved && Array.isArray(saved.stops) && saved.stops.length >= 2) { $("#fixed").checked = saved.fixed !== false; $("#round").checked = !!saved.round; saved.stops.slice(0, MAX).forEach(s => addStop(s)); }
  else for (let i = 0; i < 3; i++) addStop();

  $("#add").onclick = () => { const d = addStop(); d && d.ps.input.focus(); };
  $("#clr").onclick = () => { $("#stops").innerHTML = ""; result = null; layer && layer.clearLayers(); $("#out").innerHTML = ""; for (let i = 0; i < 3; i++) addStop(); };
  $("#go").onclick = e => solve(e.currentTarget);
  $("#imp").onclick = e => importLink(e.currentTarget);
  $("#link").addEventListener("keydown", e => { if (e.key === "Enter") importLink($("#imp")); });
  $("#link").addEventListener("paste", () => setTimeout(() => { if (/https?:\/\//.test($("#link").value)) importLink($("#imp")); }, 0));
  for (const k of ["fixed", "round"]) $("#" + k).addEventListener("change", () => { save(); if (result) solve($("#go")); });
  return () => map && map.remove();
}

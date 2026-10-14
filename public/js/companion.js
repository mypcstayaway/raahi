// Trip companion: the next-step card, automatic GPS check-in/out, and leave-by alerts.
import { api, esc, hhmm, dur, todayISO, nowMin, toast, gmapsGo, CAT_ICON } from "./core.js";

const city = (d, si) => ((d.input.segments[si] || d.input.segments[0]).destination.label || "").split(",")[0];

// What should the traveller do right now?
export function nextStep(d, di, now = nowMin()) {
  const day = d.days[di];
  if (!day) return null;
  const ck = d.checkins || {};
  const isDone = id => ck[id] && (ck[id].done || ck[id].skipped);
  const visits = day.items.filter(i => i.type === "visit");
  const P = id => d.places[id] || { name: "?" };
  const here = d.presence && d.presence.day === di ? d.presence.placeId : visits.find(i => ck[i.id] && ck[i.id].arrived && !isDone(i.id))?.id;
  const upcoming = visits.filter(i => !isDone(i.id) && i.id !== here);
  const nav = p => gmapsGo(p.lat, p.lng, p.approx ? `${p.lat},${p.lng}` : `${p.name}, ${city(d, p.seg)}`);
  if (here) {
    const it = visits.find(i => i.id === here), p = P(here), nx = upcoming[0];
    const since = ck[here] && ck[here].arrived ? new Date(ck[here].arrived).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : null;
    return { kind: "at", label: since ? `YOU'RE HERE · CHECKED IN ${since}${ck[here].auto ? " AUTOMATICALLY" : ""}` : "YOU'RE HERE", title: `${CAT_ICON[p.category] || "📍"} ${p.name}`, sub: `${it ? `Leave by ${hhmm(it.end)} to stay on plan.` : ""}${nx ? ` Next: ${P(nx.id).name}.` : " Last stop of the day."}${p.highlights && p.highlights[0] ? ` Don't miss: ${p.highlights[0]}.` : ""}`, placeId: here, list: visits.map(i => ({ name: P(i.id).name, state: isDone(i.id) ? "done" : i.id === here ? "now" : "" })) };
  }
  const meal = day.items.find(i => i.type === "meal");
  const nx = upcoming[0];
  if (meal && !d.lunchDone && now >= meal.start - 10 && now <= meal.end && (!nx || nx.start >= meal.start)) {
    const r = day.meals && day.meals.lunch && day.meals.lunch[0];
    return { kind: "lunch", label: "NEXT STEP · LUNCH", title: "🍛 Time for lunch", sub: r ? `${r.name}${r.veg === "pure-veg" ? " (pure veg)" : ""}, ${r.distance < 1000 ? r.distance + " m" : (r.distance / 1000).toFixed(1) + " km"} away. Back on the road by ${hhmm(meal.end)}.` : `Back on the road by ${hhmm(meal.end)}.`, nav: r ? gmapsGo(r.lat, r.lng, `${r.name}, ${city(d, day.seg)}`) : null, list: visits.map(i => ({ name: P(i.id).name, state: isDone(i.id) ? "done" : "" })) };
  }
  if (!nx) return { kind: "done", label: "ALL DONE FOR TODAY", title: "🎉 That's a wrap", sub: `Head back to ${(day.to && day.to.label) || "your stay"}. Your day recap is below.`, nav: day.to ? gmapsGo(day.to.lat, day.to.lng, day.to.label) : null, list: visits.map(i => ({ name: P(i.id).name, state: "done" })) };
  const p = P(nx.id);
  const early = now < day.start - 30 && !visits.some(i => ck[i.id]);
  return {
    kind: "go", label: early ? `TODAY STARTS AT ${hhmm(day.start)}` : "NEXT STEP",
    title: `Head to ${p.name}`,
    sub: `${dur(nx.travel)} drive · planned ${hhmm(nx.start)}–${hhmm(nx.end)}${p.hoursDesc && p.hoursDesc !== "Hours not known" ? ` · ${p.hoursDesc.split(" · ")[0].replace(/^Open /, "open ")}` : ""}`,
    nav: nav(p), placeId: p.id, list: visits.map(i => ({ name: P(i.id).name, state: isDone(i.id) ? "done" : i.id === nx.id ? "now" : "" })),
  };
}

export function nextStepHTML(s, { big = false } = {}) {
  if (!s) return "";
  const color = s.kind === "at" ? "var(--good)" : s.kind === "lunch" ? "var(--saffron)" : "var(--thread)";
  return `<div class="nextstep ${big ? "big" : ""}">
    <div class="ns-k" style="color:${color}">${esc(s.label)}</div>
    <div class="ns-t">${esc(s.title)}</div>
    <div class="ns-s">${esc(s.sub)}</div>
    <div class="row" style="margin-top:8px">${s.nav ? `<a class="btn small main" href="${esc(s.nav)}" target="_blank" rel="noopener">Navigate</a>` : ""}<span class="grow"></span><span class="ns-list">${(s.list || []).map(x => `<span class="${x.state}">${x.state === "done" ? "✓ " : x.state === "now" ? "● " : "○ "}${esc(x.name)}</span>`).join("")}</span></div>
  </div>`;
}

// ---------- notifications ----------
export async function askNotify() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}
async function notify(title, body, tag) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg) reg.showNotification(title, { body, tag, icon: "/icon.svg", badge: "/icon.svg" });
    else new Notification(title, { body, tag });
  } catch {}
}
const seen = new Set();
function once(key) { if (!key || seen.has(key)) return false; seen.add(key); try { const s = JSON.parse(sessionStorage.getItem("raahi.alerts") || "[]"); if (s.includes(key)) return false; s.push(key); sessionStorage.setItem("raahi.alerts", JSON.stringify(s.slice(-50))); } catch {} return true; }

// ---------- GPS companion ----------
// Watches the phone's position while Raahi is open and posts it every ~45 s (or after moving 40 m).
export function startCompanion(tripId, getData, { onUpdate, onAlert, onStatus } = {}) {
  if (!navigator.geolocation) { onStatus && onStatus("This browser can't share location."); return () => {}; }
  let lastSent = 0, lastPt = null, stopped = false, busy = false;
  const dist = (a, b) => { const r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r; return Math.sqrt(x * x + y * y) * 6371000; };
  const send = async pos => {
    if (stopped || busy) return;
    const pt = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const now = Date.now();
    if (now - lastSent < 45000 && lastPt && dist(lastPt, pt) < 40) return;
    busy = true; lastSent = now; lastPt = pt;
    try {
      const d = getData();
      const di = d.days.findIndex(x => x.date === todayISO());
      if (di < 0) { onStatus && onStatus("Your trip isn't today, so auto check-in is paused."); return; }
      const r = await api(`/api/trips/${tripId}/position`, { ...pt, acc: pos.coords.accuracy, at: now, day: di, nowMin: nowMin() });
      d.checkins = r.checkins; d.presence = r.presence;
      if (r.event) {
        const msg = r.event.type === "arrived" ? `Checked in at ${r.event.name}` : `Checked out of ${r.event.name}`;
        toast(`📍 ${msg} automatically`);
        if (document.hidden) notify("Raahi", msg, "ci-" + r.event.placeId);
      }
      if (r.alert && once(r.alert.key)) { onAlert && onAlert(r.alert); notify(r.alert.title, r.alert.text, r.alert.key); }
      onStatus && onStatus(`📍 Auto check-in on · ±${Math.round(pos.coords.accuracy)} m`);
      onUpdate && onUpdate(r);
    } catch (e) { onStatus && onStatus(e.message); }
    finally { busy = false; }
  };
  const id = navigator.geolocation.watchPosition(send, e => onStatus && onStatus(e.code === 1 ? "Location permission is off. Turn it on for auto check-in." : "Waiting for GPS…"), { enableHighAccuracy: true, maximumAge: 20000, timeout: 30000 });
  // Keep the screen's data fresh even when the phone isn't moving.
  const tick = setInterval(() => navigator.geolocation.getCurrentPosition(send, () => {}, { maximumAge: 60000, timeout: 20000 }), 60000);
  return () => { stopped = true; navigator.geolocation.clearWatch(id); clearInterval(tick); };
}

export function companionOn(tripId) { try { return localStorage.getItem("raahi.companion." + tripId) !== "off"; } catch { return true; } }
export function setCompanion(tripId, on) { try { localStorage.setItem("raahi.companion." + tripId, on ? "on" : "off"); } catch {} }

// ---------- SOS ----------
export async function sosPanel(el, { country, emergency } = {}) {
  el.innerHTML = `<div class="card" style="border-color:var(--bad)"><div class="between"><h3 style="margin:0">🆘 Need help?</h3><button class="icon-btn" data-x aria-label="Close">×</button></div>
    <div class="row" style="margin:10px 0"><a class="btn main" href="tel:112">📞 Call 112</a>${(emergency || []).filter(e => String(e.number) !== "112").slice(0, 3).map(e => `<a class="btn ghost small" href="tel:${esc(String(e.number).replace(/[^\d+]/g, ""))}">${esc(e.label)}: ${esc(e.number)}</a>`).join("")}</div>
    <button class="btn" data-wa style="background:#25D366;border-color:#25D366;color:#fff">📍 Send my location on WhatsApp</button>
    <div data-near class="list" style="margin-top:12px"><p class="help">Finding the nearest hospital and police…</p></div></div>`;
  el.hidden = false;
  el.querySelector("[data-x]").onclick = () => { el.hidden = true; };
  let pos = null;
  try { pos = await new Promise((ok, bad) => navigator.geolocation.getCurrentPosition(p => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), bad, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 })); } catch {}
  el.querySelector("[data-wa]").onclick = () => {
    const where = pos ? `https://maps.google.com/?q=${pos.lat.toFixed(6)},${pos.lng.toFixed(6)}` : "(location unavailable)";
    window.open(`https://wa.me/?text=${encodeURIComponent(`I need help. My location: ${where}`)}`, "_blank", "noopener");
  };
  const box = el.querySelector("[data-near]");
  if (!pos) { box.innerHTML = `<p class="help">Turn on location to see the nearest hospital and police station.</p>`; return; }
  try {
    const h = await api(`/api/help?lat=${pos.lat}&lng=${pos.lng}`);
    const row = (ic, x) => `<div class="between" style="padding:8px 10px;background:var(--soft);border-radius:10px"><span>${ic} <b>${esc(x.name)}</b> <small class="mute">${x.distance < 1000 ? x.distance + " m" : (x.distance / 1000).toFixed(1) + " km"}</small></span><span class="row" style="gap:6px">${x.phone ? `<a class="btn small ghost" href="tel:${esc(x.phone.replace(/[^\d+]/g, ""))}">Call</a>` : ""}<a class="btn small ghost" href="${esc(gmapsGo(x.lat, x.lng, `${x.lat},${x.lng}`))}" target="_blank" rel="noopener">Go</a></span></div>`;
    box.innerHTML = [...h.hospitals.slice(0, 2).map(x => row("🏥", x)), ...h.police.slice(0, 1).map(x => row("👮", x)), ...h.pharmacies.slice(0, 1).map(x => row("💊", x))].join("") || `<p class="help">No hospital found nearby on the map. Call 112.</p>`;
  } catch { box.innerHTML = `<p class="help">Couldn't load nearby help. Call 112.</p>`; }
}

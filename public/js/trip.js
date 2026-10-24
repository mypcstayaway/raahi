import { $, $$, api, state, esc, toast, busy, tiles, placeSearch, locate, makeMap, pinIcon, decode, hhmm, dur, km, inr, dayName, longDate, todayISO, nowMin, scoreClass, CAT_ICON, gmapsPlace, gmapsGo } from "./core.js";
import * as chat from "./chat.js";
import { nextStep, nextStepHTML, startCompanion, companionOn, setCompanion, askNotify, sosPanel } from "./companion.js";

const STEPS = ["Understanding your trip", "Asking Raahi for the best places", "Finding them on the map", "Checking real opening hours", "Working out the shortest order", "Finding places to eat", "Checking the weather"];
const REASON = { closed: "Closed on your travel days", hours: "Closes before you could get there", time: "No time left in your days", far: "Too far to fit into a day", pinned: "Pinned to another day" };
const TIPS = ["Tip: tap “I'm here” and “Done” at each place. Raahi learns your real pace.", "Tip: in Live mode, Raahi tells you if a place will close before you reach it.", "Tip: “Check crowds & news” searches the past week for crowds, closures and safety.", "Tip: print the plan or save it as a PDF for offline use.", "Tip: ask Raahi in the chat anything about this trip."];

export async function render(view, params, query, { shared } = {}) {
  const id = params[0];
  let t, timer = null, map = null, layers = null, live = { pos: null, res: null, hadLunch: false, day: null }, clockTimer = null;
  let tab = query.get("tab") || "plan", day = +(query.get("day") || 0), verifyTimer = null;
  let stopCompanion = null, nsTimer = null, liveShareTimer = null, lastAlert = null;
  const cleanup = () => { clearTimeout(timer); clearInterval(clockTimer); clearTimeout(verifyTimer); clearInterval(nsTimer); clearInterval(liveShareTimer); if (stopCompanion) stopCompanion(); if (map) map.remove(); };

  async function load() {
    t = shared ? await api("/api/share/" + id) : await api("/api/trips/" + id);
    try { if (!shared) localStorage.setItem("raahi.trip." + id, JSON.stringify(t)); } catch {}
    return t;
  }
  try { await load(); }
  catch (e) {
    let saved = null; try { saved = JSON.parse(localStorage.getItem("raahi.trip." + id) || "null"); } catch {}
    if (!saved) { view.innerHTML = `<div class="card"><h2>Couldn't open this trip</h2><p class="err">${esc(e.message)}</p><a class="btn" href="#/">Back to my trips</a></div>`; return cleanup; }
    t = saved; toast("Offline: showing the copy saved on this device.");
  }
  const D = () => t.data;
  const P = pid => D().places[pid] || { name: "?" };
  const city = si => ((D().input.segments[si] || D().input.segments[0]).destination.label || "").split(",")[0];

  function route() {
    const d = D();
    if (d.status === "planning" || t.planning) return planning();
    if (d.status === "review") return review();
    if (d.status === "error") return failed();
    return main();
  }

  // ---------- while planning ----------
  function planning() {
    const pr = D().progress || { step: 0 };
    view.innerHTML = `
      <div class="wiz" style="text-align:left">
        <h1>Planning ${esc(t.title)}…</h1>
        <p class="mute">This usually takes 20–60 seconds. You can leave this page; the plan keeps going.</p>
        <div class="card"><ul class="progress-list">${STEPS.map((s, i) => `<li class="${i < pr.step ? "done" : i === pr.step ? "now" : ""}">${i < pr.step ? "✓" : i === pr.step ? `<span class="spin"></span>` : "○"} ${esc(s)}</li>`).join("")}</ul>
        <p class="mute" style="margin:0;font-size:14px">${esc(TIPS[Math.floor(Date.now() / 6000) % TIPS.length])}</p></div>
      </div>`;
    timer = setTimeout(async () => { try { await load(); } catch {} route(); }, 1200);
  }

  function failed() {
    view.innerHTML = `<div class="wiz"><h1>That didn't work</h1><div class="card"><p class="err">${esc(D().error || "Planning failed.")}</p><div class="row"><button class="btn main" id="retry">Try again</button><a class="btn ghost" href="#/plan">Start over</a></div></div></div>`;
    $("#retry").onclick = async e => { busy(e.currentTarget, true, "Retrying…"); await api(`/api/trips/${id}/retry`, {}); await load(); route(); };
  }

  // ---------- pick places ----------
  function review() {
    const d = D(), max = d.input.detail === "max";
    const segs = d.input.segments;
    const cap = segs.map(s => s.days * ((d.pace && d.pace.maxStops) || 5));
    view.innerHTML = `
      <div class="trip-head"><div><span class="tag warn">Step 2 of 2</span><h1 style="margin-top:8px">Pick your places</h1><div class="meta">${esc(t.title)} · Raahi ticked the best ones. Untick any you'd rather skip${max ? ", set how long to stay, or choose a day" : ""}.</div></div></div>
      ${d.aiError ? `<div class="note warn" style="margin-bottom:12px">${esc(d.aiError)} The places below come from OpenStreetMap.</div>` : ""}
      <div id="segs"></div>
      <div class="card no-print" style="position:sticky;bottom:72px;margin-top:16px;z-index:10">
        <div id="cmpBar" hidden class="between" style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--line)"><span><b id="cmpN"></b> marked to compare. Keep <select id="cmpK" style="width:auto;min-height:32px;padding:2px 6px"></select></span><button class="btn small decide" id="cmpGo">✨ Let Raahi pick</button></div>
        <div id="cmpOut"></div>
        <div class="between"><span id="cnt" class="mute"></span><div class="row"><button class="btn ghost decide" id="auto" title="Use Raahi's picks">✨ Let Raahi decide</button><button class="btn main big" id="go">Make my day-by-day plan →</button></div></div></div>`;
    const box = $("#segs");
    segs.forEach((s, si) => {
      const list = Object.values(d.places).filter(p => p.seg === si).sort((a, b) => (b.selected - a.selected) || b.priority - a.priority || (b.rating || 0) - (a.rating || 0));
      const dayOpts = Array.from({ length: s.days }, (_, k) => s.offset + k);
      box.insertAdjacentHTML("beforeend", `<h2 style="margin-top:18px">${esc(city(si))} <small class="mute" style="font-size:15px;font-weight:600">· ${s.days} day${s.days > 1 ? "s" : ""}, room for about ${cap[si]} places</small></h2>
        ${d.info[si] && d.info[si].summary ? `<p class="mute">${esc(d.info[si].summary)}</p>` : ""}
        <div class="list">${list.map(p => `
          <label class="card pick ${p.selected ? "" : "off"}" data-id="${p.id}">
            <input type="checkbox" ${p.selected ? "checked" : ""} aria-label="Include ${esc(p.name)}">
            <div>
              <div class="between"><div><b style="font-size:16px">${CAT_ICON[p.category] || "📍"} ${esc(p.name)}</b> ${p.rating ? `<span class="score ${scoreClass(p.rating)}">${p.rating.toFixed(1)}<small>/10</small></span>` : ""}</div>
                <span class="row" style="gap:6px"><button type="button" class="btn small ghost cmp" aria-pressed="false" title="Can't choose? Mark places to compare, then let Raahi pick">⚖️ Compare</button><button type="button" class="btn small ghost must" aria-pressed="${!!p.must}" title="Must-see: always include">${p.must ? "★ Must-see" : "☆ Must-see"}</button></span></div>
              ${p.why ? `<div class="mute" style="font-size:14px">${esc(p.why)}</div>` : ""}
              <div class="row" style="gap:6px;margin-top:6px;font-size:13px">
                <span class="tag">🕰️ ${esc(p.hoursDesc || "Hours not known")}</span>
                ${p.ticket && (p.ticket.indian || p.ticket.foreigner) ? `<span class="tag">🎟️ ${esc(p.ticket.indian || p.ticket.foreigner)}</span>` : ""}
                ${max ? `<span class="tag">⏱️ <input type="number" class="vm" min="10" max="600" step="5" value="${p.userVisit || p.visitMin}" style="width:64px;min-height:26px;padding:2px 4px" aria-label="Minutes at ${esc(p.name)}"> min</span>
                  <span class="tag">📅 <select class="pin" style="min-height:26px;padding:2px 4px;width:auto" aria-label="Day for ${esc(p.name)}"><option value="">Any day</option>${dayOpts.map(g => `<option value="${g}" ${p.pinDay === g ? "selected" : ""}>Day ${g + 1}</option>`).join("")}</select></span>`
                  : `<span class="tag">⏱️ ${dur(p.visitMin)}</span>`}
                ${p.bestTimeOfDay ? `<span class="tag">🌅 ${esc(p.bestTimeOfDay)}</span>` : ""}
              </div>
            </div>
          </label>`).join("")}</div>`);
    });
    const count = () => { const n = $$(".pick input[type=checkbox]:checked").length; $("#cnt").textContent = `${n} places picked. Whatever doesn't fit goes to “More ideas”.`; };
    $$(".pick").forEach(card => {
      const cb = $("input[type=checkbox]", card);
      cb.onchange = () => { card.classList.toggle("off", !cb.checked); count(); };
      $(".must", card).onclick = e => { e.preventDefault(); const b = e.currentTarget, on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", on); b.textContent = on ? "★ Must-see" : "☆ Must-see"; if (on) { cb.checked = true; card.classList.remove("off"); count(); } };
      $$("input.vm, select.pin", card).forEach(x => x.addEventListener("click", e => e.stopPropagation()));
    });
    count();
    const cmpSync = () => {
      const marked = $$(".pick .cmp[aria-pressed=true]");
      $("#cmpBar").hidden = marked.length < 2;
      $("#cmpN").textContent = marked.length;
      $("#cmpK").innerHTML = Array.from({ length: Math.max(1, marked.length - 1) }, (_, k) => `<option value="${k + 1}">${k + 1}</option>`).join("");
    };
    $$(".pick .cmp").forEach(b => (b.onclick = e => { e.preventDefault(); b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"); b.style.background = b.getAttribute("aria-pressed") === "true" ? "var(--warn-bg)" : ""; cmpSync(); }));
    $("#cmpGo").onclick = async e => {
      const ids = $$(".pick .cmp[aria-pressed=true]").map(b => b.closest(".pick").dataset.id);
      busy(e.currentTarget, true, "Raahi is choosing…");
      try {
        const r = await api(`/api/trips/${id}/decide`, { placeIds: ids, keep: +$("#cmpK").value });
        ids.forEach(pid => { const c = $(`.pick[data-id="${pid}"]`), on = r.pick.includes(pid); $("input[type=checkbox]", c).checked = on; c.classList.toggle("off", !on); const cb = $(".cmp", c); cb.setAttribute("aria-pressed", "false"); cb.style.background = ""; });
        $("#cmpOut").innerHTML = `<div class="advice" style="margin-bottom:10px"><b>Raahi picked ${esc(r.pick.map(x => D().places[x].name).join(" & "))}</b><p style="margin:4px 0 0">${esc(r.why)}</p></div>`;
        count(); cmpSync();
      } catch (err) { toast(err.message, true); }
      busy(e.currentTarget, false);
    };
    $("#auto").onclick = () => { $$(".pick").forEach(c => { const on = !!D().places[c.dataset.id].selected; $("input[type=checkbox]", c).checked = on; c.classList.toggle("off", !on); }); count(); $("#go").click(); };
    $("#go").onclick = async e => {
      const cards = $$(".pick");
      const body = { selected: cards.filter(c => $("input[type=checkbox]", c).checked).map(c => c.dataset.id), must: cards.filter(c => $(".must", c).getAttribute("aria-pressed") === "true").map(c => c.dataset.id) };
      if (max) { body.visit = {}; body.pins = {}; cards.forEach(c => { body.visit[c.dataset.id] = +$("input.vm", c).value; body.pins[c.dataset.id] = $("select.pin", c).value; }); }
      busy(e.currentTarget, true, "Planning…");
      try { await api(`/api/trips/${id}/select`, body); await load(); route(); } catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
    };
  }

  // ---------- the plan ----------
  // Thread trips: the whole loop at a glance, with how to move between stops and the must-dos.
  function threadCard(inp) {
    const T = inp.thread, IC = { car: "🚗", bus: "🚌", train: "🚆", flight: "✈️", ferry: "⛴️", walk: "🚶" };
    const home = T.home && T.home.label ? T.home.label.split(",")[0] : "Home";
    const names = [home, ...(T.gateway ? [T.gateway.name] : []), ...inp.segments.map(s => s.destination.label.split(",")[0]), ...(T.loop ? [home] : [])];
    let dayNo = 1;
    const rows = inp.segments.map((s, i) => {
      const x = s.thread || {}, L = x.leg, from = dayNo; dayNo += s.days;
      const prev = i ? inp.segments[i - 1].destination.label.split(",")[0] : T.gateway ? T.gateway.name : home;
      return `${L ? `<div class="help" style="margin:8px 0 4px">${IC[L.mode] || "➜"} ${esc(L.from || prev)} → ${esc(x.name || s.destination.label.split(",")[0])}${L.roadHours || L.hours ? ` · ~${dur(Math.round((L.roadHours || L.hours) * 60))}` : ""}${L.km ? ` · ${L.km} km` : ""}${L.fare ? ` · ${esc(L.fare)}` : ""}${L.depart ? ` · leave ${esc(L.depart)}` : ""}${L.tip ? ` · 💡 ${esc(L.tip)}` : ""}</div>` : ""}
        <details class="th-stop"><summary><b>${esc(s.destination.label.split(",")[0])}</b> <span class="mute">· Day ${from}${s.days > 1 ? `–${from + s.days - 1}` : ""}${x.arriveBy ? ` · reach by ${esc(x.arriveBy)}` : ""}</span></summary>
          ${(x.plan || []).length ? `<ol class="th-plan">${x.plan.map(p => `<li>${p.time ? `<b>${esc(p.time)}</b> ` : ""}${esc(p.what)}${p.tip ? `<br><small class="mute">💡 ${esc(p.tip)}</small>` : ""}</li>`).join("")}</ol>` : ""}
          ${(x.timings || []).length ? `<p style="margin:6px 0 0;font-size:14px">🕰️ ${x.timings.map(z => `<b>${esc(z.what)}</b>: ${esc(z.time)}`).join(" · ")}</p>` : ""}
          ${(x.fees || []).length ? `<p style="margin:6px 0 0;font-size:14px">🎟️ ${x.fees.map(z => `${esc(z.what)}: <b>${esc(z.price)}</b>`).join(" · ")}</p>` : ""}
          ${(x.warnings || []).length ? `<div class="note warn" style="margin-top:8px">${x.warnings.map(w => `⚠️ ${esc(w)}`).join("<br>")}</div>` : ""}
          ${x.stay ? `<p style="margin:6px 0 0;font-size:14px">🏨 ${esc(x.stay)}</p>` : ""}${x.food ? `<p style="margin:4px 0 0;font-size:14px">🍛 ${esc(x.food)}</p>` : ""}
        </details>`;
    }).join("");
    const R = T.returnLeg;
    return `<details class="card thread-card" style="margin-bottom:14px" ${tab === "plan" ? "open" : ""}><summary><b>🧵 ${esc(T.title || "Your thread")}</b> <span class="mute">· ${esc(names.join(" → "))}</span></summary>
      ${T.summary ? `<p style="margin:8px 0">${esc(T.summary)}</p>` : ""}
      ${T.gateway ? `<div class="help">✈️ <b>First reach ${esc(T.gateway.name)}:</b> ${esc(T.gateway.how || "")}</div>` : ""}
      ${rows}
      ${R && (R.to || R.mode) ? `<div class="help" style="margin-top:8px">🏠 ${IC[R.mode] || "➜"} ${esc(R.from || inp.segments[inp.segments.length - 1].destination.label.split(",")[0])} → ${esc(R.to || home)}${R.hours ? ` · ~${dur(Math.round(R.hours * 60))}` : ""}${R.fare ? ` · ${esc(R.fare)}` : ""}${R.depart ? ` · leave ${esc(R.depart)}` : ""}${R.tip ? ` · 💡 ${esc(R.tip)}` : ""}</div>` : ""}
    </details>`;
  }

  function main() {
    const d = D(), inp = d.input;
    const today = todayISO();
    const todayIdx = d.days.findIndex(x => x.date === today);
    if (query.get("tab") === "live" && todayIdx >= 0 && !query.get("day")) day = todayIdx;
    day = Math.min(day, d.days.length - 1);
    const end = inp.start ? d.days[d.days.length - 1].date : null;
    view.innerHTML = `
      ${shared ? `<div class="note" style="margin-bottom:14px">You're viewing a shared trip. <a href="#/plan">Plan your own with Raahi</a>, it's free.</div>` : ""}
      <div class="trip-head">
        <div><h1 id="ttl">${esc(t.title)}</h1>
          <div class="meta">${inp.start ? `${esc(dayName(inp.start))} – ${esc(dayName(end))}` : "Dates not set"} · ${inp.travellers} ${inp.travellers > 1 ? "people" : "person"} · ${esc((d.pace && d.pace.key) || inp.pace || "balanced")} pace${d.pace && d.pace.auto ? " (learned)" : ""}</div></div>
        <div class="row no-print">
          <button class="btn small ghost" id="print">🖨️ Print / PDF</button>
          ${shared ? "" : `<button class="btn small ghost" id="share">🔗 Share</button><button class="btn small ghost" id="ask">💬 Ask about this trip</button><button class="btn small ghost" id="sos" style="color:var(--bad);border-color:var(--bad)">🆘 SOS</button><button class="btn small ghost" id="more" aria-haspopup="true">⋯</button>`}
        </div>
      </div>
      <div id="sosBox" class="no-print" hidden style="margin-bottom:14px"></div>
      <div id="shareBox" class="card no-print" hidden style="margin-bottom:14px"></div>
      <div id="moreBox" class="card no-print" hidden style="margin-bottom:14px"></div>
      <div id="nsBox" class="no-print"></div><div id="alertBox" class="no-print"></div>
      ${inp.thread ? threadCard(inp) : ""}
      ${d.aiError ? `<div class="note warn no-print" style="margin-bottom:10px">AI details weren't available (${esc(d.aiError)}). Places come from OpenStreetMap; ticket prices and tips are missing.</div>` : ""}
      ${d.estimatedTimes ? `<div class="note warn no-print" style="margin-bottom:10px">The road-time service was busy, so drive times are estimates. Tap “Re-plan” later for exact times.</div>` : ""}
      <div class="ttabs no-print" role="tablist">
        ${[["plan", "🗓️ Plan"], ...(shared ? [] : [["live", "📍 Live"], ["budget", "💰 Budget"]]), ["info", "ℹ️ Info & tips"]].map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}${k === "live" && todayIdx >= 0 ? ` <span class="tag red" style="padding:0 6px">today</span>` : ""}</button>`).join("")}
      </div>
      <div class="split"><div id="tb"></div><div class="mapbox no-print"><div class="map" id="map"></div></div></div>
      <div class="print-only" id="printArea"></div>`;
    $$("[data-tab]").forEach(b => (b.onclick = () => { tab = b.dataset.tab; $$("[data-tab]").forEach(x => x.setAttribute("aria-selected", x === b)); drawTab(); }));
    $("#print").onclick = () => { $("#printArea").innerHTML = printHTML(); window.print(); };
    if (!shared) {
      $("#share").onclick = async () => {
        const box = $("#shareBox");
        if (!box.hidden) { box.hidden = true; return; }
        try {
          const r = await api(`/api/trips/${id}/share`, {});
          const url = `${location.origin}/t/${r.share}`;
          box.hidden = false;
          box.innerHTML = `<div class="between"><h3 style="margin:0">🔗 Share this trip</h3><button class="icon-btn" id="shx" aria-label="Close">×</button></div>
            <p class="help">Anyone with the link can see the plan. Your expenses stay private.</p>
            <div class="row"><input type="text" readonly value="${esc(url)}" style="flex:1;min-width:200px" id="shu"><button class="btn small" id="shc">Copy</button><a class="btn small" style="background:#25D366;border-color:#25D366;color:#fff" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Our trip plan: ${t.title} ${url}`)}">WhatsApp</a></div>
            <label class="switch" style="margin-top:12px"><input type="checkbox" id="shl" ${r.live ? "checked" : ""}> <span><b style="color:var(--ink)">👨‍👩‍👧 Family live share</b>: the link also shows which stop you've reached. Only check-ins, never your live GPS.</span></label>`;
          $("#shx").onclick = () => (box.hidden = true);
          $("#shc").onclick = async () => { await navigator.clipboard.writeText(url).catch(() => {}); toast("Link copied: " + url); };
          $("#shl").onchange = async e => { try { const x = await api(`/api/trips/${id}/share`, { live: e.target.checked }); toast(x.live ? "Family can now follow your stops live" : "Live share turned off"); } catch (err) { toast(err.message, true); } };
        } catch (e) { toast(e.message, true); }
      };
      $("#sos").onclick = () => { const b = $("#sosBox"); if (!b.hidden) { b.hidden = true; return; } const info = D().info.find(x => x && x.emergency) || {}; sosPanel(b, { emergency: info.emergency }); b.scrollIntoView({ behavior: "smooth", block: "nearest" }); };
      $("#ask").onclick = () => chat.open(`Tell me about my trip: ${t.title}. What should I know?`);
      $("#more").onclick = () => { const m = $("#moreBox"); m.hidden = !m.hidden; if (!m.hidden) drawMore(m); };
    }
    if (!map) { map = makeMap($("#map"), [inp.segments[0].destination.lat || 27.18, inp.segments[0].destination.lng || 78.02], 12); layers = map && L.layerGroup().addTo(map); }
    else { $("#map").replaceWith(map.getContainer()); setTimeout(() => map.invalidateSize(), 50); }
    drawNext();
    if (!shared && !state.config.demo && todayIdx >= 0 && companionOn(id) && !stopCompanion) runCompanion();
    if (shared && t.live && !liveShareTimer) liveShareTimer = setInterval(async () => { try { await load(); drawNext(); } catch {} }, 60000);
    drawTab();
    resumeAutoVerify();
  }

  // ---------- next-step card + companion ----------
  function drawNext() {
    const box = $("#nsBox"); if (!box) return;
    const d = D(), di = d.days.findIndex(x => x.date === todayISO());
    if (di < 0 || (shared && !t.live)) { box.innerHTML = ""; return; }
    const st = nextStep(d, di);
    if (shared) {
      const seen = d.lastSeen ? new Date(d.lastSeen).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : null;
      box.innerHTML = nextStepHTML({ ...st, label: `👨‍👩‍👧 LIVE · ${st.kind === "at" ? "REACHED" : "ON THE WAY"}${seen ? " · UPDATED " + seen : ""}`, title: st.kind === "at" ? st.title.replace(/^\S+ /, "") + " ✓" : st.kind === "done" ? "Done for the day 🎉" : st.title.replace("Head to", "Heading to"), sub: "", nav: null });
      return;
    }
    box.innerHTML = nextStepHTML(st) + `<div class="row" style="margin:-6px 0 14px;gap:14px"><label class="switch"><input type="checkbox" id="compOn" ${stopCompanion ? "checked" : ""}> Auto check-in with GPS</label><span class="help" id="compMsg" style="margin:0">${stopCompanion ? "📍 On while Raahi is open" : "Off"}</span><a class="btn link" href="#/now" style="font-size:13px">Full-screen next step</a></div>`;
    $("#compOn").onchange = e => { setCompanion(id, e.target.checked); if (e.target.checked) runCompanion(); else { stopCompanion && stopCompanion(); stopCompanion = null; drawNext(); } };
    if (lastAlert) showAlert(lastAlert);
  }
  function runCompanion() {
    if (stopCompanion) return;
    askNotify();
    stopCompanion = startCompanion(id, D, {
      onUpdate: r => { drawNext(); if (r.event && $("#tb")) drawTab(); },
      onAlert: a => { lastAlert = a; showAlert(a); },
      onStatus: m => { const el = $("#compMsg"); if (el) el.textContent = m; },
    });
    clearInterval(nsTimer); nsTimer = setInterval(drawNext, 60000);
    drawNext();
  }
  function showAlert(a) {
    const box = $("#alertBox"); if (!box) return;
    box.innerHTML = `<div class="alertbar ${a.kind === "late" ? "late" : ""}"><span style="font-size:22px">${a.kind === "lunch" ? "🍛" : a.kind === "late" ? "⛔" : "⏰"}</span><div class="grow"><b>${esc(a.title)}</b> ${esc(a.text)}</div>${a.kind === "late" ? `<button class="btn small" id="alGo">Re-plan</button>` : ""}<button class="icon-btn" id="alX" aria-label="Dismiss">×</button></div>`;
    $("#alX").onclick = () => { lastAlert = null; box.innerHTML = ""; };
    if ($("#alGo")) $("#alGo").onclick = () => { tab = "live"; $$("[data-tab]").forEach(x => x.setAttribute("aria-selected", x.dataset.tab === "live")); drawTab(); };
  }

  function drawMore(m) {
    const d = D();
    m.innerHTML = `<div class="row" style="align-items:flex-end">
      <div><label class="f" style="margin-top:0">Rename</label><input id="nn" type="text" value="${esc(t.title)}" style="width:240px"></div><button class="btn small" id="ren">Save</button>
      <div><label class="f" style="margin-top:0">Change pace</label><select id="np" style="width:auto">${["fast", "balanced", "slow", "auto"].map(v => `<option value="${v}" ${(d.input.pace || "balanced") === v ? "selected" : ""}>${v === "auto" ? "Let Raahi decide" : v[0].toUpperCase() + v.slice(1)}</option>`).join("")}</select></div><button class="btn small" id="rp">Re-plan</button>
      <span class="grow"></span><button class="btn small ghost" id="del" style="color:var(--bad);border-color:var(--bad)">Delete trip</button></div>
      <div style="margin-top:12px"><label class="f" style="margin-top:0">Change where you're staying${d.input.segments.length > 1 ? ` in ${esc(city(0))}` : ""}</label><div id="nst"></div></div>`;
    const ps = placeSearch({ placeholder: "Hotel, area or Google Maps link", value: d.input.segments[0].stay, bias: d.input.segments[0].destination, allowHere: true, onPick: async v => { try { t = await api(`/api/trips/${id}/replan`, { stay: v, seg: 0 }); toast("Re-planned from your new stay"); main(); } catch (e) { toast(e.message, true); } } });
    $("#nst", m).appendChild(ps.el);
    $("#ren", m).onclick = async () => { t = await api(`/api/trips/${id}`, { title: $("#nn", m).value }, { method: "PATCH" }); $("#ttl").textContent = t.title; toast("Renamed"); };
    $("#rp", m).onclick = async e => { busy(e.currentTarget, true, "Re-planning…"); try { t = await api(`/api/trips/${id}/replan`, { pace: $("#np", m).value }); toast("Re-planned"); main(); } catch (err) { toast(err.message, true); busy(e.currentTarget, false); } };
    let armed = false;
    $("#del", m).onclick = async e => { if (!armed) { armed = true; e.currentTarget.textContent = "Tap again to delete"; return; } await api(`/api/trips/${id}`, {}, { method: "DELETE" }); toast("Trip deleted"); location.hash = "#/"; };
  }

  function drawTab() {
    clearInterval(clockTimer);
    const box = $("#tb");
    if (tab === "live") return drawLive(box);
    if (tab === "budget") return drawBudget(box);
    if (tab === "info") return drawInfo(box);
    return drawPlan(box);
  }

  // ---------- plan tab ----------
  function dayButtons(sel, onPick) {
    const d = D();
    return `<div class="days" role="tablist">${d.days.map((x, i) => `<button role="tab" data-day="${i}" aria-selected="${i === sel}"><b>Day ${i + 1}${x.date === todayISO() ? " · today" : ""}</b><small class="mute">${x.date ? esc(dayName(x.date)) : esc(city(x.seg))}${x.weather ? " " + x.weather.icon : ""}</small></button>`).join("")}</div>`;
  }
  function drawPlan(box) {
    const d = D(), x = d.days[day];
    if (!x) { box.innerHTML = `<p class="mute">No days planned.</p>`; return; }
    const visits = x.items.filter(i => i.type === "visit");
    const tix = visits.reduce((a, i) => a + (num(P(i.id).ticket && P(i.id).ticket.indian) || 0), 0);
    box.innerHTML = `
      ${dayButtons(day)}
      <div class="between" style="margin:6px 0 10px">
        <div><h2 style="margin:0">Day ${day + 1}${x.date ? " · " + esc(longDate(x.date)) : ""}</h2>
          <div class="mute" style="font-size:14px">${esc(city(x.seg))}${x.weather ? ` · <span class="wx">${x.weather.icon} ${esc(x.weather.text)} ${x.weather.max}°/${x.weather.min}° · ${x.weather.rain ?? 0}% rain · sunset ${esc(x.weather.sunset)}</span>` : ""}</div></div>
      </div>
      ${x.note ? `<div class="note" style="margin-bottom:10px">🧳 ${esc(x.note)}</div>` : ""}
      ${x.stayGuessed && !shared ? `<div class="note warn no-print" style="margin-bottom:10px">No stay given, so days start and end in the city centre. Add your hotel under ⋯ for exact times.</div>` : ""}
      <div class="row" style="gap:6px;margin-bottom:12px">
        <span class="tag">${visits.length} place${visits.length === 1 ? "" : "s"}</span><span class="tag">🚗 ${dur(x.travel)} · ${km(x.km)}</span>
        ${x.finish ? `<span class="tag">Back by ${hhmm(x.finish)}</span>` : ""}${tix ? `<span class="tag">🎟️ ~${inr(tix * d.input.travellers)} tickets</span>` : ""}
      </div>
      <div class="row no-print" style="margin-bottom:14px">
        ${(x.maps || []).map((u, k, a) => `<a class="btn small main" href="${esc(u)}" target="_blank" rel="noopener">Open day in Google Maps${a.length > 1 ? ` (${k + 1}/${a.length})` : ""}</a>`).join("")}
        ${!shared && visits.length ? `<button class="btn small" id="pulse">🔥 Check crowds & news</button>` : ""}
        ${!shared && visits.length && state.config.tinyfish ? `<button class="btn small" id="vfAll">🔎 Check all live on Google Maps</button>` : ""}
      </div>
      ${shared ? "" : rainBanner(x)}
      <div id="rainBox"></div>
      ${shared ? "" : foodPrompt(x, day)}
      ${timeline(x, day)}
      ${recapCard(x, day)}
      ${souvenirCard(x, day)}
      ${shared ? "" : `<div class="card no-print" style="margin-top:16px"><h3>Add a place</h3><div class="row" style="align-items:flex-start"><div class="grow" id="addPs"></div><select id="addDay" style="width:auto">${d.days.map((_, i) => `<option value="${i}" ${i === day ? "selected" : ""}>Day ${i + 1}</option>`).join("")}<option value="">Any day</option></select><button class="btn" id="addGo">Add</button></div></div>`}
      ${ideas()}`;
    $$("[data-day]", box).forEach(b => (b.onclick = () => { day = +b.dataset.day; drawPlan(box); }));
    wireTimeline(box, x);
    if ($("#pulse", box)) $("#pulse", box).onclick = e => runPulse(e.currentTarget, visits.map(i => i.id), () => drawPlan(box));
    if ($("#vfAll", box)) $("#vfAll", box).onclick = () => startVerify(visits.filter(i => !P(i.id).food).map(i => i.id).slice(0, 6));
    wireFood(box);
    if ($("#rainGo", box)) $("#rainGo", box).onclick = e => runRain(e.currentTarget, box, day);
    if (!shared) {
      const ps = placeSearch({ placeholder: "Any place, or paste a Google Maps link", bias: () => d.input.segments[x.seg].destination });
      $("#addPs", box).appendChild(ps.el);
      $("#addGo", box).onclick = async e => {
        const v = ps.get(); if (!v || !v.label) return ps.error("Type a place first.");
        busy(e.currentTarget, true, "Adding…");
        try { t = await api(`/api/trips/${id}/places`, { ...v, name: v.label, seg: x.seg, day: $("#addDay", box).value }); toast("Added and re-planned"); drawPlan(box); } catch (err) { toast(err.message, true); busy(e.currentTarget, false); }
      };
      $$("[data-addidea]", box).forEach(b => (b.onclick = async () => {
        const dd = $(`select[data-ideaday="${b.dataset.addidea}"]`, box).value;
        busy(b, true, "Adding…");
        try { t = await api(`/api/trips/${id}/replan`, dd === "" ? { restore: [b.dataset.addidea] } : { pin: { id: b.dataset.addidea, day: +dd } }); toast("Re-planned"); drawPlan(box); } catch (err) { toast(err.message, true); busy(b, false); }
      }));
    }
    drawMapDay(x);
  }

  function timeline(x, di, { items = x.items, from = x.from, to = x.to, start = x.start, finish = x.finish, back = x.back, compact = false } = {}) {
    const d = D();
    let n = 0;
    const live = !shared && x.date === todayISO();
    let h = `<ol class="tl"><li><span class="dot home">🏨</span><div class="stop"><div class="mute" style="padding-top:14px"><b style="color:var(--ink)">${hhmm(start)}</b> Leave ${esc((from && from.label) || "your stay")}</div></div></li>`;
    for (const it of items) {
      if (it.type === "meal") {
        const m = x.meals && x.meals.lunch || [];
        h += `<li><span class="dot meal">🍽️</span><div class="stop"><div class="card" style="padding:12px 14px"><div class="time">${hhmm(it.start)} – ${hhmm(it.end)}</div><b>Lunch break</b>${!compact && m.length ? `<div class="rest">${m.map(r => restLink(r, x.seg)).join("")}</div>` : ""}${!compact ? famous(x.seg) : ""}</div></div></li>`;
        continue;
      }
      n++;
      const p = P(it.id), c = d.checkins[it.id] || {}, pu = d.pulse && d.pulse[it.id];
      h += `<li><div class="leg">🚗 ${dur(it.travel)}${it.km ? " · " + km(it.km) : ""}</div></li>
        <li class="stop-li" data-pid="${it.id}"><span class="dot ${c.done ? "done" : ""}">${c.done ? "✓" : n}</span><div class="stop ${c.done || c.skipped ? "done" : ""}"><div class="card">
          <div class="between"><span class="time">${hhmm(it.start)} – ${hhmm(it.end)} <small class="mute" style="font-weight:600">(${dur(it.end - it.start)})</small></span>
            <span class="row" style="gap:4px">${p.rating ? `<span class="score ${scoreClass(p.rating)}" title="What visitors usually rate it">★ ${p.rating.toFixed(1)}<small>/10</small></span>` : ""}${pu && pu.score != null ? `<span class="score ${scoreClass(pu.score)}" title="Go-now score from the past week">🔥 ${(+pu.score).toFixed(1)}<small>/10</small></span>` : ""}</span></div>
          <div class="name">${CAT_ICON[p.category] || "📍"} ${esc(p.name)}</div>
          ${c.done ? `<span class="tag good">Visited ${new Date(c.done).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>` : c.skipped ? `<span class="tag">Skipped</span>` : c.arrived ? `<span class="tag warn">You're here since ${new Date(c.arrived).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>` : ""}
          ${it.start - it.arrive > 10 ? `<div class="help">Arrive ~${hhmm(it.arrive)}, opens ${hhmm(it.start)}</div>` : ""}
          ${it.short ? `<div class="help" style="color:var(--warn)">⚠️ Less than the ideal ${dur(p.userVisit || p.visitMin)} here, because it closes soon after.</div>` : ""}
          ${compact ? "" : `
          ${p.why ? `<div class="mute" style="font-size:14px;margin-top:4px">${esc(p.why)}</div>` : ""}
          <div class="facts">
            <div>🕰️ <span>${esc(p.hoursDesc || "Hours not known")}${p.hoursSource ? ` <small class="mute">(${esc(p.hoursSource)})</small>` : ""}</span></div>
            ${p.ticket && (p.ticket.indian || p.ticket.foreigner) ? `<div>🎟️ <span>${esc([p.ticket.indian && "Indians " + p.ticket.indian, p.ticket.foreigner && "Foreigners " + p.ticket.foreigner].filter(Boolean).join(" · "))}${p.ticket.note ? ` <small class="mute">${esc(p.ticket.note)}</small>` : ""}</span></div>` : ""}
            <div>⏱️ <span>Ideal time: ${dur(p.userVisit || p.visitMin)}</span></div>
            ${p.bestTimeOfDay ? `<div>🌅 <span>Best: ${esc(p.bestTimeOfDay)}</span></div>` : ""}
            ${it.skipSaves ? `<div>✂️ <span>Skip it: save ${dur(it.skipSaves)}${it.skipKm ? `, ${km(it.skipKm)}` : ""}</span></div>` : ""}
          </div>
          ${p.food ? `<div class="pulse go" style="margin-top:8px">😋 <b>${esc(p.food.dish)}</b>${p.food.price ? ` · ${esc(p.food.price)}` : ""}${p.food.tip ? `<br>💡 ${esc(p.food.tip)}` : ""}</div>` : p.nearbyFood ? `<div class="help" style="margin-top:6px">🍴 Nearby: ${esc(p.nearbyFood)}</div>` : ""}
          ${verifiedBox(it.id)}
          ${p.hoursNote ? `<div class="help">${esc(p.hoursNote)}</div>` : ""}
          ${pu ? pulseBox(pu) : ""}
          ${p.babyNote ? `<div class="note" style="margin-top:6px">👶 ${esc(p.babyNote)}</div>` : ""}
          ${(p.highlights && p.highlights.length) || p.tips ? `<details><summary>Highlights & tips</summary>${p.highlights && p.highlights.length ? `<ul style="margin:6px 0;padding-left:18px">${p.highlights.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${p.tips ? `<p style="margin:4px 0">💡 ${esc(p.tips)}</p>` : ""}${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener">Official website</a>` : ""}</details>` : ""}`}
          <div class="acts no-print">
            <a class="btn small ghost" href="${esc(gmapsGo(p.lat, p.lng, p.approx ? `${p.lat},${p.lng}` : `${p.name}, ${city(p.seg)}`))}" target="_blank" rel="noopener">Navigate</a>
            <a class="btn small ghost" href="${esc(gmapsPlace(`${p.name}, ${city(p.seg)}`))}" target="_blank" rel="noopener">Reviews & photos</a>
            ${!shared && state.config.tinyfish && !compact ? `<button class="btn small ghost vf" title="TinyFish opens it on Google Maps right now">🔎 Check live</button>` : ""}
            ${shared ? "" : `${live || tab === "live" ? (c.done ? `<button class="btn small ghost" data-ci="undo">Undo</button>` : `${c.arrived ? "" : `<button class="btn small" data-ci="arrived">📍 I'm here</button>`}<button class="btn small main" data-ci="done">✓ Done</button><button class="btn small ghost" data-ci="skipped">Skip</button>`) : ""}
            ${compact ? "" : `<select class="btn small ghost mv" aria-label="Move to another day" style="width:auto"><option value="">Move…</option>${D().days.map((_, i) => (i === di ? "" : `<option value="${i}">to Day ${i + 1}</option>`)).join("")}</select>
            <select class="btn small ghost tm" aria-label="Change time spent" style="width:auto"><option value="">Time…</option>${[20, 30, 45, 60, 90, 120, 150, 180, 240].map(m => `<option value="${m}">${dur(m)}</option>`).join("")}</select>
            <button class="btn small ghost rm">Remove</button>`}`}
          </div>
        </div></div></li>`;
    }
    h += `<li><div class="leg">🚗 ${dur(back)} back</div></li><li><span class="dot home">🏨</span><div class="stop"><div class="mute" style="padding-top:14px"><b style="color:var(--ink)">~${hhmm(finish)}</b> Back at ${esc((to && to.label) || "your stay")}</div>
      ${!compact && x.meals && x.meals.dinner && x.meals.dinner.length ? `<div class="card" style="padding:12px 14px;margin-top:8px"><b>🌙 Dinner near your stay</b><div class="rest">${x.meals.dinner.map(r => restLink(r, x.seg)).join("")}</div></div>` : ""}</div></li></ol>`;
    return h;
  }
  function restLink(r, seg) {
    return `<a href="${esc(gmapsPlace(`${r.name}, ${city(seg)}`))}" target="_blank" rel="noopener"><span><b>${esc(r.name)}</b> ${r.veg === "pure-veg" ? `<span class="tag good">Pure veg</span>` : r.veg ? `<span class="tag good">Veg options</span>` : ""}<br><small class="mute">${esc(r.cuisine || "Restaurant")}</small></span><small class="mute">${r.distance < 1000 ? r.distance + " m" : (r.distance / 1000).toFixed(1) + " km"}</small></a>`;
  }
  function famous(seg) {
    const info = D().info[seg] || {}, diet = (D().input.diet || "").toLowerCase();
    let list = info.restaurants || [];
    if (/veg|jain/.test(diet) && !/non/.test(diet)) list = list.filter(r => r.veg !== "non-veg");
    if (!list.length) return "";
    return `<details style="margin-top:6px"><summary>Well-known places to eat in ${esc(city(seg))}</summary>${list.slice(0, 5).map(r => `<div style="margin:6px 0"><a href="${esc(gmapsPlace(`${r.name}, ${r.area || city(seg)}`))}" target="_blank" rel="noopener"><b>${esc(r.name)}</b></a> <small class="mute">${esc(r.area || "")} · ${esc(r.price || "")}</small>${r.veg === "pure-veg" ? ` <span class="tag good">Pure veg</span>` : ""}<br><small>${esc(r.famousFor || "")}</small></div>`).join("")}</details>`;
  }
  // What TinyFish's browser agent read on Google Maps.
  function verifiedBox(pid) {
    const v = D().verified && D().verified[pid], st = verifyState[pid];
    if (st && st.status === "running") return `<div class="pulse caution" style="margin-top:8px"><span class="spin" style="display:inline-block;width:12px;height:12px;vertical-align:middle"></span> TinyFish is checking Google Maps… <small class="mute">${esc(st.step || "")}</small></div>`;
    if (st && st.status === "error") return `<div class="pulse avoid" style="margin-top:8px">Live check failed: ${esc(st.error || "")}</div>`;
    if (!v) return "";
    if (!v.found) return `<div class="pulse caution" style="margin-top:8px">TinyFish couldn't find it on Google Maps.</div>`;
    const isToday = v.date === todayISO();
    const closed = /closed/i.test(v.status) && !/closes soon/i.test(v.status);
    const cls = closed ? "avoid" : /busier|as busy/i.test(v.busyNow) || (v.last5 && v.last5.avg < 3.5) ? "caution" : "go";
    return `<div class="pulse ${cls}" style="margin-top:8px">
      <b>🔎 Live on Google Maps</b> <small class="mute">${new Date(v.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · via TinyFish</small><br>
      ${v.status ? `${closed ? "⛔" : "🟢"} ${esc(v.status)}` : ""}${v.hoursToday ? ` · ${isToday ? "Today" : "That day"}: ${esc(v.hoursToday)}` : ""}${v.busyNow ? ` · 👥 ${esc(v.busyNow)}` : ""}${v.fee ? ` · 🎟️ ${esc(v.fee)}` : ""}
      ${v.last5 ? `<br><b>Last 5 days: ${v.last5.avg}★</b> from ${v.last5.count} review${v.last5.count > 1 ? "s" : ""}${v.rating ? ` <small class="mute">(overall ${v.rating}★${v.reviewCount ? `, ${Number(v.reviewCount).toLocaleString("en-IN")} reviews` : ""})</small>` : ""}` : v.rating ? `<br>${v.rating}★ overall · no reviews in the last 5 days` : ""}
      ${v.reviews && v.reviews.length ? `<details style="margin-top:4px"><summary>Newest reviews</summary>${v.reviews.slice(0, 6).map(r => `<div style="margin:4px 0">${r.stars ? "★".repeat(Math.round(r.stars)) : ""} <small class="mute">${esc(r.when)}</small> ${esc(r.summary)}</div>`).join("")}</details>` : ""}
      ${v.official && (v.official.ticket || v.official.hours || v.official.notice) ? `<div style="margin-top:4px">🏛️ <b>Official site:</b> ${esc([v.official.hours, v.official.ticket, v.official.notice].filter(Boolean).join(" · "))} <a href="${esc(v.official.url)}" target="_blank" rel="noopener">source</a></div>` : ""}
    </div>`;
  }
  function pulseBox(pu) {
    const when = pu.at ? new Date(pu.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
    return `<div class="pulse ${esc(pu.verdict || "go")}"><b>${pu.verdict === "avoid" ? "⛔ Better to skip right now" : pu.verdict === "caution" ? "⚠️ Go with care" : "✅ Looks fine to go"}</b>${pu.crowd && pu.crowd !== "unknown" ? ` · crowd: ${esc(pu.crowd)}` : ""}<br>${esc(pu.summary || "")}
      ${pu.alerts && pu.alerts.length ? `<ul style="margin:4px 0;padding-left:18px">${pu.alerts.map(a => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
      ${pu.via === "TinyFish" && pu.sources && pu.sources.length ? `<details style="margin-top:4px"><summary>What people posted this week (${pu.sources.length})</summary>${pu.sources.map(s => `<div style="margin:4px 0"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.headline || s.title)}</a> <small class="mute">${esc(s.title)}</small></div>`).join("")}</details>` : ""}
      <small class="mute">${pu.recent ? "From the past week" : "Nothing recent found"} · checked ${esc(when)}${pu.via ? " · via " + esc(pu.via) : ""}${pu.via !== "TinyFish" && pu.sources && pu.sources.length ? " · " + pu.sources.slice(0, 3).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(", ") : ""}</small></div>`;
  }
  // ---------- rain plan ----------
  function rainBanner(x) {
    if (!x.date) return "";
    const max = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
    if (x.date < todayISO() || x.date > max) return "";
    const wet = x.weather && x.weather.rain >= 50;
    return `<div class="${wet ? "alertbar" : "row"} no-print" style="${wet ? "" : "margin-bottom:12px"}">${wet ? `<span style="font-size:22px">🌧️</span><div class="grow"><b>Rain likely (${x.weather.rain}%)</b> Want Raahi to move outdoor stops to the dry hours?</div>` : ""}<button class="btn small ${wet ? "main" : "ghost"}" id="rainGo">🌧️ ${wet ? "Make a rain plan" : "Check rain plan"}</button></div>`;
  }
  async function runRain(btn, box, di) {
    busy(btn, true, "Checking hourly rain…");
    try {
      const r = await api(`/api/trips/${id}/rainplan`, { day: di, date: todayISO(), nowMin: nowMin() });
      const rb = $("#rainBox", box);
      if (!r.items) { rb.innerHTML = `<div class="note" style="margin-bottom:12px">☀️ ${esc(r.text)}</div>`; busy(btn, false); return; }
      rb.innerHTML = `<div class="card" style="margin-bottom:14px;border-color:#2b6cb0"><div class="between"><h3 style="margin:0">🌧️ Rain plan</h3><button class="btn small main" id="rainUse" style="background:#2b6cb0;border-color:#2b6cb0">Use rain plan</button></div>
        <p class="help">${esc(r.text)} Outdoor stops move to the dry hours; indoor ones go into the rain.</p>
        <div class="list" style="gap:6px">${r.moves.map(m => `<div style="font-size:14px">${m.wet ? "⚠️" : "✅"} <b>${esc(m.name)}</b>: ${hhmm(m.from)} → <b>${hhmm(m.to)}</b>${m.wet ? " (still during rain: no dry slot)" : ""}</div>`).join("")}</div>
        ${r.dropped.length ? `<p class="help">Doesn't fit any more: ${esc(r.dropped.map(z => z.name).join(", "))}</p>` : ""}</div>`;
      $("#rainUse", rb).onclick = async e => { busy(e.currentTarget, true, "Saving…"); try { t = await api(`/api/trips/${id}/today`, { day: di, items: r.items }); toast("Rain plan applied"); drawTab(); } catch (err) { toast(err.message, true); busy(e.currentTarget, false); } };
    } catch (e) { toast(e.message, true); }
    busy(btn, false);
  }

  // ---------- day recap ----------
  function recapCard(x, di) {
    const d = D(), ck = d.checkins || {};
    const visits = x.items.filter(i => i.type === "visit");
    const done = visits.filter(i => ck[i.id] && ck[i.id].done);
    const isPast = x.date && x.date < todayISO();
    const allDone = visits.length && visits.every(i => ck[i.id] && (ck[i.id].done || ck[i.id].skipped));
    if (!done.length || !(isPast || allDone || (x.date === todayISO() && nowMin() > x.end - 30))) return "";
    const km2 = done.reduce((a, i) => a + (i.km || 0), 0) + (x.back ? 0 : 0);
    const stay = done.map(i => ({ n: P(i.id).name, m: (ck[i.id].done - ck[i.id].arrived) / 60000 })).sort((a, b) => b.m - a.m)[0];
    const spent = (d.expenses || []).filter(e => e.day === di || (x.date && new Date(e.at).toISOString().slice(0, 10) === x.date)).reduce((a, e) => a + e.amount, 0);
    const tm = d.days[di + 1], first = tm && tm.items.find(i => i.type === "visit");
    const sv = (!tm || tm.seg !== x.seg) && (d.info[x.seg] || {}).souvenirs;
    return `<div class="recap"><div class="ns-k" style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#e9a23b">🌙 YOUR DAY ${di + 1} RECAP</div>
      <div class="big">${done.length} place${done.length > 1 ? "s" : ""} · ${km(km2)}${spent ? ` · ${inr(spent)}` : ""}</div>
      ${stay && stay.m > 0 ? `<small>Longest stop: ${esc(stay.n)}, ${dur(stay.m)}</small><br>` : ""}
      ${first ? `<small>Tomorrow: leave ${hhmm(first.start - first.travel)} for ${esc(P(first.id).name)}</small><br>` : ""}
      ${sv && sv.length ? `<small style="color:#f6d9a8">🎁 Don't forget: ${esc(sv[0].item)}${sv[0].where ? " from " + esc(sv[0].where) : ""}</small>` : ""}</div>`;
  }

  // "Famous here: Malaiyyo at Blue Lassi Shop, ₹80. Want it?"
  function foodPrompt(x, di) {
    const list = ((D().info[x.seg] || {}).foodStops || []).map((f, k) => ({ ...f, k })).filter(f => !f.added && !f.dismissed);
    const veg = /veg|jain/i.test(D().input.diet) && !/non/i.test(D().input.diet);
    const fit = list.filter(f => !veg || f.veg !== false);
    if (!fit.length) return "";
    const f = fit[di % fit.length];
    return `<div class="card no-print" style="margin-bottom:14px;border-color:var(--saffron)">
      <div class="between"><div><span class="tag warn">😋 Famous in ${esc(city(x.seg))}</span>
        <h3 style="margin:8px 0 2px">${esc(f.dish)} at ${esc(f.shop)}</h3>
        <div class="mute" style="font-size:14px">${esc(f.area || "")}${f.price ? ` · <b style="color:var(--ink)">${esc(f.price)}</b>` : ""}${f.when && f.when !== "any" ? ` · best for ${esc(f.when)}` : ""} ${f.veg === false ? `<span class="tag">non-veg</span>` : `<span class="tag good">veg</span>`}</div>
        ${f.tip ? `<p style="margin:6px 0 0">💡 ${esc(f.tip)}</p>` : ""}</div></div>
      <p style="margin:10px 0 6px;font-weight:600">Want to have it? Raahi will fit it in at the right time.</p>
      <div class="row"><button class="btn small main" data-food="${f.k}" data-fday="${di}">Yes, add to Day ${di + 1}</button><button class="btn small ghost" data-nofood="${f.k}">No thanks</button>${fit.length > 1 ? `<button class="btn small decide" data-fdecide="${di}">✨ Let Raahi pick a food stop</button>` : ""}</div></div>`;
  }
  function wireFood(box) {
    const x = D().days[day];
    $$("[data-food]", box).forEach(b => (b.onclick = async () => { busy(b, true, "Adding…"); try { t = await api(`/api/trips/${id}/food`, { seg: x.seg, index: +b.dataset.food, day: b.dataset.fday === "" ? "" : +b.dataset.fday }); toast("Added to your plan 😋"); drawTab(); } catch (e) { toast(e.message, true); busy(b, false); } }));
    $$("[data-nofood]", box).forEach(b => (b.onclick = async () => { try { t = await api(`/api/trips/${id}/food/dismiss`, { seg: x.seg, index: +b.dataset.nofood }); drawTab(); } catch (e) { toast(e.message, true); } }));
    $$("[data-fdecide]", box).forEach(b => (b.onclick = async () => { busy(b, true, "Raahi is choosing…"); try { t = await api(`/api/trips/${id}/food`, { seg: x.seg, decide: true, day: +b.dataset.fdecide }); toast("Raahi added a food stop 😋"); drawTab(); } catch (e) { toast(e.message, true); busy(b, false); } }));
  }
  // On the last day in a city: what to bring back.
  function souvenirCard(x, di) {
    const next = D().days[di + 1];
    if (next && next.seg === x.seg) return "";
    const sv = (D().info[x.seg] || {}).souvenirs || [];
    if (!sv.length) return "";
    return `<div class="card" style="margin-top:14px"><h3>🎁 Before you leave ${esc(city(x.seg))}, bring back</h3>${sv.slice(0, 4).map(v => `<div style="margin:6px 0"><b>${esc(v.item)}</b>${v.price ? ` · ${esc(v.price)}` : ""}<br><small class="mute">📍 ${esc(v.where || "")}${v.tip ? " · " + esc(v.tip) : ""}</small></div>`).join("")}</div>`;
  }
  function ideas() {
    const d = D(), x = d.days[day];
    const dropped = d.dropped.filter(r => r.seg === x.seg && d.places[r.id]);
    const removed = Object.values(d.places).filter(p => p.seg === x.seg && !p.selected && !dropped.some(r => r.id === p.id));
    if (!dropped.length && !removed.length) return "";
    const row = (p, why) => `<div class="card" style="padding:12px 14px"><div class="between"><div><b>${CAT_ICON[p.category] || "📍"} ${esc(p.name)}</b> ${p.rating ? `<span class="score ${scoreClass(p.rating)}">${p.rating.toFixed(1)}<small>/10</small></span>` : ""}<div class="help" style="margin:0">${esc(why)} · ${esc(p.hoursDesc || "")} · ${dur(p.visitMin)}</div></div>
      ${shared ? "" : `<div class="row" style="gap:6px"><select data-ideaday="${p.id}" style="width:auto;min-height:34px;padding:4px 8px">${d.days.map((dd, i) => (dd.seg === p.seg ? `<option value="${i}" ${i === day ? "selected" : ""}>Day ${i + 1}</option>` : "")).join("")}<option value="">Any day</option></select><button class="btn small" data-addidea="${p.id}">Add</button></div>`}</div></div>`;
    return `<h3 style="margin-top:22px">More ideas in ${esc(city(x.seg))}</h3><p class="help">These didn't fit. Add one and Raahi re-plans; something else may move to make room.</p><div class="list">${dropped.map(r => row(d.places[r.id], REASON[r.reason] || "Didn't fit")).join("")}${removed.map(p => row(p, "Not picked")).join("")}</div>`;
  }

  function wireTimeline(box, x) {
    $$(".stop-li", box).forEach(li => {
      const pid = li.dataset.pid;
      li.addEventListener("click", e => { if (e.target.closest("button,a,select,summary")) return; flyTo(pid); });
      $$("[data-ci]", li).forEach(b => (b.onclick = async () => {
        try { const r = await api(`/api/trips/${id}/checkin`, { placeId: pid, state: b.dataset.ci }); D().checkins = r.checkins; toast(b.dataset.ci === "done" ? `Done: ${P(pid).name}` : b.dataset.ci === "arrived" ? "Checked in. Enjoy!" : b.dataset.ci === "skipped" ? "Skipped" : "Undone"); drawTab(); } catch (e) { toast(e.message, true); }
      }));
      const vf = $(".vf", li);
      if (vf) vf.onclick = () => startVerify([pid]);
      const mv = $(".mv", li), tm = $(".tm", li), rm = $(".rm", li);
      if (mv) mv.onchange = async () => { if (mv.value === "") return; try { t = await api(`/api/trips/${id}/replan`, { pin: { id: pid, day: +mv.value } }); toast(`Moved to Day ${+mv.value + 1}`); drawTab(); } catch (e) { toast(e.message, true); } };
      if (tm) tm.onchange = async () => { if (tm.value === "") return; try { t = await api(`/api/trips/${id}/replan`, { visit: { id: pid, min: +tm.value } }); toast("Time changed, re-planned"); drawTab(); } catch (e) { toast(e.message, true); } };
      if (rm) rm.onclick = async () => { busy(rm, true, ""); try { t = await api(`/api/trips/${id}/replan`, { remove: [pid] }); toast(`Removed ${P(pid).name}. Re-planned.`); drawTab(); } catch (e) { toast(e.message, true); busy(rm, false); } };
    });
  }

  const verifyState = {};
  // Live checks Raahi started by itself after planning: show their progress and results.
  function resumeAutoVerify() {
    const av = D().autoVerify;
    if (!av || shared || Date.now() - av.at > 10 * 60e3) return;
    const ids = av.ids.filter(pid => !(D().verified || {})[pid]);
    if (!ids.length) return;
    api(`/api/trips/${id}/verify/status`, { placeIds: ids }).then(r => { Object.assign(verifyState, r.status); D().verified = r.verified; if ($("#tb")) drawTab(); pollVerify(); }).catch(() => {});
  }
  async function startVerify(ids) {
    try {
      const r = await api(`/api/trips/${id}/verify`, { placeIds: ids });
      Object.assign(verifyState, r.status); D().verified = r.verified;
      toast("TinyFish is opening Google Maps. Results in about a minute.");
      drawTab(); pollVerify();
    } catch (e) { toast(e.message, true); }
  }
  function pollVerify() {
    clearTimeout(verifyTimer);
    if (!Object.values(verifyState).some(v => v.status === "running")) return;
    verifyTimer = setTimeout(async () => {
      try {
        const ids = Object.keys(verifyState).filter(k => verifyState[k].status === "running");
        const r = await api(`/api/trips/${id}/verify/status`, { placeIds: ids });
        const changed = ids.some(k => r.status[k] && r.status[k].status !== "running");
        Object.assign(verifyState, r.status); D().verified = r.verified;
        if (changed && $("#tb")) drawTab();
      } catch {}
      pollVerify();
    }, 4000);
  }
  async function runPulse(btn, ids, then) {
    if (!state.config.aiSearch) { toast("Live checks need the free AI key (see the README).", true); return; }
    busy(btn, true, "Searching the past week…");
    try { const r = await api(`/api/trips/${id}/pulse`, { placeIds: ids.slice(0, 10) }); Object.assign(D().pulse, r.pulse); then(); toast("Updated with the latest news and reviews"); }
    catch (e) { toast(e.message, true); busy(btn, false); }
  }

  // ---------- map ----------
  let markerById = {};
  async function drawMapDay(x, extra = []) {
    if (!map) return;
    layers.clearLayers(); markerById = {};
    const pts = [];
    if (x.from && x.from.lat != null) { L.marker([x.from.lat, x.from.lng], { icon: pinIcon("🏨", "home") }).bindTooltip(esc(x.from.label || "Start")).addTo(layers); pts.push(x.from); }
    let n = 0;
    for (const it of x.items) if (it.type === "visit") {
      const p = P(it.id); n++;
      const done = D().checkins[it.id] && D().checkins[it.id].done;
      markerById[it.id] = L.marker([p.lat, p.lng], { icon: pinIcon(done ? "✓" : n, done ? "done" : "") }).bindTooltip(`${n}. ${esc(p.name)} · ${hhmm(it.start)}`).addTo(layers);
      pts.push(p);
    }
    if (x.to && x.to.lat != null && (!x.from || x.to.lat !== x.from.lat)) { L.marker([x.to.lat, x.to.lng], { icon: pinIcon("🏨", "home") }).addTo(layers); }
    if (x.to && x.to.lat != null) pts.push(x.to);
    for (const e of extra) L.marker([e.lat, e.lng], { icon: pinIcon(e.label || "•", e.cls || "idea") }).bindTooltip(esc(e.name || "")).addTo(layers);
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])), { padding: [36, 36], maxZoom: 15 });
    else if (pts.length) map.setView([pts[0].lat, pts[0].lng], 13);
    if (pts.length > 1) {
      const key = pts.map(p => `${(+p.lat).toFixed(4)},${(+p.lng).toFixed(4)}`).join("|");
      try {
        const r = await api("/api/route/line", { points: pts.map(p => ({ lat: p.lat, lng: p.lng })) });
        if (layers && key === pts.map(p => `${(+p.lat).toFixed(4)},${(+p.lng).toFixed(4)}`).join("|")) L.polyline(r.geometry ? decode(r.geometry) : pts.map(p => [p.lat, p.lng]), { color: "#c8362f", weight: 4, opacity: 0.85, dashArray: r.geometry ? null : "6 8" }).addTo(layers);
      } catch {}
    }
  }
  function flyTo(pid) { const m = markerById[pid]; if (m && map) { map.flyTo(m.getLatLng(), 15, { duration: 0.5 }); m.openTooltip(); if (matchMedia("(max-width:980px)").matches) $("#map").scrollIntoView({ behavior: "smooth", block: "center" }); } }

  // ---------- live tab ----------
  function drawLive(box) {
    const d = D(), today = todayISO();
    let li = live.day != null ? live.day : d.days.findIndex(x => x.date === today);
    const onTrip = li >= 0 && d.days[li].date === today;
    if (li < 0) li = day;
    live.day = li;
    const x = d.days[li];
    const stops = x.items.filter(i => i.type === "visit");
    const demoBar = state.config.demo ? `<div class="card demo-ctl" style="margin-bottom:12px"><b>🎬 Demo controls</b> <span class="help">No GPS needed. Pick where you "are" and what time it "is".</span>
        <div class="row" style="margin-top:8px;gap:10px"><label class="row" style="gap:6px">📍 Pretend I'm at <select id="dPos" style="width:auto"><option value="">The hotel</option>${stops.map(i => `<option value="${i.id}" ${live.demoAt === i.id ? "selected" : ""}>${esc(P(i.id).name)}</option>`).join("")}</select></label>
        <label class="row" style="gap:6px">🕒 Pretend time <select id="dTime" style="width:auto"><option value="">Real time</option>${Array.from({ length: 31 }, (_, k) => 360 + k * 30).map(m => `<option value="${m}" ${live.demoNow === m ? "selected" : ""}>${hhmm(m)}</option>`).join("")}</select></label>
        ${stops.length ? `<button class="btn small" id="dArrive" type="button">✅ I've arrived here</button>` : ""}</div></div>` : "";
    box.innerHTML = `
      ${demoBar}
      ${onTrip ? "" : `<div class="note" style="margin-bottom:12px">${d.input.start ? `Your trip isn't today, so this is a preview of Day ${li + 1}.` : "No dates set, so this is a preview."} Live mode works best on the day itself.</div>`}
      ${dayButtons(li)}
      <div class="card" style="margin-bottom:14px">
        <div class="between"><div><div class="mute" style="font-size:13px;font-weight:600">RIGHT NOW</div><div class="clock" id="clk">${live.demoNow != null ? esc(hhmm(live.demoNow)) : esc(new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }))}</div></div>
          <div style="text-align:right"><div id="locMsg" class="help" style="margin:0 0 6px">${live.pos ? "📍 Using your location" : "Location not shared yet"}</div><button class="btn small" id="loc">📍 ${live.pos ? "Update location" : "Use my location"}</button></div></div>
        <label class="row" style="margin-top:10px;gap:8px;font-size:14px"><input type="checkbox" id="lunch" ${live.hadLunch ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--thread)"> I've already had lunch</label>
        <div class="row" style="margin-top:12px"><button class="btn main" id="chk">What's still possible today?</button>${state.config.tinyfish ? `<button class="btn" id="lvf">🔎 Check live on Google Maps</button>` : ""}${state.config.aiSearch ? `<button class="btn" id="lp">🔥 Crowds & news now</button>` : ""}</div>
      </div>
      <div id="lres"></div>
      <h3>Today's plan</h3>
      ${timeline(x, li)}`;
    clockTimer = setInterval(() => { const c = $("#clk"); if (c && live.demoNow == null) c.textContent = new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }); }, 20000);
    $$("[data-day]", box).forEach(b => (b.onclick = () => { live.day = +b.dataset.day; live.res = null; drawLive(box); }));
    wireTimeline(box, x);
    $("#lunch", box).onchange = e => (live.hadLunch = e.target.checked);
    if (state.config.demo) {
      const setAt = pid => { live.demoAt = pid || ""; const p = pid ? P(pid) : (x.from || d.input.segments[x.seg].destination); window.__demoPos = p && p.lat != null ? { lat: p.lat, lng: p.lng, acc: 10 } : null; live.pos = window.__demoPos; };
      if (live.demoAt !== undefined) setAt(live.demoAt); else setAt("");
      $("#dPos", box).onchange = e => { setAt(e.target.value); live.res = null; drawLive(box); };
      $("#dTime", box).onchange = e => { live.demoNow = e.target.value === "" ? null : +e.target.value; live.res = null; drawLive(box); };
      if ($("#dArrive", box)) $("#dArrive", box).onclick = async () => {
        const pid = live.demoAt || (stops.find(i => !(d.checkins[i.id] && d.checkins[i.id].done)) || {}).id;
        if (!pid) return toast("Pick a place first", true);
        try { const r = await api(`/api/trips/${id}/checkin`, { placeId: pid, state: "arrived" }); D().checkins = r.checkins; live.demoAt = pid; toast(`Checked in at ${P(pid).name}`); drawLive(box); drawNext(); } catch (err) { toast(err.message, true); }
      };
    }
    $("#loc", box).onclick = async e => { busy(e.currentTarget, true, "Locating…"); try { live.pos = await locate(); $("#locMsg").textContent = `📍 Got it (±${Math.round(live.pos.acc)} m)`; } catch (err) { $("#locMsg").textContent = err.message; } busy(e.currentTarget, false); };
    $("#chk", box).onclick = e => check(e.currentTarget, box, x, li, onTrip);
    if ($("#lvf", box)) $("#lvf", box).onclick = () => startVerify(x.items.filter(i => i.type === "visit" && !P(i.id).food && !(d.checkins[i.id] && d.checkins[i.id].done)).map(i => i.id).slice(0, 6));
    if ($("#lp", box)) $("#lp", box).onclick = e => runPulse(e.currentTarget, x.items.filter(i => i.type === "visit" && !(d.checkins[i.id] && d.checkins[i.id].done)).map(i => i.id), () => drawLive(box));
    if (live.res) showLive(box, x, li);
    drawMapDay(x, live.pos ? [{ ...live.pos, label: "•", cls: "me", name: "You are here" }] : []);
    if (!live.pos && onTrip) locate().then(p => { live.pos = p; const m = $("#locMsg"); if (m) m.textContent = "📍 Using your location"; }).catch(() => {});
  }
  async function check(btn, box, x, li, onTrip) {
    busy(btn, true, "Checking roads and opening times…");
    try {
      if (!live.pos) { try { live.pos = await locate(); } catch {} }
      const nm = live.demoNow != null ? live.demoNow : onTrip ? nowMin() : Math.max(x.start, nowMin());
      live.res = await api(`/api/trips/${id}/live`, { day: li, nowMin: nm, lat: live.pos && live.pos.lat, lng: live.pos && live.pos.lng, hadLunch: live.hadLunch });
      showLive(box, x, li);
    } catch (e) { toast(e.message, true); }
    busy(btn, false);
  }
  function showLive(box, x, li) {
    const r = live.res, out = $("#lres", box);
    if (!r.items.length) { out.innerHTML = `<div class="card" style="margin-bottom:14px">🎉 All of today's places are done. Enjoy the evening!</div>`; return; }
    const V = { ok: ["✅", "Go"], tight: ["⚠️", "Tight"], late: ["❌", "Too late"], toolate: ["❌", "Too late"], closed: ["❌", "Closed today"] };
    const line = f => {
      const [ic, word] = V[f.verdict] || ["", ""];
      const p = P(f.id);
      const why = f.verdict === "closed" ? "Closed today." : f.verdict === "late" || f.verdict === "toolate" ? `Closes ${hhmm(f.closesAt)}. You'd arrive ~${hhmm(f.arrive)}${f.available ? `, with only ${dur(f.available)} left` : ""}.` : `Arrive ~${hhmm(f.arrive)} (${dur(f.travel)} away)${f.opensAt ? `, opens ${hhmm(f.opensAt)}` : ""}${f.closesAt ? (f.closesAt >= 1439 ? ", open all day" : `, open till ${hhmm(f.closesAt)}`) : ""}. ${f.verdict === "tight" ? `You'd get ${dur(f.available)}, ideal is ${dur(p.userVisit || p.visitMin)}.` : ""}`;
      const vv = D().verified && D().verified[f.id];
      const live2 = vv && vv.date === todayISO() ? ` · 🔎 ${[vv.status, vv.busyNow, vv.last5 ? `last 5 days ${vv.last5.avg}★` : ""].filter(Boolean).join(", ")}` : "";
      return `<div class="card" style="padding:12px 14px"><div class="between"><div><span class="verdict ${f.verdict}">${ic} ${word}</span> · <b>${esc(f.name)}</b><div class="help" style="margin:2px 0 0">${esc(why)}${f.known === false ? " (hours not confirmed)" : ""}${esc(live2)}</div></div>
        <a class="btn small ghost" href="${esc(gmapsGo(p.lat, p.lng, `${p.name}, ${city(p.seg)}`))}" target="_blank" rel="noopener">Navigate</a></div></div>`;
    };
    const planned = r.items.filter(f => f.planned), spare = r.items.filter(f => !f.planned && f.verdict === "ok").sort((a, b) => a.travel - b.travel).slice(0, 4);
    const rp = r.replan;
    out.innerHTML = `
      <h3>Your remaining stops</h3><div class="list" style="margin-bottom:16px">${planned.map(line).join("") || `<p class="mute">None left.</p>`}</div>
      ${rp && rp.items.length ? `<div class="card" style="margin-bottom:16px;border-color:var(--thread)"><div class="between"><h3 style="margin:0">✨ Raahi's plan for the rest of today</h3><button class="btn small main" id="use">Let Raahi decide: use this</button></div>
        <p class="help">Starting now from ${live.pos ? "where you are" : "your last stop"}, back by ~${hhmm(rp.finish)}.${rp.dropped.length ? ` Doesn't fit any more: ${esc(rp.dropped.map(z => z.name).join(", "))}.` : ""}</p>
        ${timeline(x, li, { items: rp.items, start: r.nowMin, finish: rp.finish, back: 0, from: { label: live.pos ? "Where you are" : "Here" }, compact: true })}</div>` : ""}
      ${spare.length ? `<h3>Spare time? Still open nearby</h3><div class="list" style="margin-bottom:16px">${spare.map(line).join("")}</div>` : ""}
      ${r.estimated ? `<p class="help">Drive times are estimates (road service busy).</p>` : ""}`;
    if ($("#use", out)) $("#use", out).onclick = async e => { busy(e.currentTarget, true, "Saving…"); try { t = await api(`/api/trips/${id}/today`, { day: li, items: rp.items }); live.res = null; toast("Today's plan updated"); drawLive(box); } catch (err) { toast(err.message, true); busy(e.currentTarget, false); } };
    wireTimeline(out, x);
  }

  // ---------- budget tab ----------
  function drawBudget(box) {
    const d = D(), inp = d.input, n = inp.travellers;
    const est = { stay: 0, food: 0, localTransport: 0, tickets: 0 };
    inp.segments.forEach((s, si) => { const b = d.info[si] && d.info[si].budget && d.info[si].budget.perPersonPerDay; if (b) for (const k in est) est[k] += (+b[k] || 0) * s.days * n; });
    const planTix = d.days.reduce((a, x) => a + x.items.filter(i => i.type === "visit").reduce((s, i) => s + (num(P(i.id).ticket && P(i.id).ticket.indian) || 0), 0), 0) * n;
    if (planTix) est.tickets = planTix;
    const total = Object.values(est).reduce((a, b) => a + b, 0);
    const budget = inp.budget ? (inp.budget.per === "person" ? inp.budget.amount * n : inp.budget.amount) : null;
    const exp = d.expenses || [], spent = exp.reduce((a, e) => a + e.amount, 0);
    const people = d.people && d.people.length ? d.people : [];
    const cats = { food: "🍛 Food", stay: "🏨 Stay", transport: "🚗 Transport", tickets: "🎟️ Tickets", shopping: "🛍️ Shopping", other: "📦 Other" };
    box.innerHTML = `
      <div class="card" style="margin-bottom:14px"><h3>Estimated cost</h3>
        ${total ? `<dl class="kv"><dt>🏨 Stay</dt><dd>${inr(est.stay)}</dd><dt>🍛 Food</dt><dd>${inr(est.food)}</dd><dt>🚗 Local transport</dt><dd>${inr(est.localTransport)}</dd><dt>🎟️ Tickets${planTix ? " (from your plan)" : ""}</dt><dd>${inr(est.tickets)}</dd><dt><b>Total for ${n}</b></dt><dd><b>${inr(total)}</b> <small class="mute">(${inr(total / n)} per person)</small></dd></dl>
        ${budget ? `<div style="margin-top:12px"><div class="between" style="font-size:14px"><span>Your budget ${inr(budget)}</span><span class="${total > budget ? "err" : "ok"}" style="margin:0">${total > budget ? `About ${inr(total - budget)} over` : `About ${inr(budget - total)} to spare`}</span></div><div class="bar"><i class="${total > budget ? "over" : ""}" style="width:${Math.min(100, (total / budget) * 100)}%"></i></div></div>` : ""}
        <p class="help">${esc((d.info[0] && d.info[0].budget && d.info[0].budget.note) || "")} Rough guide; travel to the destination isn't included.</p>` : `<p class="mute">No estimate available${d.aiError ? " (AI was unavailable)" : ""}. Track what you spend below.</p>`}
      </div>
      <div class="card"><div class="between"><h3 style="margin:0">What you've spent</h3><b>${inr(spent)}${budget ? ` <small class="mute">of ${inr(budget)}</small>` : ""}</b></div>
        ${budget ? `<div class="bar" style="margin:8px 0"><i class="${spent > budget ? "over" : ""}" style="width:${Math.min(100, (spent / budget) * 100)}%"></i></div>` : ""}
        <form id="ex" class="row" style="margin:12px 0;align-items:flex-end">
          <div style="width:120px"><label class="f" style="margin-top:0" for="ea">Amount ₹</label><input id="ea" type="number" min="1" step="1" inputmode="decimal" required></div>
          <div class="grow" style="min-width:140px"><label class="f" style="margin-top:0" for="en">What for</label><input id="en" type="text" placeholder="e.g. Lunch at Pinch of Spice"></div>
          <div><label class="f" style="margin-top:0" for="ec">Type</label><select id="ec" style="width:auto">${Object.entries(cats).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
          ${people.length > 1 ? `<div><label class="f" style="margin-top:0" for="ep">Paid by</label><select id="ep" style="width:auto">${people.map(n => `<option>${esc(n)}</option>`).join("")}</select></div>` : ""}
          <button class="btn main">Add</button></form>
        <div class="list">${exp.slice().reverse().map(e => `<div class="between" style="padding:8px 0;border-bottom:1px solid var(--line)"><span>${cats[e.cat] ? cats[e.cat].split(" ")[0] : "📦"} ${esc(e.note || cats[e.cat] || "Expense")} <small class="mute">${new Date(e.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}${people.length > 1 ? " · paid by " + esc(e.paidBy || people[0]) : ""}</small></span><span class="row"><b>${inr(e.amount)}</b><button class="icon-btn" data-del="${e.id}" aria-label="Delete">×</button></span></div>`).join("") || `<p class="mute">Nothing yet.</p>`}</div>
        ${exp.length ? `<p class="help">${Object.entries(cats).map(([k, v]) => { const s = exp.filter(e => e.cat === k).reduce((a, e) => a + e.amount, 0); return s ? `${v}: ${inr(s)}` : ""; }).filter(Boolean).join(" · ")}</p>` : ""}
      </div>
      <div class="card" style="margin-top:14px"><div class="between"><h3 style="margin:0">💸 Split with your group</h3></div>
        <p class="help">Add everyone's name. Each expense is split equally, and Raahi works out the fewest payments to settle up.</p>
        <div class="row"><input type="text" id="pp" value="${esc(people.join(", "))}" placeholder="e.g. Pranav, Anshee" style="flex:1;min-width:200px"><button class="btn small" id="ppSave">Save names</button></div>
        <div id="settle" style="margin-top:12px"></div></div>`;
    $("#ppSave", box).onclick = async () => { try { const r = await api(`/api/trips/${id}/people`, { names: $("#pp", box).value.split(",") }, { method: "PUT" }); d.people = r.people; toast("Names saved"); drawBudget(box); } catch (e) { toast(e.message, true); } };
    if (people.length > 1) api(`/api/trips/${id}/settle`).then(st => {
      const el = $("#settle", box); if (!el) return;
      const lines = st.payments.map(x => `${x.from} pays ${x.to} ${inr(x.amount)}`);
      el.innerHTML = lines.length ? `<div class="list" style="gap:6px">${lines.map(l => `<div style="font-size:16px;font-weight:700">➡️ ${esc(l)}</div>`).join("")}</div><div class="row" style="margin-top:10px"><a class="btn small" style="background:#25D366;border-color:#25D366;color:#fff" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`${t.title}: settle up\n` + lines.join("\n") + `\nTotal spent ${inr(spent)}`)}">Send on WhatsApp</a></div>` : `<p class="ok" style="margin:0">✅ Everyone is settled up.</p>`;
    }).catch(() => {});
    $("#ex", box).onsubmit = async e => {
      e.preventDefault();
      try { const r = await api(`/api/trips/${id}/expenses`, { amount: +$("#ea", box).value, note: $("#en", box).value, cat: $("#ec", box).value, paidBy: $("#ep", box) ? $("#ep", box).value : undefined, day }); d.expenses = r.expenses; drawBudget(box); } catch (err) { toast(err.message, true); }
    };
    $$("[data-del]", box).forEach(b => (b.onclick = async () => { const r = await api(`/api/trips/${id}/expenses/${b.dataset.del}`, {}, { method: "DELETE" }); d.expenses = r.expenses; drawBudget(box); }));
    drawMapDay(d.days[day]);
  }

  // ---------- info tab ----------
  function drawInfo(box) {
    const d = D();
    const india = d.input.segments.some(s => (s.destination.country || "").toUpperCase() === "IN" || /india/i.test(s.destination.label));
    box.innerHTML = d.input.segments.map((s, si) => {
      const i = d.info[si] || {};
      return `<div class="card" style="margin-bottom:14px">
        <h2>${esc(city(si))}</h2>
        ${i.summary ? `<p>${esc(i.summary)}</p>` : ""}
        ${i.bestTime ? `<h3>🗓️ Best time to visit</h3><p><b>${esc(i.bestTime.months || "")}</b>. ${esc(i.bestTime.note || "")}${i.bestTime.forYourDates ? `<br><span class="tag">Your dates</span> ${esc(i.bestTime.forYourDates)}` : ""}</p>` : ""}
        ${i.idealDays ? `<p class="mute">Ideal stay: about ${esc(i.idealDays)} days. You have ${s.days}.</p>` : ""}
        ${i.transport ? `<h3>🚕 Getting around</h3><p>${esc(i.transport)}</p>` : ""}
        ${i.foodStops && i.foodStops.length ? `<h3>😋 Famous food & where to have it</h3><div class="list" style="gap:8px">${i.foodStops.map((f, k) => `<div class="between" style="padding:8px 10px;background:var(--soft);border-radius:10px"><div><b>${esc(f.dish)}</b> at ${esc(f.shop)} ${f.veg === false ? `<span class="tag">non-veg</span>` : `<span class="tag good">veg</span>`}<br><small class="mute">${esc(f.area || "")}${f.price ? " · " + esc(f.price) : ""}${f.when && f.when !== "any" ? " · " + esc(f.when) : ""}</small>${f.tip ? `<br><small>💡 ${esc(f.tip)}</small>` : ""}</div>${shared ? "" : f.added ? `<span class="tag good">In your plan</span>` : `<button class="btn small" data-infofood="${k}" data-seg="${si}">Add</button>`}</div>`).join("")}</div>` : i.food && i.food.length ? `<h3>🍛 Must-try food</h3><ul>${i.food.map(f => `<li><b>${esc(f.dish)}</b> ${f.veg === false ? `<span class="tag">non-veg</span>` : `<span class="tag good">veg</span>`} <small class="mute">${esc(f.where || "")}</small></li>`).join("")}</ul>` : ""}
        ${i.souvenirs && i.souvenirs.length ? `<h3>🎁 What to bring back</h3><ul>${i.souvenirs.map(v => `<li><b>${esc(v.item)}</b>${v.price ? ` · ${esc(v.price)}` : ""} <small class="mute">${esc(v.where || "")}${v.tip ? " · " + esc(v.tip) : ""}</small></li>`).join("")}</ul>` : ""}
        ${i.stayArea && i.stayArea.name ? `<h3>🏨 Best area to stay</h3><p><b>${esc(i.stayArea.name)}</b>. ${esc(i.stayArea.why || "")}</p>` : ""}
        ${i.packing && i.packing.length ? `<h3>🎒 Packing list</h3><div class="list" style="gap:4px">${i.packing.map(p => `<label class="row" style="gap:8px"><input type="checkbox" data-pack="${esc(p)}" ${d.packed && d.packed[p] ? "checked" : ""} ${shared ? "disabled" : ""} style="width:18px;height:18px;accent-color:var(--thread)"> ${esc(p)}</label>`).join("")}</div>` : ""}
        ${i.safety && i.safety.length ? `<h3>🛡️ Safety & scams</h3><ul>${i.safety.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        ${i.etiquette && i.etiquette.length ? `<h3>🙏 Local customs</h3><ul>${i.etiquette.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        ${i.emergency && i.emergency.length ? `<h3>🚨 Emergency</h3><div class="row">${i.emergency.map(e => `<a class="btn small ghost" href="tel:${esc(String(e.number).replace(/[^\d+]/g, ""))}">${esc(e.label)}: ${esc(e.number)}</a>`).join("")}</div>` : ""}
        ${i.sources && i.sources.length ? `<p class="help" style="margin-top:12px">Sources: ${i.sources.slice(0, 6).map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join(", ")}</p>` : ""}
        ${i.noAI ? `<p class="mute">Add the free AI key to get tips, food, packing and safety advice here.</p>` : ""}
      </div>`;
    }).join("") + (india ? `<div class="card"><h3>🇮🇳 Useful numbers in India</h3><div class="row"><a class="btn small ghost" href="tel:112">Emergency 112</a><a class="btn small ghost" href="tel:108">Ambulance 108</a><a class="btn small ghost" href="tel:1363">Tourist helpline 1363</a><a class="btn small ghost" href="tel:1091">Women helpline 1091</a></div></div>` : "") +
      `<p class="help" style="margin-top:12px">Opening hours come from OpenStreetMap where available, otherwise they're AI estimates. Check with the place before a long trip out. Ratings are typical visitor scores; 🔥 scores come from a live search of the past week.</p>`;
    $$("[data-infofood]", box).forEach(b => (b.onclick = async () => { busy(b, true, "Adding…"); try { t = await api(`/api/trips/${id}/food`, { seg: +b.dataset.seg, index: +b.dataset.infofood }); toast("Added to your plan 😋"); drawInfo(box); } catch (e) { toast(e.message, true); busy(b, false); } }));
    $$("[data-pack]", box).forEach(cb => (cb.onchange = () => api(`/api/trips/${id}/packed`, { item: cb.dataset.pack, done: cb.checked }, { method: "PUT" }).catch(e => toast(e.message, true))));
    drawMapDay(d.days[day]);
  }

  // ---------- print ----------
  function printHTML() {
    const d = D();
    return `<h1>${esc(t.title)}</h1><p>${d.input.start ? esc(longDate(d.input.start)) : ""} · ${d.input.travellers} people · made with Raahi</p>` +
      d.days.map((x, i) => `<section class="day-print"><h2>Day ${i + 1}${x.date ? " · " + esc(longDate(x.date)) : ""} – ${esc(city(x.seg))}</h2>${x.note ? `<p>${esc(x.note)}</p>` : ""}${x.weather ? `<p>${x.weather.icon} ${esc(x.weather.text)} ${x.weather.max}°/${x.weather.min}°</p>` : ""}${timeline(x, i)}${(x.maps || []).map((u, k) => `<p>🗺️ <a href="${esc(u)}">Google Maps route${x.maps.length > 1 ? " part " + (k + 1) : ""}</a></p>`).join("")}</section>`).join("");
  }

  route();
  return cleanup;
}

const num = s => { const m = String(s || "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/); return m && !/free/i.test(s) ? +m[1] : 0; };

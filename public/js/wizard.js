import { $, $$, api, state, esc, toast, busy, tiles, placeSearch, locate, INTERESTS, AVOID, PACES, DIETS, DIET_TEXT, todayISO, nowMin, longDate, decideTile, decideChip } from "./core.js";

const GROUPS = [["solo", "🧍 Solo"], ["couple", "💑 Couple"], ["family with kids", "👨‍👩‍👧 Family with kids"], ["friends", "🧑‍🤝‍🧑 Friends"], ["with elderly parents", "👵 With elders"]];
const TRANSPORT = [["own car / cab", "🚗", "Car or cab"], ["public transport", "🚌", "Bus, metro, auto"], ["two-wheeler", "🛵", "Scooter or bike"], ["walking", "🚶", "Mostly walking"], ["decide", "✨", "Let Raahi decide"]];
const DETAIL = [
  ["quick", "✨", "Let Raahi decide everything", "No more questions. Plan ready in one go."],
  ["review", "✅", "Let me check the places", "See the suggested places first, untick any you don't want."],
  ["max", "🎛️", "Maximum control", "Pick every place, set how long to spend, choose the day for each."],
];
const TIMES = (a, b) => { const o = []; for (let m = a; m <= b; m += 30) o.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`); return o; };

export async function render(view, params, query) {
  const p = state.user.prefs || {};
  let pre = null;
  try { pre = JSON.parse(sessionStorage.getItem("raahi.prefill") || "null"); sessionStorage.removeItem("raahi.prefill"); } catch {}
  const w = {
    segments: [{ destination: null, days: 2, stay: null }],
    hereNow: query.get("here") === "1", here: null,
    dates: "fixed", start: "", startTime: p.early ? "07:00" : p.earlyDecide ? "" : "09:00", endTime: "", arriveTime: "", leaveTime: "",
    pace: p.pace || "auto", interests: p.interestsDecide ? ["decide"] : p.interests || [], avoid: [], diet: p.diet || "any",
    travellers: 2, group: "", budget: "", per: "total", transport: "decide", detail: "review", notes: "",
    ...(pre || {}),
  };
  if (w.hereNow) { w.dates = "fixed"; w.start = todayISO(); w.segments[0].days = 1; w.detail = "quick"; }

  const steps = [
    { id: "where", q: w.hereNow ? "Where are you right now?" : "Where are you going?", draw: drawWhere, ok: () => (w.segments.every(s => s.destination && s.destination.label) ? farHere() || true : "Pick a place for each city.") },
    { id: "when", q: "When is the trip?", skip: () => w.hereNow, draw: drawWhen, ok: () => w.dates !== "fixed" || /^\d{4}-\d{2}-\d{2}$/.test(w.start) || "Pick a start date, or choose “Not decided”." },
    { id: "long", q: w.hereNow ? "How many days are you there?" : "How many days?", draw: drawLong, ok: () => true },
    { id: "stay", q: "Where are you staying?", draw: drawStay, ok: () => farStay() || true },
    { id: "times", q: "Your daily timings", draw: drawTimes, ok: () => true },
    { id: "pace", q: "What pace for this trip?", draw: drawPace, ok: () => true },
    { id: "likes", q: "What should the plan include?", draw: drawLikes, ok: () => true },
    { id: "people", q: "Who's going, and what's the budget?", draw: drawPeople, ok: () => true },
    { id: "detail", q: "How much control do you want?", draw: drawDetail, ok: () => true },
  ];
  let i = 0;
  const visible = () => steps.filter(s => !s.skip || !s.skip());

  function show() {
    const vs = visible(), s = vs[i];
    view.innerHTML = `
      <div class="wiz">
        <div class="steps" aria-hidden="true"><i style="width:${((i + 1) / vs.length) * 100}%"></i></div>
        <div class="mute" style="font-size:13px;font-weight:600">Step ${i + 1} of ${vs.length}</div>
        <div class="q">${esc(s.q)}</div>
        <div class="card" id="box" style="margin-top:12px"></div>
        <div class="err" id="werr" role="alert"></div>
        <div class="wiz-nav"><button class="btn ghost" id="back" ${i === 0 ? "style=visibility:hidden" : ""}>← Back</button><div class="row">${i < vs.length - 1 ? `<button class="btn ghost decide" id="rest" title="Skip the remaining questions">✨ Let Raahi decide the rest</button>` : ""}<button class="btn main" id="next">${i === vs.length - 1 ? "Make my plan ✨" : "Next →"}</button></div></div>
      </div>`;
    s.draw($("#box"));
    $("#back").onclick = () => { i--; show(); };
    $("#next").onclick = async e => {
      const ok = s.ok();
      if (ok !== true) { $("#werr").textContent = ok; return; }
      if (i < vs.length - 1) { i++; show(); return; }
      await submit(e.currentTarget);
    };
    if ($("#rest")) $("#rest").onclick = async e => {
      const ok = steps[0].ok();
      if (ok !== true) { $("#werr").textContent = ok === "Pick a place for each city." ? "First tell Raahi where (or tap “Let Raahi decide” for the place too)." : ok; return; }
      busy(e.currentTarget, true, "Raahi is deciding…");
      try {
        if (!w.hereNow && !w.start && w.dates !== "later" && i <= 1) {
          const r = await api("/api/advice", { kind: "when", destination: w.segments.map(x => x.destination.label).join(", "), interests: w.interests }).catch(() => null);
          if (r && r.suggestStart) w.start = r.suggestStart; else w.dates = "later";
        }
        if (i <= 2 && !w.daysSet) { const rs = await Promise.all(w.segments.map(x => api("/api/advice", { kind: "howlong", destination: x.destination.label, pace: w.pace }).catch(() => null))); rs.forEach((r, k) => { if (r && +r.days) w.segments[k].days = Math.max(1, Math.min(15, Math.round(+r.days))); }); }
        w.segments.forEach(x => { if (!x.stay) x.stay = { decide: true }; });
        w.detail = "quick";
      } catch {}
      await submit(e.currentTarget);
    };
    const first = $("#box input[type=text]"); if (first && !first.value) first.focus();
  }

  // ---- steps ----
  function drawWhere(box) {
    box.innerHTML = `
      ${w.hereNow ? `<p class="mute">Raahi will plan from where you are, starting now.</p>` : `<p class="mute">A city, area or region, in India or abroad. Going to more than one place? Add each city in order.</p>`}
      <div id="segs"></div>
      ${w.hereNow ? "" : `<div class="row"><button class="btn ghost small" id="addSeg" type="button">+ Add another city</button><button class="btn small decide" id="pickDest" type="button">✨ Not sure where? Let Raahi decide</button></div><div id="destMsg"></div>`}
      <hr>
      <label class="row" style="gap:10px;cursor:pointer"><input type="checkbox" id="hn" ${w.hereNow ? "checked" : ""} style="width:20px;height:20px;accent-color:var(--thread)"> <span><b>I'm already there</b><br><small>Start the plan now, from my current location</small></span></label>
      <div id="hereMsg" class="help"></div>
      ${w.hereNow ? "" : `<p class="help" style="margin-top:12px">🗺️ Want to see many places around your destination, one after another? <a href="#/explore?mode=around" id="thLink">Go around it</a></p>`}`;
    const segs = $("#segs", box);
    if ($("#thLink", box)) $("#thLink", box).onclick = e => { e.preventDefault(); location.hash = threadLink(); };
    w.segments.forEach((seg, k) => {
      const row = document.createElement("div");
      row.className = "seg-row";
      row.style.gridTemplateColumns = w.segments.length > 1 ? "1fr auto" : "1fr";
      const ps = placeSearch({ placeholder: k === 0 ? "e.g. Agra, Kota, Goa, Paris" : "Next city", value: seg.destination, onPick: v => (seg.destination = v), allowHere: w.hereNow && k === 0 });
      ps.input.addEventListener("input", () => (seg.destination = ps.get()));
      row.appendChild(ps.el);
      if (w.segments.length > 1) { const rm = document.createElement("button"); rm.className = "icon-btn"; rm.type = "button"; rm.textContent = "×"; rm.title = "Remove city"; rm.onclick = () => { w.segments.splice(k, 1); drawWhere(box); }; row.appendChild(rm); }
      segs.appendChild(row);
    });
    if ($("#addSeg", box)) $("#addSeg", box).onclick = () => { w.segments.push({ destination: null, days: 2, stay: null }); drawWhere(box); };
    if ($("#pickDest", box)) $("#pickDest", box).onclick = async e => {
      const home = p.home || (p.homeCity ? { label: p.homeCity } : null);
      if (!home) { $("#destMsg", box).innerHTML = `<p class="help">Add your home city in your profile first, or use <a href="#/explore">Explore</a>.</p>`; return; }
      busy(e.currentTarget, true, "Raahi is choosing a place for you…");
      try {
        const days = w.segments.reduce((a, x) => a + x.days, 0) || 3;
        const r = await api("/api/explore", { home, days, travellers: w.travellers, budget: +w.budget || null, per: w.per, start: w.start || null, interests: w.interests.filter(x => x !== "decide"), pace: w.pace, diet: w.diet });
        const o = r.options[0];
        w.segments = o.destinations.map(x => ({ destination: { label: x.search || x.name, lat: x.lat, lng: x.lng }, days: Math.max(1, Math.round(+x.nights || 1)), stay: null }));
        w.daysSet = true;
        drawWhere(box);
        $("#destMsg", box).innerHTML = `<div class="advice"><b>Raahi picked: ${esc(o.title)}</b><p style="margin:4px 0 0">${esc(o.why || "")}</p></div>`;
      } catch (err) { $("#destMsg", box).innerHTML = `<p class="err">${esc(err.message)}</p>`; busy(e.currentTarget, false); }
    };
    $("#hn", box).onchange = async e => {
      w.hereNow = e.target.checked;
      if (w.hereNow) {
        w.start = todayISO(); w.dates = "fixed"; w.segments = [w.segments[0]];
        $("#hereMsg", box).textContent = "Getting your location…";
        try {
          w.here = await locate();
          $("#hereMsg", box).textContent = "✓ Got your location.";
          if (!w.segments[0].destination || w.segments[0].destination.lat == null) {
            const r = await api(`/api/reverse?lat=${w.here.lat}&lng=${w.here.lng}`).catch(() => null);
            if (r && r.city) w.segments[0].destination = { label: r.city + (r.country ? ", " + r.country : ""), lat: w.here.lat, lng: w.here.lng };
          }
        } catch (err) { $("#hereMsg", box).textContent = err.message + " You can still type the place."; }
      }
      steps[0].q = w.hereNow ? "Where are you right now?" : "Where are you going?";
      show();
    };
  }

  function drawWhen(box) {
    box.innerHTML = `
      <div class="tiles" id="dm">
        <button type="button" class="tile" data-v="fixed"><span class="em">📅</span><b>I know my dates</b><span>Plan around the real day of the week</span></button>
        <button type="button" class="tile" data-v="help"><span class="em">🤔</span><b>Not decided, help me choose</b><span>Raahi suggests the best time to go</span></button>
        <button type="button" class="tile" data-v="later"><span class="em">🗓️</span><b>Plan without dates</b><span>Uses typical opening days. Add dates later.</span></button>
        ${decideTile("Raahi sets the best dates for you")}
      </div>
      <div id="dbody" style="margin-top:14px"></div>`;
    const t = tiles($("#dm", box), { value: w.dates, onChange: v => { w.dates = v === "help" || v === "decide" ? "fixed" : v; body(v); } });
    const body = async v => {
      const b = $("#dbody", box);
      if (v === "decide") {
        b.innerHTML = `<p class="mute"><span class="spin" style="display:inline-block;vertical-align:middle"></span> Raahi is picking the best dates…</p>`;
        try {
          const r = await api("/api/advice", { kind: "when", destination: w.segments.map(s => s.destination && s.destination.label).filter(Boolean).join(", "), days: w.segments.reduce((a, s) => a + s.days, 0), interests: w.interests });
          if (r.suggestStart) { w.dates = "fixed"; w.start = r.suggestStart; }
          b.innerHTML = `<div class="advice"><b>${r.suggestStart ? "Starting " + esc(longDate(r.suggestStart)) : esc(r.months || "")}</b><p style="margin:4px 0 0">${esc(r.answer || "")}</p></div>`;
        } catch (err) { w.dates = "later"; b.innerHTML = `<p class="err">${esc(err.message)} Planning without dates for now.</p>`; }
        return;
      }
      if (v === "later") { b.innerHTML = `<p class="mute">Fine. Raahi will assume places keep their usual hours. Weather and closed days are checked once you add dates.</p>`; return; }
      b.innerHTML = `<label class="f" for="sd">Start date</label><input id="sd" type="date" min="${todayISO()}" value="${esc(w.start)}" style="max-width:220px">
        ${v === "help" ? `<div style="margin-top:12px"><button class="btn small" id="askWhen" type="button">✨ Ask Raahi: when should I go to ${esc(w.segments[0].destination ? w.segments[0].destination.label.split(",")[0] : "this place")}?</button><div id="adv"></div></div>` : ""}`;
      $("#sd", b).onchange = e => (w.start = e.target.value);
      if ($("#askWhen", b)) $("#askWhen", b).onclick = async e => {
        const btn = e.currentTarget; busy(btn, true, "Asking Raahi…");
        try {
          const r = await api("/api/advice", { kind: "when", destination: w.segments.map(s => s.destination && s.destination.label).filter(Boolean).join(", "), days: w.segments.reduce((a, s) => a + s.days, 0), interests: w.interests });
          $("#adv", b).innerHTML = `<div class="advice"><b>${esc(r.months || "")}</b><p style="margin:4px 0 8px">${esc(r.answer || "")}</p>${r.suggestStart ? `<button class="btn small main" type="button" id="useD">Use ${esc(longDate(r.suggestStart))}</button>` : ""}</div>`;
          if ($("#useD", b)) $("#useD", b).onclick = () => { w.start = r.suggestStart; $("#sd", b).value = r.suggestStart; toast("Date set"); };
        } catch (err) { $("#adv", b).innerHTML = `<p class="err">${esc(err.message)}</p>`; }
        busy(btn, false);
      };
    };
    body(t.get());
  }

  // Places that don't belong together get a clear message before planning.
  const kmBetween = (a, b) => { const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2; return Math.round(12742 * Math.asin(Math.sqrt(h))); };
  const hasPt = x => x && x.lat != null && x.lng != null && isFinite(+x.lat);
  const short = x => String(x.label || "").split(",")[0];
  function farStay() {
    for (const s of w.segments) if (hasPt(s.stay) && hasPt(s.destination) && kmBetween(s.stay, s.destination) > 60)
      return `Your stay "${short(s.stay)}" is about ${kmBetween(s.stay, s.destination)} km from ${short(s.destination)}. Pick a hotel in or near ${short(s.destination)}, or tap "Let Raahi decide".`;
    return "";
  }
  function farHere() {
    const d = w.segments[0] && w.segments[0].destination;
    if (w.hereNow && hasPt(w.here) && hasPt(d) && kmBetween(w.here, d) > 60) return `You're about ${kmBetween(w.here, d)} km from ${short(d)} right now. Pick the place you're in today, or untick "I'm already there" to plan a normal trip.`;
    return "";
  }

  // Many days in one place? Offer a thread: that place plus others around it, in one loop back home.
  function threadLink() {
    const s0 = w.segments[0], city = s0 && s0.destination ? s0.destination.label.split(",")[0] : "";
    const days = w.segments.reduce((a, s) => a + s.days, 0);
    return city ? `#/explore?mode=around&days=${Math.max(3, days)}&base=${encodeURIComponent(s0.destination.label)}` : `#/explore?mode=thread&days=${Math.max(3, days)}`;
  }
  function threadHint() {
    if (w.hereNow || w.segments.length !== 1 || !w.segments[0].destination) return "";
    const days = w.segments[0].days, city = w.segments[0].destination.label.split(",")[0];
    if (days < 4) return "";
    return `<div class="note" style="margin-top:12px">🧵 <b>${days} days in ${esc(city)} is a lot of one place.</b> See more: 1 day in ${esc(city)}, then the best places around it, one after another. <a class="btn small main" href="${threadLink()}" style="margin-top:8px">Make it a thread →</a></div>`;
  }

  function drawLong(box) {
    box.innerHTML = `<div id="lens"></div><div style="margin-top:12px" class="row"><button class="btn small decide" id="askLen" type="button">✨ Let Raahi decide how many days</button></div><div id="adv"></div>`;
    const lens = $("#lens", box);
    const draw = () => {
      lens.innerHTML = w.segments.map((s, k) => `
        <div class="between" style="margin-bottom:10px"><b>${esc(s.destination ? s.destination.label.split(",")[0] : "City " + (k + 1))}</b>
          <div class="stepper" style="width:150px"><button type="button" data-k="${k}" data-d="-1" aria-label="Fewer days">−</button><input type="number" min="1" max="15" value="${s.days}" data-k="${k}" aria-label="Days"><button type="button" data-k="${k}" data-d="1" aria-label="More days">+</button></div></div>`).join("") +
        `<p class="mute" style="margin:0">Total: ${w.segments.reduce((a, s) => a + s.days, 0)} days${w.start ? ` · ${longDate(w.start)} onwards` : ""}</p>` +
        (threadHint() || "");
      $$("button[data-d]", lens).forEach(b => (b.onclick = () => { const s = w.segments[+b.dataset.k]; s.days = Math.max(1, Math.min(15, s.days + +b.dataset.d)); draw(); }));
      $$("input", lens).forEach(inp => (inp.onchange = () => { w.segments[+inp.dataset.k].days = Math.max(1, Math.min(15, Math.round(+inp.value) || 1)); draw(); }));
    };
    draw();
    $("#askLen", box).onclick = async e => {
      const btn = e.currentTarget; busy(btn, true, "Asking Raahi…");
      try {
        const rs = await Promise.all(w.segments.map(s => api("/api/advice", { kind: "howlong", destination: s.destination.label, pace: w.pace, interests: w.interests })));
        $("#adv", box).innerHTML = `<div class="advice">${rs.map((r, k) => `<p style="margin:0 0 6px"><b>${esc(w.segments[k].destination.label.split(",")[0])}: ${r.days} days</b> ${r.minDays ? `<small>(${r.minDays}–${r.maxDays})</small>` : ""}<br>${esc(r.answer || "")}</p>`).join("")}<button class="btn small main" type="button" id="useL">Use these</button></div>`;
        $("#useL", box).remove();
        rs.forEach((r, k) => { if (+r.days) w.segments[k].days = Math.max(1, Math.min(15, Math.round(+r.days))); }); w.daysSet = true; draw();
      } catch (err) { $("#adv", box).innerHTML = `<p class="err">${esc(err.message)}</p>`; }
      busy(btn, false);
    };
  }

  function drawStay(box) {
    box.innerHTML = `<p class="mute">Your hotel, homestay or area. Each day starts and ends here, so the route is accurate.</p><div id="stays"></div>`;
    const el = $("#stays", box);
    w.segments.forEach((s, k) => {
      const wrap = document.createElement("div");
      wrap.style.marginBottom = "14px";
      wrap.innerHTML = `<label class="f">${w.segments.length > 1 ? "In " + esc(s.destination.label.split(",")[0]) : "Stay"}</label>`;
      const ps = placeSearch({ placeholder: "Hotel, area or paste its Google Maps link", value: s.stay, bias: s.destination, onPick: v => (s.stay = v), allowHere: true });
      ps.input.addEventListener("input", () => (s.stay = ps.get()));
      wrap.appendChild(ps.el);
      const nb = document.createElement("div"); nb.className = "row"; nb.style.marginTop = "6px";
      nb.innerHTML = `<button type="button" class="btn small decide" aria-pressed="${!!(s.stay && s.stay.decide)}">✨ Not booked? Let Raahi decide the best area</button><span class="help" style="margin:0"></span>`;
      const db2 = $("button", nb), msg = $("span", nb);
      const mark = () => { const on = !!(s.stay && s.stay.decide); db2.style.background = on ? "var(--warn-bg)" : ""; msg.textContent = on ? "Raahi will pick the area closest to everything on your plan." : ""; if (on) ps.input.value = ""; };
      db2.onclick = () => { s.stay = s.stay && s.stay.decide ? null : { decide: true }; mark(); };
      ps.input.addEventListener("input", () => { if (ps.input.value) { mark(); } });
      wrap.appendChild(nb); mark();
      el.appendChild(wrap);
    });
    if (w.hereNow) { const n = document.createElement("div"); n.className = "note"; n.textContent = "Today starts from your current location and ends at your stay."; el.appendChild(n); }
  }

  function drawTimes(box) {
    const days = w.segments.reduce((a, s) => a + s.days, 0);
    box.innerHTML = `
      ${w.hereNow ? `<div class="note" style="margin-bottom:10px">Today starts now (${esc(new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }))}).</div>` : ""}
      <div class="row" style="align-items:flex-start;gap:18px">
        <div style="flex:1;min-width:180px"><label class="f" for="st">Start my day at</label><select id="st"><option value="" ${!w.startTime ? "selected" : ""}>✨ Let Raahi decide</option>${TIMES(330, 660).map(t => `<option ${t === w.startTime ? "selected" : ""}>${t}</option>`).join("")}</select><div class="help">${p.early ? "You said you're an early riser." : "Early starts catch sunrise spots and beat the crowds."}</div></div>
        <div style="flex:1;min-width:180px"><label class="f" for="et">Finish my day by</label><select id="et"><option value="">✨ Let Raahi decide</option>${TIMES(990, 1350).map(t => `<option ${t === w.endTime ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      </div>
      <div class="row" style="align-items:flex-start;gap:18px">
        ${w.hereNow ? "" : `<div style="flex:1;min-width:180px"><label class="f" for="at">Day 1: arriving at <small>(optional)</small></label><input id="at" type="time" value="${esc(w.arriveTime)}"><div class="help">Train, flight or drive arrival time</div></div>`}
        <div style="flex:1;min-width:180px"><label class="f" for="lt">Day ${days}: leaving at <small>(optional)</small></label><input id="lt" type="time" value="${esc(w.leaveTime)}"><div class="help">Raahi keeps an hour free before you leave</div></div>
      </div>`;
    $("#st", box).onchange = e => (w.startTime = e.target.value);
    $("#et", box).onchange = e => (w.endTime = e.target.value);
    if ($("#at", box)) $("#at", box).onchange = e => (w.arriveTime = e.target.value);
    $("#lt", box).onchange = e => (w.leaveTime = e.target.value);
  }

  function drawPace(box) {
    box.innerHTML = `<div class="tiles" id="pc">${PACES.map(([v, em, t, s]) => `<button type="button" class="tile" data-v="${v}"><span class="em">${em}</span><b>${t}</b><span>${s}</span></button>`).join("")}</div>
      <p class="help" style="margin-top:10px">${p.pace ? "Pre-selected from your profile." : ""} ${state.user.stats && state.user.stats.paceFactor ? `Raahi has learned your pace from ${state.user.stats.visits} check-ins.` : ""}</p>`;
    tiles($("#pc", box), { value: w.pace, onChange: v => (w.pace = v) });
  }

  function drawLikes(box) {
    box.innerHTML = `<p class="mute">Temples? Mosques? Museums? Pick what you'd like to see.</p>
      <div class="chips" id="in">${decideChip("✨ Let Raahi decide (the best of this place)")}${INTERESTS.map(([v, t]) => `<button type="button" class="chip" data-v="${v}">${t}</button>`).join("")}</div>
      <label class="f">Anything to avoid?</label><div class="chips" id="av">${AVOID.map(([v, t]) => `<button type="button" class="chip" data-v="${v}">${t}</button>`).join("")}</div>`;
    tiles($("#in", box), { multi: true, value: w.interests, onChange: v => (w.interests = v) });
    tiles($("#av", box), { multi: true, value: w.avoid, onChange: v => (w.avoid = v) });
  }

  function drawPeople(box) {
    box.innerHTML = `
      <div class="row" style="gap:18px;align-items:flex-start">
        <div><label class="f">Travellers</label><div class="stepper" style="width:150px"><button type="button" data-d="-1" aria-label="Fewer">−</button><input type="number" id="tv" min="1" max="50" value="${w.travellers}" aria-label="Travellers"><button type="button" data-d="1" aria-label="More">+</button></div></div>
        <div class="grow"><label class="f" for="bg">Budget <small>(optional)</small></label><div class="row" style="flex-wrap:nowrap"><input id="bg" type="number" min="0" step="500" placeholder="e.g. 20000" value="${esc(w.budget)}"><select id="per" style="width:auto"><option value="total">₹ total</option><option value="person" ${w.per === "person" ? "selected" : ""}>₹ per person</option></select></div></div>
      </div>
      <label class="f">Who's travelling?</label><div class="chips" id="gr">${GROUPS.map(([v, t]) => `<button type="button" class="chip" data-v="${v}">${t}</button>`).join("")}</div>
      <label class="f">Food</label><div class="chips" id="dt">${DIETS.map(([v, t]) => `<button type="button" class="chip" data-v="${v}">${t}</button>`).join("")}${decideChip()}</div>
      <p class="help">Budget empty = Raahi suggests a sensible mid-range plan.</p>
      <label class="f">Getting around</label><div class="tiles" id="tr" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">${TRANSPORT.map(([v, em, t]) => `<button type="button" class="tile" data-v="${v}"><span class="em">${em}</span><b>${t}</b></button>`).join("")}</div>`;
    const tv = $("#tv", box);
    $$("button[data-d]", box).forEach(b => (b.onclick = () => { w.travellers = Math.max(1, Math.min(50, w.travellers + +b.dataset.d)); tv.value = w.travellers; }));
    tv.onchange = () => (w.travellers = Math.max(1, Math.round(+tv.value) || 1));
    $("#bg", box).oninput = e => (w.budget = e.target.value);
    $("#per", box).onchange = e => (w.per = e.target.value);
    tiles($("#gr", box), { value: w.group, onChange: v => (w.group = v) });
    tiles($("#dt", box), { value: w.diet, onChange: v => (w.diet = v) });
    tiles($("#tr", box), { value: w.transport, onChange: v => (w.transport = v) });
  }

  function drawDetail(box) {
    const total = w.segments.reduce((a, s) => a + s.days, 0);
    box.innerHTML = `<div class="tiles" id="dl">${DETAIL.map(([v, em, t, s]) => `<button type="button" class="tile" data-v="${v}"><span class="em">${em}</span><b>${t}</b><span>${s}</span></button>`).join("")}</div>
      <label class="f" for="nt">Anything else Raahi should know? <small>(optional)</small></label>
      <textarea id="nt" placeholder="e.g. My mother can't climb many stairs. We want one evening for shopping. It's our anniversary.">${esc(w.notes)}</textarea>
      <hr><div class="mute" style="font-size:14px"><b style="color:var(--ink)">Your trip:</b> ${esc(w.segments.map(s => `${s.destination.label.split(",")[0]} (${s.days}d)`).join(" → "))} · ${total} days${w.start && w.dates === "fixed" ? " from " + esc(longDate(w.start)) : ""} · ${esc(PACES.find(x => x[0] === w.pace)[2])} · ${w.travellers} ${w.travellers > 1 ? "people" : "person"}</div>`;
    tiles($("#dl", box), { value: w.detail, onChange: v => (w.detail = v) });
    $("#nt", box).oninput = e => (w.notes = e.target.value);
  }

  async function submit(btn) {
    busy(btn, true, "Starting…");
    const body = {
      segments: w.segments.map(s => ({ destination: s.destination, days: s.days, stay: s.stay && (s.stay.label || s.stay.decide) ? s.stay : null, thread: s.thread || null })),
      thread: w.thread || null,
      start: w.dates === "fixed" && w.start ? w.start : null,
      hereNow: w.hereNow, here: w.hereNow ? w.here : null, nowMin: w.hereNow ? nowMin() : null,
      startTime: w.startTime, endTime: w.endTime || null, arriveTime: w.arriveTime || null, leaveTime: w.leaveTime || null,
      pace: w.pace, early: !!p.early, interests: w.interests.filter(x => x !== "decide"), avoid: w.avoid, diet: w.diet === "decide" ? "anything" : DIET_TEXT[w.diet] || w.diet,
      travellers: w.travellers, group: w.group, budget: +w.budget > 0 ? { amount: +w.budget, per: w.per } : null,
      transport: w.transport === "decide" ? "" : w.transport, detail: w.detail, notes: w.notes,
    };
    if (w.hereNow && !w.here) { try { body.here = await locate(); } catch {} }
    try { const r = await api("/api/trips", body); location.hash = "#/trip/" + r.id; }
    catch (e) { $("#werr").textContent = e.message; busy(btn, false); }
  }

  show();
}

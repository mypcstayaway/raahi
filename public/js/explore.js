// "I live in Agra, I have 6 days and this budget. Where can I go?"
import { $, $$, api, state, esc, toast, busy, tiles, placeSearch, INTERESTS, todayISO, inr, dur, scoreClass } from "./core.js";
import * as chat from "./chat.js";

export async function render(view, params, query) {
  query = query || new URLSearchParams();
  const p = state.user.prefs || {};
  const f = { days: 4, travellers: 2, budget: "", per: "total", scope: "india", transport: "", start: "", month: "", interests: p.interests || [] };
  view.innerHTML = `
    <div class="wiz" style="max-width:860px">
      <h1>Where can I go?</h1>
      <p class="mute">Tell Raahi where you start, how many days you have and your budget. Get trip ideas, or a <b>thread</b>: one loop through many places and back home.</p>
      <div class="chips" id="mode" style="margin-bottom:12px"><button type="button" class="chip" data-v="ideas">💡 Trip ideas</button><button type="button" class="chip" data-v="thread">🧵 Thread trip: many places, one loop</button><button type="button" class="chip" data-v="around">🗺️ Around one place</button></div>
      <div class="card">
        <div class="row" style="align-items:flex-start;gap:16px">
          <div class="grow" style="min-width:220px"><label class="f" style="margin-top:0" id="homeLbl">Starting from</label><div id="home"></div></div>
          <div><label class="f" style="margin-top:0">Days</label><div class="stepper" style="width:140px"><button type="button" data-d="-1" aria-label="Fewer">−</button><input id="dy" type="number" min="1" max="30" value="${f.days}" aria-label="Days"><button type="button" data-d="1" aria-label="More">+</button></div></div>
          <div><label class="f" style="margin-top:0">People</label><input id="tv" type="number" min="1" max="50" value="${f.travellers}" style="width:90px"></div>
        </div>
        <div class="row" style="align-items:flex-start;gap:16px">
          <div class="grow" style="min-width:200px"><label class="f">Budget <small>(optional)</small></label><div class="row" style="flex-wrap:nowrap"><input id="bg" type="number" min="0" step="1000" placeholder="e.g. 30000"><select id="per" style="width:auto"><option value="total">₹ total</option><option value="person">₹ per person</option></select></div></div>
          <div><label class="f">Starting on <small>(optional)</small></label><input id="sd" type="date" min="${todayISO()}"></div>
        </div>
        <div id="thf" hidden>
          <div class="row" style="align-items:flex-start;gap:16px">
            <div class="grow" style="min-width:220px"><label class="f">Region or country <small>(optional)</small></label><input id="rg" type="text" placeholder="e.g. Tamil Nadu, Kerala, Thailand, USA. Empty = Raahi decides"></div>
            <div class="grow" style="min-width:220px"><label class="f">Must include <small>(optional)</small></label><input id="inc" type="text" placeholder="e.g. Isha, Palani, Meenakshi Temple"></div>
          </div>
          <div class="row" style="gap:18px;margin-top:10px">
            <label class="switch"><input type="checkbox" id="lp" checked> <span>Come back home at the end</span></label>
            <label class="switch"><input type="checkbox" id="fx"> <span>Days are flexible (±2)</span></label>
          </div>
        </div>
        <label class="f">Where</label><div class="chips" id="sc"><button type="button" class="chip" data-v="india">🇮🇳 Within India</button><button type="button" class="chip" data-v="abroad">✈️ Abroad</button><button type="button" class="chip" data-v="any">🌏 Either</button></div>
        <label class="f">Getting there</label><div class="chips" id="tr"><button type="button" class="chip" data-v="">Any</button><button type="button" class="chip" data-v="own car / road trip">🚗 Road trip</button><button type="button" class="chip" data-v="train">🚆 Train</button><button type="button" class="chip" data-v="flight">✈️ Flight</button><button type="button" class="chip" data-v="bus">🚌 Bus</button></div>
        <label class="f">You like</label><div class="chips" id="in">${INTERESTS.map(([v, t]) => `<button type="button" class="chip" data-v="${v}">${t}</button>`).join("")}</div>
        <div class="actionbar"><button class="btn main big" id="go">Show me trip ideas ✨</button></div>
        <div class="err" id="err" role="alert"></div>
      </div>
      <div id="out" style="margin-top:20px"></div>
    </div>`;
  const home = placeSearch({ placeholder: "Your city", value: p.home || (p.homeCity ? { label: p.homeCity } : null), allowHere: true });
  $("#home").appendChild(home.el);
  const sc = tiles($("#sc"), { value: f.scope }), tr = tiles($("#tr"), { value: "" }), int = tiles($("#in"), { multi: true, value: f.interests });
  const dy = $("#dy");
  let mode = ["thread", "around"].includes(query.get("mode")) ? query.get("mode") : "ideas", variant = 0;
  const setMode = v => {
    mode = v; const loopy = v !== "ideas";
    $("#thf").hidden = !loopy;
    $("#rg").closest(".grow").hidden = v === "around";
    $("#homeLbl").textContent = v === "around" ? "The place you're going to (your base)" : "Starting from";
    $("#lp").nextElementSibling.textContent = v === "around" ? "Come back to this place at the end" : "Come back home at the end";
    $("#go").textContent = v === "thread" ? "Make my thread 🧵" : v === "around" ? "Show me the places around 🗺️" : "Show me trip ideas ✨";
    if (loopy && +dy.value < 4) dy.value = 6;
  };
  tiles($("#mode"), { value: mode, onChange: setMode });
  // Arriving from "Plan a trip" ("9 days in Coimbatore? Make it a thread"): fill in and start straight away.
  if (query.get("days")) dy.value = Math.max(1, Math.min(30, +query.get("days") || 7));
  if (query.get("include")) $("#inc").value = query.get("include");
  if (query.get("region")) $("#rg").value = query.get("region");
  if (query.get("base")) home.set({ label: query.get("base") });
  setMode(mode);
  if (((mode === "thread" && query.get("include")) || (mode === "around" && query.get("base"))) && home.get() && home.get().label) setTimeout(() => $("#go").click(), 50);
  $$("button[data-d]").forEach(b => (b.onclick = () => (dy.value = Math.max(1, Math.min(30, (+dy.value || 1) + +b.dataset.d)))));
  $("#go").onclick = async e => {
    $("#err").textContent = "";
    const h = home.get();
    if (!h || !h.label) { $("#err").textContent = mode === "around" ? "Tell me the place you're going to." : "Tell me where you're starting from."; return; }
    const body = { home: h, days: +dy.value, travellers: +$("#tv").value || 1, budget: +$("#bg").value || null, per: $("#per").value, start: $("#sd").value || null, scope: sc.get(), transport: tr.get(), interests: int.get(), pace: p.pace, diet: p.diet };
    if (mode !== "ideas") return makeThread(e.currentTarget, body);
    busy(e.currentTarget, true, "Finding ideas… (about 15 s)");
    $("#out").innerHTML = `<div class="cards">${[1, 2, 3].map(() => `<div class="skeleton" style="height:220px"></div>`).join("")}</div>`;
    try { show(await api("/api/explore", body), body); } catch (err) { $("#out").innerHTML = ""; $("#err").textContent = err.message; }
    busy(e.currentTarget, false);
  };

  async function makeThread(btn, body) {
    Object.assign(body, { region: mode === "around" ? "" : $("#rg").value.trim(), include: $("#inc").value.trim(), loop: $("#lp").checked, flexible: $("#fx").checked, variant, around: mode === "around" });
    busy(btn, true, "Designing your loop… (about 15 s)");
    $("#out").innerHTML = `<div class="skeleton" style="height:420px"></div>`;
    try { showThread(await api("/api/thread", body), body); } catch (err) { $("#out").innerHTML = ""; $("#err").textContent = err.message; }
    busy(btn, false);
  }

  const MODE_IC = { car: "🚗", bus: "🚌", train: "🚆", flight: "✈️", ferry: "⛴️", walk: "🚶" };
  const legHTML = (l, fallbackFrom, to) => {
    if (!l) return "";
    const hrs = l.roadHours || l.hours; // measured road time wins over the AI's guess
    const bits = [hrs ? `~${dur(Math.round(hrs * 60))}` : "", l.km ? `${l.km} km` : "", l.fare, l.depart ? `leave ${l.depart}` : ""].filter(Boolean);
    return `<li class="leg"><span class="dot leg-dot">${MODE_IC[l.mode] || "➜"}</span><div><b>${esc(l.from || fallbackFrom || "")} → ${esc(to || l.to || "")}</b>${l.mode ? ` <span class="tag">${esc(l.mode)}</span>` : ""}<div class="help" style="margin:2px 0 0">${esc(bits.join(" · "))}${l.tip ? `<br>💡 ${esc(l.tip)}` : ""}</div></div></li>`;
  };

  function showThread(r, body) {
    const t = r.thread, homeName = r.home.label.split(",")[0];
    const chain = [homeName, ...(t.gateway ? [t.gateway.name] : []), ...t.stops.map(x => x.name), ...(t.loop ? [homeName] : [])];
    const stopHTML = (x, i) => `
      ${legHTML(x.leg, i ? t.stops[i - 1].name : t.gateway ? t.gateway.name : homeName, x.name)}
      <li><span class="dot">${i + 1}</span><div class="card" style="padding:14px 16px">
        <div class="between"><h3 style="margin:0">${esc(x.name)}</h3><span class="tag">${x.nights ? `${x.nights} night${x.nights > 1 ? "s" : ""}` : "day stop"}</span></div>
        <p class="help" style="margin:4px 0 8px">${x.arriveBy ? `🕘 Reach by <b>${esc(x.arriveBy)}</b> · ` : ""}${esc(x.why)}</p>
        ${x.plan.length ? `<ol class="th-plan">${x.plan.map(p => `<li>${p.time ? `<b>${esc(p.time)}</b> ` : ""}${esc(p.what)}${p.tip ? `<br><small class="mute">💡 ${esc(p.tip)}</small>` : ""}</li>`).join("")}</ol>` : ""}
        ${x.timings.length ? `<p style="margin:8px 0 0;font-size:14px">🕰️ ${x.timings.map(z => `<b>${esc(z.what)}</b>: ${esc(z.time)}`).join(" · ")}</p>` : ""}
        ${x.fees.length ? `<p style="margin:6px 0 0;font-size:14px">🎟️ ${x.fees.map(z => `${esc(z.what)}: <b>${esc(z.price)}</b>`).join(" · ")}</p>` : ""}
        ${x.warnings.length ? `<div class="note warn" style="margin-top:8px">${x.warnings.map(w => `⚠️ ${esc(w)}`).join("<br>")}</div>` : ""}
        ${x.stay ? `<p style="margin:8px 0 0;font-size:14px">🏨 <b>Stay:</b> ${esc(x.stay)}</p>` : ""}
        ${x.food ? `<p style="margin:4px 0 0;font-size:14px">🍛 <b>Eat:</b> ${esc(x.food)}</p>` : ""}
      </div></li>`;
    $("#out").innerHTML = `
      <div class="card thread-head">
        <div class="between"><h2 style="margin:0">🧵 ${esc(t.title)}</h2>${t.rating ? `<span class="score ${scoreClass(t.rating)}">${t.rating.toFixed(1)}<small>/10</small></span>` : ""}</div>
        <p style="margin:6px 0 10px">${esc(t.summary)}</p>
        <div class="chain">${chain.map((c, i) => `<span class="tag ${i === 0 || (t.loop && i === chain.length - 1) ? "good" : ""}">${esc(c)}</span>`).join(`<span class="mute">→</span>`)}</div>
        <div class="row" style="gap:6px;margin-top:10px"><span class="tag">📅 ${t.totalDays} days</span>${t.cost && t.cost.total ? `<span class="tag">💰 ~${inr(t.cost.total)}</span>` : ""}${t.checked && t.checked.length ? `<span class="tag good">🔎 Timings checked live: ${esc(t.checked.join(", "))}</span>` : ""}</div>
        ${t.season ? `<p class="help" style="margin-top:8px">${esc(t.season)}</p>` : ""}
        ${t.flexNote ? `<p class="help">↔️ ${esc(t.flexNote)}</p>` : ""}
        ${t.betterOrder ? `<div class="note" style="margin-top:8px">🧭 Raahi found a shorter order that saves about <b>${t.betterOrder.savesKm} km</b>: ${esc(t.betterOrder.names.join(" → "))}. <button class="btn small" id="reord">Use it</button></div>` : ""}
      </div>
      ${t.gateway ? `<div class="card" style="margin-top:12px"><b>✈️ First, reach ${esc(t.gateway.name)}</b><p class="help" style="margin:4px 0 0">${esc(t.gateway.how)}</p></div>` : ""}
      <ol class="thread-line">${t.stops.map(stopHTML).join("")}${t.returnLeg ? legHTML(t.returnLeg, t.stops[t.stops.length - 1].name, t.returnLeg.to || homeName) : ""}</ol>
      <div class="actionbar"><button class="btn main big" id="planT">Plan this thread, day by day →</button><button class="btn ghost" id="moreT">Show me another loop</button><button class="btn ghost" id="askT">Ask about it</button></div>
      ${r.sources && r.sources.length ? `<p class="help">Sources: ${r.sources.slice(0, 6).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(", ")}</p>` : ""}`;
    if ($("#reord")) $("#reord").onclick = () => {
      const order = t.betterOrder.names.map(n => t.stops.find(x => x.name === n)).filter(Boolean);
      order.forEach((x, i) => { if (x.leg) { x.leg.from = i ? order[i - 1].name : t.gateway ? t.gateway.name : homeName; x.leg.km = null; x.leg.roadHours = null; } });
      if (t.returnLeg) t.returnLeg.from = order[order.length - 1].name;
      t.stops = order; delete t.betterOrder; showThread(r, body); toast("Shorter order applied");
    };
    $("#moreT").onclick = () => { variant++; makeThread($("#go"), { ...body }); window.scrollTo({ top: $("#out").offsetTop - 80, behavior: "smooth" }); };
    $("#askT").onclick = () => chat.open(`I'm starting from ${r.home.label} with ${body.days} days. Tell me more about this loop: ${chain.join(" → ")}. What should I watch out for, and is the order right?`);
    $("#planT").onclick = () => {
      const segs = t.stops.map(x => ({ destination: { label: x.search || x.name, lat: x.lat, lng: x.lng }, days: Math.max(1, x.nights || 1), stay: { decide: true }, thread: x }));
      let total = segs.reduce((a, s) => a + s.days, 0);
      while (total > t.totalDays) { const big = segs.reduce((m, s) => (s.days > m.days ? s : m), segs[0]); if (big.days <= 1) break; big.days--; total--; }
      if (total < t.totalDays && segs.length) segs[segs.length - 1].days += t.totalDays - total;
      const thread = { title: t.title, summary: t.summary, home: r.home, gateway: t.gateway, returnLeg: t.returnLeg, loop: t.loop, flexNote: t.flexNote };
      try { sessionStorage.setItem("raahi.prefill", JSON.stringify({ segments: segs, thread, daysSet: true, travellers: body.travellers, budget: body.budget || "", per: body.per, start: body.start || "", dates: "fixed", interests: body.interests })); } catch {}
      location.hash = "#/plan";
    };
  }

  function show(r, body) {
    $("#out").innerHTML = `<h2>${r.options.length} ideas from ${esc(r.home.label.split(",")[0])}</h2><div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${r.options.map((o, k) => {
      const first = o.destinations[0] || {};
      const dist = first.roadKm ? `🚗 ${first.roadKm} km · ~${dur(first.roadMin)} by road` : first.straightKm ? `✈️ ${first.straightKm} km away` : "";
      const season = String(o.season || "");
      const sc2 = /^good/i.test(season) ? "good" : /^poor/i.test(season) ? "bad" : "warn";
      return `<div class="card"><div class="between"><h3 style="margin:0">${esc(o.title)}</h3>${o.rating ? `<span class="score ${scoreClass(+o.rating)}">${(+o.rating).toFixed(1)}<small>/10</small></span>` : ""}</div>
        <p class="mute" style="margin:4px 0 8px;font-size:14px">${esc(o.destinations.map(x => `${x.name}${x.nights ? ` (${x.nights}n)` : ""}`).join(" → "))}</p>
        <div class="row" style="gap:6px;margin-bottom:8px">${dist ? `<span class="tag">${esc(dist)}</span>` : ""}${o.cost && o.cost.total ? `<span class="tag">💰 ~${inr(o.cost.total)}</span>` : ""}${o.pace ? `<span class="tag">${esc(o.pace)}</span>` : ""}</div>
        <p style="font-size:14px">${esc(o.why || "")}</p>
        ${o.highlights && o.highlights.length ? `<ul style="margin:0 0 8px;padding-left:18px;font-size:14px">${o.highlights.slice(0, 5).map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        ${season ? `<p style="font-size:13px"><span class="tag ${sc2}">Season</span> ${esc(season.replace(/^(good|ok|poor)\s*[–-]\s*/i, ""))}</p>` : ""}
        ${o.getThere ? `<p style="font-size:13px" class="mute">🧭 ${esc(o.getThere)}</p>` : ""}
        ${o.cost && o.cost.note ? `<p class="help">${esc(o.cost.note)}</p>` : ""}
        <div class="row"><button class="btn small main" data-plan="${k}">Plan this trip →</button><button class="btn small ghost" data-ask="${k}">Ask about it</button></div></div>`;
    }).join("")}</div>${r.sources && r.sources.length ? `<p class="help">Sources: ${r.sources.slice(0, 5).map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>`).join(", ")}</p>` : ""}`;
    $$("[data-plan]").forEach(b => (b.onclick = () => {
      const o = r.options[+b.dataset.plan];
      const segs = o.destinations.map(x => ({ destination: { label: x.search || x.name, lat: x.lat, lng: x.lng }, days: Math.max(1, Math.round(+x.nights || 1)), stay: null }));
      const total = segs.reduce((a, s) => a + s.days, 0);
      if (total < body.days && segs.length) segs[segs.length - 1].days += body.days - total;
      try { sessionStorage.setItem("raahi.prefill", JSON.stringify({ segments: segs, daysSet: true, travellers: body.travellers, budget: body.budget || "", per: body.per, start: body.start || "", dates: body.start ? "fixed" : "fixed", interests: body.interests })); } catch {}
      location.hash = "#/plan";
    }));
    $$("[data-ask]").forEach(b => (b.onclick = () => { const o = r.options[+b.dataset.ask]; chat.open(`I'm starting from ${r.home.label} with ${body.days} days. Tell me more about this trip idea: ${o.title} (${o.destinations.map(x => x.name).join(", ")}). Is it worth it, and what should I watch out for?`); }));
  }
}

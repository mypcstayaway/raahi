// "I live in Agra, I have 6 days and this budget. Where can I go?"
import { $, $$, api, state, esc, toast, busy, tiles, placeSearch, INTERESTS, todayISO, inr, dur, scoreClass } from "./core.js";
import * as chat from "./chat.js";

export async function render(view) {
  const p = state.user.prefs || {};
  const f = { days: 4, travellers: 2, budget: "", per: "total", scope: "india", transport: "", start: "", month: "", interests: p.interests || [] };
  view.innerHTML = `
    <div class="wiz" style="max-width:860px">
      <h1>Where can I go?</h1>
      <p class="mute">Tell Raahi where you start, how many days you have and your budget. You'll get trip ideas with real road times from home.</p>
      <div class="card">
        <div class="row" style="align-items:flex-start;gap:16px">
          <div class="grow" style="min-width:220px"><label class="f" style="margin-top:0">Starting from</label><div id="home"></div></div>
          <div><label class="f" style="margin-top:0">Days</label><div class="stepper" style="width:140px"><button type="button" data-d="-1" aria-label="Fewer">−</button><input id="dy" type="number" min="1" max="30" value="${f.days}" aria-label="Days"><button type="button" data-d="1" aria-label="More">+</button></div></div>
          <div><label class="f" style="margin-top:0">People</label><input id="tv" type="number" min="1" max="50" value="${f.travellers}" style="width:90px"></div>
        </div>
        <div class="row" style="align-items:flex-start;gap:16px">
          <div class="grow" style="min-width:200px"><label class="f">Budget <small>(optional)</small></label><div class="row" style="flex-wrap:nowrap"><input id="bg" type="number" min="0" step="1000" placeholder="e.g. 30000"><select id="per" style="width:auto"><option value="total">₹ total</option><option value="person">₹ per person</option></select></div></div>
          <div><label class="f">Starting on <small>(optional)</small></label><input id="sd" type="date" min="${todayISO()}"></div>
        </div>
        <label class="f">Where</label><div class="chips" id="sc"><button type="button" class="chip" data-v="india">🇮🇳 Within India</button><button type="button" class="chip" data-v="abroad">✈️ Abroad</button><button type="button" class="chip" data-v="any">🌏 Either</button></div>
        <label class="f">Getting there</label><div class="chips" id="tr"><button type="button" class="chip" data-v="">Any</button><button type="button" class="chip" data-v="own car / road trip">🚗 Road trip</button><button type="button" class="chip" data-v="train">🚆 Train</button><button type="button" class="chip" data-v="flight">✈️ Flight</button><button type="button" class="chip" data-v="bus">🚌 Bus</button></div>
        <label class="f">You like</label><div class="chips" id="in">${INTERESTS.map(([v, t]) => `<button type="button" class="chip" data-v="${v}">${t}</button>`).join("")}</div>
        <div class="row" style="margin-top:18px"><button class="btn main" id="go">Show me trip ideas ✨</button></div>
        <div class="err" id="err" role="alert"></div>
      </div>
      <div id="out" style="margin-top:20px"></div>
    </div>`;
  const home = placeSearch({ placeholder: "Your city", value: p.home || (p.homeCity ? { label: p.homeCity } : null), allowHere: true });
  $("#home").appendChild(home.el);
  const sc = tiles($("#sc"), { value: f.scope }), tr = tiles($("#tr"), { value: "" }), int = tiles($("#in"), { multi: true, value: f.interests });
  const dy = $("#dy");
  $$("button[data-d]").forEach(b => (b.onclick = () => (dy.value = Math.max(1, Math.min(30, (+dy.value || 1) + +b.dataset.d)))));
  $("#go").onclick = async e => {
    $("#err").textContent = "";
    const h = home.get();
    if (!h || !h.label) { $("#err").textContent = "Tell me where you're starting from."; return; }
    const body = { home: h, days: +dy.value, travellers: +$("#tv").value || 1, budget: +$("#bg").value || null, per: $("#per").value, start: $("#sd").value || null, scope: sc.get(), transport: tr.get(), interests: int.get(), pace: p.pace, diet: p.diet };
    busy(e.currentTarget, true, "Finding ideas… (about 20 s)");
    $("#out").innerHTML = `<div class="cards">${[1, 2, 3].map(() => `<div class="skeleton" style="height:220px"></div>`).join("")}</div>`;
    try { show(await api("/api/explore", body), body); } catch (err) { $("#out").innerHTML = ""; $("#err").textContent = err.message; }
    busy(e.currentTarget, false);
  };

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
      try { sessionStorage.setItem("raahi.prefill", JSON.stringify({ segments: segs, travellers: body.travellers, budget: body.budget || "", per: body.per, start: body.start || "", dates: body.start ? "fixed" : "fixed", interests: body.interests })); } catch {}
      location.hash = "#/plan";
    }));
    $$("[data-ask]").forEach(b => (b.onclick = () => { const o = r.options[+b.dataset.ask]; chat.open(`I'm starting from ${r.home.label} with ${body.days} days. Tell me more about this trip idea: ${o.title} (${o.destinations.map(x => x.name).join(", ")}). Is it worth it, and what should I watch out for?`); }));
  }
}

import { $, $$, api, state, esc, dayName, todayISO, toast } from "./core.js";
import { googleButton, afterLogin } from "./app.js";

const ART = `<svg class="hero-art" viewBox="0 0 400 400" aria-hidden="true">
  <defs><pattern id="g" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0V26" fill="none" stroke="currentColor" stroke-opacity=".08"/></pattern></defs>
  <rect width="400" height="400" rx="40" fill="url(#g)" style="color:var(--ink)"/>
  <path d="M60 320 C110 210, 150 330, 205 220 S300 170, 335 80" fill="none" stroke="#c8362f" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 12"/>
  <g font-family="system-ui" font-weight="700" font-size="15" text-anchor="middle" fill="#fff">
    <circle cx="60" cy="320" r="17" fill="#1c2b33"/><text x="60" y="325">🏨</text>
    <circle cx="128" cy="262" r="15" fill="#c8362f"/><text x="128" y="267">1</text>
    <circle cx="205" cy="220" r="15" fill="#c8362f"/><text x="205" y="225">2</text>
    <circle cx="282" cy="160" r="15" fill="#c8362f"/><text x="282" y="165">3</text>
    <circle cx="335" cy="80" r="15" fill="#c8362f"/><text x="335" y="85">4</text>
  </g>
  <g font-family="system-ui" font-size="12" fill="currentColor" style="color:var(--mute)">
    <text x="146" y="290">09:15 · Fort</text><text x="222" y="250">11:40 · lunch</text><text x="298" y="190">14:00 · closes 17:30 ✓</text>
  </g></svg>`;

export async function render(view) {
  if (!state.user) return landing(view);
  const u = state.user;
  view.innerHTML = `
    <div class="between" style="margin-bottom:18px"><div><h1>Namaste${u.name ? ", " + esc(u.name.split(" ")[0]) : ""} 👋</h1><p class="mute" style="margin:0">Where are we going next?</p></div></div>
    <div id="today"></div>
    <div class="cards" style="margin-bottom:28px">
      <a class="card" href="#/plan"><div class="ic">🗺️</div><h3>Plan a trip</h3><p class="mute">Day-by-day plan in the shortest order, around opening times, lunch and your pace.</p></a>
      <a class="card" href="#/plan?here=1"><div class="ic">📍</div><h3>I'm here now</h3><p class="mute">Already at a place? Plan the rest of today from where you are, starting now.</p></a>
      <a class="card" href="#/explore"><div class="ic">🧭</div><h3>Where can I go?</h3><p class="mute">Your days and budget → trip ideas, or a 🧵 thread: one loop through many places and back home.</p></a>
      <button type="button" role="switch" aria-checked="${!!(u.prefs && u.prefs.baby && u.prefs.baby.on)}" class="card babycard${u.prefs && u.prefs.baby && u.prefs.baby.on ? " on" : ""}" id="babyCard" style="text-align:left;font:inherit;color:inherit;cursor:pointer"><div class="between"><div class="ic">👶</div><i class="knob big" aria-hidden="true"></i></div><h3>Baby mode <span class="tag" id="babyState">${u.prefs && u.prefs.baby && u.prefs.baby.on ? "On" : "Off"}</span></h3><p class="mute">Travelling with a baby? Every plan skips risky places, adds nap breaks and baby-friendly stops.</p></button>
      <a class="card" href="#/explore?mode=around"><div class="ic">🏞️</div><h3>Around one place</h3><p class="mute">"Going to Coimbatore for 6 days." 1 day there, then Palani, Kodaikanal and more, one after another.</p></a>
      <a class="card" href="#/explore?mode=thread"><div class="ic">🧵</div><h3>Thread trip</h3><p class="mute">"9 days from Agra, include Coimbatore." One loop through many places, every leg and tip, back home.</p></a>
      <a class="card" href="#/route"><div class="ic">🔀</div><h3>Route optimiser</h3><p class="mute">Paste a Google Maps link or type stops. Get the shortest order.</p></a>
    </div>
    <div class="between"><h2 style="margin:0">Your trips</h2><a class="btn small main" href="#/plan">+ New trip</a></div>
    <div id="trips" class="list" style="margin-top:12px"><div class="skeleton" style="height:70px"></div></div>
    ${u.guest ? `<div class="note" style="margin-top:20px">You're using Raahi as a guest. <a href="#/login">Create a free account</a> to keep your trips safe and use them on other devices.</div>` : ""}`;
  let list = [];
  try { list = await api("/api/trips"); } catch (e) { $("#trips").innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const box = $("#trips");
  if (!list.length) { box.innerHTML = `<div class="card mute">No trips yet. <a href="#/plan">Plan your first one</a> – it takes about a minute.</div>`; return; }
  const today = todayISO();
  box.innerHTML = list.map(t => {
    const end = t.start && t.days ? new Date(new Date(t.start + "T00:00:00").getTime() + (t.days - 1) * 864e5).toISOString().slice(0, 10) : null;
    const live = t.start && t.start <= today && end >= today;
    const st = t.status === "planning" ? `<span class="tag warn">Planning…</span>` : t.status === "review" ? `<span class="tag warn">Pick your places</span>` : t.status === "error" ? `<span class="tag bad">Needs a retry</span>` : live ? `<span class="tag red">Today</span>` : "";
    return `<div class="trip-row" data-id="${esc(t.id)}"><a class="card" href="#/trip/${esc(t.id)}${live ? "?tab=live" : ""}" style="padding:14px 16px"><div class="between"><div><b style="font-size:16px">${esc(t.title)}</b><div class="mute" style="font-size:13px">${t.start ? dayName(t.start) : "Dates not set"}${t.destination ? " · " + esc(t.destination) : ""}</div></div>${st}</div></a><button type="button" class="trip-del" data-del="${esc(t.id)}" aria-label="Delete ${esc(t.title)}" title="Delete this trip">🗑️</button></div>`;
  }).join("");
  // Delete a trip right from the list: tap once to arm, tap again to delete (no pop-ups).
  box.addEventListener("click", async e => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (!b.classList.contains("armed")) { $$(".trip-del.armed", box).forEach(x => { x.classList.remove("armed"); x.textContent = "🗑️"; }); b.classList.add("armed"); b.textContent = "Delete?"; setTimeout(() => { if (b.isConnected && b.classList.contains("armed")) { b.classList.remove("armed"); b.textContent = "🗑️"; } }, 4000); return; }
    b.disabled = true;
    try {
      await api(`/api/trips/${b.dataset.del}`, {}, { method: "DELETE" });
      const row = b.closest(".trip-row"); row.remove();
      toast("Trip deleted");
      if (!$(".trip-row", box)) box.innerHTML = `<div class="card mute">No trips yet. <a href="#/plan">Plan your first one</a> – it takes about a minute.</div>`;
    } catch (err) { b.disabled = false; toast(err.message, true); }
  });
  const now = list.find(t => { if (!t.start || !t.days) return false; const end = new Date(new Date(t.start + "T00:00:00").getTime() + (t.days - 1) * 864e5).toISOString().slice(0, 10); return t.start <= today && end >= today; });
  if (now) $("#today").innerHTML = `<a class="btn main" href="#/now" style="margin-bottom:10px">🧭 What's my next step?</a><a class="card" href="#/trip/${esc(now.id)}?tab=live" style="margin-bottom:18px;border-color:var(--thread)"><div class="between"><div><span class="tag red">On your trip today</span><h3 style="margin:8px 0 2px">${esc(now.title)}</h3><p class="mute" style="margin:0">Open live mode: check in, see what's still open, re-plan the rest of the day.</p></div><span class="btn main">Go live →</span></div></a>`;
}

function landing(view) {
  view.innerHTML = `
    <section class="hero">
      <div>
        <span class="tag red">Free · India & abroad</span>
        <h1 style="margin-top:12px">Your whole trip, planned to the minute.<br>Then guided live.</h1>
        <p class="lead">Raahi plans every day in the shortest order, around opening times, lunch and your pace. On the trip, check in as you go and Raahi tells you what's still possible, what's crowded right now, and where to eat.</p>
        <div class="row" style="margin:22px 0 8px"><div id="gbtn"></div></div>
        <div class="row"><a class="btn main" href="#/login">Sign in or create account</a><button class="btn ghost" id="guest">Try without an account</button></div>
        <p class="help">Email, phone number or Google. No fees.</p>
      </div>
      ${ART}
    </section>
    <div class="cards">
      <div class="card feature"><div class="ic">🕰️</div><div><h3>Around real opening hours</h3><p class="mute">Closed on Fridays? Shuts at 5:30? Raahi plans around it and lets you know when a place won't fit.</p></div></div>
      <div class="card feature"><div class="ic">📍</div><div><h3>Live on the trip</h3><p class="mute">"It's 4:30, can I still make Guna Caves?" Tap once, get the answer and a new plan for the rest of the day.</p></div></div>
      <div class="card feature"><div class="ic">🔥</div><div><h3>What's happening now</h3><p class="mute">Recent news, Reddit posts and reviews from the past week, rolled into one "go now" score out of 10.</p></div></div>
      <div class="card feature"><div class="ic">🍛</div><div><h3>Food that suits you</h3><p class="mute">Veg, Jain or non-veg: lunch and dinner spots near where you'll be, plus local dishes to try.</p></div></div>
      <div class="card feature"><div class="ic">🧭</div><div><h3>Where can I go?</h3><p class="mute">"I live in Agra, I have 6 days and ₹30,000." Get trip ideas with real road times.</p></div></div>
      <div class="card feature"><div class="ic">💬</div><div><h3>Ask Raahi anything</h3><p class="mute">Best time to go, how many days you need, what to wear, whether it's safe. Just ask.</p></div></div>
    </div>`;
  googleButton($("#gbtn"));
  $("#guest").onclick = async () => { try { state.after = "#/"; afterLogin(await api("/api/auth/guest", {})); } catch (e) { toast(e.message, true); } };
}

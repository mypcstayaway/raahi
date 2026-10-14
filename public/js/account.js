import { $, $$, api, state, esc, toast, busy, tiles, placeSearch, INTERESTS, PACES, DIETS, initials, decideTile, decideChip } from "./core.js";
import { googleButton, afterLogin, setUser } from "./app.js";

// ---------- sign in / create account ----------
export const login = {
  async render(view, params, query) {
    let mode = query && query.get("new") ? "register" : "login";
    const draw = () => {
      view.innerHTML = `
        <div style="max-width:440px;margin:10px auto">
          <h1>${mode === "login" ? "Welcome back" : "Create your free account"}</h1>
          <p class="mute">${state.after && /plan|trip|explore/.test(state.after) ? "Sign in so Raahi can save your trip." : "Save your trips and use them on any device."}</p>
          <div class="card">
            <div id="gbtn" style="min-height:${state.config.googleClientId ? 44 : 0}px"></div>
            ${state.config.googleClientId ? `<div class="row" style="margin:14px 0;color:var(--mute);font-size:13px"><hr style="flex:1;margin:0"> or <hr style="flex:1;margin:0"></div>` : ""}
            <form id="f" novalidate>
              ${mode === "register" ? `<label class="f" for="n">Your name</label><input id="n" type="text" autocomplete="name" placeholder="e.g. Yug">` : ""}
              <label class="f" for="i">Email or phone number</label>
              <input id="i" type="text" inputmode="email" autocomplete="username" placeholder="you@example.com or 98765 43210" required>
              <label class="f" for="p">Password</label>
              <input id="p" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" placeholder="${mode === "register" ? "At least 6 characters" : ""}" required>
              <div class="err" id="e" role="alert"></div>
              <button class="btn main" style="width:100%;margin-top:6px">${mode === "login" ? "Sign in" : "Create account"}</button>
            </form>
            <p style="margin:14px 0 0;text-align:center">${mode === "login" ? `New here? <button class="btn link" id="sw">Create an account</button>` : `Have an account? <button class="btn link" id="sw">Sign in</button>`}</p>
          </div>
          ${!state.user ? `<p style="text-align:center;margin-top:14px"><button class="btn ghost" id="guest">Continue without an account</button></p>` : ""}
          <p class="help" style="text-align:center">Phone numbers sign in with a password. Raahi doesn't use SMS codes, because sending them costs money.</p>
        </div>`;
      googleButton($("#gbtn"));
      $("#sw").onclick = () => { mode = mode === "login" ? "register" : "login"; draw(); };
      if ($("#guest")) $("#guest").onclick = async () => { try { afterLogin(await api("/api/auth/guest", {})); } catch (e) { $("#e").textContent = e.message; } };
      $("#f").onsubmit = async e => {
        e.preventDefault();
        const btn = $("#f button"); busy(btn, true, mode === "login" ? "Signing in…" : "Creating…"); $("#e").textContent = "";
        try {
          const body = { id: $("#i").value, password: $("#p").value };
          if (mode === "register") body.name = $("#n").value;
          afterLogin(await api(`/api/auth/${mode}`, body));
        } catch (err) { $("#e").textContent = err.message; busy(btn, false); }
      };
    };
    draw();
  },
};

// ---------- first-time questions ----------
const BUDGET = [["backpacker", "🎒", "Backpacker", "Hostels, buses, street food"], ["mid", "🧳", "Mid-range", "3-star hotels, cabs, good restaurants"], ["comfort", "🛎️", "Comfort", "4-star stays, private car"], ["luxury", "💎", "Luxury", "The best of everything"]];

function prefForm(p = {}) {
  return `
    <section class="q-block"><div class="q">What kind of traveller are you?</div><p class="mute">Raahi uses this to decide how much to fit into each day. You can change it for any trip.</p>
      <div class="tiles" id="pace">${PACES.map(([v, em, t, s]) => `<button type="button" class="tile" data-v="${v}"><span class="em">${em}</span><b>${t}</b><span>${s}</span></button>`).join("")}</div></section>
    <section class="q-block"><div class="q">Can you rise early?</div>
      <div class="tiles" id="early"><button type="button" class="tile" data-v="yes"><span class="em">🌅</span><b>Yes, I'm an early riser</b><span>Start by 7 am, catch sunrise spots</span></button><button type="button" class="tile" data-v="no"><span class="em">😴</span><b>No, I like a slow morning</b><span>Start around 9–10 am</span></button>${decideTile("Early only where it's worth it (sunrise spots)")}</div></section>
    <section class="q-block"><div class="q">What do you eat?</div><p class="mute">So restaurant suggestions suit you.</p>
      <div class="chips" id="diet">${DIETS.map(([v, t]) => `<button type="button" class="chip" data-v="${v}">${t}</button>`).join("")}${decideChip()}</div></section>
    <section class="q-block"><div class="q">What do you enjoy?</div><p class="mute">Pick as many as you like.</p>
      <div class="chips" id="int">${decideChip("✨ Let Raahi decide (the best of each place)")}${INTERESTS.map(([v, t]) => `<button type="button" class="chip" data-v="${v}">${t}</button>`).join("")}</div></section>
    <section class="q-block"><div class="q">Your usual travel budget</div>
      <div class="tiles" id="bud">${BUDGET.map(([v, em, t, s]) => `<button type="button" class="tile" data-v="${v}"><span class="em">${em}</span><b>${t}</b><span>${s}</span></button>`).join("")}${decideTile("Good value, comfortable choices")}</div></section>
    <section class="q-block"><div class="q">Where do you live?</div><p class="mute">Used for "Where can I go?" trip ideas from home.</p><div id="homeCity"></div></section>`;
}
function wirePrefs(root, p = {}) {
  const pace = tiles($("#pace", root), { value: p.pace || "balanced" });
  const early = tiles($("#early", root), { value: p.earlyDecide ? "decide" : p.early ? "yes" : p.early === false ? "no" : null });
  const diet = tiles($("#diet", root), { value: p.diet });
  const int = tiles($("#int", root), { multi: true, value: p.interestsDecide ? ["decide"] : p.interests || [] });
  const bud = tiles($("#bud", root), { value: p.budgetStyle || "mid" });
  const home = placeSearch({ placeholder: "Your city, e.g. Agra", value: p.home || (p.homeCity ? { label: p.homeCity } : null), allowHere: true });
  $("#homeCity", root).appendChild(home.el);
  return () => {
    const h = home.get();
    const ints = int.get();
    return { pace: pace.get() || "auto", early: early.get() === "yes", earlyDecide: early.get() === "decide" || !early.get(), diet: diet.get() && diet.get() !== "decide" ? diet.get() : "any", interests: ints.filter(x => x !== "decide"), interestsDecide: ints.includes("decide") || !ints.length, budgetStyle: bud.get() && bud.get() !== "decide" ? bud.get() : "mid", home: h, homeCity: h ? h.label : "" };
  };
}

export const welcome = {
  async render(view) {
    const p = state.user.prefs || {};
    view.innerHTML = `
      <div class="wiz">
        <h1>Let's get to know you</h1>
        <p class="mute">A few quick questions so every plan fits you. It takes 30 seconds, and you can change it later.</p>
        ${!state.user.name ? `<label class="f" for="nm">What should we call you?</label><input id="nm" type="text" placeholder="Your name" style="max-width:320px">` : ""}
        <div class="card" style="display:grid;gap:26px;margin-top:18px">${prefForm(p)}</div>
        <div class="wiz-nav"><button class="btn ghost decide" id="skip">✨ Let Raahi decide for me</button><button class="btn main" id="save">Save and continue →</button></div>
      </div>`;
    $$(".q", view).forEach(q => (q.style.fontSize = "20px"));
    const get = wirePrefs(view, p);
    const save = async (prefs) => {
      const body = { prefs };
      if ($("#nm") && $("#nm").value.trim()) body.name = $("#nm").value.trim();
      const r = await api("/api/me", body, { method: "PUT" });
      setUser(r.user);
      const next = state.after && !/welcome|login/.test(state.after) ? state.after : "#/";
      state.after = null; location.hash = next;
    };
    $("#save").onclick = async e => { busy(e.currentTarget, true, "Saving…"); try { await save(get()); } catch (err) { toast(err.message, true); busy(e.currentTarget, false); } };
    $("#skip").onclick = () => save({ pace: "auto", earlyDecide: true, diet: "any", interestsDecide: true, budgetStyle: "mid" }).catch(err => toast(err.message, true));
  },
};

// ---------- profile ----------
export const profile = {
  async render(view) {
    const u = state.user, p = u.prefs || {}, s = u.stats || {};
    const learned = s.paceFactor ? (s.paceFactor < 0.9 ? `You usually spend less time than suggested (about ${Math.round(s.paceFactor * 100)}%). "Let Raahi decide" will fit more into your days.` : s.paceFactor > 1.1 ? `You like to take your time: about ${Math.round(s.paceFactor * 100)}% of the suggested time. "Let Raahi decide" will plan fewer, longer stops.` : "You spend about the suggested time at places.") : `Check in at places on your trips ("I'm here" / "Done") and Raahi learns your real pace.`;
    view.innerHTML = `
      <div class="wiz">
        <div class="row" style="margin-bottom:16px"><div class="avatar" style="width:56px;height:56px;font-size:20px">${u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : esc(initials(u))}</div>
          <div><h1 style="margin:0;font-size:30px">${esc(u.name || (u.guest ? "Guest" : "Your profile"))}</h1><div class="mute">${esc(u.email || u.phone || (u.guest ? "Not signed in. Your trips are saved on this device only." : ""))}${u.google ? " · Google" : ""}</div></div></div>
        ${u.guest ? `<div class="note warn" style="margin-bottom:16px">You're a guest. <a href="#/login?new=1">Create a free account</a> to keep your trips, and they'll move across automatically.</div>` : ""}
        <div class="card" style="margin-bottom:16px"><h3>Your pace, learned</h3><p class="mute" style="margin:0">${esc(learned)}${s.visits ? ` (${s.visits} check-ins so far)` : ""}</p></div>
        <div class="card" style="display:grid;gap:26px">
          <div><label class="f" for="nm" style="margin-top:0">Name</label><input id="nm" type="text" value="${esc(u.name || "")}"></div>
          ${prefForm(p)}
        </div>
        <div class="wiz-nav"><div class="row"><button class="btn ghost" id="out">Sign out</button><button class="btn link" id="del">Delete account</button></div><button class="btn main" id="save">Save</button></div>
        <hr><div class="row"><span class="mute">Theme</span><div class="chips" id="theme"><button class="chip" data-v="auto">Auto</button><button class="chip" data-v="light">Light</button><button class="chip" data-v="dark">Dark</button></div></div>
      </div>`;
    $$(".q", view).forEach(q => (q.style.fontSize = "18px"));
    const get = wirePrefs(view, p);
    let th = "auto"; try { th = localStorage.getItem("raahi.theme") || "auto"; } catch {}
    tiles($("#theme"), { value: th, onChange: v => { try { localStorage.setItem("raahi.theme", v); } catch {} applyTheme(v); } });
    $("#save").onclick = async e => {
      busy(e.currentTarget, true, "Saving…");
      try { const r = await api("/api/me", { name: $("#nm").value, prefs: get() }, { method: "PUT" }); setUser(r.user); toast("Saved"); } catch (err) { toast(err.message, true); }
      busy(e.currentTarget, false);
    };
    $("#out").onclick = async () => { await api("/api/auth/logout", {}); setUser(null); location.hash = "#/"; };
    let armed = false;
    $("#del").onclick = async e => {
      if (!armed) { armed = true; e.currentTarget.textContent = "Tap again to delete everything"; e.currentTarget.style.color = "var(--bad)"; return; }
      await api("/api/me", {}, { method: "DELETE" }); setUser(null); toast("Account deleted"); location.hash = "#/";
    };
  },
};

export function applyTheme(v) {
  if (v === "light" || v === "dark") document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme;
}
try { applyTheme(localStorage.getItem("raahi.theme")); } catch {}

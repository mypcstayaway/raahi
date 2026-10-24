// Raahi app shell: sign-in state, page router, chat box.
import { $, $$, api, state, esc, initials, toast } from "./core.js";
import * as home from "./home.js";
import * as account from "./account.js";
import * as wizard from "./wizard.js";
import * as trip from "./trip.js";
import * as explore from "./explore.js";
import * as route from "./route.js";
import * as chat from "./chat.js";
import * as now from "./now.js";

const PAGES = [
  [/^\/?$/, home, "home", false],
  [/^\/login$/, account.login, "", false],
  [/^\/welcome$/, account.welcome, "", true],
  [/^\/profile$/, account.profile, "", true],
  [/^\/plan$/, wizard, "plan", true],
  [/^\/trip\/([\w-]+)$/, trip, "home", true],
  [/^\/s\/([\w-]+)$/, trip, "", false, true],
  [/^\/explore$/, explore, "explore", true],
  [/^\/route$/, route, "route", false],
  [/^\/now$/, now, "home", true],
];

let cleanup = null;
export async function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }
window.addEventListener("hashchange", render);

// Bigger text for anyone who needs it (remembered on this device).
const SIZES = ["", "big", "bigger"];
function applySize(k) { document.documentElement.dataset.size = SIZES[k] || ""; const b = $("#textSize"); if (b) { b.setAttribute("aria-pressed", k > 0); b.title = ["Bigger text", "Even bigger text", "Normal text size"][k] || "Bigger text"; } }
let sizeK = 0; try { sizeK = +localStorage.getItem("raahi.size") || 0; } catch {}
applySize(sizeK);
document.addEventListener("click", e => { if (e.target.closest("#textSize")) { sizeK = (sizeK + 1) % SIZES.length; try { localStorage.setItem("raahi.size", sizeK); } catch {} applySize(sizeK); toast(["Normal text size", "Bigger text", "Even bigger text"][sizeK]); } });

// Baby mode: one switch for the whole website (saved in the user's preferences).
function babyUI() {
  const u = state.user, on = !!(u && u.prefs && u.prefs.baby && u.prefs.baby.on);
  const b = $("#baby"); if (!b) return;
  b.hidden = !u; b.setAttribute("aria-checked", on); b.classList.toggle("on", on);
  $("#babybar").hidden = !on; document.body.classList.toggle("baby", on);
  const card = $("#babyCard");
  if (card) { card.classList.toggle("on", on); card.setAttribute("aria-checked", on); $("#babyState").textContent = on ? "On" : "Off"; }
}
async function setBaby(on) {
  try {
    const r = await api("/api/me", { prefs: { baby: { on, months: (state.user.prefs.baby || {}).months || null } } }, { method: "PUT" });
    setUser(r.user);
    toast(on ? "👶 Baby mode on: every plan, idea and loop now puts the baby first" : "Baby mode off");
  } catch (e) { toast(e.message, true); }
}
document.addEventListener("click", e => {
  if (e.target.closest("#baby, #babyCard")) setBaby(!(state.user.prefs.baby && state.user.prefs.baby.on));
  if (e.target.closest("#babyOff")) { e.preventDefault(); setBaby(false); }
});

export function setUser(u) {
  state.user = u;
  setTimeout(babyUI, 0);
  const me = $("#me");
  if (u && !u.guest) { me.href = "#/profile"; me.innerHTML = u.picture ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : esc(initials(u)); me.title = u.name || "Account"; }
  else if (u && u.guest) { me.href = "#/profile"; me.textContent = "👤"; me.title = "Guest – tap to save your account"; }
  else { me.href = "#/login"; me.textContent = "Sign in"; me.style.width = "auto"; me.style.padding = "0 12px"; me.style.borderRadius = "99px"; return; }
  me.style.width = ""; me.style.padding = ""; me.style.borderRadius = "";
}

async function render() {
  let path = location.hash.replace(/^#/, "").split("?")[0] || "/";
  const query = new URLSearchParams(location.hash.split("?")[1] || "");
  const m = location.pathname.match(/^\/t\/([\w-]+)/);
  if (m && (path === "/" || !location.hash)) path = "/s/" + m[1];
  if (path === "/route" && location.pathname === "/route" && !location.hash) path = "/route";
  if (!location.hash && location.pathname === "/route") path = "/route";
  const hit = PAGES.find(([re]) => re.test(path)) || PAGES[0];
  const [re, mod, nav, needUser, shared] = hit;
  const params = path.match(re).slice(1);
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const navKey = nav === "explore" && query.get("mode") === "around" ? "around" : nav;
  $$("[data-nav]").forEach(a => a.classList.toggle("on", a.dataset.nav === navKey && !!navKey));
  const view = $("#view");
  view.innerHTML = "";
  $("#toasts").innerHTML = "";
  window.scrollTo(0, 0);
  if (needUser && !state.user) { state.after = location.hash; cleanup = await account.login.render(view, [], query); return; }
  if (needUser && state.user && !state.user.prefs.onboarded && mod !== account.welcome && mod !== account.profile) { state.after = location.hash; location.hash = "#/welcome"; return; }
  state.page = { name: nav || path, params, tripId: mod === trip && !shared ? params[0] : null };
  chat.setContext(state.page.tripId);
  try { cleanup = (await mod.render(view, params, query, { shared })) || null; }
  catch (e) { console.error(e); view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="err">${esc(e.message)}</p><a class="btn" href="#/">Go home</a></div>`; }
  view.focus({ preventScroll: true });
}

// After signing in, continue where the person was going.
export function afterLogin(res) {
  setUser(res.user);
  if (!res.user.prefs.onboarded) { location.hash = "#/welcome"; return; }
  const next = state.after && !/login/.test(state.after) ? state.after : "#/";
  state.after = null;
  if (location.hash === next) render(); else location.hash = next;
}

// Google sign-in button (only when the server has a Client ID).
let gisReady = null;
export function googleButton(el) {
  if (!state.config.googleClientId) { el.innerHTML = ""; return; }
  gisReady = gisReady || new Promise((ok, bad) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.onload = ok; s.onerror = bad;
    document.head.appendChild(s);
  });
  gisReady.then(() => {
    google.accounts.id.initialize({
      client_id: state.config.googleClientId,
      callback: async r => { try { afterLogin(await api("/api/auth/google", { credential: r.credential })); toast("Signed in with Google"); } catch (e) { toast(e.message, true); } },
    });
    google.accounts.id.renderButton(el, { theme: "outline", size: "large", text: "continue_with", shape: "pill", width: Math.min(320, el.clientWidth || 320) });
  }).catch(() => { el.innerHTML = `<p class="help">Google sign-in couldn't load. Check your internet.</p>`; });
}

(async function boot() {
  try {
    const slow = setTimeout(() => toast("Waking Raahi up… your saved trips are shown meanwhile."), 3000);
    const [cfg, me] = await Promise.all([api("/api/config"), api("/api/me")]).finally(() => clearTimeout(slow));
    state.config = cfg; setUser(me.user);
    // New version on the server? Throw away the old saved app files and reload once.
    try {
      const was = localStorage.getItem("raahi.version");
      localStorage.setItem("raahi.version", cfg.version || "");
      if (was && cfg.version && was !== cfg.version && !sessionStorage.getItem("raahi.reloaded")) {
        sessionStorage.setItem("raahi.reloaded", "1");
        if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
        const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update().catch(() => {});
        location.reload(); return;
      }
    } catch {}
  } catch (e) { state.config = {}; setUser(null); toast(e.message, true); }
  chat.init();
  render();
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("/sw.js").catch(() => {});
})();

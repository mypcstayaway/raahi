// "Ask Raahi" chat box. Answers stream in as they're written.
import { $, $$, api, state, esc, md, toast } from "./core.js";

let el, tripId = "", loadedFor = null, sending = false;
const QUICK_GENERAL = ["When is the best time to visit Ladakh?", "How many days do I need for Rajasthan?", "Plan a weekend near me under ₹10,000", "What should I pack for Goa in monsoon?"];
const QUICK_TRIP = ["I can't decide, you choose for me", "What famous food should I try, and how much?", "What souvenir should I bring back?", "Is it crowded right now?", "What should I wear and pack?"];

export function init() {
  el = $("#chat");
  el.innerHTML = `
    <header><div><b>💬 Ask Raahi</b><div class="help" id="ctx" style="margin:0"></div></div><div class="row" style="gap:2px"><button class="icon-btn" id="cclr" title="Clear chat" aria-label="Clear chat">🗑️</button><button class="icon-btn" id="cx" aria-label="Close chat">×</button></div></header>
    <div class="msgs" id="msgs"></div>
    <div class="quick" id="quick"></div>
    <form id="cf"><input id="ci" type="text" placeholder="Ask anything about travel…" autocomplete="off" aria-label="Message"><button class="btn main" aria-label="Send">➤</button></form>`;
  $("#fab").onclick = () => open();
  $("#tabChat").onclick = () => open();
  $("#cx").onclick = close;
  $("#cclr").onclick = async () => { if (!state.user) return; await api("/api/chat?tripId=" + encodeURIComponent(tripId), {}, { method: "DELETE" }).catch(() => {}); $("#msgs").innerHTML = ""; hello(); };
  $("#cf").onsubmit = e => { e.preventDefault(); send($("#ci").value); };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !el.hidden) close(); });
}

export function setContext(id) { tripId = id || ""; if (!el.hidden) load(); }
function close() { el.hidden = true; $("#fab").hidden = false; }

export async function open(prefill) {
  if (!state.user) { try { const r = await api("/api/auth/guest", {}); const app = await import("./app.js"); app.setUser(r.user); } catch (e) { toast(e.message, true); return; } }
  el.hidden = false; $("#fab").hidden = true;
  await load();
  if (prefill) send(prefill); else $("#ci").focus();
}

async function load() {
  $("#ctx").textContent = tripId ? "About this trip" : state.config.aiSearch ? "Searches the web for fresh info" : "";
  $("#quick").innerHTML = (tripId ? QUICK_TRIP : QUICK_GENERAL).map(q => `<button type="button">${esc(q)}</button>`).join("");
  $$("#quick button").forEach(b => (b.onclick = () => send(b.textContent)));
  if (loadedFor === tripId) return;
  loadedFor = tripId;
  const box = $("#msgs");
  box.innerHTML = "";
  if (!state.config.ai) { box.innerHTML = `<div class="msg assistant"><p>The chat needs a free AI key. Add <b>GEMINI_API_KEY</b> to the <b>.env</b> file and restart the server (see README). Everything else in Raahi works without it.</p></div>`; return; }
  try { const hist = await api("/api/chat?tripId=" + encodeURIComponent(tripId)); hist.forEach(m => add(m.role, m.text, m.sources)); } catch {}
  if (!box.children.length) hello();
  box.scrollTop = box.scrollHeight;
}
function hello() { add("assistant", `Namaste${state.user && state.user.name ? " " + state.user.name.split(" ")[0] : ""}! I'm Raahi. Ask me anything: best time to go, how many days you need, what to eat, whether a place is crowded right now…`); }

function add(role, text, sources) {
  const m = document.createElement("div");
  m.className = "msg " + role;
  m.innerHTML = role === "user" ? esc(text) : md(text);
  if (sources && sources.length) m.insertAdjacentHTML("beforeend", srcHTML(sources));
  $("#msgs").appendChild(m);
  $("#msgs").scrollTop = $("#msgs").scrollHeight;
  return m;
}
const srcHTML = s => `<div class="src">${s.slice(0, 5).map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join("")}</div>`;

async function send(text) {
  text = String(text || "").trim();
  if (!text || sending) return;
  if (!state.config.ai) { toast("The chat needs the free AI key (see README).", true); return; }
  sending = true;
  $("#ci").value = "";
  add("user", text);
  const m = add("assistant", "");
  m.innerHTML = `<span class="typing"><i></i><i></i><i></i></span>`;
  let full = "", sources = [];
  try {
    const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, tripId, context: state.page && state.page.name ? `on the ${state.page.name} page` : "" }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "The assistant couldn't answer."); }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
        if (!line.startsWith("data:")) continue;
        const ev = JSON.parse(line.slice(5));
        if (ev.t) { full += ev.t; m.innerHTML = md(full); $("#msgs").scrollTop = $("#msgs").scrollHeight; }
        if (ev.sources) sources = ev.sources;
        if (ev.error) throw new Error(ev.error);
      }
    }
    if (sources.length) m.insertAdjacentHTML("beforeend", srcHTML(sources));
    if (!full) m.innerHTML = md("Sorry, I didn't get an answer. Try asking again.");
  } catch (e) { m.innerHTML = `<p class="err" style="margin:0">${esc(e.message)}</p>`; }
  sending = false;
  $("#msgs").scrollTop = $("#msgs").scrollHeight;
}

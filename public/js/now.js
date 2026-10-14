// Full-screen "Next step" view: the widget. Add it to the home screen from the browser menu,
// or long-press the installed Raahi icon → "Next step".
import { $, api, esc, todayISO, toast } from "./core.js";
import { nextStep, nextStepHTML, startCompanion, companionOn, setCompanion, askNotify, sosPanel } from "./companion.js";

export async function render(view) {
  view.innerHTML = `<div style="max-width:560px;margin:0 auto"><div class="skeleton" style="height:220px"></div></div>`;
  let list = [];
  try { list = await api("/api/trips"); } catch (e) { view.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const today = todayISO();
  const endOf = t => new Date(new Date(t.start + "T00:00:00").getTime() + (t.days - 1) * 864e5).toISOString().slice(0, 10);
  const cur = list.find(t => t.start && t.days && t.start <= today && endOf(t) >= today);
  if (!cur) {
    const soon = list.filter(t => t.start && t.start > today).sort((a, b) => (a.start < b.start ? -1 : 1))[0];
    view.innerHTML = `<div style="max-width:560px;margin:0 auto">${nextStepHTML({ kind: "go", label: "NEXT STEP", title: soon ? `Your next trip: ${soon.title}` : "No trip today", sub: soon ? `Starts ${new Date(soon.start + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}. This screen comes alive on the day.` : "Plan a trip and this screen will guide you through each day." }, { big: true })}<a class="btn main" href="${soon ? "#/trip/" + esc(soon.id) : "#/plan"}">${soon ? "Open the plan" : "Plan a trip"}</a></div>`;
    return;
  }
  const t = await api("/api/trips/" + cur.id);
  const d = t.data;
  let stop = null, timer = null;
  const draw = (msg) => {
    const di = d.days.findIndex(x => x.date === today);
    view.innerHTML = `<div style="max-width:560px;margin:0 auto">
      <div class="between" style="margin-bottom:10px"><div><div class="mute" style="font-size:13px;font-weight:700">${esc(t.title)} · Day ${di + 1}</div><div style="font-size:44px;font-weight:300;letter-spacing:-.03em">${new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</div></div><button class="btn small ghost" id="sos" style="color:var(--bad);border-color:var(--bad)">🆘 SOS</button></div>
      <div id="sosBox" hidden style="margin-bottom:12px"></div>
      <div id="al"></div>
      ${nextStepHTML(nextStep(d, di), { big: true })}
      <div class="row" style="gap:14px"><label class="switch"><input type="checkbox" id="on" ${stop ? "checked" : ""}> Auto check-in with GPS</label><span class="help" style="margin:0" id="msg">${esc(msg || (stop ? "📍 On" : "Off"))}</span></div>
      <div class="row" style="margin-top:16px"><a class="btn ghost" href="#/trip/${esc(t.id)}?tab=live">Open today's plan</a></div>
      <p class="help" style="margin-top:18px">Tip: in Chrome, tap ⋮ → "Add to Home screen" on this page to keep your next step one tap away.</p></div>`;
    $("#on").onchange = e => { setCompanion(t.id, e.target.checked); e.target.checked ? go() : (stop && stop(), (stop = null), draw()); };
    $("#sos").onclick = () => sosPanel($("#sosBox"), { emergency: (d.info.find(x => x && x.emergency) || {}).emergency });
  };
  const go = () => {
    if (stop) return;
    askNotify();
    stop = startCompanion(t.id, () => d, { onUpdate: () => draw(), onStatus: m => { const el = $("#msg"); if (el) el.textContent = m; }, onAlert: a => { draw(); const el = $("#al"); if (el) el.innerHTML = `<div class="alertbar ${a.kind === "late" ? "late" : ""}"><span style="font-size:22px">⏰</span><div><b>${esc(a.title)}</b> ${esc(a.text)}</div></div>`; } });
    draw();
  };
  draw();
  if (companionOn(t.id)) go();
  timer = setInterval(() => { if (!document.querySelector("#sosBox:not([hidden])")) draw(); }, 60000);
  return () => { stop && stop(); clearInterval(timer); };
}

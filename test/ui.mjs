// Clicks through the whole website in a headless browser (fake outside services).
// Run: node test/ui.mjs  (needs Playwright; screenshots go to test/shots/)
import { createRequire } from "module";
import os from "os";
import path from "path";
import fs from "fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || "/opt/npm-tools/node_modules/playwright");
const fakes = require("./fakes.js");

const SHOTS = path.join(path.dirname(new URL(import.meta.url).pathname), "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const F = await fakes.start();
Object.assign(process.env, F.env, { DB_FILE: path.join(os.tmpdir(), `raahi-ui-${Date.now()}.db`), RATE_LIMIT: "100000" });
const server = require("../server.js");
await new Promise(r => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// Tiny stand-in for the Leaflet map library (the CDN isn't reachable from the test machine).
const LEAFLET = `window.L=(()=>{const ll=(a,b)=>({lat:a,lng:b});const chain=o=>Object.assign(o,{addTo(){return o},bindTooltip(){return o},openTooltip(){return o},on(){return o}});
const bounds=()=>({extend(){return this},isValid(){return true}});
return{map(el){el.innerHTML='<div style="width:100%;height:100%;background:repeating-linear-gradient(45deg,#e8e6dc,#e8e6dc 10px,#efede4 10px,#efede4 20px)" data-fakemap></div>';return chain({setView(){return this},fitBounds(){return this},flyTo(){return this},getCenter(){return ll(27.18,78.02)},remove(){},getContainer(){return el},invalidateSize(){}})},
tileLayer(){return chain({})},layerGroup(){const g=chain({items:[],clearLayers(){g.items=[]}});return g},featureGroup(){return chain({getBounds:bounds})},
marker(p){return chain({getLatLng(){return ll(p[0],p[1])}})},divIcon(o){return o},polyline(){return chain({getBounds:bounds})},latLngBounds:bounds,geoJSON(){return chain({getBounds:bounds})}}})();`;

const browser = await chromium.launch();
const errors = [];
let current = null;
async function page(w, h, name) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, geolocation: { latitude: 27.172, longitude: 78.035 }, permissions: ["geolocation"], timezoneId: "Asia/Kolkata", locale: "en-IN" });
  const p = await ctx.newPage();
  current = p;
  await p.route(/cdnjs\.cloudflare\.com\/.*leaflet.*\.js/, r => r.fulfill({ contentType: "text/javascript", body: LEAFLET }));
  await p.route(/cdnjs\.cloudflare\.com\/.*\.css|fonts\.(googleapis|gstatic)\.com|tile\.openstreetmap\.org|accounts\.google\.com/, r => r.fulfill({ body: "", contentType: "text/css" }));
  p.on("pageerror", e => errors.push(`[${name}] ${e.message}`));
  p.on("console", m => { if (m.type() === "error" && !/Failed to load resource|favicon|service worker|ServiceWorker/i.test(m.text())) errors.push(`[${name}] console: ${m.text()}`); });
  return p;
}
const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: false });
const step = async (label, fn) => { process.stdout.write(label + " … "); await fn(); console.log("ok"); };

try {
  const p = await page(1280, 860, "desktop");
  await step("landing page", async () => {
    await p.goto(BASE + "/");
    await p.waitForSelector("text=Your whole trip, planned to the minute.");
    await shot(p, "01-landing");
  });
  await step("continue as guest → onboarding questions", async () => {
    await p.click("#guest");
    await p.waitForSelector("text=Let's get to know you");
    await p.fill("#nm", "Yug");
    await p.click("#pace [data-v=fast]");
    await p.click("#early [data-v=yes]");
    await p.click("#diet [data-v=veg]");
    await p.click("#int [data-v=history]"); await p.click("#int [data-v=temples]");
    await p.fill("#homeCity input", "Agra");
    await p.waitForSelector(".sug li"); await p.click(".sug li");
    await shot(p, "02-onboarding");
    await p.click("#save");
    await p.waitForSelector("text=Namaste, Yug");
    await shot(p, "03-home");
  });
  await step("wizard: where / when (ask Raahi) / how long / stay / times / pace / likes / people / detail", async () => {
    // Home shows every feature, including Baby mode, Around one place and Thread trip
    for (const sel of ["#babyCard", "a.card[href='#/explore?mode=around']", "a.card[href='#/explore?mode=thread']"]) await p.waitForSelector(sel);
    // Story slideshow: five illustrative stories, labelled as such, sliding one after another
    await p.waitForSelector(".stories .st-slide");
    if ((await p.$$eval(".st-slide", x => x.length)) !== 5) throw new Error("expected 5 stories");
    if ((await p.$$eval(".st-label", x => x.filter(e => /Illustrative/.test(e.textContent)).length)) !== 5) throw new Error("every story must be labelled illustrative");
    await p.click(".st-next"); await p.waitForSelector(".st-dots button[data-i='1'][aria-selected=true]");
    await p.$eval(".stories", el => el.scrollIntoView()); await p.waitForTimeout(700); await shot(p, "03c-stories");
    await p.click("#babyCard"); await p.waitForSelector("#babyCard.on"); await p.waitForTimeout(400); await shot(p, "03b-home-baby-on");
    await p.click("#babyCard"); await p.waitForSelector("#babyCard:not(.on)");
    await p.click("a.card[href='#/plan']");
    await p.waitForSelector("text=Where are you going?");
    await p.fill("#segs input", "Agra"); await p.waitForSelector(".sug li"); await p.click(".sug li");
    await shot(p, "04-wizard-where");
    await p.click("#next");
    await p.click("#dm [data-v=help]");
    await p.click("#askWhen");
    await p.waitForSelector("text=October to March is best.");
    await p.click("#useD");
    await shot(p, "05-wizard-when");
    await p.click("#next");
    await p.click("#askLen"); await p.waitForSelector("#adv .advice");
    await p.click("#next");
    await p.fill("#stays input", "Hotel near Taj Mahal"); await p.waitForSelector(".sug li"); await p.click(".sug li");
    await p.click("#next");
    await p.selectOption("#lt", { label: "" }).catch(() => {});
    await p.fill("#lt", "18:00");
    await p.click("#next");
    await p.waitForSelector("#pc [data-v=fast][aria-pressed=true]");
    await p.click("#next");
    await p.click("#in [data-v=mosques]");
    await shot(p, "06-wizard-likes");
    await p.click("#next");
    await p.fill("#bg", "20000");
    await p.click("#next");
    await p.click("#dl [data-v=review]");
    await p.fill("#nt", "My mother can't climb many stairs.");
    await shot(p, "07-wizard-detail");
    await p.click("#next");
  });
  await step("planning progress → pick places", async () => {
    await p.waitForSelector("text=Pick your places", { timeout: 20000 });
    await shot(p, "08-review");
    const n = await p.$$eval(".pick", x => x.length);
    if (n < 6) throw new Error("only " + n + " places to pick");
    await p.click(".pick:has-text('Kinari Bazaar') input[type=checkbox]").catch(() => {});
    await p.click(".pick:has-text('Taj Mahal') .cmp");
    await p.click(".pick:has-text('Agra Fort') .cmp");
    await p.click("#cmpGo");
    await p.waitForSelector("text=Raahi picked Taj Mahal");
    await shot(p, "08b-raahi-decides");
    await p.click(".pick:has-text('Taj Mahal') .must");
    await p.click("#go");
  });
  let tripUrl;
  await step("plan tab: days, timeline, lunch, restaurants, Google Maps link", async () => {
    await p.waitForSelector(".tl .stop-li", { timeout: 20000 });
    tripUrl = p.url();
    await p.waitForSelector("a:has-text('Open day in Google Maps')");
    await shot(p, "09-plan-day1");
    await p.click(".days [data-day='1']");
    await p.waitForSelector(".days [data-day='1'][aria-selected=true]"); await p.waitForSelector(".stop-li");
    if (!(await p.$("text=Lunch break"))) { await p.click(".days [data-day='0']"); await p.waitForSelector("text=Lunch break"); await p.click(".days [data-day='1']"); }
    await p.screenshot({ path: path.join(SHOTS, "10-plan-day2-full.png"), fullPage: true });
  });
  await step("famous food: 'Want to have it?' → added at the right time; souvenirs", async () => {
    await p.waitForSelector("text=Want to have it?");
    await shot(p, "10b-food-prompt");
    await p.click("[data-food]");
    await p.waitForSelector("text=Added to your plan");
    await p.waitForSelector(".stop-li:has-text('😋')");
    await p.click(".days [data-day='1']");
    await p.waitForSelector("text=bring back");
  });
  await step("TinyFish: check all live on Google Maps", async () => {
    await p.click("#vfAll");
    await p.waitForSelector("text=TinyFish is checking Google Maps");
    await p.waitForSelector("text=Live on Google Maps", { timeout: 30000 });
    await p.waitForSelector("text=Last 5 days: 3.5★");
    await shot(p, "10c-tinyfish-verified");
  });
  await step("crowds & news (live web search)", async () => {
    await p.click("#pulse");
    await p.waitForSelector(".pulse");
    await p.waitForSelector("text=Very crowded this week");
    await p.waitForSelector("text=via TinyFish");
    await shot(p, "11-pulse");
  });
  await step("move / remove / add place / more ideas", async () => {
    const first = await p.$(".stop-li .rm");
    await first.click();
    await p.waitForSelector("text=Re-planned", { timeout: 10000 });
    await p.fill("#addPs input", "Guru Ka Taal"); await p.waitForSelector("#addPs .sug li"); await p.click("#addPs .sug li");
    await p.click("#addGo");
    await p.waitForSelector("text=Added and re-planned", { timeout: 10000 });
    await p.waitForSelector("text=More ideas in Agra");
  });
  await step("live tab: what's still possible, check-in, use new plan", async () => {
    await p.click("[data-tab=live]");
    await p.waitForSelector("text=RIGHT NOW");
    await p.click("#chk");
    await p.waitForSelector("text=Your remaining stops", { timeout: 10000 });
    await shot(p, "12-live");
    const btn = await p.$("#tb [data-ci=arrived]");
    if (btn) { await btn.click(); await p.waitForSelector("text=Checked in"); }
    const done = await p.$("#tb [data-ci=done]");
    if (done) { await done.click(); await p.waitForSelector("text=Done:"); }
    await p.click("#chk");
    await p.waitForSelector("text=Your remaining stops");
    const use = await p.$("#use");
    if (use) { await use.click(); await p.waitForSelector("text=Today's plan updated"); }
  });
  await step("budget tab: estimate + expenses", async () => {
    await p.click("[data-tab=budget]");
    await p.waitForSelector("text=Estimated cost");
    await p.fill("#ea", "450"); await p.fill("#en", "Lunch at Shree Bhojnalaya"); await p.click("#ex button");
    await p.waitForSelector("text=Lunch at Shree Bhojnalaya");
    await shot(p, "13-budget");
  });
  await step("info tab: best time, food, packing, emergency", async () => {
    await p.click("[data-tab=info]");
    await p.waitForSelector("text=Best time to visit");
    await p.click("[data-pack='Sunscreen']");
    await p.waitForSelector("text=Tourist helpline 1363");
    await shot(p, "14-info");
  });
  await step("chat box streams an answer with sources", async () => {
    await p.click("#ask");
    await p.waitForSelector(".msg.assistant:has-text('October to March')", { timeout: 10000 });
    await p.waitForSelector(".msg .src a");
    await shot(p, "15-chat");
    await p.click("#cx");
  });
  await step("share link opens read-only", async () => {
    await p.click("#share");
    await p.waitForSelector("#shu");
    const url = (await p.inputValue("#shu")).replace(/^https?:\/\/[^/]+/, BASE);
    const p2 = await page(1280, 860, "shared");
    await p2.goto(url);
    await p2.waitForSelector("text=You're viewing a shared trip");
    if (await p2.$("[data-tab=budget]")) throw new Error("budget visible on shared view");
    await p2.close();
  });
  await step("print view renders all days", async () => {
    await p.click("[data-tab=plan]");
    await p.evaluate(() => { window.print = () => {}; });
    await p.click("#print");
    const days = await p.$$eval("#printArea .day-print", x => x.length);
    if (days !== 2) throw new Error("print days " + days);
    await p.emulateMedia({ media: "print" });
    await p.screenshot({ path: path.join(SHOTS, "16-print.png"), fullPage: true });
    await p.emulateMedia({ media: "screen" });
  });
  await step("explore ideas from home → plan this trip", async () => {
    await p.goto(BASE + "/#/explore");
    await p.waitForSelector("text=Where can I go?");
    await p.fill("#dy", "6"); await p.fill("#bg", "30000");
    await p.click("#go");
    await p.waitForSelector("text=Krishna trail", { timeout: 10000 });
    await shot(p, "17-explore");
    await p.click("[data-plan='0']");
    await p.waitForSelector("text=Where are you going?");
    const vals = await p.$$eval("#segs input", x => x.map(i => i.value));
    if (vals.length !== 2) throw new Error("prefill segments " + vals);
  });
  await step("thread trip: loop through many places → plan it day by day", async () => {
    await p.goto(BASE + "/#/explore");
    await p.waitForSelector("text=Where can I go?");
    await p.click("#mode [data-v=thread]");
    await p.fill("#dy", "5"); await p.fill("#inc", "Isha, Palani, Meenakshi Temple"); await p.fill("#rg", "Tamil Nadu");
    await p.click("#go");
    await p.waitForSelector(".thread-line", { timeout: 10000 });
    await p.waitForSelector("text=First, reach Bengaluru");
    await p.waitForSelector("text=Shayana Aarti at Meenakshi Temple");
    await p.$eval(".thread-head", el => el.scrollIntoView());
    await shot(p, "17b-thread");
    await p.click("#planT");
    await p.waitForSelector("text=Where are you going?");
    const vals = await p.$$eval("#segs input", x => x.map(i => i.value));
    if (vals.length !== 4) throw new Error("thread prefill segments " + vals);
    await p.click("#rest");
    for (let i = 0; i < 6 && !/#\/trip\//.test(p.url()); i++) { await p.click("#next", { timeout: 3000 }).catch(() => {}); await p.waitForTimeout(300); }
    await p.waitForURL(/#\/trip\//, { timeout: 10000 });
    const r = await Promise.race([p.waitForSelector("button#go:has-text('day-by-day')", { timeout: 20000 }).then(() => "review"), p.waitForSelector(".thread-card", { timeout: 20000 }).then(() => "plan")]);
    if (r === "review") await p.click("button#go:has-text('day-by-day')");
    await p.waitForSelector(".thread-card", { timeout: 20000 });
    await p.waitForSelector("text=Temples & hills loop");
    const title = await p.textContent("#ttl");
    if (!/^5 days/.test(title)) throw new Error("thread trip length changed: " + title);
    await shot(p, "17c-thread-trip");
  });
  await step("plan a trip → 'Coimbatore' → make it a thread (auto-runs)", async () => {
    await p.goto(BASE + "/#/plan");
    await p.waitForSelector("text=Where are you going?");
    await p.fill("#segs input", "Coimbatore"); await p.waitForSelector(".sug li"); await p.click(".sug li");
    await p.click("#thLink");
    await p.waitForSelector(".thread-line", { timeout: 10000 });
    const lbl = await p.textContent("#homeLbl");
    if (!/base/.test(lbl)) throw new Error("not in around-one-place mode: " + lbl);
    // Baby mode: one switch for the whole site
    await p.click("#baby");
    await p.waitForSelector("#babybar:not([hidden])");
    await shot(p, "17d-baby-mode");
    await p.click("#babyOff");
    await p.waitForSelector("#babybar", { state: "hidden" });
  });
  await step("route optimiser: share link + typed stops (spinner clears)", async () => {
    await p.goto(BASE + "/#/route");
    await p.waitForSelector("text=Route optimiser");
    await p.fill("#link", `Check out this route ${F.base}/short`);
    await p.click("#imp");
    await p.waitForSelector("text=Open in Google Maps", { timeout: 10000 });
    const spinning = await p.$$eval("#imp .spin", x => x.length);
    if (spinning) throw new Error("spinner still showing");
    const label = await p.textContent("#imp");
    if (!/Optimise/.test(label)) throw new Error("button label not restored: " + label);
    await shot(p, "18-route");
    await p.click("#clr");
    const inputs = await p.$$("#stops input");
    for (const [i, q] of ["Agra Fort", "Mathura", "Taj Mahal"].entries()) { await inputs[i].fill(q); await p.waitForSelector(".sug li"); await p.click(".sug li"); }
    await p.click("#go");
    await p.waitForSelector("text=Starting point");
    if (await p.$$eval("#go .spin", x => x.length)) throw new Error("spinner stuck on Find shortest route");
  });
  await step("'I'm here now' quick plan", async () => {
    await p.goto(BASE + "/#/plan?here=1");
    await p.waitForSelector("text=Where are you right now?");
    await p.fill("#segs input", "Agra"); await p.waitForSelector(".sug li"); await p.click(".sug li");
    for (let i = 0; i < 7; i++) { await p.click("#next"); await p.waitForTimeout(80); }
    await p.click("#next");
    await p.waitForSelector(".tl .stop-li", { timeout: 20000 }); await shot(p, "19a-here-now");
  });
  await step("create account keeps guest trips; profile", async () => {
    await p.goto(BASE + "/#/login?new=1");
    await p.waitForSelector("text=Create your free account");
    await p.fill("#n", "Yug Gupta"); await p.fill("#i", "9876543210"); await p.fill("#p", "secret12");
    await p.click("#f button");
    await p.waitForSelector("text=Your trips");
    await p.waitForSelector("#trips a.card", { timeout: 10000 });
    const n = await p.$$eval("#trips a.card", x => x.length);
    if (n < 2) throw new Error("trips after signup: " + n);
    // Delete a trip right from the list (tap, then confirm)
    const before = await p.$$eval(".trip-row", x => x.length);
    await p.click(".trip-row:last-child .trip-del");
    await p.waitForSelector(".trip-del.armed");
    await p.click(".trip-del.armed");
    await p.waitForSelector("text=Trip deleted");
    const after = await p.$$eval(".trip-row", x => x.length);
    if (after !== before - 1) throw new Error(`delete from list: ${before} → ${after}`);
    await p.reload(); await p.waitForSelector("#trips a.card");
    if ((await p.$$eval(".trip-row", x => x.length)) !== before - 1) throw new Error("deleted trip came back after reload");
    await p.goto(BASE + "/#/profile");
    await p.waitForSelector("text=Your pace, learned");
    await shot(p, "19-profile");
  });

  await step("companion: next-step card, GPS auto check-in/out, recap, /now page", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, geolocation: { latitude: 27.16, longitude: 78.03 }, permissions: ["geolocation", "notifications"], timezoneId: "Asia/Kolkata" });
    const c = await ctx.newPage(); current = c;
    await c.route(/cdnjs\.cloudflare\.com\/.*leaflet.*\.js/, r => r.fulfill({ contentType: "text/javascript", body: LEAFLET }));
    await c.route(/cdnjs\.cloudflare\.com\/.*\.css|fonts\.(googleapis|gstatic)\.com|tile\.openstreetmap\.org|accounts\.google\.com/, r => r.fulfill({ body: "", contentType: "text/css" }));
    c.on("pageerror", e => errors.push(`[companion] ${e.message}`));
    await c.clock.install({ time: new Date() });
    await c.goto(BASE + "/");
    await c.click("#guest"); await c.waitForSelector("text=Let's get to know you"); await c.click("#skip"); await c.waitForSelector("text=Your trips");
    const id = await c.evaluate(async () => {
      const d = new Date(), today = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
      const r = await fetch("/api/trips", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ segments: [{ destination: { label: "Agra" }, days: 1, stay: { label: "Hotel near Taj, Agra" } }], start: today, detail: "quick", startTime: "06:00", endTime: "23:30" }) });
      return (await r.json()).id;
    });
    for (let i = 0; i < 100; i++) { const st = await c.evaluate(async id => (await (await fetch("/api/trips/" + id)).json()).data.status, id); if (st === "ready") break; await c.waitForTimeout(100); }
    const trip = await c.evaluate(async id => (await (await fetch("/api/trips/" + id)).json()).data, id);
    const visits = trip.days[0].items.filter(i => i.type === "visit");
    const p0 = trip.places[visits[0].id];
    await c.goto(BASE + "/#/trip/" + id);
    await c.waitForSelector(".nextstep");
    await c.waitForSelector(`.nextstep:has-text("${p0.name}")`);
    await shot(c, "24-next-step-card");
    // Walk to the first stop and stay 4 minutes
    await ctx.setGeolocation({ latitude: p0.lat, longitude: p0.lng });
    const until = async (sel, n = 10) => { for (let i = 0; i < n; i++) { if (await c.$(sel)) return; await c.clock.fastForward(61000); await c.waitForTimeout(700); } const dbg = await c.evaluate(async id => (await (await fetch("/api/trips/" + id)).json()).data.presence, id); throw new Error("never saw " + sel + " presence=" + JSON.stringify(dbg)); };
    await until("text=Checked in at");
    await c.waitForSelector(".nextstep:has-text(\"YOU'RE HERE\")");
    await shot(c, "25-auto-checked-in");
    // Leave
    await ctx.setGeolocation({ latitude: p0.lat + 0.02, longitude: p0.lng });
    await until("text=Checked out of");
    // SOS
    await c.click("#sos");
    await c.waitForSelector("text=District Hospital");
    await shot(c, "26-sos");
    await c.click("#sosBox [data-x]");
    // Family live share
    await c.click("#share"); await c.waitForSelector("#shl"); await c.check("#shl"); await c.waitForSelector("text=Family can now follow");
    const url = await c.inputValue("#shu");
    const fam = await page(390, 844, "family");
    await fam.goto(url);
    await fam.waitForSelector("text=LIVE");
    await shot(fam, "27-family-view");
    await fam.close(); current = c;
    // Rain plan
    await c.click("#rainGo");
    await c.waitForSelector("text=Rain plan", { timeout: 15000 });
    await shot(c, "28-rain-plan");
    // Split expenses
    await c.click("[data-tab=budget]");
    await c.fill("#pp", "Pranav, Anshee"); await c.click("#ppSave"); await c.waitForSelector("#ep");
    await c.fill("#ea", "900"); await c.selectOption("#ep", "Pranav"); await c.click("#ex button");
    await c.waitForSelector("text=Anshee pays Pranav");
    await shot(c, "29-split");
    // Day recap after finishing all stops
    for (const v of visits.slice(1)) await c.evaluate(async ([id, pid]) => fetch(`/api/trips/${id}/checkin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ placeId: pid, state: "done" }) }), [id, v.id]);
    await c.reload();
    await c.waitForSelector("text=RECAP");
    // All stops done: "That's a wrap", or lunch first if the test runs at lunchtime.
    await c.waitForSelector(".nextstep:has-text(\"That's a wrap\"), .nextstep:has-text(\"Time for lunch\")");
    await shot(c, "30-recap");
    // Full-screen next step
    await c.goto(BASE + "/#/now");
    await c.waitForSelector(".nextstep.big");
    await shot(c, "31-now");
    await ctx.close();
  });

  // Phone size
  const m = await page(390, 844, "mobile");
  await step("mobile: home, trip, live, chat", async () => {
    await m.goto(BASE + "/");
    await m.click("#guest");
    await m.waitForSelector("text=Let's get to know you");
    await m.click("#skip");
    await m.waitForSelector("text=Your trips");
    await shot(m, "20-m-home");
    await m.goto(tripUrl.replace(/^https?:\/\/[^/]+/, BASE)); // someone else's trip → error card
    await m.waitForSelector("text=Couldn't open this trip");
    await m.goto(BASE + "/#/plan");
    await m.fill("#segs input", "Agra"); await m.waitForSelector(".sug li"); await m.click(".sug li");
    await m.click("#next"); await m.click("#dm [data-v=fixed]"); await m.fill("#sd", "2026-10-24");
    await m.click("#rest"); // ✨ Let Raahi decide the rest
    await m.waitForSelector(".tl .stop-li", { timeout: 20000 });
    await shot(m, "21-m-plan");
    await m.click("[data-tab=live]");
    await m.click("#chk");
    await m.waitForSelector("text=Your remaining stops");
    await shot(m, "22-m-live");
    await m.click("#tabChat");
    await m.waitForSelector(".chat:not([hidden])");
    await m.click("#quick button");
    await m.waitForSelector(".msg.assistant >> nth=1");
    await shot(m, "23-m-chat");
    const over = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (over) throw new Error("page scrolls sideways on mobile");
  });
} catch (e) {
  console.log("FAILED\n", e.message);
  if (current) { await current.screenshot({ path: path.join(SHOTS, "zz-failure.png"), fullPage: true }).catch(() => {}); console.log("url:", current.url()); }
  process.exitCode = 1;
} finally {
  if (errors.length) { console.log("\nBrowser errors:\n" + [...new Set(errors)].join("\n")); process.exitCode = 1; }
  await browser.close(); server.close(); F.close();
}

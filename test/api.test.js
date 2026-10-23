// End-to-end API tests: real Raahi server, fake outside services.
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fakes = require("./fakes");

let F, base, server;
const jar = { c: "" };
async function call(method, p, body, j = jar) {
  const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", Cookie: j.c }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie");
  if (sc) j.c = sc.split(";")[0];
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function waitTrip(id, j = jar, want = ["ready", "review", "error"]) {
  for (let i = 0; i < 200; i++) {
    const r = await call("GET", "/api/trips/" + id, null, j);
    if (want.includes(r.data.data.status) && !r.data.planning) return r.data;
    await wait(50);
  }
  throw new Error("trip never finished");
}

test.before(async () => {
  F = await fakes.start();
  Object.assign(process.env, F.env, { DB_FILE: path.join(os.tmpdir(), `raahi-test-${process.pid}.db`), RATE_LIMIT: "100000" });
  server = require("../server");
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); F.close(); });

test("config and guest sign-in", async () => {
  const c = await call("GET", "/api/config");
  assert.strictEqual(c.data.ai, true);
  assert.strictEqual(c.data.googleClientId, "test-client");
  assert.strictEqual((await call("GET", "/api/trips")).data.length, 0);
  const g = await call("POST", "/api/auth/guest", {});
  assert.ok(g.data.user.guest);
  const me = await call("GET", "/api/me");
  assert.strictEqual(me.data.user.id, g.data.user.id);
});

test("rejects non-JSON posts (protects against other sites)", async () => {
  const r = await fetch(base + "/api/auth/guest", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
  assert.strictEqual(r.status, 415);
});

test("onboarding preferences are saved", async () => {
  const r = await call("PUT", "/api/me", { name: "Yug", prefs: { pace: "fast", diet: "veg", early: true, interests: ["history", "temples"], homeCity: "Agra" } });
  assert.strictEqual(r.data.user.prefs.pace, "fast");
  assert.ok(r.data.user.prefs.onboarded);
});

let tripId;
test("plan a 2-day Agra trip with review step", async () => {
  const r = await call("POST", "/api/trips", { segments: [{ destination: { label: "Agra" }, days: 2, stay: { label: "Hotel near Taj, Agra" } }], start: "2026-10-23", travellers: 2, diet: "veg", interests: ["history"], detail: "review", leaveTime: "18:00" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  tripId = r.data.id;
  const t = await waitTrip(tripId);
  assert.strictEqual(t.data.status, "review", t.data.error);
  const pl = Object.values(t.data.places);
  assert.ok(pl.length >= 8, "places: " + pl.length);
  const taj = pl.find(p => p.name === "Taj Mahal");
  assert.strictEqual(taj.hoursSource, "OpenStreetMap");
  assert.match(taj.hoursDesc, /Closed Fri/);
  assert.ok(t.data.info[0].summary);
  // Choose everything, make the Taj a must-see
  const sel = await call("POST", `/api/trips/${tripId}/select`, { selected: pl.map(p => p.id), must: [taj.id] });
  assert.strictEqual(sel.status, 200);
  const done = await waitTrip(tripId);
  assert.strictEqual(done.data.status, "ready", done.data.error);
  assert.strictEqual(done.data.days.length, 2);
  // 2026-10-23 is a Friday: the Taj Mahal is closed, so it must be on day 2 (Saturday).
  const d1 = done.data.days[0].items.filter(i => i.type === "visit").map(i => done.data.places[i.id].name);
  const d2 = done.data.days[1].items.filter(i => i.type === "visit").map(i => done.data.places[i.id].name);
  assert.ok(!d1.includes("Taj Mahal") && d2.includes("Taj Mahal"), JSON.stringify({ d1, d2 }));
  // Fast pace → up to 7 stops a day; times are in order and inside opening hours
  for (const day of done.data.days) {
    let last = 0;
    for (const it of day.items) { assert.ok(it.start >= last - 1, "times in order"); last = it.end; }
    assert.ok(day.maps.length >= 1 && day.maps[0].startsWith("https://www.google.com/maps/dir/"));
    assert.ok(day.weather && day.weather.max === 31);
    assert.ok(day.meals.dinner.length && day.meals.dinner[0].veg === "pure-veg", "veg restaurant first");
  }
  assert.ok(done.data.days[0].items.some(i => i.type === "meal"), "lunch break");
  // Last day ends by 17:00 because they leave at 18:00
  assert.ok(done.data.days[1].finish <= 17 * 60 + 10);
  const list = await call("GET", "/api/trips");
  assert.strictEqual(list.data[0].title, "2 days in Agra");
});

test("live mode: is it still possible to go?", async () => {
  const t = (await call("GET", "/api/trips/" + tripId)).data;
  const day = t.data.days[1];
  const first = day.items.find(i => i.type === "visit");
  await call("POST", `/api/trips/${tripId}/checkin`, { placeId: first.id, state: "arrived", at: Date.now() - 80 * 60e3 });
  const c = await call("POST", `/api/trips/${tripId}/checkin`, { placeId: first.id, state: "done", at: Date.now() });
  assert.ok(c.data.checkins[first.id].done);
  // It's 17:50: everything closing at 18:00 is too late
  const late = await call("POST", `/api/trips/${tripId}/live`, { day: 1, nowMin: 17 * 60 + 50, lat: 27.17, lng: 78.03 });
  assert.strictEqual(late.status, 200, JSON.stringify(late.data));
  const fort = late.data.items.find(i => i.name === "Agra Fort" || i.name === "Akbar's Tomb");
  if (fort) assert.ok(["late", "toolate"].includes(fort.verdict), JSON.stringify(fort));
  assert.ok(!late.data.items.find(i => i.id === first.id), "visited place not listed");
  const early = await call("POST", `/api/trips/${tripId}/live`, { day: 1, nowMin: 10 * 60, lat: 27.17, lng: 78.03 });
  assert.ok(early.data.items.some(i => i.verdict === "ok"));
  assert.ok(early.data.replan.items.length >= 1);
  const ap = await call("POST", `/api/trips/${tripId}/today`, { day: 1, items: early.data.replan.items });
  assert.ok(ap.data.data.days[1].replannedAt);
  const me = await call("GET", "/api/me");
  assert.strictEqual(me.data.user.stats.visits, 1);
});

test("crowds & news: TinyFish searches the past week, AI scores it", async () => {
  const t = (await call("GET", "/api/trips/" + tripId)).data;
  const taj = Object.values(t.data.places).find(p => p.name === "Taj Mahal");
  const ids = [taj.id, ...Object.keys(t.data.places).filter(x => x !== taj.id).slice(0, 2)];
  const before = F.calls.tfSearch || 0;
  const r = await call("POST", `/api/trips/${tripId}/pulse`, { placeIds: ids });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const v = r.data.pulse[taj.id];
  assert.strictEqual(v.score, 4);
  assert.strictEqual(v.via, "TinyFish");
  assert.ok(v.sources.some(s => s.url.includes("reddit.com")), "reddit evidence");
  assert.ok(v.sources.some(s => /timesofindia/.test(s.title)), "news evidence");
  assert.ok((F.calls.tfSearch || 0) >= before + 9, "3 searches per place");
  const n = F.calls.tfSearch;
  await call("POST", `/api/trips/${tripId}/pulse`, { placeIds: ids });
  assert.strictEqual(F.calls.tfSearch, n, "second check is cached");
});

test("TinyFish browser agent verifies a place on Google Maps (today's hours, busy now, last 5 days reviews, official site)", async () => {
  const t = (await call("GET", "/api/trips/" + tripId)).data;
  const taj = Object.values(t.data.places).find(p => p.name === "Taj Mahal");
  // give it an official website so Fetch is used too
  let r = await call("POST", `/api/trips/${tripId}/verify`, { placeIds: [taj.id] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(r.data.status[taj.id].status, "running");
  let v;
  for (let i = 0; i < 100; i++) {
    r = await call("POST", `/api/trips/${tripId}/verify/status`, { placeIds: [taj.id] });
    if (r.data.status[taj.id].status !== "running") { v = r.data.verified[taj.id]; break; }
    await wait(100);
  }
  assert.ok(v, JSON.stringify(r.data));
  assert.strictEqual(v.busyNow, "Busier than usual");
  assert.deepStrictEqual(v.todayWindow, [360, 1020]);
  assert.deepStrictEqual(v.last5, { count: 2, avg: 3.5 });
  assert.strictEqual(v.reviews.length, 3);
  // Live mode now uses today's real closing time (5 pm, not 6:30 pm)
  const today = new Date().toISOString().slice(0, 10);
  const trip = (await call("GET", "/api/trips/" + tripId)).data;
  const dayIdx = trip.data.days.findIndex(d => d.items.some(i => i.id === taj.id));
  trip.data.days[Math.max(0, dayIdx)].date = today; // pretend the trip is today
  require("../lib/db").trips.save(tripId, trip.data);
  await call("POST", `/api/trips/${tripId}/checkin`, { placeId: taj.id, state: "undo" });
  const l = await call("POST", `/api/trips/${tripId}/live`, { day: Math.max(0, dayIdx), nowMin: 16 * 60, lat: 27.17, lng: 78.04 });
  const f = l.data.items.find(i => i.id === taj.id);
  assert.ok(f && f.closesAt === 1020, JSON.stringify(f));
});

test("Let Raahi decide: Taj Mahal or Agra Fort?", async () => {
  const t = (await call("GET", "/api/trips/" + tripId)).data;
  const pl = Object.values(t.data.places);
  const taj = pl.find(p => p.name === "Taj Mahal"), fort = pl.find(p => p.name === "Agra Fort");
  const r = await call("POST", `/api/trips/${tripId}/decide`, { placeIds: [fort.id, taj.id], keep: 1, apply: true, replan: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.deepStrictEqual(r.data.pick, [taj.id]);
  assert.match(r.data.why, /one of a kind/);
  assert.strictEqual(r.data.trip.data.places[fort.id].selected, false);
  assert.ok(!r.data.trip.data.days.some(d => d.items.some(i => i.id === fort.id)));
});

test("edit: remove, add a place, move to another day", async () => {
  let t = (await call("GET", "/api/trips/" + tripId)).data;
  const anyVisit = t.data.days[0].items.find(i => i.type === "visit");
  let r = await call("POST", `/api/trips/${tripId}/replan`, { remove: [anyVisit.id] });
  assert.ok(!r.data.data.days.some(d => d.items.some(i => i.id === anyVisit.id)));
  r = await call("POST", `/api/trips/${tripId}/places`, { label: "Guru Ka Taal, Agra", day: 0 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const added = Object.values(r.data.data.places).find(p => p.userAdded);
  assert.ok(r.data.data.days[0].items.some(i => i.id === added.id), "added to day 1");
  assert.strictEqual(added.rating, 8.1, "AI filled the details");
});

test("famous food: ask, add at the right time, Let Raahi pick; souvenirs", async () => {
  let t = (await call("GET", "/api/trips/" + tripId)).data;
  const fs0 = t.data.info[0].foodStops;
  assert.strictEqual(fs0.length, 3);
  assert.match(fs0[2].tip, /extra malai/);
  assert.strictEqual(t.data.info[0].souvenirs.length, 2);
  assert.ok(Object.values(t.data.places).some(p => p.nearbyFood));
  let r = await call("POST", `/api/trips/${tripId}/food`, { seg: 0, index: 0, day: 1 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const food = Object.values(r.data.data.places).find(p => p.food && /Bedai/.test(p.food.dish));
  const item = r.data.data.days[1].items.find(i => i.id === food.id);
  assert.ok(item, "scheduled on day 2");
  assert.ok(item.start >= 7 * 60 && item.end <= 11 * 60, "breakfast time: " + item.start);
  assert.ok(r.data.data.info[0].foodStops[0].added);
  r = await call("POST", `/api/trips/${tripId}/food/dismiss`, { seg: 0, index: 1 });
  assert.ok(r.data.data.info[0].foodStops[1].dismissed);
  r = await call("POST", `/api/trips/${tripId}/food`, { seg: 0, decide: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.data.info[0].foodStops[2].added, "Raahi picked the lassi");
});

test("GPS auto check-in and check-out, leave-by alert", async () => {
  const r0 = await call("POST", "/api/trips", { segments: [{ destination: { label: "Agra" }, days: 1, stay: { label: "Hotel near Taj, Agra" } }], start: "2026-11-07", detail: "quick" });
  const t = await waitTrip(r0.data.id);
  const tid = r0.data.id, day = t.data.days[0];
  const first = day.items.find(i => i.type === "visit"), p = t.data.places[first.id];
  const T0 = Date.parse("2026-11-07T09:00:00+05:30");
  const pos = (lat, lng, mins, nowMin) => call("POST", `/api/trips/${tid}/position`, { lat, lng, acc: 20, at: T0 + mins * 60e3, day: 0, nowMin });
  let r = await pos(p.lat + 0.0005, p.lng, 0, first.start);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(r.data.event, null, "not yet: must stay 3 min");
  assert.strictEqual(r.data.presence.placeId, p.id);
  r = await pos(p.lat + 0.0004, p.lng, 4, first.start + 4);
  assert.strictEqual(r.data.event.type, "arrived");
  assert.ok(r.data.checkins[p.id].auto && r.data.checkins[p.id].arrived === T0);
  // Close to the planned leaving time: alert
  const nx = day.items.find((i, k) => i.type === "visit" && k > day.items.indexOf(first));
  if (nx) { r = await pos(p.lat + 0.0004, p.lng, 60, nx.start - nx.travel + 10); assert.ok(r.data.alert && /Leave|Time to leave/.test(r.data.alert.title), JSON.stringify(r.data.alert)); }
  r = await pos(p.lat + 0.01, p.lng, 70, first.end);
  assert.strictEqual(r.data.event.type, "left");
  assert.ok(r.data.checkins[p.id].done);
  assert.strictEqual(r.data.presence, null);
});

test("rain plan moves outdoor stops out of rainy hours", async () => {
  const today = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  const r0 = await call("POST", "/api/trips", { segments: [{ destination: { label: "Agra" }, days: 1, stay: { label: "Hotel near Taj, Agra" } }], start: today, detail: "quick", pace: "balanced" });
  const t = await waitTrip(r0.data.id);
  const r = await call("POST", `/api/trips/${r0.data.id}/rainplan`, { day: 0 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.rain);
  assert.deepStrictEqual(r.data.windows, [[840, 1020]]);
  if (r.data.moves && r.data.moves.length) assert.ok(r.data.moves.filter(m => m.wet).length <= t.data.days[0].items.filter(i => i.type === "visit" && i.start < 1020 && i.end > 840 && require("../lib/trips").OUTDOOR.has(t.data.places[i.id].category)).length, "no more outdoor stops in the rain than before");
});

test("split expenses: fewest payments", async () => {
  let r = await call("PUT", `/api/trips/${tripId}/people`, { names: ["Pranav", "Anshee"] });
  assert.deepStrictEqual(r.data.people, ["Pranav", "Anshee"]);
  await call("POST", `/api/trips/${tripId}/expenses`, { amount: 900, note: "Lunch", cat: "food", paidBy: "Pranav" });
  r = await call("POST", `/api/trips/${tripId}/expenses`, { amount: 100, note: "Tickets", cat: "tickets", paidBy: "Anshee" });
  assert.deepStrictEqual(r.data.settle.payments, [{ from: "Anshee", to: "Pranav", amount: 400 }]);
});

test("SOS: nearest hospital and police", async () => {
  const r = await call("GET", "/api/help?lat=27.17&lng=78.03");
  assert.strictEqual(r.data.hospitals[0].name, "District Hospital");
  assert.strictEqual(r.data.police[0].name, "Tajganj Police Station");
});

test("expenses, packing, share", async () => {
  let r = await call("POST", `/api/trips/${tripId}/expenses`, { amount: 450, note: "Lunch", cat: "food" });
  assert.ok(r.data.expenses.some(e => e.note === "Lunch" && e.amount === 450));
  r = await call("PUT", `/api/trips/${tripId}/packed`, { item: "Sunscreen", done: true });
  assert.strictEqual(r.data.packed.Sunscreen, true);
  r = await call("POST", `/api/trips/${tripId}/share`, {});
  const s = await call("GET", "/api/share/" + r.data.share, null, { c: "" });
  assert.strictEqual(s.data.title, "2 days in Agra");
  assert.ok(!s.data.data.expenses, "expenses stay private");
  assert.deepStrictEqual(s.data.data.checkins, {}, "no check-ins unless live share is on");
  const anyPid = Object.keys((await call("GET", "/api/trips/" + tripId)).data.data.places)[0];
  await call("POST", `/api/trips/${tripId}/checkin`, { placeId: anyPid, state: "arrived" });
  await call("POST", `/api/trips/${tripId}/share`, { live: true });
  const s2 = await call("GET", "/api/share/" + r.data.share, null, { c: "" });
  assert.ok(s2.data.live && Object.keys(s2.data.data.checkins).length >= 1, "family sees check-ins");
  assert.ok(!s2.data.data.lastPos && !s2.data.data.people);
  const other = { c: "" };
  await call("POST", "/api/auth/guest", {}, other);
  assert.strictEqual((await call("GET", "/api/trips/" + tripId, null, other)).status, 400, "other users can't open it");
});

test("quick mode plans straight away; 'I'm here now' starts from current time", async () => {
  const r = await call("POST", "/api/trips", { segments: [{ destination: { label: "Agra" }, days: 1 }], start: "2026-10-24", hereNow: true, here: { lat: 27.17, lng: 78.03 }, nowMin: 15 * 60 + 5, detail: "quick", pace: "slow" });
  const t = await waitTrip(r.data.id);
  assert.strictEqual(t.data.status, "ready", t.data.error);
  const day = t.data.days[0];
  assert.ok(day.start >= 15 * 60 + 15, "starts after now");
  const visits = day.items.filter(i => i.type === "visit");
  assert.ok(visits.length >= 1 && visits.length <= 3, "slow pace → max 3");
  assert.ok(day.stayGuessed, "no stay given");
  assert.ok(t.data.dropped.length > 0, "extra ideas listed");
});

test("Let Raahi decide where to stay", async () => {
  const r = await call("POST", "/api/trips", { segments: [{ destination: { label: "Agra" }, days: 1, stay: { decide: true } }], start: "2026-11-03", detail: "quick" });
  const t = await waitTrip(r.data.id);
  assert.strictEqual(t.data.status, "ready", t.data.error);
  assert.match(t.data.days[0].from.label, /^Near .+, Agra$/);
  assert.ok(t.data.input.segments[0].suggestedStay.why);
  assert.ok(!t.data.days[0].stayGuessed);
});

test("multi-city trip with a travel day", async () => {
  const r = await call("POST", "/api/trips", { segments: [{ destination: { label: "Agra" }, days: 1 }, { destination: { label: "Jaipur" }, days: 1, stay: { label: "Jaipur" } }], start: "2026-11-02", detail: "quick" });
  const t = await waitTrip(r.data.id);
  assert.strictEqual(t.data.status, "ready", t.data.error);
  assert.match(t.data.days[1].note, /Travel day: Agra → Jaipur/);
  assert.ok(t.data.days[1].start > 11 * 60, "day starts after the drive");
  assert.match(t.title || "", /Agra → Jaipur/);
});

test("no AI key: falls back to OpenStreetMap attractions", async () => {
  F.setGemini("quota");
  const r = await call("POST", "/api/trips", { segments: [{ destination: { label: "Agra" }, days: 1 }], detail: "quick" });
  const t = await waitTrip(r.data.id);
  F.setGemini("ok");
  assert.strictEqual(t.data.status, "ready", t.data.error);
  assert.ok(Object.values(t.data.places).some(p => p.name === "Taj Mahal"));
  assert.match(t.data.aiError, /limit/);
});

test("explore ideas from home and best-time advice", async () => {
  const r = await call("POST", "/api/explore", { home: { label: "Agra" }, days: 6, budget: 30000, travellers: 2 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(r.data.options.length, 2);
  assert.ok(r.data.options[0].destinations[0].roadKm > 0, "road distance from home");
  const a = await call("POST", "/api/advice", { kind: "when", destination: "Agra" });
  assert.strictEqual(a.data.months, "October to March");
  const h = await call("POST", "/api/advice", { kind: "howlong", destination: "Agra" });
  assert.strictEqual(h.data.days, 2);
});

test("chat streams an answer and remembers it", async () => {
  const r = await fetch(base + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Cookie: jar.c }, body: JSON.stringify({ message: "When should I go to Agra?", tripId }) });
  const text = await r.text();
  const parts = text.split("\n\n").filter(Boolean).map(l => JSON.parse(l.slice(5)));
  assert.ok(parts.filter(p => p.t).length > 3, "streamed in pieces");
  assert.ok(parts.some(p => p.done));
  assert.ok(parts.some(p => p.sources));
  const h = await call("GET", "/api/chat?tripId=" + tripId);
  assert.strictEqual(h.data.length, 2);
  assert.match(h.data[1].text, /October to March/);
});

test("register keeps guest trips; login; google", async () => {
  const before = (await call("GET", "/api/trips")).data.length;
  let r = await call("POST", "/api/auth/register", { id: "98765 43210", password: "secret1", name: "Yug" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(r.data.user.phone, "+919876543210");
  assert.strictEqual((await call("GET", "/api/trips")).data.length, before);
  await call("POST", "/api/auth/logout", {});
  assert.strictEqual((await call("GET", "/api/me")).data.user, null);
  r = await call("POST", "/api/auth/login", { id: "+91 98765-43210", password: "wrong" });
  assert.strictEqual(r.status, 400);
  r = await call("POST", "/api/auth/login", { id: "9876543210", password: "secret1" });
  assert.strictEqual(r.status, 200);
  const g = { c: "" };
  r = await call("POST", "/api/auth/google", { credential: "bad" }, g);
  assert.strictEqual(r.status, 400);
  r = await call("POST", "/api/auth/google", { credential: "good-token" }, g);
  assert.strictEqual(r.data.user.email, "yug@example.com");
  assert.ok(r.data.isNew);
});

test("route optimiser: share links and 'Your location' links", async () => {
  // A short link that redirects
  const s = await call("POST", "/api/route/import", { url: `Check out my route ${F.base}/short` });
  assert.strictEqual(s.status, 200, JSON.stringify(s.data));
  assert.strictEqual(s.data.stops.length, 3);
  assert.ok(s.data.result.distance > 0);
  // A share page with the address inside the HTML (saddr/daddr format)
  const h = await call("POST", "/api/route/import", { url: `${F.base}/short-html` });
  assert.strictEqual(h.status, 200, JSON.stringify(h.data));
  assert.deepStrictEqual(h.data.stops.map(x => x.label), ["Agra Fort", "Taj Mahal", "Mehtab Bagh"]);
  // Route starting at "Your location"
  const y = await call("POST", "/api/route/import", { url: "https://www.google.com/maps/dir//Taj+Mahal/Agra+Fort/@27,78,12z" });
  assert.ok(y.data.needHere);
  const y2 = await call("POST", "/api/route/import", { url: "https://www.google.com/maps/dir//Taj+Mahal/Agra+Fort/@27,78,12z", here: { lat: 27.16, lng: 78.0 } });
  assert.strictEqual(y2.data.stops[0].label, "Your location");
  assert.strictEqual(y2.data.result.stops.length, 3);
});

test("paste a Google Maps link of one place", async () => {
  const a = await call("POST", "/api/place-link", { url: "https://www.google.com/maps/place/Pine+Oak+Apartments/@29.39,79.45,17z/data=!4m6!3m5!8m2!3d29.39187!4d79.45213" });
  assert.strictEqual(a.status, 200, JSON.stringify(a.data));
  assert.strictEqual(a.data.title, "Pine Oak Apartments");
  assert.strictEqual(a.data.lat, 29.39187);
  const b = await call("POST", "/api/place-link", { url: "https://www.google.com/maps/search/?api=1&query=Taj%20Mahal" });
  assert.strictEqual(b.status, 200, JSON.stringify(b.data));
  assert.ok(b.data.lat != null);
  const c = await call("POST", "/api/place-link", { url: "hello" });
  assert.strictEqual(c.status, 400);
});

test("thread trip: a loop through several places, then a full plan", async () => {
  const r = await call("POST", "/api/thread", { home: { label: "Agra", lat: 27.1767, lng: 78.0081 }, days: 5, include: "Isha, Palani, Meenakshi Temple", travellers: 2 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const t = r.data.thread;
  assert.strictEqual(t.stops.length, 4);
  assert.strictEqual(t.gateway.name, "Bengaluru");
  assert.ok(t.stops.every(x => x.lat != null), "every stop is on the map");
  assert.ok(t.stops[1].plan[0].what.includes("Palani"));
  assert.ok(t.stops[0].leg.km > 0, "road distance measured");
  // Plan it day by day
  const segs = t.stops.map(x => ({ destination: { label: x.search, lat: x.lat, lng: x.lng }, days: Math.max(1, x.nights), stay: { decide: true }, thread: x }));
  const c = await call("POST", "/api/trips", { segments: segs, thread: { title: t.title, home: r.data.home, gateway: t.gateway, returnLeg: t.returnLeg, loop: true }, start: "2026-12-01", travellers: 2, detail: "quick" });
  assert.strictEqual(c.status, 200, JSON.stringify(c.data));
  const data = (await waitTrip(c.data.id)).data;
  assert.strictEqual(data.status, "ready", data.error);
  assert.strictEqual(data.input.thread.gateway.name, "Bengaluru");
  assert.strictEqual(data.input.segments.length, 4);
  assert.strictEqual(data.days.length, 5);
  assert.match(data.days[0].note, /Bengaluru/);
  assert.match(data.days[1].note, /Travel day: Coimbatore → Palani/);
  assert.match(data.days[4].note, /Head home/);
});

test("static pages and SPA paths", async () => {
  for (const p of ["/", "/route", "/t/abc"]) assert.strictEqual((await fetch(base + p)).status, 200);
  assert.strictEqual((await fetch(base + "/../server.js")).status, 404);
});

// Render's free plan wipes the disk when the app sleeps. With Turso set up, nothing is lost.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("child_process");
const os = require("os");
const path = require("path");
const fakes = require("./fakes");

let F;
test.before(async () => { F = await fakes.start(); });
test.after(() => F.close());

function startRaahi(dbFile, port) {
  const env = { ...process.env, ...F.env, TURSO_URL: "libsql://" + F.base.replace(/^http:\/\//, ""), TURSO_TOKEN: "turso-token", DB_FILE: dbFile, PORT: String(port), RATE_LIMIT: "100000" };
  // the fake runs on http, so point the client at it directly
  env.TURSO_URL = F.base;
  const p = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", d => (out += d)); p.stderr.on("data", d => (out += d));
  return new Promise((ok, bad) => {
    const t = setTimeout(() => bad(new Error("server did not start:\n" + out)), 15000);
    p.stdout.on("data", () => { if (/Raahi is running/.test(out)) { clearTimeout(t); ok({ p, log: () => out }); } });
  });
}
const stop = p => new Promise(r => { p.on("exit", r); p.kill("SIGTERM"); });

test("accounts, trips and chats survive a wiped disk", async () => {
  const port1 = 40000 + Math.floor(Math.random() * 10000), port2 = port1 + 1;
  const jar = { c: "" };
  const call = async (port, m, p, b) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers: { "Content-Type": "application/json", Cookie: jar.c }, body: b ? JSON.stringify(b) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) jar.c = sc.split(";")[0];
    return { status: r.status, data: await r.json() };
  };
  const a = await startRaahi(path.join(os.tmpdir(), `turso-a-${Date.now()}.db`), port1);
  let r = await call(port1, "POST", "/api/auth/register", { id: "pranav@example.com", password: "secret12", name: "Pranav" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  await call(port1, "PUT", "/api/me", { prefs: { pace: "slow", diet: "veg" } });
  r = await call(port1, "POST", "/api/trips", { segments: [{ destination: { label: "Agra" }, days: 1 }], start: "2026-11-07", detail: "quick" });
  const tripId = r.data.id;
  for (let i = 0; i < 100; i++) { r = await call(port1, "GET", "/api/trips/" + tripId); if (r.data.data.status === "ready") break; await new Promise(x => setTimeout(x, 100)); }
  assert.strictEqual(r.data.data.status, "ready");
  await stop(a.p); // like Render putting the app to sleep (SIGTERM → last changes flushed)

  // New machine, empty disk
  const b = await startRaahi(path.join(os.tmpdir(), `turso-b-${Date.now()}.db`), port2);
  assert.match(b.log(), /Loaded \d+ saved rows from Turso/);
  // Old login cookie still works
  r = await call(port2, "GET", "/api/me");
  assert.strictEqual(r.data.user && r.data.user.name, "Pranav", "session restored");
  assert.strictEqual(r.data.user.prefs.pace, "slow");
  r = await call(port2, "GET", "/api/trips/" + tripId);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.data.status, "ready");
  // Fresh sign-in works too
  jar.c = "";
  r = await call(port2, "POST", "/api/auth/login", { id: "pranav@example.com", password: "secret12" });
  assert.strictEqual(r.status, 200);
  await stop(b.p);
});

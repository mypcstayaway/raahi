// Keep-awake: Raahi visits its own address regularly so Render never puts it to sleep.
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { spawn } = require("child_process");
const os = require("os");
const path = require("path");

test("pings its public address on a timer", async () => {
  let hits = 0;
  const fake = http.createServer((req, res) => { if (req.url === "/api/config") hits++; res.end("{}"); });
  await new Promise(r => fake.listen(0, r));
  const env = { ...process.env, RENDER_EXTERNAL_URL: `http://127.0.0.1:${fake.address().port}`, KEEP_AWAKE_MINUTES: "0.005", PORT: "0", DB_FILE: path.join(os.tmpdir(), `awake-${Date.now()}.db`) };
  const p = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; p.stdout.on("data", d => (out += d));
  await new Promise(r => setTimeout(r, 2500));
  p.kill("SIGTERM"); fake.close();
  assert.match(out, /Keep-awake/);
  assert.ok(hits >= 3, "hits: " + hits);
});

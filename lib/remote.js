// Permanent copy of the database in Turso (free cloud SQLite, no card), over plain HTTPS.
// Raahi keeps using its fast local SQLite file; every change is also sent here within a second,
// and on start-up (e.g. after Render's free plan wipes the disk) everything is loaded back.
const cfg = require("./config");

const enabled = () => !!(cfg.TURSO_URL && cfg.TURSO_TOKEN);
const base = () => cfg.TURSO_URL.replace(/^(libsql|turso|wss?):\/\//, "https://").replace(/\/$/, "");

function arg(v) {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "bigint") return { type: "integer", value: String(v) };
  if (typeof v === "number") return Number.isInteger(v) ? { type: "integer", value: String(v) } : { type: "float", value: v };
  if (typeof v === "boolean") return { type: "integer", value: v ? "1" : "0" };
  return { type: "text", value: String(v) };
}
function val(x) {
  if (!x || x.type === "null") return null;
  if (x.type === "integer") return Number(x.value);
  if (x.type === "float") return Number(x.value);
  if (x.type === "blob") return Buffer.from(x.base64 || "", "base64");
  return x.value;
}

// Run statements in one round trip. Returns rows (as objects) for each statement.
async function exec(stmts, ms = 20000) {
  const body = { requests: [...stmts.map(s => ({ type: "execute", stmt: { sql: s.sql, args: (s.args || []).map(arg) } })), { type: "close" }] };
  const r = await fetch(base() + "/v2/pipeline", { method: "POST", headers: { Authorization: "Bearer " + cfg.TURSO_TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error(`Turso returned ${r.status}${j && j.message ? ": " + j.message : ""}`);
  return j.results.slice(0, stmts.length).map((x, i) => {
    if (x.type !== "ok") throw new Error(`Turso statement ${i + 1} failed: ${(x.error && x.error.message) || "error"}`);
    const res = x.response.result;
    const cols = res.cols.map(c => c.name);
    return res.rows.map(row => Object.fromEntries(row.map((v, k) => [cols[k], val(v)])));
  });
}

// ---------- write queue ----------
let queue = [], timer = null, flushing = null, failures = 0;
function push(sql, args) {
  if (!enabled()) return;
  queue.push({ sql, args });
  if (!timer) timer = setTimeout(flush, failures ? Math.min(30000, 1000 * 2 ** failures) : 400);
}
async function flush() {
  timer = null;
  if (flushing) return flushing;
  if (!queue.length) return;
  const batch = queue.slice(0, 100);
  flushing = exec(batch).then(() => { queue = queue.slice(batch.length); failures = 0; }, e => { failures++; console.warn("Turso sync failed, will retry:", e.message); })
    .finally(() => { flushing = null; if (queue.length && !timer) timer = setTimeout(flush, failures ? Math.min(30000, 1000 * 2 ** failures) : 50); });
  return flushing;
}
async function drain(ms = 15000) {
  const until = Date.now() + ms;
  while (queue.length && Date.now() < until) { await flush(); if (queue.length) await new Promise(r => setTimeout(r, 200)); }
  return queue.length === 0;
}
const pending = () => queue.length;

module.exports = { enabled, exec, push, flush, drain, pending };

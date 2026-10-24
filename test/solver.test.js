const test = require("node:test");
const assert = require("node:assert");
const { solve, pathCost } = require("../lib/solver");

function randMatrix(n, seed) {
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const p = Array.from({ length: n }, () => [rnd() * 300, rnd() * 300]);
  // Road-like and slightly asymmetric.
  return p.map((a, i) => p.map((b, j) => i === j ? 0 : Math.hypot(a[0] - b[0], a[1] - b[1]) * 1000 * (1 + ((i * 7 + j * 3) % 5) / 40)));
}
function brute(d, fixed, round) {
  const n = d.length; let best = Infinity;
  const rec = (path, used, len) => {
    if (path.length === n) { best = Math.min(best, len + (round ? d[path[n - 1]][path[0]] : 0)); return; }
    for (let j = 0; j < n; j++) if (!used[j]) { used[j] = 1; rec([...path, j], used, len + (path.length ? d[path[path.length - 1]][j] : 0)); used[j] = 0; }
  };
  if (fixed || round) rec([0], [1], 0); else rec([], [], 0);
  return best;
}

test("exact solver matches brute force", () => {
  for (let seed = 1; seed <= 30; seed++) for (const [fixed, round] of [[true, false], [false, false], [true, true]]) {
    const d = randMatrix(3 + (seed % 6), seed);
    const r = solve(d, { fixed, round });
    assert.ok(r.exact);
    assert.strictEqual(new Set(r.order).size, d.length);
    if (fixed || round) assert.strictEqual(r.order[0], 0);
    assert.ok(Math.abs(pathCost(d, r.order, round) - brute(d, fixed, round)) < 1e-6, `seed ${seed} ${fixed} ${round}`);
  }
});

test("16 stops is exact and fast", () => {
  const d = randMatrix(16, 99), t = Date.now();
  const r = solve(d, { fixed: false });
  assert.ok(r.exact); assert.ok(Date.now() - t < 1500, "took " + (Date.now() - t));
});

test("25 stops gives a valid, good route quickly", () => {
  const d = randMatrix(25, 7), t = Date.now();
  const r = solve(d, { fixed: true, round: true });
  assert.ok(Date.now() - t < 3000);
  assert.strictEqual(r.order.length, 25); assert.strictEqual(new Set(r.order).size, 25); assert.strictEqual(r.order[0], 0);
  assert.ok(r.cost < pathCost(d, [...Array(25).keys()], true) * 0.6);
});

test("unreachable stop returns null", () => {
  const d = [[0, 1, 1e12], [1, 0, 1e12], [1e12, 1e12, 0]];
  assert.strictEqual(solve(d, { fixed: true }), null);
});

test("reads one place from Google Maps links", () => {
  const { parsePlace } = require("../lib/google");
  const a = parsePlace("https://www.google.com/maps/place/Pine+Oak+Apartments/@29.3912,79.4501,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d29.39187!4d79.45213!16s");
  assert.equal(a.name, "Pine Oak Apartments"); assert.equal(a.lat, 29.39187); assert.equal(a.lng, 79.45213);
  const b = parsePlace("https://maps.google.com/?q=29.38,79.46");
  assert.equal(b.lat, 29.38); assert.equal(b.lng, 79.46);
  const c = parsePlace("https://www.google.com/maps/search/?api=1&query=Naini%20Lake%2C%20Nainital");
  assert.equal(c.name, "Naini Lake, Nainital"); assert.equal(c.lat, undefined);
  assert.throws(() => parsePlace("https://example.com/x"));
});

test("language and baby mode reach every AI prompt", () => {
  const P = require("../lib/prompts");
  const seg = { destination: { label: "Agra" }, days: 2 };
  const pr = P.planPrompt(seg, { travellers: 2, interests: [] }, { lang: "hi", baby: { on: true, months: 8 } }, 10);
  assert.match(pr.prompt, /LANGUAGE: .*Hindi/);
  assert.match(pr.prompt, /TRAVELLING WITH A BABY \(about 8 months old\)/);
  const th = P.threadPrompt({ home: { label: "Coimbatore" }, days: 5, around: true }, { lang: "ta" });
  assert.match(th.prompt, /AROUND-ONE-PLACE MODE/);
  assert.match(th.prompt, /Tamil/);
  assert.match(P.chatSystem({ prefs: { lang: "bn" } }), /reply in Bengali/);
});

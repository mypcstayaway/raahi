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

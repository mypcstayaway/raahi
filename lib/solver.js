// Finds the shortest order to visit every stop.
// Up to 16 stops: exact answer (Held-Karp dynamic programming, milliseconds).
// 17 to 25 stops: very good answer (nearest neighbour + 2-opt + or-opt from many starts).

const BIG = 1e12;

// d: n x n matrix (metres), may be asymmetric. fixed: stop 0 is the start. round: come back to start.
function solve(d, { fixed = true, round = false } = {}) {
  const n = d.length;
  if (n < 2) return { order: [...Array(n).keys()], cost: 0, exact: true };
  if (round) fixed = true; // a loop has no real start; keep the user's stop A first
  // "Any stop can be the start": add a dummy start that costs 0 to every stop.
  let m = d, dummy = false;
  if (!fixed) {
    dummy = true;
    m = [Array(n + 1).fill(0), ...d.map(r => [BIG, ...r])];
    m[0][0] = 0;
  }
  const N = m.length;
  let res = N <= 17 ? heldKarp(m, round) : heuristic(m, round);
  if (!res) return null;
  let order = res.order;
  if (dummy) order = order.slice(1).map(i => i - 1);
  return { order, cost: res.cost, exact: N <= 17 };
}

function heldKarp(d, round) {
  const n = d.length, full = 1 << (n - 1), size = full * (n - 1);
  // State: subset of stops 1..n-1 visited (bit i-1), ending at stop j.
  const dp = new Float64Array(size).fill(Infinity);
  const par = new Int8Array(size).fill(-1);
  for (let j = 1; j < n; j++) dp[(1 << (j - 1)) * (n - 1) + (j - 1)] = d[0][j];
  for (let S = 1; S < full; S++) {
    for (let j = 1; j < n; j++) {
      const bj = 1 << (j - 1);
      if (!(S & bj)) continue;
      const cur = dp[S * (n - 1) + j - 1];
      if (cur === Infinity) continue;
      for (let k = 1; k < n; k++) {
        const bk = 1 << (k - 1);
        if (S & bk) continue;
        const T = S | bk, idx = T * (n - 1) + k - 1, v = cur + d[j][k];
        if (v < dp[idx]) { dp[idx] = v; par[idx] = j; }
      }
    }
  }
  const S = full - 1;
  let best = Infinity, end = -1;
  for (let j = 1; j < n; j++) {
    const v = dp[S * (n - 1) + j - 1] + (round ? d[j][0] : 0);
    if (v < best) { best = v; end = j; }
  }
  if (n === 1) return { order: [0], cost: 0 };
  if (best >= BIG / 10) return null;
  const order = [];
  let mask = S, j = end;
  while (j > 0) { order.push(j); const p = par[mask * (n - 1) + j - 1]; mask &= ~(1 << (j - 1)); j = p; }
  order.push(0);
  return { order: order.reverse(), cost: best };
}

function pathCost(d, p, round) {
  let c = 0;
  for (let i = 0; i < p.length - 1; i++) c += d[p[i]][p[i + 1]];
  if (round) c += d[p[p.length - 1]][p[0]];
  return c;
}

function heuristic(d, round) {
  const n = d.length;
  let best = null, bestCost = Infinity;
  // Nearest-neighbour from stop 0, plus randomised variants, each improved by local search.
  for (let attempt = 0; attempt < 40; attempt++) {
    const used = Array(n).fill(false), p = [0];
    used[0] = true;
    while (p.length < n) {
      const last = p[p.length - 1];
      const cand = [];
      for (let j = 0; j < n; j++) if (!used[j]) cand.push([d[last][j], j]);
      cand.sort((a, b) => a[0] - b[0]);
      const pick = attempt === 0 ? cand[0][1] : cand[Math.floor(Math.random() * Math.min(3, cand.length))][1];
      used[pick] = true; p.push(pick);
    }
    improve(d, p, round);
    const c = pathCost(d, p, round);
    if (c < bestCost) { bestCost = c; best = p.slice(); }
  }
  return bestCost >= BIG / 10 ? null : { order: best, cost: bestCost };
}

// 2-opt (reverse a section) and or-opt (move 1-3 stops elsewhere). Stop 0 stays first.
function improve(d, p, round) {
  const n = p.length;
  let cost = pathCost(d, p, round), better = true;
  while (better) {
    better = false;
    for (let i = 1; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
      const q = p.slice(0, i).concat(p.slice(i, j + 1).reverse(), p.slice(j + 1));
      const c = pathCost(d, q, round);
      if (c < cost - 1e-6) { p.splice(0, n, ...q); cost = c; better = true; }
    }
    for (let len = 1; len <= 3; len++) for (let i = 1; i + len <= n; i++) {
      const seg = p.slice(i, i + len), rest = p.slice(0, i).concat(p.slice(i + len));
      for (let k = 1; k <= rest.length; k++) {
        if (k === i) continue;
        const q = rest.slice(0, k).concat(seg, rest.slice(k));
        const c = pathCost(d, q, round);
        if (c < cost - 1e-6) { p.splice(0, n, ...q); cost = c; better = true; break; }
      }
    }
  }
}

module.exports = { solve, pathCost };

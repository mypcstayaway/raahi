// Turns a list of located stops into the optimised route and the per-stop advice.
const { solve, pathCost } = require("./solver");
const svc = require("./places");
const { userErr } = require("./google");

const compass = b => ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(b / 45) % 8];
function brg(a, b) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

async function plan(pts, { fixed = true, round = false } = {}) {
  if (round) fixed = true;
  const n = pts.length;
  const { d, t } = await svc.table(pts);
  const res = solve(d, { fixed, round });
  if (!res) throw userErr("No driving route connects all these places (one may be on an island or unreachable by road).");
  const order = res.order;
  const seq = order.map(i => pts[i]);
  if (round) seq.push(seq[0]);
  const rt = await svc.route(seq);

  // How much the user's own order (as typed / as in the link) would have cost.
  const given = [...Array(n).keys()];
  const givenDist = pathCost(d, given, round);
  const givenTime = pathCost(t, given, round);

  const m = order.length;
  const stops = order.map((idx, k) => {
    const prev = k > 0 ? order[k - 1] : round ? order[m - 1] : null;
    const next = k < m - 1 ? order[k + 1] : round ? order[0] : null;
    const leg = rt.legs[k];
    const s = { index: idx, label: pts[idx].label, name: pts[idx].name, lat: pts[idx].lat, lng: pts[idx].lng };
    if (leg && next != null) s.next = { distance: leg.distance, duration: leg.duration, heading: compass(brg(pts[idx], pts[next])) };
    if (k === 0 && fixed) { s.start = true; return s; }
    let sd, st;
    if (prev != null && next != null) { sd = d[prev][idx] + d[idx][next] - d[prev][next]; st = t[prev][idx] + t[idx][next] - t[prev][next]; }
    else if (prev != null) { sd = d[prev][idx]; st = t[prev][idx]; }
    else { sd = d[idx][next]; st = t[idx][next]; }
    s.skip = { distance: Math.max(0, sd), duration: Math.max(0, st) };
    if (prev != null && next != null) {
      const inB = brg(pts[prev], pts[idx]), outB = brg(pts[idx], pts[next]);
      const turn = Math.abs(((outB - inB + 540) % 360) - 180);
      if (turn > 120) s.flag = `Opposite direction: you travel ${compass(inB)} to reach it, then turn back ${compass(outB)}.`;
    }
    if (!s.flag && sd >= 0.25 * rt.distance) s.flag = "Far off the main route: it adds a big share of the total distance.";
    return s;
  });

  return {
    order, round, fixed, exact: res.exact,
    distance: rt.distance, duration: rt.duration, geometry: rt.geometry,
    saved: { distance: Math.max(0, givenDist - res.cost), duration: Math.max(0, givenTime - pathCost(t, order, round)) },
    stops,
  };
}

module.exports = { plan };

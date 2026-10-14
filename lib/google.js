// Reads the stops out of any kind of Google Maps directions link, including the short
// "Share" links from the phone app (maps.app.goo.gl/...).
const MAX = 25;

function userErr(msg) { const e = new Error(msg); e.user = true; return e; }

// The Share button often gives text like "Check out this route https://maps.app.goo.gl/abc".
function findUrl(text) {
  const m = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[).,]+$/, "") : null;
}
const host = u => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
const isShortLink = u => /^(maps\.app\.goo\.gl|goo\.gl|g\.co)$/.test(host(u));
const isGoogle = u => /(^|\.)google\.[a-z.]+$/.test(host(u));

// A link we can read stops from.
function isFullMapsUrl(u) {
  if (!isGoogle(u)) return false;
  const x = new URL(u);
  if (/consent\./.test(x.hostname)) return false;
  return /\/maps/.test(x.pathname) || x.searchParams.has("saddr") || x.searchParams.has("daddr") || x.searchParams.has("destination");
}

function unescapeHtml(s) {
  return s.replace(/\\u003d/gi, "=").replace(/\\u0026/gi, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

// Follow a short link until it becomes a full Google Maps address.
async function expand(url, fetchImpl = fetch) {
  let cur = url;
  for (let hop = 0; hop < 8; hop++) {
    if (isFullMapsUrl(cur)) return cur;
    // EU-style consent pages carry the real address in ?continue=
    if (/consent\./.test(host(cur))) {
      const c = new URL(cur).searchParams.get("continue");
      if (c) { cur = c; continue; }
    }
    let r;
    try {
      r = await fetchImpl(cur, {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36", "Accept-Language": "en-IN,en;q=0.9", Accept: "text/html" },
        signal: AbortSignal.timeout(9000),
      });
    } catch { const e = new Error("Could not open the short link"); e.net = true; throw e; }
    const loc = r.headers.get("location");
    if (loc) { cur = new URL(loc, cur).href; continue; }
    // No redirect: the page itself may contain the full address (meta refresh, og:url or a script).
    const html = unescapeHtml(await r.text().catch(() => ""));
    const m = html.match(/https?:\/\/(?:www\.|maps\.)?google\.[a-z.]+\/maps[^"'\s<>\\]*/i)
      || html.match(/https?:\/\/(?:www\.|maps\.)?google\.[a-z.]+\/?\?[^"'\s<>\\]*(?:saddr|daddr)=[^"'\s<>\\]*/i);
    if (m) { cur = m[0]; if (isFullMapsUrl(cur)) return cur; continue; }
    break;
  }
  throw userErr("That share link didn't lead to a Google Maps route. In Google Maps, open the route, then copy the address from the browser's address bar and paste it here.");
}

const clean = t => { let s = String(t); try { s = decodeURIComponent(s.replace(/\+/g, " ")); } catch { s = s.replace(/\+/g, " "); } return s.replace(/\s+/g, " ").trim(); };
const HERE = /^(my|your) location$|^current location$/i;

// Returns [{label, lat?, lng?}] plus whether the route started at "Your location".
function parseGmaps(text) {
  const link = findUrl(text);
  if (!link) throw userErr("That doesn't look like a link. Copy the whole link and paste it here.");
  let u;
  try { u = new URL(link); } catch { throw userErr("That doesn't look like a link."); }
  if (!isGoogle(link)) throw userErr("This needs a Google Maps link.");
  const sp = u.searchParams;
  let raw = [];
  if (sp.get("destination")) {
    raw = [sp.get("origin") || "", ...(sp.get("waypoints") || "").split("|").filter(Boolean), sp.get("destination")];
  } else if (sp.get("daddr")) {
    // Older style: ?saddr=A&daddr=B+to:C+to:D
    raw = [sp.get("saddr") || "", ...sp.get("daddr").split(/\s*\+?to:\s*/i)];
  } else {
    const i = u.pathname.indexOf("/dir/");
    if (i < 0) throw userErr("I can only read directions links (the ones with several stops). In Google Maps tap Directions, add your stops, then share or copy the link.");
    // Keep empty parts: "/dir//B/C" means the route starts at "Your location".
    raw = u.pathname.slice(i + 5).split("/").filter(x => !x.startsWith("@") && !x.startsWith("data="));
    while (raw.length && raw[raw.length - 1] === "") raw.pop();
  }
  raw = raw.map(clean);
  const startsHere = raw.length > 0 && (raw[0] === "" || HERE.test(raw[0]));
  const labels = raw.filter(x => x && !HERE.test(x));
  if (labels.length + (startsHere ? 1 : 0) < 2) throw userErr("I found fewer than 2 stops in that link.");
  if (labels.length > MAX) throw userErr(`That link has ${labels.length} stops. The limit is ${MAX}.`);
  // Exact positions are stored as !1d<lng>!2d<lat> in the data= part, one per named stop.
  const dm = [...u.href.matchAll(/!1d(-?\d+\.?\d*)!2d(-?\d+\.?\d*)/g)];
  const coords = dm.length === labels.length ? dm.map(m => ({ lat: +m[2], lng: +m[1] })) : null;
  const stops = labels.map((label, k) => {
    const c = label.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (c) return { label, lat: +c[1], lng: +c[2], name: label };
    if (coords) return { label, ...coords[k], name: label };
    return { label };
  });
  return { stops, startsHere };
}

// One place from a Google Maps link (a shared place, a pin, or a search).
// Returns { name, lat?, lng? }. Exact pin is "!3d<lat>!4d<lng>"; "/@lat,lng" is only the map view.
function parsePlace(text) {
  const link = findUrl(text);
  if (!link || !isGoogle(link)) throw userErr("This needs a Google Maps link.");
  const u = new URL(link), sp = u.searchParams, href = decodeURIComponent(u.href);
  const ll = s => { const c = String(s || "").match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/); return c ? { lat: +c[1], lng: +c[2] } : null; };
  let name = "";
  const pm = u.pathname.match(/\/maps\/(?:place|search)\/([^/]+)/);
  if (pm) name = clean(pm[1]);
  const q = sp.get("query") || sp.get("q") || sp.get("destination") || sp.get("daddr") || "";
  if (!name && q && !ll(q)) name = clean(q);
  let pt = null;
  const pin = [...href.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g)].pop();
  if (pin) pt = { lat: +pin[1], lng: +pin[2] };
  pt = pt || ll(name) || ll(q) || ll(sp.get("ll")) || ll(sp.get("center"));
  if (!pt && !name) { const at = u.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/); if (at) pt = { lat: +at[1], lng: +at[2] }; }
  if (ll(name)) name = "";
  if (!pt && !name) throw userErr("I couldn't read a place from that link. In Google Maps, open the place, tap Share, then Copy link, and paste it here.");
  return { name: name.split(",")[0].trim() ? name : "", lat: pt ? pt.lat : undefined, lng: pt ? pt.lng : undefined };
}

module.exports = { parsePlace, parseGmaps, expand, findUrl, isShortLink, isFullMapsUrl, userErr, MAX };

// Makes Raahi open instantly: the app itself loads from the phone, then updates quietly in the background.
// Trips you opened before also show at once if the server is slow to answer or you're offline.
const CACHE = "raahi-v11"; // change on every release so phones pick up the new app
const SHELL = ["/", "/css/app.css", "/js/app.js", "/js/core.js", "/js/home.js", "/js/account.js", "/js/wizard.js", "/js/trip.js", "/js/explore.js", "/js/route.js", "/js/chat.js", "/js/companion.js", "/js/now.js", "/js/stories.js", "/icon.svg", "/manifest.webmanifest"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
// On an update: delete the old copy and reload open pages once, so nobody keeps seeing the old app.
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(async ks => {
    const old = ks.filter(k => k !== CACHE);
    await Promise.all(old.map(k => caches.delete(k)));
    await self.clients.claim();
    if (old.length) (await self.clients.matchAll({ type: "window" })).forEach(c => c.navigate(c.url).catch(() => {}));
  }));
});

const put = (req, res) => { if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; };
const timeout = (p, ms) => new Promise((ok, bad) => { const t = setTimeout(() => bad(new Error("slow")), ms); p.then(r => { clearTimeout(t); ok(r); }, e => { clearTimeout(t); bad(e); }); });

self.addEventListener("fetch", e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET") return;
  const lib = /cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(u.host);
  const mine = u.origin === location.origin;
  if (!mine && !lib) return;
  // App files and libraries: answer from the phone at once, refresh in the background.
  if (lib || (mine && !u.pathname.startsWith("/api/"))) {
    const key = mine && (u.pathname === "/" || u.pathname === "/route" || u.pathname.startsWith("/t/")) ? "/" : req;
    e.respondWith(caches.match(key).then(hit => {
      const net = fetch(req, mine ? { cache: "no-cache" } : undefined).then(r => put(key, r)).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  // Saved data (your trips, account, settings): use the server if it answers within 4 s, else the saved copy.
  if (/^\/api\/(trips(\/[\w-]+)?|share\/[\w-]+|config|me)$/.test(u.pathname)) {
    const net = fetch(req).then(r => put(req, r));
    e.respondWith(timeout(net, 4000).catch(() => caches.match(req).then(hit => hit || net)).catch(() => new Response(JSON.stringify({ error: "You're offline." }), { status: 503, headers: { "Content-Type": "application/json" } })));
  }
});

// Offline shell: app files come from cache first, then refresh in the background. Google API calls are never cached.
const V = "yoman-v5";
const SHELL = ["./","index.html","css/app.css","js/app.js","js/parser.js","js/scheduler.js","js/school.js","js/gcal.js","js/store.js","js/vacations.js","manifest.webmanifest","icons/icon-192.png","icons/apple-touch-icon.png"];
self.addEventListener("install", e=>{ e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())); });
self.addEventListener("activate", e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener("fetch", e=>{
  const u = new URL(e.request.url);
  if(e.request.method!=="GET" || u.origin!==location.origin) return;
  e.respondWith(caches.open(V).then(async c=>{
    const hit = await c.match(e.request, { ignoreSearch:true });
    const net = fetch(e.request).then(r=>{ if(r.ok) c.put(e.request, r.clone()); return r; }).catch(()=>hit);
    return hit || net;
  }));
});

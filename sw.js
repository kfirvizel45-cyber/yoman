// Network first, so every update I push shows up on the next open. The cache is only a fallback when offline.
const V = "yoman-v7";
const SHELL = ["./","index.html","css/app.css","js/app.js","js/parser.js","js/scheduler.js","js/school.js","js/gcal.js","js/store.js","js/vacations.js","manifest.webmanifest","icons/icon-192.png","icons/apple-touch-icon.png"];
self.addEventListener("install", e=>{ e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())); });
self.addEventListener("activate", e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener("fetch", e=>{
  const u = new URL(e.request.url);
  if(e.request.method!=="GET" || u.origin!==location.origin) return;
  e.respondWith(fetch(e.request, { cache:"no-cache" }).then(r=>{ if(r.ok){ const c = r.clone(); caches.open(V).then(x=>x.put(e.request, c)); } return r; })
    .catch(()=>caches.match(e.request, { ignoreSearch:true })));
});

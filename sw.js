// Offline cache for the eDrawings Viewer app shell.
const CACHE='edrawings-viewer-v1';
const FILES=['./','index.html','app.js','easm-core.js','manifest.webmanifest','three.min.js','OrbitControls.js','fflate.js','icon-192.png','icon-512.png','icon-maskable-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(hit=>hit||fetch(e.request).then(res=>{
    if(res.ok&&new URL(e.request.url).origin===location.origin){const copy=res.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy));}
    return res;
  })));
});

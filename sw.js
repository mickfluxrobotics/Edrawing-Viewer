// eDrawings Viewer: network first (so updates arrive), cache fallback (so it works offline).
const CACHE='edrawings-viewer-v11';
const FILES=["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "three.min.js", "OrbitControls.js", "LineSegmentsGeometry.js", "LineMaterial.js", "LineSegments2.js", "fflate.js", "easm-core.js", "formats.js", "app.js", "step-worker.js", "occt-import-js.js", "occt-import-js.wasm", "dwg-worker.js", "dwgdxf.js", "dwgdxf_bg.wasm"];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;
  e.respondWith(fetch(e.request.url,{cache:'no-cache'}).then(res=>{
    if(res.ok){const copy=res.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy));}
    return res;
  }).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(hit=>hit||caches.match('index.html'))));
});

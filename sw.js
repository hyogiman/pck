/* 생각의 텃밭 + 독서의 정원 — shared service worker
   두 앱의 껍데기를 캐시해 두어 네트워크가 없어도 화면을 다시 열 수 있게 합니다.
   생각의 텃밭과 독서의 정원은 같은 origin을 쓰지만 manifest ID와 앱 scope는 분리합니다.

   v22: Fragment badge v75 반영을 위해 런타임 패치 버전과 캐시를 갱신한다.
   독서의 정원은 reading.html 자체가 현재 CSS/JS를 직접 참조한다.
   서비스워커 주입에 의존하지 않고, 최신 파일은 network-first로 확인한다. */
const CACHE = "garden-v22-fragment-badge-v75";
const PATCH_VERSION = "20260904-1725-fragment-badge-v75";
const PATCH_TAGS = [
  `<script src="./storage-fix.js?v=${PATCH_VERSION}"></script>`,
  `<script src="./capture-marking.js?v=${PATCH_VERSION}"></script>`,
  `<script src="./ai-v2-test-runtime.js?v=${PATCH_VERSION}"></script>`,
  `<script src="./blooming-v2-runtime.js?v=${PATCH_VERSION}"></script>`
];
const SHELL = [
  "./", "./index.html", "./manifest.json",
  "./reading.html", "./reading.css", "./reading.js", "./reading-manifest.json",
  "./reading-theme-v3.css", "./reading-enhance-v3.js", "./reading-theme-v4.css", "./reading-hotfix-v4.js",
  "./reading-theme-v5.css", "./reading-genre-v5.js", "./reading-polish-v6.js", "./reading-pwa-v7.js",
  "./reading-swipe-v8.css", "./reading-swipe-v8.js", "./reading-detail-v12.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/reading-garden.svg", "./icons/reading-garden-maskable.svg"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter((k)=>k!==CACHE).map((k)=>caches.delete(k)));
    await self.clients.claim();
    const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    await Promise.all(windows.map(async(client)=>{try{await client.navigate(client.url)}catch(_){}}));
  })());
});

async function injectThoughtPatches(response){
  if(!response)return response;
  const type=response.headers.get("content-type")||"";
  if(!type.includes("text/html"))return response;
  let html=await response.text();
  html=html.replace(/\s*<script src="\.\/(?:storage-fix|capture-marking|ai-v2-test-runtime|blooming-v2-runtime)\.js(?:\?v=[^"]*)?"><\/script>/gi,"");
  html=html.replace(/<\/body>/i, `${PATCH_TAGS.join("\n")}\n</body>`);
  const headers=new Headers(response.headers);headers.delete("content-length");headers.delete("content-encoding");
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
}

self.addEventListener("fetch", (e) => {
  const req=e.request;if(req.method!=="GET")return;const url=new URL(req.url);
  if(url.origin!==self.location.origin){
    if(url.hostname==="www.gstatic.com" && url.pathname.includes("/firebasejs/")){
      e.respondWith((async()=>{const cached=await caches.match(req);if(cached)return cached;try{const res=await fetch(req);if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{})}return res}catch(_){return Response.error()}})());
    }
    return;
  }

  const isReadingHtml=url.pathname.endsWith("/reading.html");
  const isRuntimePatch=
    url.pathname.endsWith("/manifest.json")||url.pathname.endsWith("/reading-manifest.json")||
    url.pathname.endsWith("/storage-fix.js")||url.pathname.endsWith("/capture-marking.js")||
    url.pathname.endsWith("/ai-v2-test-runtime.js")||url.pathname.endsWith("/blooming-v2-runtime.js")||
    url.pathname.endsWith("/reading.js")||url.pathname.endsWith("/reading.css")||
    url.pathname.endsWith("/reading-theme-v3.css")||url.pathname.endsWith("/reading-enhance-v3.js")||
    url.pathname.endsWith("/reading-theme-v4.css")||url.pathname.endsWith("/reading-hotfix-v4.js")||
    url.pathname.endsWith("/reading-theme-v5.css")||url.pathname.endsWith("/reading-genre-v5.js")||url.pathname.endsWith("/reading-polish-v6.js")||url.pathname.endsWith("/reading-pwa-v7.js")||
    url.pathname.endsWith("/reading-swipe-v8.css")||url.pathname.endsWith("/reading-swipe-v8.js")||
    url.pathname.endsWith("/reading-detail-v12.js")||
    url.pathname.endsWith("/reading-garden.svg")||url.pathname.endsWith("/reading-garden-maskable.svg");

  if(isRuntimePatch){
    e.respondWith((async()=>{
      try{
        const fresh=await fetch(req,{cache:"no-store"});
        if(fresh.ok){const copy=fresh.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{})}
        return fresh;
      }catch(_){return (await caches.match(req))||Response.error()}
    })());return;
  }

  if(req.mode==="navigate"||(req.headers.get("accept")||"").includes("text/html")){
    e.respondWith((async()=>{
      try{
        const network=await fetch(req,{cache:"no-store"});
        const response=isReadingHtml?network:await injectThoughtPatches(network);
        const copy=response.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});
        return response;
      }catch(_){
        if(isReadingHtml)return (await caches.match(req))||(await caches.match("./reading.html"))||Response.error();
        const cached=await caches.match(req)||await caches.match("./index.html");return injectThoughtPatches(cached);
      }
    })());return;
  }

  e.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});return res})));
});

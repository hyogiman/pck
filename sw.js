/* 생각의 텃밭 + 독서의 정원 — shared service worker
   두 앱의 껍데기를 캐시해 두어 네트워크가 없어도 화면을 다시 열 수 있게 합니다.
   생각의 텃밭 HTML에만 기존 런타임 패치를 주입하고, reading.html에는 주입하지 않습니다.

   v9: 독서의 정원(reading.html/css/js) 쉘 추가 + reading 페이지 패치 격리. */
const CACHE = "garden-v9";
const PATCH_VERSION = "20260820-1635-ai-v2-lab";
const PATCH_TAGS = [
  `<script src="./storage-fix.js?v=${PATCH_VERSION}"></script>`,
  `<script src="./capture-marking.js?v=${PATCH_VERSION}"></script>`,
  // Test runtime loads first so ?ai-v2-test=1 can suppress spontaneous Blooming.
  `<script src="./ai-v2-test-runtime.js?v=${PATCH_VERSION}"></script>`,
  `<script src="./blooming-v2-runtime.js?v=${PATCH_VERSION}"></script>`
];
const SHELL = [
  "./", "./index.html", "./manifest.json",
  "./reading.html", "./reading.css", "./reading.js",
  "./icons/icon-192.png", "./icons/icon-512.png"
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

    // 새 서비스워커가 활성화됐는데 현재 화면이 구버전 HTML/패치로 열려 있으면
    // 같은 주소를 한 번 다시 열어 즉시 새 패치를 적용한다.
    const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    await Promise.all(windows.map(async(client)=>{
      try{ await client.navigate(client.url); }catch(_){}
    }));
  })());
});

async function injectPatches(response){
  if(!response)return response;
  const type=response.headers.get("content-type")||"";
  if(!type.includes("text/html"))return response;

  let html=await response.text();
  // 예전 주입 태그가 응답/캐시에 남아 있어도 제거한 뒤 현재 버전만 넣는다.
  html=html.replace(/\s*<script src="\.\/(?:storage-fix|capture-marking|ai-v2-test-runtime|blooming-v2-runtime)\.js(?:\?v=[^"]*)?"><\/script>/gi,"");
  html=html.replace(/<\/body>/i, `${PATCH_TAGS.join("\n")}\n</body>`);

  const headers=new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");

  return new Response(html,{
    status:response.status,
    statusText:response.statusText,
    headers
  });
}

self.addEventListener("fetch", (e) => {
  const req=e.request;
  if(req.method!=="GET")return;
  const url=new URL(req.url);

  // Firebase ESM은 독서의 정원이 한번 온라인으로 열린 뒤에는 런타임 캐시에 남긴다.
  // 이렇게 하면 같은 기기에서 이후 오프라인 재진입 가능성이 높아진다.
  if(url.origin!==self.location.origin){
    if(url.hostname==="www.gstatic.com" && url.pathname.includes("/firebasejs/")){
      e.respondWith((async()=>{
        const cached=await caches.match(req);
        if(cached)return cached;
        try{
          const res=await fetch(req);
          if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});}
          return res;
        }catch(_){return Response.error();}
      })());
    }
    return;
  }

  const isReadingHtml=url.pathname.endsWith("/reading.html");

  // 패치 파일은 항상 네트워크 우선. 실패할 때만 현재 SW 캐시를 사용한다.
  if(url.pathname.endsWith("/storage-fix.js")||url.pathname.endsWith("/capture-marking.js")||url.pathname.endsWith("/ai-v2-test-runtime.js")||url.pathname.endsWith("/blooming-v2-runtime.js")){
    e.respondWith((async()=>{
      try{
        const fresh=await fetch(req,{cache:"no-store"});
        if(fresh.ok){
          const copy=fresh.clone();
          caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});
        }
        return fresh;
      }catch(_){
        return (await caches.match(req)) || Response.error();
      }
    })());
    return;
  }

  // HTML은 네트워크 우선. 생각의 텃밭에만 기존 런타임 패치를 주입한다.
  // 독서의 정원에는 Thought Garden 전용 패치를 절대 주입하지 않는다.
  if(req.mode==="navigate"||(req.headers.get("accept")||"").includes("text/html")){
    e.respondWith((async()=>{
      try{
        const network=await fetch(req,{cache:"no-store"});
        if(isReadingHtml){
          const copy=network.clone();
          caches.open(CACHE).then((c)=>c.put(req,copy)).catch(()=>{});
          return network;
        }
        const patched=await injectPatches(network);
        const copy=patched.clone();
        caches.open(CACHE).then((c)=>c.put(req,copy)).catch(()=>{});
        return patched;
      }catch(_){
        if(isReadingHtml){
          return (await caches.match(req)) || (await caches.match("./reading.html")) || Response.error();
        }
        const cached=await caches.match(req)||await caches.match("./index.html");
        return injectPatches(cached);
      }
    })());
    return;
  }

  e.respondWith(
    caches.match(req).then((cached)=>
      cached||fetch(req).then((res)=>{
        const copy=res.clone();
        caches.open(CACHE).then((c)=>c.put(req,copy)).catch(()=>{});
        return res;
      })
    )
  );
});
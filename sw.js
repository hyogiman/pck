/* 생각의 텃밭 — service worker
   앱 껍데기를 캐시해 두어, 네트워크가 없어도 화면이 열리게 합니다.
   기록 데이터 자체의 오프라인 처리는 Firestore 캐시가 담당합니다.

   v6: 최근 3일 로컬 캐시 정책 + 캡처창 UI 패치를 유지하면서,
   패치 JS는 버전 URL로 불러오고 새 SW 활성화 시 열린 앱을 한 번 새로고침합니다. */
const CACHE = "garden-v6";
const PATCH_VERSION = "20260817-1229";
const PATCH_TAGS = [
  `<script src="./storage-fix.js?v=${PATCH_VERSION}"></script>`,
  `<script src="./capture-marking.js?v=${PATCH_VERSION}"></script>`
];
const SHELL = ["./", "./index.html", "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png"];

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
  html=html.replace(/\s*<script src="\.\/(?:storage-fix|capture-marking)\.js(?:\?v=[^"]*)?"><\/script>/gi,"");
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
  if(url.origin!==self.location.origin)return;

  // 패치 파일은 항상 네트워크 우선. 실패할 때만 현재 SW 캐시를 사용한다.
  if(url.pathname.endsWith("/storage-fix.js")||url.pathname.endsWith("/capture-marking.js")){
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

  // HTML은 네트워크 우선 + 현재 버전 패치 주입.
  if(req.mode==="navigate"||(req.headers.get("accept")||"").includes("text/html")){
    e.respondWith((async()=>{
      try{
        const network=await fetch(req,{cache:"no-store"});
        const patched=await injectPatches(network);
        const copy=patched.clone();
        caches.open(CACHE).then((c)=>c.put(req,copy)).catch(()=>{});
        return patched;
      }catch(_){
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

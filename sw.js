/* 생각의 텃밭 — service worker
   앱 껍데기를 캐시해 두어, 네트워크가 없어도 화면이 열리게 합니다.
   기록 데이터 자체의 오프라인 처리는 Firestore 캐시가 담당합니다.

   v5: 최근 3일 로컬 캐시 정책 + 캡처창 별표/분류 UI + 안내 문구 정리를 반영합니다. */
const CACHE = "garden-v5";
const PATCH_TAGS = [
  '<script src="./storage-fix.js"></script>',
  '<script src="./capture-marking.js"></script>'
];
const SHELL = ["./", "./index.html", "./storage-fix.js", "./capture-marking.js", "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function injectPatches(response){
  if(!response)return response;
  const type=response.headers.get("content-type")||"";
  if(!type.includes("text/html"))return response;

  let html=await response.text();
  for(const tag of PATCH_TAGS){
    const match=tag.match(/src="\.\/(.+?)"/);
    const file=match?.[1]||"";
    if(file&&!html.includes(file))html=html.replace(/<\/body>/i, `${tag}\n</body>`);
  }

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
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    e.respondWith((async()=>{
      try{
        const network=await fetch(req);
        const patched=await injectPatches(network);
        const copy=patched.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return patched;
      }catch(_){
        const cached=await caches.match(req) || await caches.match("./index.html");
        return injectPatches(cached);
      }
    })());
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
    )
  );
});

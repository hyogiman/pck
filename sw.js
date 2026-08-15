/* 생각의 텃밭 — service worker
   앱 껍데기를 캐시해 두어, 네트워크가 없어도 화면이 열리게 합니다.
   기록 데이터 자체의 오프라인 처리는 Firestore 캐시가 담당합니다.

   v2: index.html을 직접 크게 수정하지 않고 storage-fix.js를 런타임에 주입합니다.
   이 패치는 Firestore 원본은 그대로 두고 localStorage에는 가벼운 오프라인
   스냅샷만 남겨 브라우저 quota 초과를 막습니다. */
const CACHE = "garden-v2";
const STORAGE_FIX_TAG = '<script src="./storage-fix.js"></script>';
const SHELL = ["./", "./index.html", "./storage-fix.js", "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png"];

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

async function injectStorageFix(response){
  if(!response)return response;
  const type=response.headers.get("content-type")||"";
  if(!type.includes("text/html"))return response;

  const html=await response.text();
  const patched=html.includes("storage-fix.js")
    ? html
    : html.replace(/<\/body>/i, `${STORAGE_FIX_TAG}\n</body>`);

  const headers=new Headers(response.headers);
  // A newly constructed Response has a new body; stale transport-length/encoding
  // headers can otherwise confuse some mobile browsers and proxies.
  headers.delete("content-length");
  headers.delete("content-encoding");

  return new Response(patched,{
    status:response.status,
    statusText:response.statusText,
    headers
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 앱 자신의 파일만 처리 — Firebase·알라딘·TMDB 등 외부 요청은 그대로 통과
  if (url.origin !== self.location.origin) return;

  // HTML: 네트워크 우선(항상 최신 버전), 실패하면 캐시.
  // 반환 직전에 작은 저장 호환 패치를 주입합니다.
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    e.respondWith((async()=>{
      try{
        const network=await fetch(req);
        const patched=await injectStorageFix(network);
        const copy=patched.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return patched;
      }catch(_){
        const cached=await caches.match(req) || await caches.match("./index.html");
        return injectStorageFix(cached);
      }
    })());
    return;
  }

  // 그 외 정적 파일: 캐시 우선
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

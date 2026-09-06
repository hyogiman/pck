from pathlib import Path
import json


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def replace_between(text, start_marker, end_marker, replacement, label):
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"{label}: start marker not found")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"{label}: end marker not found")
    return text[:start] + replacement + text[end:]


# -----------------------------------------------------------------------------
# Firebase Functions: Cloud Vision OCR + YES24-primary shared book search
# -----------------------------------------------------------------------------
p = Path("functions/package.json")
data = json.loads(p.read_text(encoding="utf-8"))
data.setdefault("dependencies", {})["@google-cloud/vision"] = "^6.0.0"
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

p = Path("functions/index.js")
s = p.read_text(encoding="utf-8")

s = replace_once(
    s,
    'const { getFirestore, FieldValue } = require("firebase-admin/firestore");\n',
    'const { getFirestore, FieldValue } = require("firebase-admin/firestore");\nconst { getAuth: getAdminAuth } = require("firebase-admin/auth");\nconst vision = require("@google-cloud/vision");\n',
    "functions imports",
)
s = replace_once(
    s,
    'const db = getFirestore();\n',
    'const db = getFirestore();\nconst visionClient = new vision.ImageAnnotatorClient();\n',
    "vision client",
)

new_services = r'''const PUBLIC_WEB_ORIGINS = [
  "https://hyogiman.github.io",
  "https://2nhyeok.kr",
  "https://www.2nhyeok.kr",
];

function normalizeYes24Book(item = {}) {
  return {
    provider: "YES24",
    itemId: String(item.itemId || ""),
    title: String(item.title || ""),
    author: String(item.author || ""),
    publisher: String(item.publisher || ""),
    pubDate: String(item.publishDate || ""),
    cover: String(item.cover || "").replace(/^http:/, "https:"),
    isbn13: String(item.isbn13 || ""),
    isbn: String(item.isbn10 || ""),
    link: String(item.link || ""),
    categoryName: String(item.goodsSortNm || item.goodsType || ""),
    subTitle: String(item.subTitle || ""),
    pages: Number.isFinite(Number(item.pages)) ? Number(item.pages) : null,
    starScore: Number.isFinite(Number(item.starScore)) ? Number(item.starScore) : null,
    bookIntroduction: String(item.contentDetail?.bookIntroduction || ""),
    bookSummary: String(item.contentDetail?.bookSummary || ""),
    tableOfContents: String(item.contentDetail?.tableOfContents || ""),
  };
}

function normalizeAladinBook(item = {}) {
  return {
    provider: "Aladin",
    itemId: String(item.itemId || ""),
    title: String(item.title || ""),
    author: String(item.author || ""),
    publisher: String(item.publisher || ""),
    pubDate: String(item.pubDate || ""),
    cover: String(item.cover || "").replace(/^http:/, "https:"),
    isbn13: String(item.isbn13 || ""),
    isbn: String(item.isbn || ""),
    link: String(item.link || ""),
    categoryName: String(item.categoryName || ""),
    subTitle: String(item.subInfo?.subTitle || ""),
    pages: null,
    starScore: null,
    bookIntroduction: String(item.description || ""),
    bookSummary: "",
    tableOfContents: "",
  };
}

async function searchYes24Books(query, apiKey) {
  const url = new URL("https://apis.yes24.com/v1/goods/itemList");
  url.searchParams.set("query", query);
  url.searchParams.set("category", "BOOK");
  url.searchParams.set("sort", "RELATION");
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("detail", "Y");

  const upstream = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "Accept": "application/json",
      "X-Api-Key": apiKey,
      "User-Agent": "ThoughtGarden/1.0",
    },
  });
  const raw = await upstream.text();
  if (!upstream.ok) {
    throw new Error(`YES24 HTTP ${upstream.status}: ${raw.replace(/\s+/g, " ").slice(0, 180)}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`YES24 non-JSON response: ${raw.replace(/\s+/g, " ").slice(0, 180)}`);
  }
  if (!data?.success) {
    throw new Error(`YES24 API error: ${data?.message || data?.errorCode || "unknown"}`);
  }
  return {
    totalResults: Number(data?.data?.totalCount || 0),
    items: Array.isArray(data?.data?.items) ? data.data.items.map(normalizeYes24Book) : [],
  };
}

async function searchAladinBooks(query, key) {
  const url = new URL("http://www.aladin.co.kr/ttb/api/ItemSearch.aspx");
  url.searchParams.set("TTBKey", key);
  url.searchParams.set("Query", query);
  url.searchParams.set("QueryType", "Keyword");
  url.searchParams.set("MaxResults", "20");
  url.searchParams.set("start", "1");
  url.searchParams.set("SearchTarget", "Book");
  url.searchParams.set("Cover", "Big");
  url.searchParams.set("Output", "JS");
  url.searchParams.set("Version", "20131101");

  const upstream = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "Accept": "application/json,text/plain,*/*",
      "User-Agent": "ThoughtGarden/1.0",
    },
  });
  const raw = await upstream.text();
  if (!upstream.ok) {
    throw new Error(`Aladin HTTP ${upstream.status}: ${raw.replace(/\s+/g, " ").slice(0, 180)}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Aladin non-JSON response: ${raw.replace(/\s+/g, " ").slice(0, 180)}`);
  }
  if (data?.errorCode || data?.errorMessage) {
    throw new Error(`Aladin API error: ${data.errorMessage || data.errorCode}`);
  }
  return {
    totalResults: Number(data?.totalResults || 0),
    items: Array.isArray(data?.item) ? data.item.map(normalizeAladinBook) : [],
  };
}

exports.bookSearch = onRequest(
  {
    region: "us-central1",
    cors: PUBLIC_WEB_ORIGINS,
    secrets: ["YES24_API_KEY", "ALADIN_TTB_KEY"],
    timeoutSeconds: 30,
    maxInstances: 2,
  },
  async (req, res) => {
    const query = String(req.query.q || "").trim();
    if (!query) {
      res.status(400).json({ ok: false, error: "검색어가 없습니다." });
      return;
    }

    let yes24Error = "";
    const yes24Key = process.env.YES24_API_KEY;
    if (yes24Key) {
      try {
        const result = await searchYes24Books(query, yes24Key);
        res.status(200).json({
          ok: true,
          provider: "YES24",
          totalResults: result.totalResults,
          items: result.items,
        });
        return;
      } catch (error) {
        yes24Error = error?.message || "YES24 search failed";
        logger.warn("YES24 book search failed; falling back to Aladin", yes24Error);
      }
    } else {
      yes24Error = "YES24_API_KEY Secret이 설정되지 않았습니다.";
    }

    const aladinKey = process.env.ALADIN_TTB_KEY;
    if (!aladinKey) {
      res.status(500).json({ ok: false, error: `${yes24Error} / ALADIN_TTB_KEY도 없습니다.` });
      return;
    }

    try {
      const result = await searchAladinBooks(query, aladinKey);
      res.status(200).json({
        ok: true,
        provider: "Aladin",
        fallbackFrom: "YES24",
        yes24Error,
        totalResults: result.totalResults,
        items: result.items,
      });
    } catch (error) {
      logger.error("Book search fallback failed", error);
      res.status(502).json({
        ok: false,
        error: `도서 검색 실패: ${error?.message || "unknown error"}`,
        yes24Error,
      });
    }
  }
);

async function verifyFirebaseBearer(req) {
  const auth = String(req.headers.authorization || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    return await getAdminAuth(adminApp).verifyIdToken(match[1]);
  } catch (error) {
    logger.warn("readingOcr invalid Firebase token", error?.message || error);
    return null;
  }
}

exports.readingOcr = onRequest(
  {
    region: "us-central1",
    cors: PUBLIC_WEB_ORIGINS,
    timeoutSeconds: 30,
    maxInstances: 2,
    memory: "512MiB",
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "POST만 지원합니다." });
      return;
    }

    const user = await verifyFirebaseBearer(req);
    if (!user) {
      res.status(401).json({ ok: false, error: "로그인이 필요합니다." });
      return;
    }

    const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (!["image/webp", "image/png", "image/jpeg"].includes(contentType)) {
      res.status(415).json({ ok: false, error: "WebP, PNG, JPEG 이미지만 인식할 수 있습니다." });
      return;
    }

    const body = req.rawBody;
    if (!Buffer.isBuffer(body) || !body.length) {
      res.status(400).json({ ok: false, error: "필사 이미지가 없습니다." });
      return;
    }
    if (body.length > 4 * 1024 * 1024) {
      res.status(413).json({ ok: false, error: "필사 이미지가 너무 큽니다. 4MB 이하만 지원합니다." });
      return;
    }

    try {
      const [result] = await visionClient.documentTextDetection({
        image: { content: body },
        imageContext: { languageHints: ["ko", "en"] },
      });
      const rawText = String(
        result?.fullTextAnnotation?.text || result?.textAnnotations?.[0]?.description || ""
      ).trim();
      res.set("Cache-Control", "no-store");
      res.status(200).json({ ok: true, rawText });
    } catch (error) {
      logger.error("readingOcr Vision request failed", error);
      res.status(502).json({
        ok: false,
        error: `OCR 처리 실패: ${error?.message || "unknown error"}`,
      });
    }
  }
);
'''

s = replace_between(s, "exports.bookSearch = onRequest(", "\nfunction safeId", new_services, "bookSearch/readingOcr block")
p.write_text(s, encoding="utf-8")


# -----------------------------------------------------------------------------
# Reading Garden: binary OCR request + YES24 provider metadata
# -----------------------------------------------------------------------------
p = Path("reading.js")
s = p.read_text(encoding="utf-8")
s = replace_once(
    s,
    'const BOOK_SEARCH_PROXY="https://us-central1-idea-pocket-56063.cloudfunctions.net/bookSearch";\n',
    'const BOOK_SEARCH_PROXY="https://us-central1-idea-pocket-56063.cloudfunctions.net/bookSearch";\nconst READING_OCR_PROXY="https://us-central1-idea-pocket-56063.cloudfunctions.net/readingOcr";\n',
    "reading OCR endpoint",
)

new_handwriting = r'''async function buildHandwritingDraft(){
  const ink=state.handwriting.strokes.filter(s=>!s.erase&&s.points.length);if(!ink.length){toast("먼저 필사해주세요.");return null}
  const pad=28;let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const s of ink)for(const p of s.points){if(p.x<minX)minX=p.x;if(p.y<minY)minY=p.y;if(p.x>maxX)maxX=p.x;if(p.y>maxY)maxY=p.y}
  minX=Math.max(0,minX-pad);minY=Math.max(0,minY-pad);const paper=$("writingPaper").getBoundingClientRect();maxX=Math.min(paper.width,maxX+pad);maxY=Math.min(paper.height,maxY+pad);
  const w=Math.max(1,Math.ceil(maxX-minX)),h=Math.max(1,Math.ceil(maxY-minY)),maxPixels=2200000,scale=Math.min(1.6,Math.max(1,Math.sqrt(maxPixels/(w*h)))),out=document.createElement("canvas");
  out.width=Math.max(1,Math.round(w*scale));out.height=Math.max(1,Math.round(h*scale));const o=out.getContext("2d");o.fillStyle="#fff";o.fillRect(0,0,out.width,out.height);o.save();o.scale(scale,scale);o.translate(-minX,-minY);redrawWriting(o,out);o.restore();
  const imageBlob=await new Promise(r=>out.toBlob(r,"image/webp",.8));out.width=1;out.height=1;
  if(!imageBlob){toast("필사 이미지를 만들지 못했습니다.");return null}
  return {imageBlob,rawOcrText:"",suggestedText:"",confirmedText:""};
}
async function recognizeHandwritingServer(imageBlob){
  if(!state.user?.getIdToken)throw new Error("Google 로그인이 필요합니다.");
  const token=await state.user.getIdToken();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),22000);
  try{
    const r=await fetch(READING_OCR_PROXY,{method:"POST",headers:{"Authorization":`Bearer ${token}`,"Content-Type":imageBlob.type||"image/webp","Accept":"application/json"},body:imageBlob,signal:controller.signal});
    let data=null;try{data=await r.json()}catch{}
    if(!r.ok||!data?.ok)throw new Error(data?.error||`OCR 서버 ${r.status}`);
    return safeText(data.rawText||"");
  }finally{clearTimeout(timer)}
}
async function convertHandwriting(){
  const btn=$("convertHandwritingBtn");if(btn){btn.disabled=true;btn.textContent="필사 이미지 준비 중…"}
  try{
    const d=await buildHandwritingDraft();if(!d)return;
    state.handwriting.draft=d;state.handwriting.strokes=[];state.handwriting.current=null;
    let raw="",ocrError="";
    if(navigator.onLine&&state.user){
      if(btn)btn.textContent="글자 인식 중…";
      try{raw=await recognizeHandwritingServer(d.imageBlob)}catch(err){ocrError=err?.name==="AbortError"?"OCR 응답 시간이 초과되었습니다.":(err?.message||"OCR 서버 연결에 실패했습니다.");console.warn("Reading OCR fallback to manual confirmation",err)}
    }else ocrError="오프라인이라 OCR을 건너뛰었습니다.";
    d.rawOcrText=raw;d.suggestedText=raw;d.confirmedText=raw;
    $("ocrConfirmedText").value=raw;
    $("ocrRawText").textContent=raw||ocrError||"인식된 글자가 없습니다.";
    $("ocrNotice").textContent=raw?"필기 인식 결과입니다. 책의 원문과 비교해 수정한 뒤 확정해주세요.":`${ocrError||"글자를 인식하지 못했습니다."} 필사 이미지는 준비되어 있으므로 텍스트 없이 그대로 확정해도 됩니다.`;
    closeLayer("handwritingLayer");openDialog("ocrDialog");
  }catch(err){console.error("convertHandwriting failed",err);toast("필사 이미지를 준비하지 못했습니다. 다시 시도해주세요.",3200)}
  finally{if(btn){btn.disabled=false;btn.textContent="텍스트 변환"}}
}
function confirmOcr(){const text=safeText($("ocrConfirmedText").value);if(!state.handwriting.draft)return toast("필사 원본을 찾지 못했습니다. 다시 필사해주세요.");state.handwriting.draft.confirmedText=text;state.handwriting.draft.suggestedText=text;if(text)$("entryQuote").value=text;closeDialog("ocrDialog");syncHandwritingAttachmentCard();openDialog("recordDialog")}
'''
s = replace_between(s, "async function buildHandwritingDraft(){", "\nfunction normalizeGenre", new_handwriting, "reading handwriting block")

start = s.find("async function runBookSearch(){")
end = s.find("\nfunction bookSearchRow", start)
if start < 0 or end < 0:
    raise SystemExit("reading book search block markers not found")
old_search = s[start:end]
new_search = r'''async function runBookSearch(){const q=safeText($("bookSearchInput").value);if(!q)return;const box=$("bookSearchResults");box.innerHTML=`<div class="helper">YES24에서 검색 중…</div>`;const local=state.sources.filter(s=>`${s.title} ${s.creator}`.toLowerCase().includes(q.toLowerCase())).slice(0,6);let api=[];try{const r=await fetch(`${BOOK_SEARCH_PROXY}?q=${encodeURIComponent(q)}`),j=await r.json();if(!r.ok||!j.ok)throw new Error(j?.error||`도서 검색 서버 ${r.status}`);api=(j.items||[]).map(x=>({title:safeText(x.title),creator:safeText(x.author),publisher:safeText(x.publisher),image:x.cover||"",isbn13:x.isbn13||x.isbn||"",categoryName:safeText(x.categoryName),pubDate:x.pubDate||x.publishDate||"",externalLink:x.link||"",provider:x.provider||j.provider||"YES24",externalId:String(x.itemId||""),subTitle:safeText(x.subTitle),pages:Number(x.pages)||null,starScore:Number(x.starScore)||null,bookIntroduction:safeText(x.bookIntroduction),bookSummary:safeText(x.bookSummary),tableOfContents:safeText(x.tableOfContents)}))}catch(err){console.warn(err);box.innerHTML=`<div class="helper">도서 검색 서버 오류 · Google Books로 보완 검색합니다.</div>`}if(api.length<8){const google=await googleBooksSearch(q);api=dedupeBookResults([...api,...google])}box.innerHTML=(local.length?`<div class="eyebrow" style="margin:10px 0 4px">이미 내 서재에 있음</div>${local.map(s=>bookSearchRow(s,true)).join("")}`:"")+(api.length?`<div class="eyebrow" style="margin:14px 0 4px">검색 결과</div>${api.map((x,i)=>bookSearchRow({...x,_index:i},false)).join("")}`:`<div class="empty-card">검색 결과가 없습니다.</div>`);state.bookApiResults=api}'''
s = s[:start] + new_search + s[end:]

s = s.replace(
    '<p>${esc(x.creator||"")}${x.publisher?` · ${esc(x.publisher)}`:""}</p>',
    '<p>${esc(x.creator||"")}${x.publisher?` · ${esc(x.publisher)}`:""}${x.provider?` · ${esc(x.provider)}`:""}</p>',
    1,
)
s = s.replace(
    'provider:x.provider,externalLink:x.externalLink,rawCategories:x.categoryName?[x.categoryName]:[],primaryGenre:normalizeGenre(x.categoryName),publisher:x.publisher,pubDate:x.pubDate,createdAt:nowIso(),updatedAt:nowIso()',
    'provider:x.provider,externalId:x.externalId||"",externalLink:x.externalLink,rawCategories:x.categoryName?[x.categoryName]:[],primaryGenre:normalizeGenre(x.categoryName),publisher:x.publisher,pubDate:x.pubDate,subTitle:x.subTitle||"",pages:x.pages||null,starScore:x.starScore||null,bookIntroduction:x.bookIntroduction||"",bookSummary:x.bookSummary||"",tableOfContents:x.tableOfContents||"",createdAt:nowIso(),updatedAt:nowIso()',
    1,
)
p.write_text(s, encoding="utf-8")


# -----------------------------------------------------------------------------
# Thought Garden: same shared backend, correct provider/labels
# -----------------------------------------------------------------------------
p = Path("index.html")
s = p.read_text(encoding="utf-8")

needle = 'async function aladinBookSearch(query){'
start = s.find(needle)
if start < 0:
    raise SystemExit("Thought Garden aladinBookSearch not found")
segment_end = s.find("function renderCombinedBookResults", start)
if segment_end < 0:
    raise SystemExit("Thought Garden combined book marker not found")
segment = s[start:segment_end]
if 'provider:"Aladin"' not in segment:
    raise SystemExit("Thought Garden provider mapping not found")
segment = segment.replace('provider:"Aladin"', 'provider:x.provider||d.provider||"YES24"', 1)
s = s[:start] + segment + s[segment_end:]

s = s.replace("알라딘과 Google Books를 함께 검색 중…", "YES24와 Google Books를 함께 검색 중…")
s = s.replace("알라딘은 연결되어 있습니다. 영상 검색에 필요한 키만 관리합니다.", "YES24를 기본 도서 검색으로 사용합니다. 검색 장애 시 알라딘과 Google Books로 보완합니다.")
s = s.replace("알라딘 · Firebase Function", "YES24 · Firebase Function")
s = s.replace('r.provider==="Aladin"?"ok":""', '(r.provider==="YES24"||r.provider==="Aladin")?"ok":""')
s = s.replace('`알라딘 검색 서버 ${r.status}`', '`도서 검색 서버 ${r.status}`')
s = s.replace('<span class="bad">알라딘 오류</span>', '<span class="bad">도서 검색 오류</span>')
s = s.replace('<span class="ok">알라딘 ${status.aladinCount}건</span>', '<span class="ok">도서 검색 ${status.aladinCount}건</span>')
p.write_text(s, encoding="utf-8")


# -----------------------------------------------------------------------------
# Reading Garden cache/version + OCR copy
# -----------------------------------------------------------------------------
p = Path("reading.html")
s = p.read_text(encoding="utf-8")
s = s.replace("20260904-reading-v14", "20260906-reading-v25")
s = s.replace(
    "필사 원본은 저장할 준비가 됐습니다. OCR 서버 연결 전에는 아래 칸을 직접 확인·수정해 확정할 수 있습니다.",
    "S Pen 필사를 이미지로 준비한 뒤 글자를 인식합니다. 결과를 책의 원문과 비교해 수정한 뒤 확정해주세요.",
)
s = s.replace("아직 실제 OCR 엔진과 연결되지 않았습니다.", "필사 후 인식 원문이 여기에 표시됩니다.")
p.write_text(s, encoding="utf-8")

p = Path("reading-pwa-v7.js")
s = p.read_text(encoding="utf-8")
s = s.replace("v24", "v25")
s = s.replace("20260904-reading-v24", "20260906-reading-v25")
p.write_text(s, encoding="utf-8")

print("Reading Garden v25 OCR + YES24 integration patch applied")

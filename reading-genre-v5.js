/* 독서의 정원 v5 — stable genre enrichment + Reading-only metadata */
import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const FIREBASE_CONFIG={
  apiKey:"AIzaSyAZwvHGXmi_m_a8KqZbxELHAlV0ah1SWO8",
  authDomain:"idea-pocket-56063.firebaseapp.com",
  projectId:"idea-pocket-56063",
  storageBucket:"idea-pocket-56063.firebasestorage.app",
  messagingSenderId:"894399979515",
  appId:"1:894399979515:web:834a298e37ef05dbd0f55e"
};
const BOOK_SEARCH_PROXY="https://us-central1-idea-pocket-56063.cloudfunctions.net/bookSearch";
const GENRES=new Set(["소설","에세이","인문·철학","사회·정치","역사","심리","경제·경영","과학·기술","예술·문화","자기계발","육아·교육"]);
const app=getApps()[0]||initializeApp(FIREBASE_CONFIG),auth=getAuth(app),db=getFirestore(app);
let currentUser=null,books=[],metadata=new Map(),refreshing=false;

const safe=v=>String(v??"").trim();
const digits=v=>String(v||"").replace(/\D/g,"");
const norm=v=>String(v||"").toLowerCase().replace(/[\s:：·\-–—_'"“”‘’()\[\]<>]/g,"");
function toast(msg,ms=2700){const el=document.getElementById("toast");if(!el)return;el.textContent=msg;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),ms)}
function validGenre(v){return GENRES.has(safe(v))}

function normalizeGenre(raw=""){
  const x=String(raw).toLowerCase();
  if(/에세이|산문|essay/.test(x))return "에세이";
  if(/심리|정신분석|psycholog/.test(x))return "심리";
  if(/육아|자녀교육|교육학|교육|education|parenting/.test(x))return "육아·교육";
  if(/경제|경영|재테크|마케팅|투자|비즈니스|business|economics|finance/.test(x))return "경제·경영";
  if(/자기계발|성공|처세|시간관리|self-help|self help/.test(x))return "자기계발";
  if(/역사|한국사|세계사|고고학|history/.test(x))return "역사";
  if(/사회과학|사회학|정치|법학|법률|시사|언론|미디어|political|social science|sociology/.test(x))return "사회·정치";
  if(/과학|공학|기술|컴퓨터|it>|수학|물리|화학|생명|의학|science|technology|computer|mathematics|medical/.test(x))return "과학·기술";
  if(/예술|미술|음악|영화|사진|디자인|문화|art|music|film|design/.test(x))return "예술·문화";
  if(/인문|철학|종교|언어학|고전|philosophy|humanities|religion/.test(x))return "인문·철학";
  if(/소설|장르문학|문학|fiction|literature/.test(x))return "소설";
  return "기타";
}

function candidateScore(book,item){
  let score=0;const bi=digits(book.isbn13),ii=digits(item.isbn13||item.isbn);
  if(bi&&ii&&bi===ii)score+=120;
  const bt=norm(book.title),it=norm(item.title);if(bt&&it){if(bt===it)score+=70;else if(bt.includes(it)||it.includes(bt))score+=35}
  const ba=norm(book.creator),ia=norm(item.author||item.creator);if(ba&&ia&&(ba.includes(ia)||ia.includes(ba)))score+=20;
  return score;
}
async function aladinGenre(book){
  try{
    /* ItemSearch는 ISBN 숫자 검색보다 제목 검색이 안정적이므로 제목을 사용하고 결과에서 ISBN으로 검증한다. */
    const q=safe(book.title)||digits(book.isbn13);if(!q)return null;
    const r=await fetch(`${BOOK_SEARCH_PROXY}?q=${encodeURIComponent(q)}`);if(!r.ok)return null;
    const j=await r.json();if(!j.ok||!Array.isArray(j.items))return null;
    const ranked=j.items.map(item=>({item,score:candidateScore(book,item)})).sort((a,b)=>b.score-a.score);
    const hit=ranked[0]?.score>0?ranked[0].item:null;if(!hit)return null;
    const raw=safe(hit.categoryName);
    /* 잘못된 필드가 장르로 들어가는 것을 방지한다. 출판사와 같거나 카테고리가 없으면 사용하지 않는다. */
    if(!raw||raw===safe(hit.publisher))return null;
    const primaryGenre=normalizeGenre(raw);if(!validGenre(primaryGenre))return null;
    return {primaryGenre,rawCategories:[raw],genreProvider:"Aladin"};
  }catch(err){console.debug("Aladin genre skipped",err);return null}
}
async function googleGenre(book){
  try{
    const isbn=digits(book.isbn13),url=new URL("https://www.googleapis.com/books/v1/volumes");
    url.searchParams.set("q",isbn?`isbn:${isbn}`:`intitle:${safe(book.title)}${safe(book.creator)?` inauthor:${safe(book.creator)}`:""}`);
    url.searchParams.set("maxResults","10");url.searchParams.set("printType","books");
    const r=await fetch(url);if(!r.ok)return null;const j=await r.json(),items=Array.isArray(j.items)?j.items:[];
    const ranked=items.map(item=>{const v=item.volumeInfo||{},mapped={title:v.title||"",author:(v.authors||[]).join(", "),isbn13:(v.industryIdentifiers||[]).find(x=>x.type==="ISBN_13")?.identifier||""};return {v,score:candidateScore(book,mapped)}}).sort((a,b)=>b.score-a.score);
    const v=(ranked[0]?.score>0?ranked[0]:items[0]?{v:items[0].volumeInfo||{},score:1}:null)?.v;if(!v)return null;
    const raw=(v.categories||[]).map(safe).filter(Boolean);if(!raw.length)return null;
    const primaryGenre=normalizeGenre(raw.join(" > "));if(!validGenre(primaryGenre))return null;
    return {primaryGenre,rawCategories:raw,genreProvider:"Google Books"};
  }catch(err){console.debug("Google genre skipped",err);return null}
}
async function discoverGenre(book){return await aladinGenre(book)||await googleGenre(book)}

async function loadGenreData(){
  if(!currentUser)return;
  const [srcSnap,metaSnap]=await Promise.all([
    getDocs(collection(db,"users",currentUser.uid,"sources")),
    getDocs(collection(db,"users",currentUser.uid,"readingBookMetadata")).catch(()=>null)
  ]);
  books=srcSnap.docs.map(d=>({id:d.id,ref:d.ref,...d.data()})).filter(x=>x.type==="book");
  metadata=new Map((metaSnap?.docs||[]).map(d=>[d.id,{id:d.id,...d.data()}]));
}
function effectiveGenre(book){const m=metadata.get(book.id);return validGenre(m?.primaryGenre)?m.primaryGenre:validGenre(book.primaryGenre)?book.primaryGenre:""}

async function persistGenre(book,g){
  const now=new Date().toISOString(),payload={sourceId:book.id,primaryGenre:g.primaryGenre,rawCategories:g.rawCategories||[],genreProvider:g.genreProvider,genreEnrichedAt:now,titleSnapshot:book.title||"",creatorSnapshot:book.creator||"",isbn13Snapshot:book.isbn13||"",updatedAt:now};
  let metaOk=true;
  try{await setDoc(doc(db,"users",currentUser.uid,"readingBookMetadata",book.id),payload,{merge:true})}catch(err){metaOk=false;console.warn("readingBookMetadata save failed",err)}
  /* reading.js의 기존 통계가 source.primaryGenre를 사용하므로 호환 필드도 merge로 유지한다. */
  await setDoc(book.ref,{primaryGenre:g.primaryGenre,rawCategories:g.rawCategories||[],genreProvider:g.genreProvider,genreEnrichedAt:now,updatedAt:now},{merge:true});
  metadata.set(book.id,payload);book.primaryGenre=g.primaryGenre;book.rawCategories=g.rawCategories||[];
  return metaOk;
}

async function repairSourcesFromMetadata(){
  let repaired=0;
  for(const book of books){const m=metadata.get(book.id);if(!validGenre(m?.primaryGenre))continue;if(book.primaryGenre===m.primaryGenre)continue;
    try{await setDoc(book.ref,{primaryGenre:m.primaryGenre,rawCategories:m.rawCategories||[],genreProvider:m.genreProvider||"Reading Garden",genreEnrichedAt:m.genreEnrichedAt||new Date().toISOString()},{merge:true});book.primaryGenre=m.primaryGenre;repaired++}catch{}
  }
  if(repaired&&!sessionStorage.getItem("rgGenreRepairReloaded")){sessionStorage.setItem("rgGenreRepairReloaded","1");setTimeout(()=>location.reload(),250)}
}

function removeOldGenreTool(){document.querySelectorAll(".rg-genre-card").forEach(x=>x.remove())}
function addGenreTool(){
  removeOldGenreTool();const modal=document.querySelector("#settingsDialog .modal");if(!modal||modal.querySelector(".rg-genre-card-v5"))return;
  const cards=[...modal.querySelectorAll(".setting-card")],dataCard=cards.find(x=>x.textContent.includes("데이터"));
  const card=document.createElement("div");card.className="setting-card rg-genre-card-v5";
  card.innerHTML=`<b>책 장르 정보</b><p class="helper">독서의 정원 전용 메타데이터에 장르를 보관하고, 통계용 source에는 같은 값을 안전하게 동기화합니다.</p><div class="rg-genre-status-v5">장르 상태를 확인하고 있습니다.</div><button id="rgGenreRepairBtn" class="btn" type="button">기존 책 장르 자동 보완</button><div class="genre-note">장르가 확인되지 않은 책은 억지로 분류하지 않습니다. 출판사명 같은 값은 장르로 저장하지 않도록 검증합니다.</div>`;
  (dataCard||cards.at(-1))?.insertAdjacentElement("afterend",card);card.querySelector("button").addEventListener("click",backfillGenres);
}
function refreshGenreStatus(){
  const el=document.querySelector(".rg-genre-status-v5"),btn=document.getElementById("rgGenreRepairBtn");if(!el)return;
  const pending=books.filter(b=>!effectiveGenre(b));
  el.textContent=pending.length?`현재 ${pending.length}권의 장르를 보완할 수 있습니다. ${books.length-pending.length}권은 장르가 저장되어 있습니다.`:`현재 ${books.length}권 모두 장르 정보가 저장되어 있습니다.`;
  if(btn)btn.disabled=!pending.length;
}
async function backfillGenres(){
  if(refreshing||!currentUser)return;refreshing=true;const btn=document.getElementById("rgGenreRepairBtn"),status=document.querySelector(".rg-genre-status-v5");if(btn)btn.disabled=true;
  try{
    await loadGenreData();const pending=books.filter(b=>!effectiveGenre(b));if(!pending.length){refreshGenreStatus();toast("보완할 장르가 없습니다.");return}
    let done=0,failed=0;
    for(let i=0;i<pending.length;i++){
      const b=pending[i];if(status)status.textContent=`장르 확인 중… ${i+1} / ${pending.length} · ${b.title||"책"}`;
      const g=await discoverGenre(b);if(g){try{await persistGenre(b,g);done++}catch(err){console.warn("genre save failed",err);failed++}}else failed++;
      if(i<pending.length-1)await new Promise(r=>setTimeout(r,100));
    }
    applyGenreBadges();refreshGenreStatus();toast(`장르 ${done}권을 보완했습니다.${failed?` ${failed}권은 확인 보류.`:""}`,3200);
    if(done)setTimeout(()=>location.reload(),800);
  }finally{refreshing=false;if(btn)btn.disabled=false}
}

function genreForId(id){const b=books.find(x=>x.id===id);return b?effectiveGenre(b):""}
function ensureBadge(host,genre){if(!host||!genre)return;let badge=host.querySelector(".rg-genre-badge");if(!badge){badge=document.createElement("span");badge.className="rg-genre-badge";host.appendChild(badge)}badge.textContent=genre}
function applyGenreBadges(){
  document.querySelectorAll(".book-card[data-open-book]").forEach(card=>{const genre=genreForId(card.dataset.openBook);if(!genre)return;let host=card.querySelector(".book-card-meta");if(!host){host=document.createElement("div");host.className="book-card-meta";card.appendChild(host)}ensureBadge(host,genre)});
  const detail=document.getElementById("bookDetailBody"),title=detail?.querySelector(".detail-meta h2")?.textContent?.trim();if(title){const matches=books.filter(b=>safe(b.title)===title);if(matches.length===1)ensureBadge(detail.querySelector(".detail-tags"),effectiveGenre(matches[0]))}
}

let uiScheduled=false;
function scheduleUi(){if(uiScheduled)return;uiScheduled=true;requestAnimationFrame(()=>{uiScheduled=false;removeOldGenreTool();addGenreTool();applyGenreBadges();if(document.getElementById("settingsDialog")?.open)refreshGenreStatus()})}
const observer=new MutationObserver(scheduleUi);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["class","open"]});
const theme=document.querySelector('meta[name="theme-color"]');if(theme)theme.setAttribute("content","#f2e9dc");

onAuthStateChanged(auth,async user=>{
  currentUser=user;if(!user)return;
  try{await loadGenreData();await repairSourcesFromMetadata();scheduleUi();refreshGenreStatus()}catch(err){console.warn("Reading Garden genre init",err)}
});
scheduleUi();

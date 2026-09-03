/* 독서의 정원 v3 enhancement — startup feel, picker search, session cleanup, genre backfill */
const SNAPSHOT_DB="readingGarden_v1";
const CURRENT_BOOK_KEY="readingGarden_currentBook_v1";
const BOOK_SEARCH_PROXY="https://us-central1-idea-pocket-56063.cloudfunctions.net/bookSearch";
const FIREBASE_CONFIG={
  apiKey:"AIzaSyAZwvHGXmi_m_a8KqZbxELHAlV0ah1SWO8",
  authDomain:"idea-pocket-56063.firebaseapp.com",
  projectId:"idea-pocket-56063",
  storageBucket:"idea-pocket-56063.firebasestorage.app",
  messagingSenderId:"894399979515",
  appId:"1:894399979515:web:834a298e37ef05dbd0f55e"
};
const esc=(v="")=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const safe=v=>String(v??"").trim();
let firebaseCtxPromise=null;

function toast(msg,ms=2600){
  const el=document.getElementById("toast");if(!el)return;
  el.textContent=msg;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),ms);
}
function inferService(platform=""){
  const p=String(platform).toLowerCase();
  if(p.includes("밀리"))return "밀리의 서재";
  if(p.includes("yes24")||p.includes("예스24"))return "YES24";
  if(p.includes("종이"))return "종이책";
  return platform||"독서";
}
function relativeDate(v){
  if(!v)return "";const d=new Date(v),today=new Date();today.setHours(0,0,0,0);d.setHours(0,0,0,0);
  const days=Math.round((today-d)/86400000);return days===0?"오늘":days===1?"어제":days>1?`${days}일 전`:"최근";
}
async function getSnapshot(){
  return new Promise(resolve=>{
    const req=indexedDB.open(SNAPSHOT_DB,1);
    req.onerror=()=>resolve(null);
    req.onupgradeneeded=()=>{};
    req.onsuccess=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains("meta")){resolve(null);db.close();return}
      const tx=db.transaction("meta","readonly"),r=tx.objectStore("meta").get("snapshot");
      r.onsuccess=()=>{resolve(r.result||null);db.close()};r.onerror=()=>{resolve(null);db.close()};
    };
  });
}
function profileFor(snapshot,id){
  const p=(snapshot.readingProfiles||[]).find(x=>x.sourceId===id);if(p)return p;
  const s=(snapshot.sources||[]).find(x=>x.id===id);return s?{status:s.status==="done"?"completed":"reading",service:"",format:"ebook",lastReadAt:""}:null;
}
function pickCachedBook(snapshot){
  const sources=(snapshot.sources||[]).filter(s=>s.type==="book"),saved=localStorage.getItem(CURRENT_BOOK_KEY);
  if(saved&&sources.some(s=>s.id===saved))return sources.find(s=>s.id===saved);
  const reading=sources.filter(s=>profileFor(snapshot,s.id)?.status==="reading");
  reading.sort((a,b)=>new Date(profileFor(snapshot,b.id)?.lastReadAt||b.updatedAt||0)-new Date(profileFor(snapshot,a.id)?.lastReadAt||a.updatedAt||0));
  return reading[0]||sources[0]||null;
}
function cachedHeroHtml(book,profile){
  const cover=book.image?`<img class="hero-cover" src="${esc(book.image)}" alt="${esc(book.title)} 표지" />`:`<div class="hero-cover placeholder">📕</div>`;
  const service=profile?.service==="millie"?"밀리의 서재":profile?.service==="yes24"?"YES24":profile?.service==="paper"?"종이책":inferService(book.platform);
  const recent=profile?.lastReadAt?`<div class="hero-locator"><small>최근 독서</small><strong style="font-size:1rem">${esc(relativeDate(profile.lastReadAt))}</strong></div>`:"";
  return `<div class="read-hero-inner">${cover}<h2 class="hero-title">${esc(book.title)}</h2><p class="hero-author">${esc(book.creator||"")}</p><span class="hero-service">${esc(service||"독서")}</span>${recent}<button class="btn primary block start-btn" data-start-book="${esc(book.id)}" type="button">▶ 읽기 시작</button><button class="text-btn switch-book" data-open-book-picker type="button">다른 책 선택 ›</button></div>`;
}
async function showCachedHeroImmediately(){
  try{
    const hero=document.getElementById("readHero");if(!hero)return;
    const snap=await getSnapshot(),book=snap&&pickCachedBook(snap);if(!book)return;
    const render=()=>{
      const text=hero.textContent||"";
      if(text.includes("서재를 불러오고")||!hero.children.length)hero.innerHTML=cachedHeroHtml(book,profileFor(snap,book.id));
    };
    render();
    const mo=new MutationObserver(()=>render());mo.observe(hero,{childList:true,subtree:true});setTimeout(()=>mo.disconnect(),4500);
  }catch(err){console.debug("cached hero skipped",err)}
}

function addPickerSearchAction(){
  const dialog=document.getElementById("bookPickerDialog"),head=dialog?.querySelector(".sheet-head");
  if(!dialog||!head||dialog.querySelector(".rg-picker-new"))return;
  const wrap=document.createElement("div");wrap.className="rg-picker-new";
  wrap.innerHTML=`<button class="btn block" type="button">＋ 새 책 검색 · 추가</button><small>서재로 이동하지 않고 여기서 바로 새 책을 찾을 수 있어요.</small>`;
  wrap.querySelector("button").addEventListener("click",()=>{dialog.close();document.getElementById("addBookBtn")?.click()});
  head.insertAdjacentElement("afterend",wrap);
}

async function getFirebaseCtx(){
  if(firebaseCtxPromise)return firebaseCtxPromise;
  firebaseCtxPromise=(async()=>{
    const appMod=await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js");
    const authMod=await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js");
    const fsMod=await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
    const app=appMod.getApps()[0]||appMod.initializeApp(FIREBASE_CONFIG);
    return {app,auth:authMod.getAuth(app),db:fsMod.getFirestore(app),...authMod,...fsMod};
  })();
  return firebaseCtxPromise;
}
function waitForUser(auth,onAuthStateChanged){return new Promise(resolve=>{const off=onAuthStateChanged(auth,u=>{if(u){off();resolve(u)}})})}

let timelineLoaded=false,timelineSessions=[],timelineSources=[];
function timeText(v){const d=new Date(v);return new Intl.DateTimeFormat("ko-KR",{hour:"2-digit",minute:"2-digit",hour12:false}).format(d)}
function monthDay(v){const d=new Date(v);return {month:d.getMonth()+1,day:d.getDate()}}
function sourceTitle(id){return timelineSources.find(s=>s.id===id)?.title||""}
async function loadTimelineDeleteData(){
  if(timelineLoaded)return;
  const ctx=await getFirebaseCtx(),user=ctx.auth.currentUser||await waitForUser(ctx.auth,ctx.onAuthStateChanged);
  const [ss,src]=await Promise.all([
    ctx.getDocs(ctx.collection(ctx.db,"users",user.uid,"readingSessions")),
    ctx.getDocs(ctx.collection(ctx.db,"users",user.uid,"sources"))
  ]);
  timelineSessions=ss.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.endedAt);
  timelineSources=src.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.type==="book");
  timelineLoaded=true;enhanceTimeline();
}
function matchSession(card){
  const head=card.querySelector(".timeline-session-head"),title=head?.querySelector("h3")?.textContent?.trim()||"",meta=head?.querySelector("p")?.textContent||"",dayTitle=card.closest(".day-group")?.querySelector(".day-title")?.textContent||"";
  const tm=meta.match(/(\d{1,2}:\d{2})\s*[–-]/),dm=dayTitle.match(/(\d{1,2})월\s*(\d{1,2})일/);if(!title||!tm||!dm)return null;
  const candidates=timelineSessions.filter(s=>{const md=monthDay(s.startedAt);return sourceTitle(s.sourceId)===title&&timeText(s.startedAt)===tm[1]&&md.month===Number(dm[1])&&md.day===Number(dm[2])});
  return candidates.length===1?candidates[0]:null;
}
function enhanceTimeline(){
  if(!timelineLoaded)return;
  document.querySelectorAll(".timeline-session").forEach(card=>{
    if(card.querySelector(".rg-session-delete"))return;const session=matchSession(card);if(!session)return;const head=card.querySelector(".timeline-session-head");if(!head)return;
    const btn=document.createElement("button");btn.type="button";btn.className="rg-session-delete";btn.title="독서시간 기록 삭제";btn.setAttribute("aria-label","독서시간 기록 삭제");btn.textContent="✕";
    btn.addEventListener("click",async e=>{e.stopPropagation();await deleteSession(session.id)});head.appendChild(btn);
  });
}
async function deleteSession(sessionId){
  const target=timelineSessions.find(s=>s.id===sessionId);if(!target)return;
  const ctx=await getFirebaseCtx(),user=ctx.auth.currentUser;if(!user)return;
  const [entriesSnap,profilesSnap]=await Promise.all([
    ctx.getDocs(ctx.collection(ctx.db,"users",user.uid,"readingEntries")),
    ctx.getDocs(ctx.collection(ctx.db,"users",user.uid,"readingProfiles"))
  ]);
  const entries=entriesSnap.docs.map(d=>({ref:d.ref,id:d.id,...d.data()})).filter(e=>e.sessionId===sessionId),profiles=profilesSnap.docs.map(d=>({ref:d.ref,id:d.id,...d.data()}));
  const extra=entries.length?`\n\n이 세션 안의 문장·필사·생각 ${entries.length}개는 삭제하지 않고 독립 기록으로 남깁니다.`:"";
  if(!confirm(`이 독서시간 기록을 삭제할까요?\n${sourceTitle(target.sourceId)} · ${timeText(target.startedAt)} · ${Math.round(Number(target.finalDurationMinutes)||0)}분${extra}`))return;
  try{
    const now=new Date().toISOString();for(const e of entries)await ctx.setDoc(e.ref,{sessionId:null,updatedAt:now},{merge:true});
    await ctx.deleteDoc(ctx.doc(ctx.db,"users",user.uid,"readingSessions",sessionId));
    const remaining=timelineSessions.filter(s=>s.id!==sessionId&&s.sourceId===target.sourceId&&s.endedAt).sort((a,b)=>new Date(b.endedAt||b.startedAt)-new Date(a.endedAt||a.startedAt)),profile=profiles.find(p=>p.sourceId===target.sourceId);
    if(profile){const patch={lastReadAt:remaining[0]?.endedAt||remaining[0]?.startedAt||"",updatedAt:now};if((profile.currentLocator||"")===(target.endLocator||""))patch.currentLocator=remaining[0]?.endLocator||"";await ctx.setDoc(profile.ref,patch,{merge:true})}
    toast(entries.length?"독서시간을 삭제했습니다. 문장과 생각은 남겨두었습니다.":"독서시간 기록을 삭제했습니다.");setTimeout(()=>location.reload(),650);
  }catch(err){console.error(err);toast("삭제 중 문제가 생겼습니다. 기록은 그대로 유지됩니다.",3200)}
}

function normalizeGenre(raw=""){
  const x=String(raw).toLowerCase();
  if(/소설|문학/.test(x))return "소설";if(/에세이/.test(x))return "에세이";if(/인문|철학/.test(x))return "인문·철학";if(/사회|정치/.test(x))return "사회·정치";if(/역사/.test(x))return "역사";if(/심리/.test(x))return "심리";if(/경제|경영/.test(x))return "경제·경영";if(/과학|기술|컴퓨터/.test(x))return "과학·기술";if(/예술|문화/.test(x))return "예술·문화";if(/자기계발/.test(x))return "자기계발";if(/육아|교육/.test(x))return "육아·교육";return "기타";
}
function digits(v){return String(v||"").replace(/\D/g,"")}
function normalizeTitle(v){return String(v||"").toLowerCase().replace(/[\s:：·\-–—_'"“”‘’()\[\]]/g,"")}
async function findGenre(book){
  const q=digits(book.isbn13)||book.title;if(!q)return null;
  try{
    const r=await fetch(`${BOOK_SEARCH_PROXY}?q=${encodeURIComponent(q)}`);if(!r.ok)return null;const j=await r.json();if(!j.ok)return null;
    const items=j.items||[],isbn=digits(book.isbn13);
    let hit=isbn?items.find(x=>digits(x.isbn13||x.isbn)===isbn):null;
    if(!hit){const nt=normalizeTitle(book.title);hit=items.find(x=>normalizeTitle(x.title)===nt)||items[0]}
    const raw=safe(hit?.categoryName);if(!raw)return null;return {primaryGenre:normalizeGenre(raw),rawCategories:[raw]};
  }catch{return null}
}
async function loadGenreBooks(){
  const ctx=await getFirebaseCtx(),user=ctx.auth.currentUser||await waitForUser(ctx.auth,ctx.onAuthStateChanged),snap=await ctx.getDocs(ctx.collection(ctx.db,"users",user.uid,"sources"));
  return {ctx,user,books:snap.docs.map(d=>({ref:d.ref,id:d.id,...d.data()})).filter(s=>s.type==="book")};
}
async function refreshGenreStatus(){
  const status=document.querySelector(".rg-genre-status"),btn=document.getElementById("rgGenreBackfillBtn");if(!status||!btn)return;
  try{const {books}=await loadGenreBooks(),pending=books.filter(b=>!safe(b.primaryGenre)||b.primaryGenre==="기타");status.textContent=pending.length?`현재 ${pending.length}권의 장르가 비어 있거나 ‘기타’입니다.`:"모든 책에 장르 정보가 들어 있습니다.";btn.disabled=!pending.length}
  catch{status.textContent="장르 상태는 버튼을 누를 때 다시 확인합니다."}
}
async function backfillGenres(){
  const btn=document.getElementById("rgGenreBackfillBtn"),status=document.querySelector(".rg-genre-status");if(btn)btn.disabled=true;
  try{
    const {ctx,books}=await loadGenreBooks(),pending=books.filter(b=>!safe(b.primaryGenre)||b.primaryGenre==="기타");if(!pending.length){status.textContent="보완할 책이 없습니다.";return}
    let done=0,failed=0;
    for(let i=0;i<pending.length;i+=3){
      const batch=pending.slice(i,i+3);await Promise.all(batch.map(async b=>{const g=await findGenre(b);if(g&&g.primaryGenre!=="기타"){await ctx.setDoc(b.ref,{...g,genreProvider:"Aladin",genreEnrichedAt:new Date().toISOString(),updatedAt:new Date().toISOString()},{merge:true});done++}else failed++}));
      status.textContent=`장르 확인 중… ${Math.min(i+batch.length,pending.length)} / ${pending.length}`;
      if(i+3<pending.length)await new Promise(r=>setTimeout(r,180));
    }
    status.textContent=`${done}권을 보완했습니다.${failed?` ${failed}권은 자동 분류할 정보가 부족했습니다.`:""}`;toast(`책 장르 ${done}권을 보완했습니다.`);if(done)setTimeout(()=>location.reload(),900);
  }catch(err){console.error(err);status.textContent="장르 보완 중 문제가 생겼습니다. 기존 정보는 그대로 유지됩니다.";toast("장르 보완을 완료하지 못했습니다.")}
  finally{if(btn)btn.disabled=false}
}
function addGenreTool(){
  const modal=document.querySelector("#settingsDialog .modal");if(!modal||modal.querySelector(".rg-genre-card"))return;
  const cards=[...modal.querySelectorAll(".setting-card")],dataCard=cards.find(x=>x.textContent.includes("데이터"));
  const card=document.createElement("div");card.className="setting-card rg-genre-card";card.innerHTML=`<b>책 장르 정보</b><p class="helper">예전에 등록한 책은 장르가 없을 수 있습니다. ISBN과 책 제목으로 알라딘 정보를 다시 확인해 자동 분류합니다.</p><div class="rg-genre-status">설정을 열면 상태를 확인합니다.</div><button id="rgGenreBackfillBtn" class="btn soft" type="button">기존 책 장르 자동 보완</button>`;
  (dataCard||cards.at(-1))?.insertAdjacentElement("afterend",card);card.querySelector("button").addEventListener("click",backfillGenres);
}

function watchUi(){
  const observer=new MutationObserver(()=>{
    const timeline=document.querySelector('[data-view="timeline"].active');
    if(timeline){if(!timelineLoaded)loadTimelineDeleteData().catch(()=>{});else enhanceTimeline()}
    if(document.getElementById("settingsDialog")?.open)refreshGenreStatus();
  });
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["class","open"]});
}

addPickerSearchAction();addGenreTool();showCachedHeroImmediately();watchUi();

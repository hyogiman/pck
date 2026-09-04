/* 독서의 정원 v12 — 책 상세 드롭다운 + Reading Garden 전용 서재 제거/복원 */
import { getApps, getApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const SNAPSHOT_DB="readingGarden_v1";
const CURRENT_BOOK_KEY="readingGarden_currentBook_v1";
let busy=false;

function injectStyle(){
  if(document.getElementById('rgDetailMenuStyle'))return;
  const s=document.createElement('style');s.id='rgDetailMenuStyle';s.textContent=`
    #bookDetail .layer-shell{position:relative}
    #bookDetail .layer-head{position:relative;z-index:86}
    #bookMoreMenu{
      position:absolute!important;z-index:85;top:calc(62px + env(safe-area-inset-top));right:15px;
      width:min(258px,calc(100vw - 38px));display:grid;gap:2px;padding:8px;
      border:1px solid var(--line);border-radius:16px;background:rgba(255,250,242,.985);
      box-shadow:0 18px 48px rgba(74,52,35,.18);backdrop-filter:blur(16px);
    }
    #bookMoreMenu.hidden{display:none!important}
    #bookMoreMenu .btn{
      width:100%;display:block;text-align:left;padding:11px 12px;border:0;border-radius:10px;
      background:transparent;box-shadow:none;color:var(--text);font-size:.78rem;
    }
    #bookMoreMenu .btn:hover,#bookMoreMenu .btn:active{background:#f0e6d8;transform:none}
    #bookMoreMenu .rg-book-remove{margin-top:4px;padding-top:12px;border-top:1px solid var(--line);border-radius:0 0 10px 10px;color:var(--danger)}
    #bookMoreMenu .rg-book-restore{margin-top:4px;padding-top:12px;border-top:1px solid var(--line);border-radius:0 0 10px 10px;color:#65745d}
    #bookMoreMenu .rg-menu-note{padding:5px 12px 2px;color:var(--muted);font-size:.62rem;line-height:1.45}
    @media(max-width:520px){#bookMoreMenu{right:12px;top:calc(59px + env(safe-area-inset-top));width:min(244px,calc(100vw - 28px))}}
  `;document.head.appendChild(s);
}

function openDb(){return new Promise(resolve=>{const r=indexedDB.open(SNAPSHOT_DB,1);r.onerror=()=>resolve(null);r.onupgradeneeded=()=>{};r.onsuccess=()=>resolve(r.result)})}
async function readSnapshot(){const db=await openDb();if(!db)return null;return new Promise(resolve=>{if(!db.objectStoreNames.contains('meta')){db.close();resolve(null);return}const tx=db.transaction('meta','readonly'),r=tx.objectStore('meta').get('snapshot');r.onsuccess=()=>{db.close();resolve(r.result||null)};r.onerror=()=>{db.close();resolve(null)}})}
async function writeSnapshot(snap){const db=await openDb();if(!db||!snap)return;return new Promise(resolve=>{if(!db.objectStoreNames.contains('meta')){db.close();resolve();return}const tx=db.transaction('meta','readwrite');tx.objectStore('meta').put(snap);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();resolve()}})}
async function queueProfile(profile){const db=await openDb();if(!db)return;return new Promise(resolve=>{if(!db.objectStoreNames.contains('outbox')){db.close();resolve();return}const tx=db.transaction('outbox','readwrite');tx.objectStore('outbox').put({id:`readingProfiles:${profile.id}`,collectionName:'readingProfiles',docId:profile.id,data:profile,kind:'set',queuedAt:new Date().toISOString()});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();resolve()}})}

async function waitForApp(){for(let i=0;i<40;i++){if(getApps().length)return getApp();await new Promise(r=>setTimeout(r,75))}return null}
async function getUser(){
  const app=await waitForApp();if(!app)return {app:null,user:null};const auth=getAuth(app);
  if(auth.currentUser)return {app,user:auth.currentUser};
  const user=await new Promise(resolve=>{let settled=false;const finish=u=>{if(settled)return;settled=true;try{off()}catch{};resolve(u||null)};const off=onAuthStateChanged(auth,u=>finish(u));setTimeout(()=>finish(null),2500)});
  return {app,user};
}

async function cloudProfiles(){
  const {app,user}=await getUser();if(!app||!user)return {db:null,user:null,profiles:[]};
  const db=getFirestore(app);try{const snap=await getDocs(collection(db,'users',user.uid,'readingProfiles'));return {db,user,profiles:snap.docs.map(d=>({id:d.id,...d.data()}))}}catch{return {db,user,profiles:[]}}
}

function sourceIdFromDetail(){return document.querySelector('#bookMoreMenu [data-edit-profile]')?.dataset.editProfile||document.querySelector('#bookDetail [data-start-book]')?.dataset.startBook||''}
function profileStatus(snap,id){const p=(snap?.readingProfiles||[]).find(x=>x.sourceId===id);if(p)return p.status;const s=(snap?.sources||[]).find(x=>x.id===id);return s?.status==='done'?'completed':'reading'}
function nextReadingId(snap,removedId){return (snap?.sources||[]).find(s=>s.id!==removedId&&profileStatus(snap,s.id)==='reading')?.id||''}

async function persistProfile(sourceId,mode){
  const now=new Date().toISOString(),snap=await readSnapshot()||{key:'snapshot',readingProfiles:[],sources:[]};
  snap.readingProfiles=Array.isArray(snap.readingProfiles)?snap.readingProfiles:[];
  let p=snap.readingProfiles.find(x=>x.sourceId===sourceId);
  const cloud=await cloudProfiles();
  const cp=cloud.profiles.find(x=>x.sourceId===sourceId);
  if(cp){const i=snap.readingProfiles.findIndex(x=>x.sourceId===sourceId);p={...(i>=0?snap.readingProfiles[i]:{}),...cp};if(i>=0)snap.readingProfiles[i]=p;else snap.readingProfiles.push(p)}
  if(!p){p={id:crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`,sourceId,status:'reading',format:'ebook',service:'other',currentLocator:'',createdAt:now,updatedAt:now};snap.readingProfiles.push(p)}
  if(mode==='remove'){
    p.previousStatus=p.status&&p.status!=='removed'?p.status:(p.previousStatus||'reading');p.status='removed';p.removedAt=now;p.updatedAt=now;
  }else{
    p.status=p.previousStatus&&p.previousStatus!=='removed'?p.previousStatus:'reading';p.removedAt=null;p.updatedAt=now;
  }
  snap.savedAt=now;await writeSnapshot(snap);
  if(cloud.db&&cloud.user&&navigator.onLine){try{await setDoc(doc(cloud.db,'users',cloud.user.uid,'readingProfiles',p.id),p,{merge:true})}catch{await queueProfile(p)}}else await queueProfile(p);
  return snap;
}

async function removeBook(sourceId){
  if(busy||!sourceId)return;
  const ok=confirm('이 책을 독서의 정원 서재에서 제거할까요?\n\n생각의 텃밭에 있는 책과 생각은 삭제되지 않고, 지금까지의 독서 기록도 그대로 보존됩니다.');
  if(!ok)return;busy=true;
  const btn=document.querySelector('[data-rg-remove-book]');if(btn){btn.disabled=true;btn.textContent='제거 중…'}
  try{const snap=await persistProfile(sourceId,'remove');const next=nextReadingId(snap,sourceId);if(next)localStorage.setItem(CURRENT_BOOK_KEY,next);else localStorage.removeItem(CURRENT_BOOK_KEY);location.reload()}finally{busy=false}
}
async function restoreBook(sourceId){
  if(busy||!sourceId)return;busy=true;const btn=document.querySelector('[data-rg-restore-book]');if(btn){btn.disabled=true;btn.textContent='추가 중…'}
  try{await persistProfile(sourceId,'restore');localStorage.setItem(CURRENT_BOOK_KEY,sourceId);location.reload()}finally{busy=false}
}

async function decorateMenu(){
  injectStyle();const menu=document.getElementById('bookMoreMenu');if(!menu)return;
  const id=sourceIdFromDetail();if(!id)return;
  const snap=await readSnapshot(),removed=profileStatus(snap,id)==='removed';
  menu.querySelectorAll('.rg-book-remove,.rg-book-restore,.rg-menu-note').forEach(x=>x.remove());
  if(removed){
    const b=document.createElement('button');b.type='button';b.className='btn rg-book-restore';b.dataset.rgRestoreBook=id;b.textContent='🌿 독서의 정원 서재에 다시 추가';menu.appendChild(b);
    const tag=document.querySelector('#bookDetailBody .detail-tags .mini-tag');if(tag&&!tag.textContent.trim())tag.textContent='서재에서 제거됨';
  }else{
    const note=document.createElement('div');note.className='rg-menu-note';note.textContent='생각의 텃밭의 책·생각과 독서 기록은 유지됩니다.';menu.appendChild(note);
    const b=document.createElement('button');b.type='button';b.className='btn rg-book-remove';b.dataset.rgRemoveBook=id;b.textContent='독서의 정원에서 제거';menu.appendChild(b);
  }
}

let decorating=false;
function scheduleDecorate(){if(decorating)return;decorating=true;requestAnimationFrame(async()=>{decorating=false;await decorateMenu();guardRemovedHome()})}
async function guardRemovedHome(){
  const start=document.querySelector('#readView.active #readHero [data-start-book]');if(!start)return;
  const snap=await readSnapshot();if(profileStatus(snap,start.dataset.startBook)!=='removed')return;
  const next=nextReadingId(snap,start.dataset.startBook);
  if(next){localStorage.setItem(CURRENT_BOOK_KEY,next);location.reload();return}
  const hero=document.getElementById('readHero');if(hero)hero.innerHTML='<div class="empty-hero"><div class="empty-icon">📚</div><h2>읽는 중인 책이 없습니다.</h2><p>서재에서 책을 읽는 중으로 바꾸거나 새 책을 추가해보세요.</p><button class="btn primary" data-open-book-search type="button">＋ 책 추가</button></div>';
}

document.addEventListener('click',e=>{
  const remove=e.target.closest('[data-rg-remove-book]');if(remove){e.preventDefault();e.stopPropagation();removeBook(remove.dataset.rgRemoveBook);return}
  const restore=e.target.closest('[data-rg-restore-book]');if(restore){e.preventDefault();e.stopPropagation();restoreBook(restore.dataset.rgRestoreBook);return}
  const menu=document.getElementById('bookMoreMenu');if(menu&&!menu.classList.contains('hidden')&&!e.target.closest('#bookMoreBtn')&&!e.target.closest('#bookMoreMenu'))menu.classList.add('hidden');
});
new MutationObserver(scheduleDecorate).observe(document.body,{subtree:true,childList:true});
scheduleDecorate();

/* 독서의 정원 v15 — 책 상세 안정화 + 필사 저장 중복 방지/시각 피드백 */
import { getApps, getApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const SNAPSHOT_DB="readingGarden_v1";
const CURRENT_BOOK_KEY="readingGarden_currentBook_v1";
let busy=false;
let rgEntrySaving=false;
let rgSaveFallbackTimer=null;
let rgHandwritingPreviewUrl="";

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

    .rg-handwriting-save-preview{
      margin:-1px 0 16px;padding:12px;border:1px solid rgba(118,86,61,.16);border-radius:14px;
      background:#f7f0e6;display:flex;align-items:center;gap:12px;
    }
    .rg-handwriting-save-preview.hidden{display:none!important}
    .rg-handwriting-save-preview img{
      width:74px;height:56px;object-fit:contain;border-radius:9px;background:#fff;border:1px solid rgba(118,86,61,.12);
    }
    .rg-handwriting-save-preview .rg-hw-copy{min-width:0;flex:1}
    .rg-handwriting-save-preview strong{display:block;font-size:.76rem;color:var(--text);margin-bottom:3px}
    .rg-handwriting-save-preview span{display:block;font-size:.66rem;line-height:1.45;color:var(--muted)}
    .rg-handwriting-save-preview.is-saving{background:#f1eadf}
    .rg-handwriting-save-preview.is-saving img{opacity:.68}
    .rg-handwriting-save-preview .rg-hw-spinner{
      width:15px;height:15px;flex:0 0 auto;border:2px solid rgba(118,86,61,.22);border-top-color:#76563d;border-radius:50%;
      animation:rgSpin .8s linear infinite;display:none;
    }
    .rg-handwriting-save-preview.is-saving .rg-hw-spinner{display:block}
    #saveEntryBtn[aria-busy="true"]{opacity:.78;cursor:wait}
    @keyframes rgSpin{to{transform:rotate(360deg)}}
    @media(max-width:520px){
      #bookMoreMenu{right:12px;top:calc(59px + env(safe-area-inset-top));width:min(244px,calc(100vw - 28px))}
      .rg-handwriting-save-preview img{width:64px;height:50px}
    }
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

  const start=document.querySelector('#bookDetailBody [data-start-book]');
  const edit=menu.querySelector('[data-edit-profile]');
  const complete=menu.querySelector('[data-complete-book]');

  if(removed){
    edit?.classList.add('hidden');complete?.classList.add('hidden');
    if(start){
      start.removeAttribute('data-start-book');
      start.dataset.rgRestoreBook=id;
      start.textContent='🌿 독서의 정원 서재에 다시 추가';
    }
    const b=document.createElement('button');b.type='button';b.className='btn rg-book-restore';b.dataset.rgRestoreBook=id;b.textContent='🌿 독서의 정원 서재에 다시 추가';menu.appendChild(b);
  }else{
    edit?.classList.remove('hidden');complete?.classList.remove('hidden');
    const note=document.createElement('div');note.className='rg-menu-note';note.textContent='생각의 텃밭의 책·생각과 독서 기록은 유지됩니다.';menu.appendChild(note);
    const b=document.createElement('button');b.type='button';b.className='btn rg-book-remove';b.dataset.rgRemoveBook=id;b.textContent='독서의 정원에서 제거';menu.appendChild(b);
  }
}

let decorating=false;
function scheduleDecorate(){
  if(decorating)return;decorating=true;
  requestAnimationFrame(async()=>{decorating=false;await decorateMenu();guardRemovedHome()});
}
async function guardRemovedHome(){
  const start=document.querySelector('#readView.active #readHero [data-start-book]');if(!start)return;
  const snap=await readSnapshot();if(profileStatus(snap,start.dataset.startBook)!=='removed')return;
  const next=nextReadingId(snap,start.dataset.startBook);
  if(next){localStorage.setItem(CURRENT_BOOK_KEY,next);location.reload();return}
  const hero=document.getElementById('readHero');if(hero)hero.innerHTML='<div class="empty-hero"><div class="empty-icon">📚</div><h2>읽는 중인 책이 없습니다.</h2><p>서재에서 책을 읽는 중으로 바꾸거나 새 책을 추가해보세요.</p><button class="btn primary" data-open-book-search type="button">＋ 책 추가</button></div>';
}

function ensureHandwritingPreview(){
  injectStyle();
  const quote=document.getElementById('entryQuote');
  const field=quote?.closest('.field');
  if(!field)return null;
  let box=document.getElementById('rgHandwritingSavePreview');
  if(!box){
    box=document.createElement('div');
    box.id='rgHandwritingSavePreview';
    box.className='rg-handwriting-save-preview hidden';
    box.innerHTML='<img alt="필사 원본 미리보기"><div class="rg-hw-copy"><strong>✍ 필사 원본 포함</strong><span>작성한 필사 이미지와 S Pen 획 데이터가 기록과 함께 저장됩니다.</span></div><i class="rg-hw-spinner" aria-hidden="true"></i>';
    field.insertAdjacentElement('afterend',box);
  }
  return box;
}

function captureHandwritingPreview(){
  const canvas=document.getElementById('writingCanvas');
  if(!canvas||!canvas.width||!canvas.height)return '';
  try{return canvas.toDataURL('image/png',.72)}catch{return ''}
}

function showHandwritingPreview(){
  const box=ensureHandwritingPreview();if(!box)return;
  if(!rgHandwritingPreviewUrl)rgHandwritingPreviewUrl=captureHandwritingPreview();
  const img=box.querySelector('img');if(img&&rgHandwritingPreviewUrl)img.src=rgHandwritingPreviewUrl;
  box.classList.remove('hidden','is-saving');
  box.querySelector('strong').textContent='✍ 필사 원본 포함';
  box.querySelector('span').textContent='작성한 필사 이미지와 S Pen 획 데이터가 기록과 함께 저장됩니다.';
}

function setSaveVisual(saving){
  const btn=document.getElementById('saveEntryBtn');if(!btn)return;
  const box=ensureHandwritingPreview();
  btn.disabled=saving;btn.setAttribute('aria-busy',saving?'true':'false');
  if(saving){
    if(!btn.dataset.rgOriginalText)btn.dataset.rgOriginalText=btn.textContent||'기록 저장';
    const hasHandwriting=box&&!box.classList.contains('hidden');
    btn.textContent=hasHandwriting?'✍ 필사 이미지 저장 중…':'기록 저장 중…';
    if(hasHandwriting){
      box.classList.add('is-saving');
      box.querySelector('strong').textContent='필사 이미지 저장 중…';
      box.querySelector('span').textContent='원본 이미지와 펜 획 데이터를 함께 저장하고 있습니다. 한 번만 눌러주세요.';
    }
  }else{
    btn.disabled=false;btn.setAttribute('aria-busy','false');
    if(btn.dataset.rgOriginalText){btn.textContent=btn.dataset.rgOriginalText;delete btn.dataset.rgOriginalText}
    if(box&&!box.classList.contains('hidden'))showHandwritingPreview();
  }
}

function resetEntrySaveUi({clearPreview=false}={}){
  clearTimeout(rgSaveFallbackTimer);rgSaveFallbackTimer=null;rgEntrySaving=false;setSaveVisual(false);
  if(clearPreview){
    rgHandwritingPreviewUrl='';
    const box=document.getElementById('rgHandwritingSavePreview');box?.classList.add('hidden');box?.classList.remove('is-saving');
  }
}

function beginEntrySave(e){
  const btn=e.target.closest('#saveEntryBtn');if(!btn)return;
  if(rgEntrySaving){e.preventDefault();e.stopImmediatePropagation();return}
  rgEntrySaving=true;setSaveVisual(true);
  rgSaveFallbackTimer=setTimeout(()=>{
    const dialog=document.getElementById('recordDialog');
    if(dialog?.open&&rgEntrySaving){
      rgEntrySaving=false;setSaveVisual(false);
      const box=document.getElementById('rgHandwritingSavePreview');
      if(box&&!box.classList.contains('hidden'))box.querySelector('span').textContent='저장 확인이 오래 걸리고 있습니다. 네트워크 상태를 확인한 뒤 다시 시도할 수 있습니다.';
    }
  },30000);
}

function setupRecordDialogFeedback(){
  const dialog=document.getElementById('recordDialog');if(!dialog)return;
  ensureHandwritingPreview();
  const observer=new MutationObserver(()=>{
    if(dialog.open){
      if(!rgEntrySaving)setSaveVisual(false);
      if(rgHandwritingPreviewUrl)showHandwritingPreview();
    }
  });
  observer.observe(dialog,{attributes:true,attributeFilter:['open']});
  dialog.addEventListener('close',()=>{clearTimeout(rgSaveFallbackTimer);rgSaveFallbackTimer=null;rgEntrySaving=false;});
}

/*
  v15: document.body 전체 MutationObserver는 사용하지 않는다.
  책 상세 decorate는 실제 사용자 동작에서만 실행하고,
  기록 저장 버튼은 capture 단계에서 즉시 잠가 느린 이미지 업로드 중 더블탭 중복 저장을 막는다.
  필사 확정 후에는 record dialog에 원본 이미지 미리보기와 저장 상태를 보여준다.
*/
document.addEventListener('click',e=>{
  const remove=e.target.closest('[data-rg-remove-book]');if(remove){e.preventDefault();e.stopPropagation();removeBook(remove.dataset.rgRemoveBook);return}
  const restore=e.target.closest('[data-rg-restore-book]');if(restore){e.preventDefault();e.stopPropagation();restoreBook(restore.dataset.rgRestoreBook);return}

  if(e.target.closest('[data-open-book],[data-open-existing-book],[data-detail-tab],#bookMoreBtn'))scheduleDecorate();

  if(e.target.closest('#confirmOcrBtn')){
    rgHandwritingPreviewUrl=captureHandwritingPreview();
    requestAnimationFrame(showHandwritingPreview);
  }
  if(e.target.closest('#openHandwritingBtn')){
    rgHandwritingPreviewUrl='';
    document.getElementById('rgHandwritingSavePreview')?.classList.add('hidden');
  }

  const menu=document.getElementById('bookMoreMenu');if(menu&&!menu.classList.contains('hidden')&&!e.target.closest('#bookMoreBtn')&&!e.target.closest('#bookMoreMenu'))menu.classList.add('hidden');
});
document.addEventListener('click',beginEntrySave,true);

window.addEventListener('pageshow',()=>{scheduleDecorate();setupRecordDialogFeedback()});
injectStyle();
setupRecordDialogFeedback();
scheduleDecorate();

/* 독서의 정원 v27 hotfix — 타임라인 삭제 버튼/동작 단일화 + 앱 확인모달 직접 사용 */
import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, deleteDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const FIREBASE_CONFIG={
  apiKey:"AIzaSyAZwvHGXmi_m_a8KqZbxELHAlV0ah1SWO8",
  authDomain:"idea-pocket-56063.firebaseapp.com",
  projectId:"idea-pocket-56063",
  storageBucket:"idea-pocket-56063.firebasestorage.app",
  messagingSenderId:"894399979515",
  appId:"1:894399979515:web:834a298e37ef05dbd0f55e"
};
const SNAPSHOT_DB="readingGarden_v1";
const app=getApps()[0]||initializeApp(FIREBASE_CONFIG),auth=getAuth(app),db=getFirestore(app);
const theme=document.querySelector('meta[name="theme-color"]');if(theme)theme.setAttribute("content","#f2e9dc");

let timelineData=null;
let loadPromise=null;
let scheduled=false;
let deleting=false;

function toast(msg,ms=2600){const el=document.getElementById("toast");if(!el)return;el.textContent=msg;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),ms)}
function timeText(v){const d=new Date(v);return Number.isNaN(d.getTime())?"":new Intl.DateTimeFormat("ko-KR",{hour:"2-digit",minute:"2-digit",hour12:false}).format(d)}
function monthDay(v){const d=new Date(v);return {month:d.getMonth()+1,day:d.getDate()}}
function iconHtml(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'}
async function confirmAction({title,message,confirmText,cancelText="취소",danger=true}){
  if(typeof window.rgConfirm==="function")return await window.rgConfirm({title,message,confirmText,cancelText,danger});
  return window.confirm(message||title);
}

function injectStyle(){
  if(document.getElementById("rgTimelineDeleteV26Style"))return;
  const style=document.createElement("style");style.id="rgTimelineDeleteV26Style";style.textContent=`
    .timeline-session-head{position:relative!important;padding-right:52px!important;min-height:42px}
    .rg-session-delete{
      position:absolute!important;right:-4px!important;top:-3px!important;z-index:12!important;
      width:44px!important;height:44px!important;padding:0!important;border:0!important;border-radius:50%!important;
      display:grid!important;place-items:center!important;background:rgba(118,86,61,.055)!important;
      color:#8a7462!important;box-shadow:none!important;cursor:pointer!important;
      touch-action:manipulation!important;-webkit-tap-highlight-color:transparent!important;
    }
    .rg-session-delete svg{width:19px;height:19px;display:block;pointer-events:none}
    .rg-session-delete:hover{background:#efe3d8!important;color:var(--danger)!important}
    .rg-session-delete:active{transform:scale(.94)!important;background:#eadbd0!important}
    .rg-session-delete:disabled{opacity:.38!important;cursor:wait!important}
    .timeline-entry[data-edit-entry]{cursor:pointer}
    @media (pointer:coarse){.rg-session-delete{width:46px!important;height:46px!important;right:-5px!important;top:-4px!important}}
    @media print{.rg-session-delete{display:none!important}}
  `;document.head.appendChild(style);
}

function openLocalDb(){return new Promise(resolve=>{const r=indexedDB.open(SNAPSHOT_DB,1);r.onerror=()=>resolve(null);r.onupgradeneeded=()=>{};r.onsuccess=()=>resolve(r.result)})}
async function readSnapshot(){const local=await openLocalDb();if(!local)return null;return new Promise(resolve=>{if(!local.objectStoreNames.contains("meta")){local.close();resolve(null);return}const tx=local.transaction("meta","readonly"),r=tx.objectStore("meta").get("snapshot");r.onsuccess=()=>{local.close();resolve(r.result||null)};r.onerror=()=>{local.close();resolve(null)}})}
async function writeSnapshot(snapshot){const local=await openLocalDb();if(!local||!snapshot)return;return new Promise(resolve=>{if(!local.objectStoreNames.contains("meta")){local.close();resolve();return}const tx=local.transaction("meta","readwrite");tx.objectStore("meta").put(snapshot);tx.oncomplete=()=>{local.close();resolve()};tx.onerror=()=>{local.close();resolve()}})}
async function deleteLocalKey(store,key){const local=await openLocalDb();if(!local)return;return new Promise(resolve=>{if(!local.objectStoreNames.contains(store)){local.close();resolve();return}const tx=local.transaction(store,"readwrite");tx.objectStore(store).delete(key);tx.oncomplete=()=>{local.close();resolve()};tx.onerror=()=>{local.close();resolve()}})}

async function loadTimelineData(force=false){
  if(!auth.currentUser)return null;
  if(timelineData&&!force)return timelineData;
  if(loadPromise&&!force)return loadPromise;
  loadPromise=(async()=>{
    const user=auth.currentUser;if(!user)return null;
    const [ss,src,es,ps]=await Promise.all([
      getDocs(collection(db,"users",user.uid,"readingSessions")),
      getDocs(collection(db,"users",user.uid,"sources")),
      getDocs(collection(db,"users",user.uid,"readingEntries")),
      getDocs(collection(db,"users",user.uid,"readingProfiles"))
    ]);
    const sources=src.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.type==="book");
    timelineData={
      sessions:ss.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.endedAt),
      sources,
      entries:es.docs.map(d=>({id:d.id,...d.data()})),
      profiles:ps.docs.map(d=>({id:d.id,...d.data()}))
    };
    return timelineData;
  })();
  try{return await loadPromise}finally{loadPromise=null}
}
function titleOf(id){return timelineData?.sources.find(s=>s.id===id)?.title||""}
function parseSessionCard(card){
  const head=card.querySelector(".timeline-session-head"),title=head?.querySelector("h3")?.textContent?.trim()||"",meta=head?.querySelector("p")?.textContent||"",dayTitle=card.closest(".day-group")?.querySelector(".day-title")?.textContent||"";
  const tm=meta.match(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/),dm=dayTitle.match(/(\d{1,2})월\s*(\d{1,2})일/),duration=meta.match(/(?:^|·)\s*(\d+)\s*분/);
  if(!title||!tm||!dm)return null;
  return {title,start:tm[1],end:tm[2],month:Number(dm[1]),day:Number(dm[2]),duration:duration?Number(duration[1]):null};
}
function sessionForCard(card){
  if(!timelineData)return null;
  const childIds=[...card.querySelectorAll(".timeline-entry[data-edit-entry]")].map(x=>x.dataset.editEntry).filter(Boolean);
  const sessionIds=[...new Set(childIds.map(id=>timelineData.entries.find(e=>e.id===id)?.sessionId).filter(Boolean))];
  if(sessionIds.length===1){const hit=timelineData.sessions.find(s=>s.id===sessionIds[0]);if(hit)return hit}
  const key=parseSessionCard(card);if(!key)return null;
  let matches=timelineData.sessions.filter(s=>{const md=monthDay(s.startedAt);return titleOf(s.sourceId)===key.title&&timeText(s.startedAt)===key.start&&timeText(s.endedAt)===key.end&&md.month===key.month&&md.day===key.day});
  if(matches.length>1&&key.duration!=null)matches=matches.filter(s=>Math.round(Number(s.finalDurationMinutes)||0)===key.duration);
  return matches.length===1?matches[0]:null;
}
function standaloneEntryForCard(card){
  const label=card.querySelector(".timeline-session-head p")?.textContent?.trim()||"";
  if(label!=="독서 기록")return null;
  const id=card.querySelector(".timeline-entry[data-edit-entry]")?.dataset.editEntry;if(!id)return null;
  return timelineData?.entries.find(e=>e.id===id)||{id};
}
function makeButton(kind,id){
  const btn=document.createElement("button");btn.type="button";btn.className="rg-session-delete";btn.dataset.rgOwned="v26";
  if(kind==="session"){btn.dataset.rgDeleteSession=id;btn.title="독서시간 기록 삭제";btn.setAttribute("aria-label","독서시간 기록 삭제")}
  else{btn.dataset.rgDeleteEntry=id;btn.title="독서 기록 삭제";btn.setAttribute("aria-label","독서 기록 삭제")}
  btn.innerHTML=iconHtml();return btn;
}
function installButton(card,kind,id){
  const head=card.querySelector(".timeline-session-head");if(!head)return;
  const expected=kind==="session"?`session:${id}`:`entry:${id}`;
  const owned=head.querySelector(':scope > .rg-session-delete[data-rg-owned="v26"]');
  const ownedKey=owned?.dataset.rgDeleteSession?`session:${owned.dataset.rgDeleteSession}`:owned?.dataset.rgDeleteEntry?`entry:${owned.dataset.rgDeleteEntry}`:"";
  if(owned&&ownedKey===expected){head.querySelectorAll(':scope > .rg-session-delete:not([data-rg-owned="v26"])').forEach(x=>x.remove());return}
  head.querySelectorAll(':scope > .rg-session-delete').forEach(x=>x.remove());
  head.appendChild(makeButton(kind,id));
}
function clearBrokenButtons(card){card.querySelectorAll('.timeline-session-head > .rg-session-delete:not([data-rg-owned="v26"])').forEach(x=>x.remove())}
async function normalizeTimeline(){
  injectStyle();
  const data=await loadTimelineData();if(!data)return;
  document.querySelectorAll(".timeline-session").forEach(card=>{
    const session=sessionForCard(card);if(session){installButton(card,"session",session.id);return}
    const entry=standaloneEntryForCard(card);if(entry?.id){installButton(card,"entry",entry.id);return}
    clearBrokenButtons(card);
  });
}
function schedule(force=false){if(force)timelineData=null;if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;normalizeTimeline().catch(err=>console.warn("timeline delete normalization skipped",err))})}

async function updateSnapshotAfterSessionDelete(target,entries,profilePatch){
  const snap=await readSnapshot();if(!snap)return;
  snap.readingSessions=(snap.readingSessions||[]).filter(s=>s.id!==target.id);
  snap.readingEntries=(snap.readingEntries||[]).map(e=>e.sessionId===target.id?{...e,sessionId:null,updatedAt:new Date().toISOString()}:e);
  if(profilePatch){snap.readingProfiles=(snap.readingProfiles||[]).map(p=>p.sourceId===target.sourceId?{...p,...profilePatch}:p)}
  snap.savedAt=new Date().toISOString();await writeSnapshot(snap);
}
async function deleteSession(sessionId,btn){
  if(deleting)return;
  const data=await loadTimelineData(true),target=data?.sessions.find(s=>s.id===sessionId);if(!target)return toast("삭제할 독서시간을 찾지 못했습니다. 화면을 다시 열어주세요.");
  const entries=data.entries.filter(e=>e.sessionId===sessionId),book=titleOf(target.sourceId)||"이 책",extra=entries.length?`\n\n이 세션 안의 문장·필사·생각 ${entries.length}개는 삭제하지 않고 독립 기록으로 남깁니다.`:"";
  const sessionMessage=`${book} · ${timeText(target.startedAt)}–${timeText(target.endedAt)} · ${Math.round(Number(target.finalDurationMinutes)||0)}분${extra}`;
  if(!await confirmAction({title:"독서시간 기록을 삭제할까요?",message:sessionMessage,confirmText:"독서시간 삭제"}))return;
  const user=auth.currentUser;if(!user)return toast("로그인 상태를 확인해주세요.");deleting=true;if(btn)btn.disabled=true;
  try{
    const now=new Date().toISOString();
    for(const entry of entries)await setDoc(doc(db,"users",user.uid,"readingEntries",entry.id),{sessionId:null,updatedAt:now},{merge:true});
    await deleteDoc(doc(db,"users",user.uid,"readingSessions",sessionId));
    const remaining=data.sessions.filter(s=>s.id!==sessionId&&s.sourceId===target.sourceId&&s.endedAt).sort((a,b)=>new Date(b.endedAt||b.startedAt)-new Date(a.endedAt||a.startedAt));
    const profile=data.profiles.find(p=>p.sourceId===target.sourceId);let profilePatch=null;
    if(profile){profilePatch={lastReadAt:remaining[0]?.endedAt||remaining[0]?.startedAt||"",updatedAt:now};if((profile.currentLocator||"")===(target.endLocator||""))profilePatch.currentLocator=remaining[0]?.endLocator||"";await setDoc(doc(db,"users",user.uid,"readingProfiles",profile.id),profilePatch,{merge:true})}
    await updateSnapshotAfterSessionDelete(target,entries,profilePatch);
    timelineData=null;toast(entries.length?"독서시간을 삭제했습니다. 문장·필사·생각은 그대로 남겼습니다.":"독서시간 기록을 삭제했습니다.");setTimeout(()=>location.reload(),420);
  }catch(err){console.error(err);toast("삭제 중 문제가 생겼습니다. 기록은 그대로 유지됩니다.",3200);if(btn)btn.disabled=false}finally{deleting=false}
}
async function updateSnapshotAfterEntryDelete(entryId){const snap=await readSnapshot();if(!snap)return;snap.readingEntries=(snap.readingEntries||[]).filter(e=>e.id!==entryId);snap.savedAt=new Date().toISOString();await writeSnapshot(snap)}
async function deleteEntry(entryId,btn){
  if(deleting)return;
  const data=await loadTimelineData(true),entry=data?.entries.find(e=>e.id===entryId);if(!entry)return toast("삭제할 독서 기록을 찾지 못했습니다. 화면을 다시 열어주세요.");
  if(!await confirmAction({title:"독서 기록을 삭제할까요?",message:"이 기록을 삭제하면 독서의 정원 타임라인에서 사라집니다.",confirmText:"기록 삭제"}))return;
  let deleteThought=false;
  if(entry.linkedFragmentId){
    deleteThought=await confirmAction({
      title:"연결된 생각도 삭제할까요?",
      message:"이 독서 기록에 연결된 생각의 텃밭 생각이 있습니다.\n\n생각까지 삭제하려면 ‘생각도 삭제’를 누르고, 생각을 남기려면 ‘생각은 남기기’를 누르세요.",
      confirmText:"생각도 삭제",cancelText:"생각은 남기기"
    });
  }
  const user=auth.currentUser;if(!user)return toast("로그인 상태를 확인해주세요.");deleting=true;if(btn)btn.disabled=true;
  try{
    await deleteDoc(doc(db,"users",user.uid,"readingEntries",entryId));
    if(deleteThought&&entry.linkedFragmentId)await deleteDoc(doc(db,"users",user.uid,"fragments",entry.linkedFragmentId));
    await Promise.all([
      deleteLocalKey("outbox",`readingEntries:${entryId}`),
      deleteLocalKey("files",`${entryId}:image`),
      deleteLocalKey("files",`${entryId}:strokes`),
      deleteThought&&entry.linkedFragmentId?deleteLocalKey("outbox",`fragments:${entry.linkedFragmentId}`):Promise.resolve()
    ]);
    await updateSnapshotAfterEntryDelete(entryId);
    timelineData=null;toast(deleteThought?"독서 기록과 연결된 생각을 삭제했습니다.":"독서 기록을 삭제했습니다.");setTimeout(()=>location.reload(),420);
  }catch(err){console.error(err);toast("삭제 중 문제가 생겼습니다. 기록은 그대로 유지됩니다.",3200);if(btn)btn.disabled=false}finally{deleting=false}
}

document.addEventListener("click",e=>{
  const btn=e.target.closest('.rg-session-delete[data-rg-owned="v26"]');if(!btn)return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  if(btn.dataset.rgDeleteSession)void deleteSession(btn.dataset.rgDeleteSession,btn);
  else if(btn.dataset.rgDeleteEntry)void deleteEntry(btn.dataset.rgDeleteEntry,btn);
},true);

document.addEventListener("click",e=>{if(e.target.closest('[data-view-target="timeline"],[data-open-book],[data-open-existing-book],[data-detail-tab]'))setTimeout(()=>schedule(true),0)});
const observer=new MutationObserver(()=>schedule(false));observer.observe(document.body,{subtree:true,childList:true});
onAuthStateChanged(auth,user=>{if(user)schedule(true)});
window.addEventListener("pageshow",()=>schedule(true));
injectStyle();schedule(false);

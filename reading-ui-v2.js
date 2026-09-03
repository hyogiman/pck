/* 독서의 정원 v2 UI patch — 완료한 독서 세션을 안전하게 삭제한다. */
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
const app=getApps()[0]||initializeApp(FIREBASE_CONFIG);
const auth=getAuth(app),db=getFirestore(app);
let user=null,sessions=[],sources=[];
let enhancing=false;

function toast(msg,ms=2600){
  const el=document.getElementById("toast");
  if(!el)return;
  el.textContent=msg;el.classList.add("show");
  clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),ms);
}
function timeText(v){
  const d=new Date(v);
  return new Intl.DateTimeFormat("ko-KR",{hour:"2-digit",minute:"2-digit",hour12:false}).format(d);
}
function monthDay(v){const d=new Date(v);return {month:d.getMonth()+1,day:d.getDate()}}
function sourceTitle(id){return sources.find(s=>s.id===id)?.title||""}
async function loadData(){
  if(!user)return;
  try{
    const [ss,src]=await Promise.all([
      getDocs(collection(db,"users",user.uid,"readingSessions")),
      getDocs(collection(db,"users",user.uid,"sources"))
    ]);
    sessions=ss.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.endedAt);
    sources=src.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.type==="book");
    enhanceTimeline();
  }catch(err){console.warn("Reading Garden session delete loader",err)}
}
function matchSession(card){
  const head=card.querySelector(".timeline-session-head"),title=head?.querySelector("h3")?.textContent?.trim()||"",meta=head?.querySelector("p")?.textContent||"",dayTitle=card.closest(".day-group")?.querySelector(".day-title")?.textContent||"";
  const tm=meta.match(/(\d{1,2}:\d{2})\s*[–-]/),dm=dayTitle.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if(!title||!tm||!dm)return null;
  const candidates=sessions.filter(s=>{
    const md=monthDay(s.startedAt);
    return sourceTitle(s.sourceId)===title&&timeText(s.startedAt)===tm[1]&&md.month===Number(dm[1])&&md.day===Number(dm[2]);
  });
  return candidates.length===1?candidates[0]:null;
}
function enhanceTimeline(){
  if(enhancing)return;enhancing=true;
  try{
    document.querySelectorAll(".timeline-session").forEach(card=>{
      if(card.querySelector(".rg-session-delete"))return;
      const session=matchSession(card);if(!session)return;
      const head=card.querySelector(".timeline-session-head");if(!head)return;
      const btn=document.createElement("button");
      btn.type="button";btn.className="rg-session-delete";btn.title="독서시간 기록 삭제";btn.setAttribute("aria-label","독서시간 기록 삭제");btn.textContent="✕";btn.dataset.sessionId=session.id;
      btn.addEventListener("click",async e=>{e.stopPropagation();await deleteSession(session.id)});
      head.appendChild(btn);
    });
  }finally{enhancing=false}
}
async function deleteSession(sessionId){
  if(!user)return;
  const target=sessions.find(s=>s.id===sessionId);if(!target)return;
  let entryDocs=[],profileDocs=[];
  try{
    const [entriesSnap,profilesSnap]=await Promise.all([
      getDocs(collection(db,"users",user.uid,"readingEntries")),
      getDocs(collection(db,"users",user.uid,"readingProfiles"))
    ]);
    entryDocs=entriesSnap.docs.map(d=>({ref:d.ref,id:d.id,...d.data()})).filter(e=>e.sessionId===sessionId);
    profileDocs=profilesSnap.docs.map(d=>({ref:d.ref,id:d.id,...d.data()}));
  }catch(err){toast("삭제할 기록을 확인하지 못했습니다.");return}
  const extra=entryDocs.length?`\n\n이 세션 안의 문장·필사·생각 ${entryDocs.length}개는 삭제하지 않고 날짜 기록으로 남깁니다.`:"";
  if(!window.confirm(`이 독서시간 기록을 삭제할까요?\n${sourceTitle(target.sourceId)} · ${timeText(target.startedAt)} · ${Math.round(Number(target.finalDurationMinutes)||0)}분${extra}`))return;
  try{
    const now=new Date().toISOString();
    for(const e of entryDocs)await setDoc(e.ref,{sessionId:null,updatedAt:now},{merge:true});
    await deleteDoc(doc(db,"users",user.uid,"readingSessions",sessionId));
    const remaining=sessions.filter(s=>s.id!==sessionId&&s.sourceId===target.sourceId&&s.endedAt).sort((a,b)=>new Date(b.endedAt||b.startedAt)-new Date(a.endedAt||a.startedAt));
    const profile=profileDocs.find(p=>p.sourceId===target.sourceId);
    if(profile){
      const patch={lastReadAt:remaining[0]?.endedAt||remaining[0]?.startedAt||"",updatedAt:now};
      if((profile.currentLocator||"")===(target.endLocator||""))patch.currentLocator=remaining[0]?.endLocator||"";
      await setDoc(profile.ref,patch,{merge:true});
    }
    sessions=sessions.filter(s=>s.id!==sessionId);
    toast(entryDocs.length?"독서시간 기록을 삭제했습니다. 문장과 생각은 남겨두었습니다.":"독서시간 기록을 삭제했습니다.");
    setTimeout(()=>location.reload(),700);
  }catch(err){console.error(err);toast("삭제 중 문제가 생겼습니다. 기록은 그대로 유지됩니다.",3200)}
}

const observer=new MutationObserver(()=>enhanceTimeline());
observer.observe(document.documentElement,{subtree:true,childList:true});
const theme=document.querySelector('meta[name="theme-color"]');if(theme)theme.setAttribute("content","#f3f6f9");
onAuthStateChanged(auth,async u=>{user=u;if(u)await loadData()});

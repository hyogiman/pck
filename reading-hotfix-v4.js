/* 독서의 정원 v4 hotfix — 새로 끝낸 세션에도 삭제 버튼을 즉시 붙인다. */
import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, deleteDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const FIREBASE_CONFIG={
  apiKey:"AIzaSyAZwvHGXmi_m_a8KqZbxELHAlV0ah1SWO8",
  authDomain:"idea-pocket-56063.firebaseapp.com",
  projectId:"idea-pocket-56063",
  storageBucket:"idea-pocket-56063.firebasestorage.app",
  messagingSenderId:"894399979515",
  appId:"1:894399979515:web:834a298e37ef05dbd0f55e"
};
const app=getApps()[0]||initializeApp(FIREBASE_CONFIG),auth=getAuth(app),db=getFirestore(app);
const theme=document.querySelector('meta[name="theme-color"]');if(theme)theme.setAttribute("content","#f2e9dc");

function toast(msg,ms=2600){const el=document.getElementById("toast");if(!el)return;el.textContent=msg;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),ms)}
function timeText(v){const d=new Date(v);return new Intl.DateTimeFormat("ko-KR",{hour:"2-digit",minute:"2-digit",hour12:false}).format(d)}
function monthDay(v){const d=new Date(v);return {month:d.getMonth()+1,day:d.getDate()}}
function parseCard(card){
  const head=card.querySelector(".timeline-session-head"),title=head?.querySelector("h3")?.textContent?.trim()||"",meta=head?.querySelector("p")?.textContent||"",dayTitle=card.closest(".day-group")?.querySelector(".day-title")?.textContent||"";
  const tm=meta.match(/(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/),dm=dayTitle.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if(!title||!tm||!dm)return null;
  return {title,start:tm[1],end:tm[2],month:Number(dm[1]),day:Number(dm[2])};
}
function addDeleteButtons(){
  document.querySelectorAll(".timeline-session").forEach(card=>{
    if(card.querySelector(".rg-session-delete"))return;
    const key=parseCard(card);if(!key)return;
    const head=card.querySelector(".timeline-session-head");if(!head)return;
    const btn=document.createElement("button");
    btn.type="button";btn.className="rg-session-delete";btn.title="독서시간 기록 삭제";btn.setAttribute("aria-label","독서시간 기록 삭제");btn.textContent="🗑";
    btn.addEventListener("click",async e=>{e.stopPropagation();btn.disabled=true;await deleteSessionForCard(card,key);btn.disabled=false});
    head.appendChild(btn);
  });
}
async function deleteSessionForCard(card,key){
  const user=auth.currentUser;if(!user){toast("로그인 상태를 확인해주세요.");return}
  try{
    const [ss,src,entriesSnap,profilesSnap]=await Promise.all([
      getDocs(collection(db,"users",user.uid,"readingSessions")),
      getDocs(collection(db,"users",user.uid,"sources")),
      getDocs(collection(db,"users",user.uid,"readingEntries")),
      getDocs(collection(db,"users",user.uid,"readingProfiles"))
    ]);
    const sources=src.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.type==="book"),titleOf=id=>sources.find(s=>s.id===id)?.title||"";
    const sessions=ss.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.endedAt);
    const matches=sessions.filter(s=>{const md=monthDay(s.startedAt);return titleOf(s.sourceId)===key.title&&timeText(s.startedAt)===key.start&&timeText(s.endedAt)===key.end&&md.month===key.month&&md.day===key.day});
    if(matches.length!==1){toast("삭제할 독서시간을 정확히 찾지 못했습니다. 잠시 후 다시 시도해주세요.");return}
    const target=matches[0],entries=entriesSnap.docs.map(d=>({ref:d.ref,id:d.id,...d.data()})).filter(e=>e.sessionId===target.id),profiles=profilesSnap.docs.map(d=>({ref:d.ref,id:d.id,...d.data()}));
    const extra=entries.length?`\n\n이 세션 안의 문장·필사·생각 ${entries.length}개는 삭제하지 않고 독립 기록으로 남깁니다.`:"";
    if(!confirm(`이 독서시간 기록을 삭제할까요?\n${key.title} · ${key.start}–${key.end} · ${Math.round(Number(target.finalDurationMinutes)||0)}분${extra}`))return;
    const now=new Date().toISOString();
    for(const e of entries)await setDoc(e.ref,{sessionId:null,updatedAt:now},{merge:true});
    await deleteDoc(doc(db,"users",user.uid,"readingSessions",target.id));
    const remaining=sessions.filter(s=>s.id!==target.id&&s.sourceId===target.sourceId&&s.endedAt).sort((a,b)=>new Date(b.endedAt||b.startedAt)-new Date(a.endedAt||a.startedAt)),profile=profiles.find(p=>p.sourceId===target.sourceId);
    if(profile){const patch={lastReadAt:remaining[0]?.endedAt||remaining[0]?.startedAt||"",updatedAt:now};if((profile.currentLocator||"")===(target.endLocator||""))patch.currentLocator=remaining[0]?.endLocator||"";await setDoc(profile.ref,patch,{merge:true})}
    card.closest(".timeline-card")?.remove();
    toast(entries.length?"독서시간을 삭제했습니다. 문장과 생각은 남겨두었습니다.":"독서시간 기록을 삭제했습니다.");
    setTimeout(()=>location.reload(),500);
  }catch(err){console.error(err);toast("삭제 중 문제가 생겼습니다. 기록은 그대로 유지됩니다.",3200)}
}

let scheduled=false;
const schedule=()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;addDeleteButtons()})};
const observer=new MutationObserver(schedule);observer.observe(document.body,{subtree:true,childList:true});
document.addEventListener("click",e=>{if(e.target.closest('[data-view-target="timeline"]'))setTimeout(schedule,0)});
schedule();

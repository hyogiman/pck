/* 독서의 정원 v17 — 세션 복구 + 조용한 타이머 + 이미지 전용 필사 안내
   필기 성능 최적화와 필사 이미지 저장은 reading.js 원본에 통합했다. */
import { getApps, getApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const ACTIVE_SESSION_KEY="readingGarden_activeSession_v1";
const RECOVERY_MARK_KEY="readingGarden_recoveredSession_v17";
const MAX_AUTO_RECOVERY_AGE_MS=18*60*60*1000;

function toast(message,ms=3200){
  const el=document.getElementById('toast');
  if(!el)return;
  el.textContent=message;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t=setTimeout(()=>el.classList.remove('show'),ms);
}

function whenDomReady(fn){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fn,{once:true});
  else fn();
}

function installQuietTimer(){
  if(document.getElementById('rgQuietTimerStyle'))return;
  const style=document.createElement('style');
  style.id='rgQuietTimerStyle';
  style.textContent=`
    #sessionLayer.rg-quiet-timer .session-clock-top{display:none!important}
    #sessionLayer.rg-quiet-timer .session-clock{display:none!important}
    #sessionLayer.rg-quiet-timer.rg-timer-peek .session-clock{display:block!important;opacity:.72;font-size:clamp(2rem,8vw,3.6rem)}
    #rgTimerPeekBtn{border:0;background:transparent;color:var(--muted);font:inherit;font-size:.76rem;padding:7px 10px;border-radius:999px;cursor:pointer}
    #rgTimerPeekBtn:hover,#rgTimerPeekBtn:active{background:rgba(118,86,61,.08)}
  `;
  document.head.appendChild(style);

  const layer=document.getElementById('sessionLayer');
  const stateText=document.getElementById('sessionStateText');
  if(!layer||!stateText)return;
  layer.classList.add('rg-quiet-timer');

  let btn=document.getElementById('rgTimerPeekBtn');
  if(!btn){
    btn=document.createElement('button');
    btn.id='rgTimerPeekBtn';btn.type='button';
    btn.textContent='● 시간 기록 중 · 시간 보기';
    stateText.insertAdjacentElement('afterend',btn);
  }
  let timer=null;
  btn.addEventListener('click',()=>{
    layer.classList.add('rg-timer-peek');
    btn.textContent='● 시간 기록 중';
    clearTimeout(timer);
    timer=setTimeout(()=>{
      layer.classList.remove('rg-timer-peek');
      btn.textContent='● 시간 기록 중 · 시간 보기';
    },4000);
  });
}

function refreshHandwritingCopy(){
  const box=document.getElementById('rgHandwritingSavePreview');
  if(!box||box.classList.contains('hidden'))return;
  const strong=box.querySelector('strong');
  const copy=box.querySelector('span');
  if(box.classList.contains('is-saving')){
    if(strong)strong.textContent='필사 원본 보관 중…';
    if(copy)copy.textContent='필사 이미지를 기기에 먼저 안전하게 저장하고 있습니다. 클라우드 동기화는 이어서 진행됩니다.';
  }else{
    if(strong)strong.textContent='✍ 필사 원본 이미지 포함';
    if(copy)copy.textContent='필사 원본 이미지만 저장합니다. 펜 획 데이터는 저장하지 않습니다.';
  }
}
function installHandwritingCopySync(){
  document.addEventListener('click',e=>{
    if(e.target.closest('#confirmOcrBtn,#saveEntryBtn')){
      requestAnimationFrame(()=>{refreshHandwritingCopy();setTimeout(refreshHandwritingCopy,0)});
    }
  });
}

async function waitForFirebaseApp(){
  for(let i=0;i<50;i++){
    if(getApps().length)return getApp();
    await new Promise(r=>setTimeout(r,100));
  }
  return null;
}
async function waitForUser(auth){
  if(auth.currentUser)return auth.currentUser;
  return new Promise(resolve=>{
    let done=false;
    const finish=user=>{if(done)return;done=true;try{off()}catch{};resolve(user||null)};
    const off=onAuthStateChanged(auth,user=>finish(user));
    setTimeout(()=>finish(null),5000);
  });
}
async function recoverRecentActiveSession(){
  if(localStorage.getItem(ACTIVE_SESSION_KEY))return;
  const app=await waitForFirebaseApp();if(!app)return;
  const auth=getAuth(app),user=await waitForUser(auth);if(!user)return;
  try{
    const db=getFirestore(app);
    const snap=await getDocs(collection(db,'users',user.uid,'readingSessions'));
    const now=Date.now();
    const candidates=snap.docs.map(d=>({id:d.id,...d.data()}))
      .filter(s=>!s.endedAt&&s.startedAt&&now-new Date(s.startedAt).getTime()>=0&&now-new Date(s.startedAt).getTime()<=MAX_AUTO_RECOVERY_AGE_MS)
      .sort((a,b)=>new Date(b.startedAt)-new Date(a.startedAt));
    const session=candidates[0];if(!session)return;
    if(localStorage.getItem(RECOVERY_MARK_KEY)===session.id)return;
    localStorage.setItem(ACTIVE_SESSION_KEY,JSON.stringify(session));
    localStorage.setItem(RECOVERY_MARK_KEY,session.id);
    toast('중단됐던 독서시간을 복구했습니다. 🌿',3600);
    setTimeout(()=>location.reload(),450);
  }catch(err){
    console.warn('Reading Garden active session recovery failed',err);
  }
}

whenDomReady(()=>{
  installQuietTimer();
  installHandwritingCopySync();
  recoverRecentActiveSession();
});

/* 독서의 정원 v16 — 긴 필사 안정화 + 세션 복구 + 조용한 타이머 */
import { getApps, getApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const ACTIVE_SESSION_KEY="readingGarden_activeSession_v1";
const RECOVERY_MARK_KEY="readingGarden_recoveredSession_v16";
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

/* ------------------------------------------------------------------
   1) 긴 S Pen 필사 안정화

   core v1은 pointermove마다 지금까지의 모든 stroke를 처음부터 redraw한다.
   필사가 길어질수록 O(n²)에 가까운 비용이 생기므로, capture 단계에서:
   - 화면에는 새 선분을 즉시 그려 펜 반응성을 유지하고
   - core에는 일정 간격의 pointermove만 전달해 저장 point 수와 전체 redraw 빈도를 줄인다.
   - 필사가 길어질수록 core 전달 간격을 조금 늘린다.
   저장되는 stroke는 충분한 표본을 유지하고, 화면 반응은 원래 이벤트 속도로 유지한다.
------------------------------------------------------------------ */
function installHandwritingStability(){
  const canvas=document.getElementById('writingCanvas');
  if(!canvas||canvas.dataset.rgStabilityV16==='1')return;
  canvas.dataset.rgStabilityV16='1';

  let pointerId=null;
  let visualPoint=null;
  let lastCoreForward=0;
  let forwardedMoves=0;

  const point=e=>{
    const r=canvas.getBoundingClientRect();
    return {x:e.clientX-r.left,y:e.clientY-r.top,p:e.pressure>0?e.pressure:.5};
  };
  const penWidth=()=>Number(document.querySelector('[data-pen-width].on')?.dataset.penWidth)||2.5;
  const isEraser=()=>document.getElementById('eraserBtn')?.classList.contains('on')===true;
  const pressureWidth=(base,a,b)=>{
    const pa=.58+Math.max(.06,Math.min(1,a?.p||.5))*.92;
    const pb=.58+Math.max(.06,Math.min(1,b?.p||.5))*.92;
    return base*(pa+pb)/2;
  };
  const drawImmediate=(a,b)=>{
    if(!a||!b)return;
    const ctx=canvas.getContext('2d');
    ctx.save();
    ctx.lineCap='round';ctx.lineJoin='round';
    const erase=isEraser();
    ctx.globalCompositeOperation=erase?'destination-out':'source-over';
    ctx.strokeStyle='#171a16';
    ctx.lineWidth=erase?22:pressureWidth(penWidth(),a,b);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    ctx.restore();
  };
  const coreInterval=()=>{
    if(isEraser())return 18;
    if(forwardedMoves<1500)return 24;
    if(forwardedMoves<4000)return 36;
    return 50;
  };

  canvas.addEventListener('pointerdown',e=>{
    if(e.pointerType==='touch')return;
    pointerId=e.pointerId;
    visualPoint=point(e);
    lastCoreForward=performance.now();
  },{capture:true,passive:false});

  canvas.addEventListener('pointermove',e=>{
    if(e.pointerType==='touch'||pointerId!==e.pointerId||!visualPoint)return;
    const next=point(e);
    drawImmediate(visualPoint,next);
    visualPoint=next;

    const now=performance.now();
    if(now-lastCoreForward<coreInterval()){
      /* core의 전체 redraw만 생략한다. 즉시 그리기는 이미 위에서 끝났다. */
      e.stopImmediatePropagation();
      return;
    }
    lastCoreForward=now;
    forwardedMoves++;
  },{capture:true,passive:false});

  const finish=e=>{
    if(pointerId!==e.pointerId)return;
    pointerId=null;visualPoint=null;
  };
  canvas.addEventListener('pointerup',finish,{capture:true});
  canvas.addEventListener('pointercancel',finish,{capture:true});
  canvas.addEventListener('lostpointercapture',()=>{pointerId=null;visualPoint=null},{capture:true});

  /* 필사창을 새로 열면 단계 카운터만 초기화한다. */
  document.getElementById('openHandwritingBtn')?.addEventListener('click',()=>{
    forwardedMoves=0;lastCoreForward=0;pointerId=null;visualPoint=null;
  });
}

/* ------------------------------------------------------------------
   2) 조용한 타이머
   실제 시간 계산은 그대로 두고, 읽는 동안 숫자는 기본 숨김.
   필요할 때만 4초간 확인한다.
------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------
   3) 진행 중 세션 2중 복구
   localStorage가 살아 있으면 core가 원래 복구한다.
   localStorage가 사라졌더라도 Firestore에 최근 18시간 내 종료되지 않은 세션이 있으면
   한 번만 localStorage로 복원 후 앱을 다시 로드한다.
------------------------------------------------------------------ */
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
  installHandwritingStability();
  installQuietTimer();
  /* module boot/resize가 조금 늦어도 한 번 더 확인 */
  setTimeout(installHandwritingStability,600);
  recoverRecentActiveSession();
});

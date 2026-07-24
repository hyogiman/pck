
const STORAGE_KEY="thoughtGarden_v02", FIREBASE_KEY="thoughtGarden_firebaseConfig";
const state={sources:[],fragments:[],threads:[],projects:[],view:"home",openSourceId:null,openThreadId:null,openProjectId:null,resurfaceId:null,
  gardenUnlinked:false,pendingLinkFragmentId:null,
  firebase:{app:null,auth:null,db:null,uid:null,connected:false,api:null}};
const $=id=>document.getElementById(id), $$=s=>[...document.querySelectorAll(s)];
const esc=(v="")=>String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const uid=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`;
const today=()=>new Date().toLocaleDateString("en-CA");
const fmt=d=>d?new Intl.DateTimeFormat("ko-KR",{year:"numeric",month:"short",day:"numeric"}).format(new Date(`${d.slice(0,10)}T00:00:00`)):"";
const daysAgo=d=>{if(!d)return null;const x=new Date(`${d.slice(0,10)}T00:00:00`),n=new Date();n.setHours(0,0,0,0);return Math.max(0,Math.round((n-x)/86400000))};
const sourceIcon=t=>t==="book"?"📚":"🎬";
const fragIcon=t=>({thought:"💭",moment:"🌿",decision:"⚖️",source:"✦"}[t]||"💭");

function toast(msg){const e=$("toast");e.textContent=msg;e.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("show"),2100)}
function localLoad(){try{const d=JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}");state.sources=d.sources||[];state.fragments=d.fragments||[];state.threads=d.threads||[];state.projects=d.projects||[]}catch{}renderAll()}
function localSave(){localStorage.setItem(STORAGE_KEY,JSON.stringify({sources:state.sources,fragments:state.fragments,threads:state.threads,projects:state.projects}))}
function normalizeFirebaseConfig(raw){
  let s=raw.trim().replace(/^const\s+firebaseConfig\s*=\s*/,"").replace(/;\s*$/,"");
  try{return JSON.parse(s)}catch{}
  s=s.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g,'$1"$2"$3').replace(/'/g,'"');
  return JSON.parse(s);
}
async function connectFirebase(){
  const raw=localStorage.getItem(FIREBASE_KEY); if(!raw){setFirebaseStatus(false);localLoad();return}
  try{
    const config=normalizeFirebaseConfig(raw); if(!config.apiKey||!config.projectId)throw new Error("config 형식 확인");
    const [appApi,authApi,fireApi]=await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js")]);
    if(state.firebase.app&&state.firebase.api?.deleteApp)await state.firebase.api.deleteApp(state.firebase.app);
    const app=appApi.initializeApp(config,"garden-"+Date.now()),auth=authApi.getAuth(app),db=fireApi.getFirestore(app);
    state.firebase={app,auth,db,uid:null,connected:false,api:{...appApi,...authApi,...fireApi}};
    await authApi.signInAnonymously(auth);
    await new Promise((resolve,reject)=>{const tm=setTimeout(()=>reject(new Error("인증 시간 초과")),8000);const off=authApi.onAuthStateChanged(auth,u=>{if(u){clearTimeout(tm);off();state.firebase.uid=u.uid;state.firebase.connected=true;resolve()}},reject)});
    setFirebaseStatus(true);await firebaseLoad();toast("Firebase에 연결되었습니다.");
  }catch(e){console.error(e);state.firebase.connected=false;setFirebaseStatus(false,e.message);localLoad();toast("Firebase 연결 실패 · 로컬 모드로 열었습니다.");}
}
function setFirebaseStatus(ok,error=""){
  $("storageStatus").innerHTML=ok?'<span class="status-dot ok"></span>Firebase 동기화 모드':'<span class="status-dot warn"></span>로컬 저장 모드';
  $("storageText").textContent=ok?"Firestore의 개인 사용자 공간에 저장됩니다.":error?`연결 오류: ${error}`:"이 브라우저에 저장됩니다.";
  $("firebaseConfigInput").value=localStorage.getItem(FIREBASE_KEY)||"";
}
async function firebaseLoad(){
  const {api,db,uid}=state.firebase;
  for(const key of ["sources","fragments","threads","projects"]){const snap=await api.getDocs(api.collection(db,"users",uid,key));state[key]=snap.docs.map(d=>({id:d.id,...d.data()}))}
  renderAll();
}
async function persist(collectionName,obj){
  if(state.firebase.connected){const {api,db,uid}=state.firebase;await api.setDoc(api.doc(db,"users",uid,collectionName,obj.id),{...obj,updatedAtServer:api.serverTimestamp()},{merge:true})}else localSave();
}
async function remove(collectionName,id){
  state[collectionName]=state[collectionName].filter(x=>x.id!==id);
  if(state.firebase.connected){const {api,db,uid}=state.firebase;await api.deleteDoc(api.doc(db,"users",uid,collectionName,id))}else localSave();
}
function setView(v){
  state.view=v;state.openSourceId=null;state.openThreadId=null;state.openProjectId=null;
  $$(".view").forEach(x=>x.classList.toggle("active",x.dataset.view===v));$$(".nav-btn").forEach(x=>x.classList.toggle("active",x.dataset.viewTarget===v));
  $("libraryIndex").classList.remove("hidden");$("sourceDetail").classList.add("hidden");$("gardenIndex").classList.remove("hidden");$("threadDetail").classList.add("hidden");$("studioIndex").classList.remove("hidden");$("projectDetail").classList.add("hidden");
  renderAll();window.scrollTo({top:0,behavior:"smooth"});
}
function renderAll(){state.fragments.sort((a,b)=>String(b.createdAt||b.date).localeCompare(String(a.createdAt||a.date)));renderHome();renderLibrary();renderGarden();renderStudio();refreshSelects()}
function refreshSelects(){
  const threadOpts='<option value="">연결하지 않음</option>'+state.threads.map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join("");
  $("captureThread").innerHTML=threadOpts;$("projectThread").innerHTML='<option value="">없음</option>'+state.threads.map(t=>`<option value="${t.id}">${esc(t.title)}</option>`).join("");
}
function renderHome(){
  $("dateLabel").textContent=new Intl.DateTimeFormat("ko-KR",{month:"long",day:"numeric",weekday:"short"}).format(new Date());
  $("metricFragments").textContent=state.fragments.length;$("metricThreads").textContent=state.threads.length;$("metricProjects").textContent=state.projects.length;
  renderResurface();
  const srcs=[...state.sources].sort((a,b)=>lastSourceActivity(b.id).localeCompare(lastSourceActivity(a.id))).slice(0,3);
  $("continueSources").innerHTML=srcs.length?srcs.map(s=>sourceCard(s,true)).join(""):empty("📚","아직 Library가 비어 있어요.","한 작품을 등록하고 그 안에 생각을 계속 쌓아보세요.");
  const ts=[...state.threads].sort((a,b)=>threadFragments(b.id).length-threadFragments(a.id).length).slice(0,3);
  $("growingThreads").innerHTML=ts.length?ts.map(t=>threadCard(t,true)).join(""):empty("🌱","아직 자라는 생각이 없어요.","비슷한 조각이 보이면 Thread로 연결해보세요.");
}
function renderResurface(){
  const c=state.fragments.filter(f=>daysAgo(f.date||f.createdAt)>=7);if(!c.length){$("resurfaceBox").innerHTML=empty("🕰","조금 더 쌓이면 돌아옵니다.","7일 이상 지난 생각을 다시 보여줄게요.");return}
  let f=c.find(x=>x.id===state.resurfaceId);if(!f){f=c[Math.floor(Math.random()*c.length)];state.resurfaceId=f.id}
  const src=state.sources.find(s=>s.id===f.sourceId);
  $("resurfaceBox").innerHTML=`<div class="card"><div class="card-head"><span class="chip">${fragIcon(f.type)} ${daysAgo(f.date||f.createdAt)}일 전</span><span class="date">${fmt((f.date||f.createdAt||"").slice(0,10))}</span></div>
    ${src?`<div class="source-sub">${sourceIcon(src.type)} ${esc(src.title)}</div>`:""}
    ${f.externalText?`<div class="source-line">${esc(f.externalText)}</div>`:""}<div class="thought">${esc(f.thought||f.text||"")}</div>
    <div class="actions"><button class="btn soft" data-continue="${f.id}" type="button">지금 생각 덧붙이기</button><button class="btn" data-link="${f.id}" type="button">🌱 Thread 연결</button></div></div>`;
}
function renderLibrary(){
  const q=$("sourceSearch").value.trim().toLowerCase(),filter=$("sourceFilter").value;
  const arr=state.sources.filter(s=>(filter==="all"||s.type===filter)&&[s.title,s.creator,s.platform].filter(Boolean).join(" ").toLowerCase().includes(q));
  $("sourceList").innerHTML=arr.length?arr.map(s=>sourceCard(s)).join(""):empty("📚","등록된 작품이 없어요.","책이나 미디어는 딱 한 번만 등록합니다.");
}
function sourceCard(s,compact=false){
  const count=sourceFragments(s.id).length,last=lastSourceActivity(s.id),cover=s.image?`<img src="${esc(s.image)}" alt="">`:sourceIcon(s.type);
  return `<article class="card click-card source-card" data-open-source="${s.id}">
    <div class="cover">${cover}</div><div><div class="card-head"><span class="chip">${sourceIcon(s.type)} ${s.type==="book"?"책":"미디어"}</span><span class="date">${last?fmt(last.slice(0,10)):""}</span></div>
    <div class="source-title">${esc(s.title)}</div><div class="source-sub">${esc([s.creator,s.platform].filter(Boolean).join(" · ")||"")}</div>
    <div class="meta"><span class="status">생각 ${count}개</span><span class="status">${s.status==="done"?"완료":s.status==="paused"?"잠시 멈춤":"이어가는 중"}</span></div></div></article>`;
}
function openSource(id){
  state.openSourceId=id;const s=state.sources.find(x=>x.id===id);if(!s)return;
  $("libraryIndex").classList.add("hidden");$("sourceDetail").classList.remove("hidden");
  const fs=sourceFragments(id);
  $("sourceDetail").innerHTML=`<div class="detail-topline"><button class="back-btn" data-back-library type="button">← Library</button><button class="text-btn" data-edit-source="${s.id}" type="button">작품정보 수정</button></div>
    <div class="detail-head"><div class="cover">${s.image?`<img src="${esc(s.image)}" alt="">`:sourceIcon(s.type)}</div><div><span class="chip">${sourceIcon(s.type)} ${s.type==="book"?"BOOK":"MEDIA"}</span><h2 style="margin:8px 0 4px;letter-spacing:-.04em">${esc(s.title)}</h2><div class="source-sub">${esc([s.creator,s.platform].filter(Boolean).join(" · "))}</div><div class="meta"><span class="status">생각 ${fs.length}개</span></div></div></div>
    <div class="quick-capture">
      <div class="eyebrow">한 줄 + 나의 한 줄</div>
      <div class="field"><label>${s.type==="book"?"책에서 남은 문장":"장면·대사·핵심 내용"} <span style="color:var(--muted);font-weight:500">(선택)</span></label><textarea class="textarea" id="sourceExternalText" placeholder="${s.type==="book"?"놓치고 싶지 않은 한 줄":"기억하고 싶은 장면이나 말"}"></textarea></div>
      <div class="inline-two"><input class="input" id="sourceLocator" placeholder="${s.type==="book"?"p.132":"6화 / 12:31"}"><textarea class="textarea" id="sourceThought" placeholder="그래서 나는 무엇을 생각했나요?"></textarea></div>
      <div style="display:flex;justify-content:flex-end;margin-top:9px"><button class="btn primary" data-save-source-fragment="${s.id}" type="button">생각 남기기</button></div>
    </div>
    <div class="section"><div class="section-head"><div><h2>쌓인 생각</h2><p>같은 작품을 다시 볼 때마다 여기로 돌아옵니다.</p></div></div>
    <div>${fs.length?fs.map(fragmentCard).join(""):empty("✦","아직 생각이 없어요.","문장을 수집하는 데서 끝내지 말고, 그 아래 내 생각 한 줄을 붙여보세요.")}</div></div>`;
}
function sourceFragments(id){return state.fragments.filter(f=>f.sourceId===id)}
function lastSourceActivity(id){return sourceFragments(id).map(f=>f.createdAt||f.date||"").sort().reverse()[0]||state.sources.find(s=>s.id===id)?.updatedAt||""}
function renderGarden(){
  const q=$("gardenSearch").value.trim().toLowerCase();
  const ts=state.threads.filter(t=>[t.title,t.question,...threadFragments(t.id).flatMap(f=>[f.thought,f.externalText,f.context])].filter(Boolean).join(" ").toLowerCase().includes(q));
  $("threadList").innerHTML=ts.length?ts.map(t=>threadCard(t)).join(""):empty("🌱","아직 Thread가 없어요.","같은 질문을 향하는 생각 조각들을 한 줄기로 묶어보세요.");
  const frags=state.fragments
    .filter(f=>!state.gardenUnlinked || !(f.threadIds||[]).length)
    .filter(f=>[f.thought,f.externalText,f.context,f.choice].filter(Boolean).join(" ").toLowerCase().includes(q))
    .slice(0,8);
  $("showUnlinked").textContent=state.gardenUnlinked?"전체 조각":"미연결 조각";
  $("showUnlinked").classList.toggle("soft",state.gardenUnlinked);
  $("recentFragments").innerHTML=frags.length?frags.map(fragmentCard).join(""):empty("💭",state.gardenUnlinked?"미연결 조각이 없어요.":"생각 조각이 없습니다.",state.gardenUnlinked?"모든 조각이 적어도 하나의 Thread에 연결되어 있습니다.":"+ 버튼으로 한 줄만 먼저 붙잡아보세요.");
}
function threadFragments(id){return state.fragments.filter(f=>(f.threadIds||[]).includes(id)).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)))}
function threadCard(t,compact=false){
  const fs=threadFragments(t.id),last=fs.at(-1);
  return `<article class="card click-card thread-card" data-open-thread="${t.id}"><div class="card-head"><span class="chip">🌱 THREAD</span><span class="thread-count">${fs.length}</span></div><div class="title">${esc(t.title)}</div>
    ${t.question?`<div class="source-sub" style="margin-top:5px">지금의 질문 · ${esc(t.question)}</div>`:""}${last?`<div class="thought" style="margin-top:11px">${esc(last.thought||last.text||"")}</div>`:""}
    <div class="meta"><span class="status">생각 ${fs.length}개</span><span class="status">Studio ${state.projects.filter(p=>p.threadId===t.id).length}개</span></div></article>`;
}
function openThread(id){
  state.openThreadId=id;const t=state.threads.find(x=>x.id===id);if(!t)return;
  $("gardenIndex").classList.add("hidden");$("threadDetail").classList.remove("hidden");const fs=threadFragments(id);
  $("threadDetail").innerHTML=`<div class="detail-topline"><button class="back-btn" data-back-garden type="button">← Garden</button><button class="text-btn" data-edit-thread="${t.id}" type="button">Thread 수정</button></div>
    <div class="card thread-card"><span class="eyebrow">THREAD</span><h2 style="margin:8px 0 5px;letter-spacing:-.04em">${esc(t.title)}</h2>${t.question?`<div class="body">${esc(t.question)}</div>`:""}<div class="actions"><button class="btn primary" data-project-from-thread="${t.id}" type="button">🏭 Studio로 키우기</button></div></div>
    <div class="quick-capture" style="margin-top:12px"><div class="eyebrow">생각 이어쓰기</div><div class="field"><textarea class="textarea" id="threadThoughtInput" placeholder="이 생각에 지금 한 줄을 더한다면?"></textarea></div><div style="text-align:right"><button class="btn primary" data-save-thread-thought="${t.id}" type="button">한 줄 추가</button></div></div>
    <div class="section"><div class="section-head"><div><h2>생각의 변화</h2><p>정답보다, 내가 어떻게 달라졌는지를 봅니다.</p></div></div>
    <div class="timeline">${fs.length?fs.map(f=>`<div class="timeline-item"><div class="date">${fmt((f.date||f.createdAt||"").slice(0,10))}</div>${fragmentCard(f,true)}</div>`).join(""):empty("🌱","아직 연결된 조각이 없어요.","Garden의 다른 조각을 이 Thread에 연결해보세요.")}</div></div>`;
}
function fragmentCard(f,compact=false){
  const src=state.sources.find(s=>s.id===f.sourceId),threads=(f.threadIds||[]).map(id=>state.threads.find(t=>t.id===id)).filter(Boolean);
  return `<article class="card"><div class="card-head"><span class="chip">${src?sourceIcon(src.type):fragIcon(f.type)} ${src?esc(src.title):f.type==="moment"?"순간":f.type==="decision"?"결정":"생각"}</span><span class="date">${fmt((f.date||f.createdAt||"").slice(0,10))}</span></div>
    ${f.context?`<div class="source-sub">${esc(f.context)}</div>`:""}${f.externalText?`<div class="source-line">${esc(f.externalText)}${f.locator?`<div class="date" style="margin-top:4px">${esc(f.locator)}</div>`:""}</div>`:""}
    <div class="thought">${esc(f.thought||f.text||"")}</div>${f.choice?`<div class="meta"><span class="status">결정 · ${esc(f.choice)}</span></div>`:""}
    <div class="meta">${threads.map(t=>`<span class="tag">🌱 ${esc(t.title)}</span>`).join("")}</div>
    ${compact?"":`<div class="actions"><button class="btn soft" data-link="${f.id}" type="button">Thread 연결</button><button class="btn danger" data-delete-fragment="${f.id}" type="button">삭제</button></div>`}</article>`;
}
function renderStudio(){
  $("projectList").innerHTML=state.projects.length?state.projects.map(projectCard).join(""):empty("🏭","아직 Studio 작업이 없어요.","Thread 하나를 골라 콘텐츠 작업대로 보내보세요.");
}
const templates={
  blog:[
    {id:"hook",title:"1. 시작 / Hook",prompt:"첫 문단에서 독자가 멈춰 읽게 할 내 경험이나 질문은?"},
    {id:"experience",title:"2. 나의 경험",prompt:"내가 실제로 겪은 장면·실패·사건은?"},
    {id:"outside",title:"3. 외부의 시선",prompt:"책·미디어·누군가의 말 중 이 생각을 확장한 재료는?"},
    {id:"meaning",title:"4. 나의 해석",prompt:"그래서 나는 이것을 어떻게 다르게 보게 되었나?"},
    {id:"counter",title:"5. 반론",prompt:"반대로 생각하는 사람은 뭐라고 말할까? 내가 합리화하고 있는 건 없나?"},
    {id:"conclusion",title:"6. 지금의 결론",prompt:"지금 시점에서 내가 말하고 싶은 한 문장은?"}
  ],
  shorts:[
    {id:"hook",title:"1. 3초 Hook",prompt:"스크롤을 멈추게 할 한 문장은?"},
    {id:"situation",title:"2. 상황",prompt:"아주 짧게 맥락을 보여준다."},
    {id:"turn",title:"3. 전환",prompt:"예상과 다른 생각이나 깨달음은?"},
    {id:"point",title:"4. 핵심 한 문장",prompt:"이 콘텐츠의 단 하나의 메시지는?"},
    {id:"close",title:"5. 마무리",prompt:"시청자 머릿속에 남길 질문 또는 문장은?"}
  ],
  podcast:[
    {id:"open",title:"1. 오프닝 질문",prompt:"오늘 청취자에게 던질 질문은?"},
    {id:"line",title:"2. 책/미디어 한 줄",prompt:"오늘 이야기를 여는 외부의 한 줄은?"},
    {id:"experience",title:"3. 내 경험",prompt:"그 한 줄과 맞닿는 내 실제 이야기는?"},
    {id:"counter",title:"4. 반론 / 백번읽꾸",prompt:"이 생각에 가장 날카롭게 반박한다면?"},
    {id:"meaning",title:"5. 내 생각",prompt:"반론을 지나고도 남는 내 생각은?"},
    {id:"question",title:"6. 청취자 질문",prompt:"듣는 사람에게 어떤 질문을 남길까?"}
  ]
};
function projectSlots(p){const base=templates[p.format]||templates.blog;return base.map(b=>({ ...b, ...(p.slots?.find(s=>s.id===b.id)||{text:"",fragmentIds:[]})}))}
function projectCard(p){
  const slots=projectSlots(p),done=slots.filter(s=>s.text||(s.fragmentIds||[]).length).length,pct=Math.round(done/slots.length*100),t=state.threads.find(x=>x.id===p.threadId);
  return `<article class="card click-card" data-open-project="${p.id}"><div class="card-head"><span class="chip">🏭 ${p.format==="shorts"?"Shorts":p.format==="podcast"?"Podcast":"블로그"}</span><span class="date">${pct}%</span></div><div class="title">${esc(p.title)}</div>${t?`<div class="source-sub">🌱 ${esc(t.title)}</div>`:""}<div class="completion" style="margin-top:12px"><div class="mini-bar"><span style="width:${pct}%"></span></div><strong>${done}/${slots.length}</strong></div></article>`;
}
function openProject(id){
  state.openProjectId=id;const p=state.projects.find(x=>x.id===id);if(!p)return;
  $("studioIndex").classList.add("hidden");$("projectDetail").classList.remove("hidden");const slots=projectSlots(p),t=state.threads.find(x=>x.id===p.threadId);
  const pool=t?threadFragments(t.id):state.fragments.slice(0,12),done=slots.filter(s=>s.text||(s.fragmentIds||[]).length).length,pct=Math.round(done/slots.length*100);
  $("projectDetail").innerHTML=`<div class="detail-topline"><button class="back-btn" data-back-studio type="button">← Studio</button><button class="text-btn" data-delete-project="${p.id}" type="button">프로젝트 삭제</button></div>
    <div class="card"><span class="eyebrow">WORKBENCH</span><h2 style="margin:8px 0 5px;letter-spacing:-.04em">${esc(p.title)}</h2>${t?`<div class="source-sub">시작 Thread · ${esc(t.title)}</div>`:""}<div class="completion" style="margin-top:14px"><div class="mini-bar"><span style="width:${pct}%"></span></div><strong>${pct}%</strong></div></div>
    <div class="studio-layout section">
      <aside class="material-pool"><div class="section-head"><div><h2>재료함</h2><p>내가 이미 남긴 생각.</p></div></div>${pool.length?pool.map(f=>`<div class="material">${srcLabel(f)}<br><b>${esc((f.thought||f.text||f.externalText||"").slice(0,120))}</b></div>`).join(""):empty("🧺","재료가 없어요.","Garden에서 생각을 먼저 연결해보세요.")}</aside>
      <section><div class="section-head"><div><h2>이야기 구조</h2><p>빈칸이 다음 생각을 끌어냅니다.</p></div></div>
      ${slots.map(s=>slotHTML(p,s)).join("")}<button class="btn primary block" data-save-all-slots="${p.id}" type="button">작업대 저장</button></section>
    </div>`;
}
function srcLabel(f){const s=state.sources.find(x=>x.id===f.sourceId);return s?`${sourceIcon(s.type)} ${esc(s.title)}`:`${fragIcon(f.type)} ${f.type==="moment"?"순간":f.type==="decision"?"결정":"생각"}`}
function slotHTML(p,s){
  const attached=(s.fragmentIds||[]).map(id=>state.fragments.find(f=>f.id===id)).filter(Boolean);
  return `<div class="slot ${(s.text||attached.length)?"done":""}"><div class="slot-head"><h3>${esc(s.title)}</h3><button class="btn soft" data-attach-slot="${s.id}" data-project="${p.id}" type="button">+ 재료</button></div><div class="slot-prompt">${esc(s.prompt)}</div>
    ${attached.map(f=>`<div class="material">${srcLabel(f)}<br>${esc((f.thought||f.text||f.externalText||"").slice(0,140))}</div>`).join("")}
    <textarea class="textarea slot-text" data-slot-text="${s.id}" placeholder="여기에 내 말로 적어보세요.">${esc(s.text||"")}</textarea></div>`;
}
function empty(icon,title,desc){return `<div class="empty"><span class="emoji">${icon}</span><strong>${esc(title)}</strong><div class="helper">${esc(desc)}</div></div>`}

function setCaptureMode(mode){$("captureMode").value=mode;$$(".mode-btn").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));$("captureContextWrap").classList.toggle("hidden",mode==="thought");$("captureChoiceWrap").classList.toggle("hidden",mode!=="decision");$("captureLabel").textContent=mode==="thought"?"무슨 생각이 났나요?":mode==="moment"?"무슨 일이 마음에 남았나요?":"이 결정에 대해 지금 무엇을 생각하나요?"}
function openCapture(mode="thought",prefill=""){$("captureId").value="";$("captureText").value=prefill;$("captureContext").value="";$("captureChoice").value="";setCaptureMode(mode);refreshSelects();$("captureDialog").showModal();setTimeout(()=>$("captureText").focus(),60)}
async function saveCapture(){
  const text=$("captureText").value.trim();if(!text)return toast("한 줄만 남겨주세요.");
  const threadId=$("captureThread").value,f={id:uid(),type:$("captureMode").value,thought:text,context:$("captureContext").value.trim(),choice:$("captureChoice").value.trim(),threadIds:threadId?[threadId]:[],date:today(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  state.fragments.unshift(f);await persist("fragments",f);$("captureDialog").close();renderAll();toast("생각을 붙잡았습니다. 🌱");
}
function openSourceDialog(s=null){$("sourceId").value=s?.id||"";$("sourceDialogTitle").textContent=s?"작품정보 수정":"Library에 작품 추가";$("sourceType").value=s?.type||"book";$("sourceStatus").value=s?.status||"active";$("sourceTitleInput").value=s?.title||"";$("sourceCreator").value=s?.creator||"";$("sourcePlatform").value=s?.platform||"";$("sourceImage").value=s?.image||"";$("sourceDialog").showModal()}
async function saveSource(){
  const title=$("sourceTitleInput").value.trim();if(!title)return toast("작품 제목을 적어주세요.");const old=state.sources.find(s=>s.id===$("sourceId").value);
  const s={id:old?.id||uid(),type:$("sourceType").value,status:$("sourceStatus").value,title,creator:$("sourceCreator").value.trim(),platform:$("sourcePlatform").value.trim(),image:$("sourceImage").value.trim(),createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
  state.sources=old?state.sources.map(x=>x.id===s.id?s:x):[s,...state.sources];await persist("sources",s);$("sourceDialog").close();renderAll();if(old)openSource(s.id);toast("Library에 저장했습니다.");
}
async function saveSourceFragment(sourceId){
  const thought=$("sourceThought").value.trim(),externalText=$("sourceExternalText").value.trim();if(!thought&&!externalText)return toast("문장이나 내 생각 중 하나는 남겨주세요.");
  const f={id:uid(),type:"source",sourceId,externalText,locator:$("sourceLocator").value.trim(),thought,threadIds:[],date:today(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  state.fragments.unshift(f);await persist("fragments",f);openSource(sourceId);renderHome();renderGarden();toast("이 작품에 생각을 하나 더 쌓았습니다.");
}
function openThreadDialog(t=null){$("threadId").value=t?.id||"";$("threadTitleInput").value=t?.title||"";$("threadQuestion").value=t?.question||"";$("threadDialog").showModal()}
async function saveThread(){
  const title=$("threadTitleInput").value.trim();if(!title)return toast("Thread 이름을 적어주세요.");const old=state.threads.find(t=>t.id===$("threadId").value);
  const t={id:old?.id||uid(),title,question:$("threadQuestion").value.trim(),createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
  state.threads=old?state.threads.map(x=>x.id===t.id?t:x):[t,...state.threads];await persist("threads",t);
  if(!old && state.pendingLinkFragmentId){
    const f=state.fragments.find(x=>x.id===state.pendingLinkFragmentId);
    if(f){f.threadIds=[...new Set([...(f.threadIds||[]),t.id])];f.updatedAt=new Date().toISOString();await persist("fragments",f);}
    state.pendingLinkFragmentId=null;
  }
  $("threadDialog").close();renderAll();toast(old?"Thread를 수정했습니다.":"생각의 줄기를 만들었습니다. 🌱");
}
function openLinkDialog(fid){state.pendingLinkFragmentId=fid;$("linkFragmentId").value=fid;$("linkThreadList").innerHTML=state.threads.length?state.threads.map(t=>`<button class="card click-card" data-link-to-thread="${t.id}" type="button" style="width:100%;text-align:left;margin-bottom:7px"><div class="title">${esc(t.title)}</div><div class="source-sub">생각 ${threadFragments(t.id).length}개</div></button>`).join(""):empty("🌱","아직 Thread가 없어요.","새 Thread를 먼저 만들어보세요.");$("linkDialog").showModal()}
async function linkFragment(fid,tid){
  const f=state.fragments.find(x=>x.id===fid);if(!f)return;f.threadIds=[...new Set([...(f.threadIds||[]),tid])];f.updatedAt=new Date().toISOString();await persist("fragments",f);$("linkDialog").close();renderAll();if(state.openThreadId)openThread(state.openThreadId);toast("Thread에 연결했습니다.");
}
async function addThreadThought(tid){
  const el=$("threadThoughtInput"),text=el?.value.trim();if(!text)return toast("한 줄을 적어주세요.");const f={id:uid(),type:"thought",thought:text,threadIds:[tid],date:today(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};state.fragments.unshift(f);await persist("fragments",f);openThread(tid);renderHome();toast("생각을 한 줄 더 이어갔습니다.");
}
function openProjectDialog(threadId=""){
  $("projectId").value="";$("projectTitleInput").value="";$("projectFormat").value="blog";refreshSelects();$("projectThread").value=threadId;$("projectDialog").showModal();
}
async function saveProject(){
  const title=$("projectTitleInput").value.trim();if(!title)return toast("프로젝트 제목을 적어주세요.");const format=$("projectFormat").value;
  const p={id:uid(),title,format,threadId:$("projectThread").value,slots:templates[format].map(s=>({id:s.id,text:"",fragmentIds:[]})),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  state.projects.unshift(p);await persist("projects",p);$("projectDialog").close();renderStudio();openProject(p.id);toast("Studio 작업대를 만들었습니다.");
}
function openAttachDialog(pid,slotId){
  $("attachProjectId").value=pid;$("attachSlotId").value=slotId;const p=state.projects.find(x=>x.id===pid),pool=p?.threadId?threadFragments(p.threadId):state.fragments;
  $("attachFragmentList").innerHTML=pool.length?pool.map(f=>`<button class="card click-card" data-attach-fragment="${f.id}" type="button" style="display:block;width:100%;text-align:left;margin-bottom:7px"><div class="source-sub">${srcLabel(f)}</div><div class="body">${esc((f.thought||f.text||f.externalText||"").slice(0,180))}</div></button>`).join(""):empty("🧺","연결할 재료가 없어요.","Garden에서 생각을 먼저 쌓아보세요.");$("attachDialog").showModal();
}
async function attachFragment(pid,slotId,fid){
  const p=state.projects.find(x=>x.id===pid);if(!p)return;const slots=projectSlots(p),slot=slots.find(s=>s.id===slotId);slot.fragmentIds=[...new Set([...(slot.fragmentIds||[]),fid])];p.slots=slots.map(s=>({id:s.id,text:s.text||"",fragmentIds:s.fragmentIds||[]}));p.updatedAt=new Date().toISOString();await persist("projects",p);$("attachDialog").close();openProject(pid);toast("재료를 배치했습니다.");
}
async function saveAllSlots(pid){
  const p=state.projects.find(x=>x.id===pid);if(!p)return;const slots=projectSlots(p);$$("[data-slot-text]").forEach(el=>{const s=slots.find(x=>x.id===el.dataset.slotText);if(s)s.text=el.value.trim()});p.slots=slots.map(s=>({id:s.id,text:s.text||"",fragmentIds:s.fragmentIds||[]}));p.updatedAt=new Date().toISOString();await persist("projects",p);renderStudio();openProject(pid);toast("작업대를 저장했습니다.");
}
async function deleteFragment(fid){if(!confirm("이 생각 조각을 삭제할까요?"))return;await remove("fragments",fid);for(const p of state.projects){p.slots=(p.slots||[]).map(s=>({...s,fragmentIds:(s.fragmentIds||[]).filter(id=>id!==fid)}));await persist("projects",p)}renderAll();toast("삭제했습니다.")}
async function deleteProject(pid){if(!confirm("이 Studio 프로젝트를 삭제할까요?"))return;await remove("projects",pid);setView("studio");toast("프로젝트를 삭제했습니다.")}

function seedDemoObjects(){
  const s1={id:uid(),type:"book",status:"active",title:"미드나잇 라이브러리",creator:"Matt Haig",platform:"독서",image:"",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const s2={id:uid(),type:"media",status:"active",title:"꾸준함에 관한 YouTube 영상",creator:"",platform:"YouTube",image:"",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const t={id:uid(),title:"꾸준함에 대하여",question:"멈추지 않는 것만이 정말 꾸준함일까?",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const mkDate=n=>{const d=new Date();d.setDate(d.getDate()-n);return d.toLocaleDateString("en-CA")};
  const fs=[
    {id:uid(),type:"source",sourceId:s1.id,externalText:"선택하지 않은 삶을 우리는 쉽게 이상화한다.",locator:"p.132",thought:"후회는 선택 자체보다 다른 삶을 완벽하게 상상해서 커지는 걸지도 모르겠다.",threadIds:[t.id],date:mkDate(90),createdAt:new Date(Date.now()-90*86400000).toISOString(),updatedAt:new Date().toISOString()},
    {id:uid(),type:"moment",context:"예전에 중단했던 프로젝트들을 떠올리며",thought:"나는 무언가를 지속하지 못하는 사람 같다고 자주 생각한다.",threadIds:[t.id],date:mkDate(35),createdAt:new Date(Date.now()-35*86400000).toISOString(),updatedAt:new Date().toISOString()},
    {id:uid(),type:"source",sourceId:s2.id,externalText:"완벽한 루틴보다 다시 돌아오는 장치가 중요하다.",locator:"12:31",thought:"내게 필요한 건 의지력이 아니라 복귀 버튼일지도 모른다.",threadIds:[t.id],date:mkDate(10),createdAt:new Date(Date.now()-10*86400000).toISOString(),updatedAt:new Date().toISOString()},
    {id:uid(),type:"thought",thought:"꾸준한 사람은 한 번도 멈추지 않는 사람이 아니라 계속 돌아오는 사람 아닐까?",threadIds:[t.id],date:mkDate(2),createdAt:new Date(Date.now()-2*86400000).toISOString(),updatedAt:new Date().toISOString()}
  ];
  const p={id:uid(),title:"나는 왜 늘 시작하고 그만둘까",format:"blog",threadId:t.id,slots:templates.blog.map(s=>({id:s.id,text:"",fragmentIds:[]})),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  return {sources:[s1,s2],threads:[t],fragments:fs,projects:[p]};
}
async function seedDemo(){const d=seedDemoObjects();for(const k of ["sources","threads","fragments","projects"]){for(const x of d[k]){state[k].push(x);await persist(k,x)}}renderAll();toast("전체 흐름 샘플을 넣었습니다.")}
async function migrateV01(){
  let d;try{d=JSON.parse(localStorage.getItem("thoughtGarden_v01")||"null")}catch{}if(!d?.fragments?.length)return toast("이 브라우저에서 V0.1 기록을 찾지 못했습니다.");
  let n=0;for(const old of d.fragments){const f={id:old.id||uid(),type:["moment","decision"].includes(old.type)?old.type:"thought",thought:old.myThought||old.content||old.quote||old.title||"",context:old.people||old.sourceTitle||"",choice:old.decisionOptions||"",externalText:old.quote||"",locator:old.page?`p.${old.page}`:"",threadIds:[],date:old.date||today(),createdAt:old.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};state.fragments.push(f);await persist("fragments",f);n++}renderAll();toast(`V0.1 기록 ${n}개를 가져왔습니다.`)
}
function exportData(){const blob=new Blob([JSON.stringify({app:"thought-garden-v02",exportedAt:new Date().toISOString(),sources:state.sources,fragments:state.fragments,threads:state.threads,projects:state.projects},null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`thought-garden-v02-${today()}.json`;a.click();URL.revokeObjectURL(url)}
async function importData(file){try{const d=JSON.parse(await file.text());for(const k of ["sources","fragments","threads","projects"]){if(Array.isArray(d[k])){const m=new Map(state[k].map(x=>[x.id,x]));d[k].forEach(x=>m.set(x.id||uid(),x));state[k]=[...m.values()]}}if(state.firebase.connected){for(const k of ["sources","fragments","threads","projects"])for(const x of state[k])await persist(k,x)}else localSave();renderAll();toast("백업을 가져왔습니다.")}catch(e){console.error(e);toast("백업 파일을 읽지 못했습니다.")}}

document.addEventListener("click",async e=>{
  const n=e.target.closest("[data-view-target]");if(n)return setView(n.dataset.viewTarget);
  const g=e.target.closest("[data-go]");if(g)return setView(g.dataset.go);
  const c=e.target.closest("[data-close]");if(c)return $(c.dataset.close).close();
  const m=e.target.closest("[data-mode]");if(m)return setCaptureMode(m.dataset.mode);
  const os=e.target.closest("[data-open-source]");if(os)return openSource(os.dataset.openSource);
  if(e.target.closest("[data-back-library]")){state.openSourceId=null;$("libraryIndex").classList.remove("hidden");$("sourceDetail").classList.add("hidden");return renderLibrary()}
  const es=e.target.closest("[data-edit-source]");if(es)return openSourceDialog(state.sources.find(s=>s.id===es.dataset.editSource));
  const ss=e.target.closest("[data-save-source-fragment]");if(ss)return saveSourceFragment(ss.dataset.saveSourceFragment);
  const ot=e.target.closest("[data-open-thread]");if(ot)return openThread(ot.dataset.openThread);
  if(e.target.closest("[data-back-garden]")){state.openThreadId=null;$("gardenIndex").classList.remove("hidden");$("threadDetail").classList.add("hidden");return renderGarden()}
  const et=e.target.closest("[data-edit-thread]");if(et)return openThreadDialog(state.threads.find(t=>t.id===et.dataset.editThread));
  const st=e.target.closest("[data-save-thread-thought]");if(st)return addThreadThought(st.dataset.saveThreadThought);
  const li=e.target.closest("[data-link]");if(li)return openLinkDialog(li.dataset.link);
  const lt=e.target.closest("[data-link-to-thread]");if(lt)return linkFragment($("linkFragmentId").value,lt.dataset.linkToThread);
  const ct=e.target.closest("[data-continue]");if(ct){const f=state.fragments.find(x=>x.id===ct.dataset.continue);return openCapture("thought",`예전의 나는 이렇게 생각했다.\n“${f?.thought||f?.text||""}”\n\n지금은 `)}
  const df=e.target.closest("[data-delete-fragment]");if(df)return deleteFragment(df.dataset.deleteFragment);
  const pf=e.target.closest("[data-project-from-thread]");if(pf)return openProjectDialog(pf.dataset.projectFromThread);
  const op=e.target.closest("[data-open-project]");if(op)return openProject(op.dataset.openProject);
  if(e.target.closest("[data-back-studio]")){state.openProjectId=null;$("studioIndex").classList.remove("hidden");$("projectDetail").classList.add("hidden");return renderStudio()}
  const as=e.target.closest("[data-attach-slot]");if(as)return openAttachDialog(as.dataset.project,as.dataset.attachSlot);
  const af=e.target.closest("[data-attach-fragment]");if(af)return attachFragment($("attachProjectId").value,$("attachSlotId").value,af.dataset.attachFragment);
  const saveSlots=e.target.closest("[data-save-all-slots]");if(saveSlots)return saveAllSlots(saveSlots.dataset.saveAllSlots);
  const dp=e.target.closest("[data-delete-project]");if(dp)return deleteProject(dp.dataset.deleteProject);
});
$("fab").addEventListener("click",()=>openCapture("thought"));$("newSource").addEventListener("click",()=>openSourceDialog());$("newThread").addEventListener("click",()=>openThreadDialog());$("newProject").addEventListener("click",()=>openProjectDialog());
$("saveCapture").addEventListener("click",saveCapture);$("saveSource").addEventListener("click",saveSource);$("saveThread").addEventListener("click",saveThread);$("saveProject").addEventListener("click",saveProject);
$("sourceSearch").addEventListener("input",renderLibrary);$("sourceFilter").addEventListener("change",renderLibrary);$("gardenSearch").addEventListener("input",renderGarden);
$("showUnlinked").addEventListener("click",()=>{state.gardenUnlinked=!state.gardenUnlinked;renderGarden()});
$("reshuffle").addEventListener("click",()=>{state.resurfaceId=null;renderResurface()});$("openSettings").addEventListener("click",()=>$("settingsDialog").showModal());
$("linkNewThread").addEventListener("click",()=>{$("linkDialog").close();openThreadDialog()});
$("seedDemo").addEventListener("click",seedDemo);$("migrateV01").addEventListener("click",migrateV01);$("exportData").addEventListener("click",exportData);
$("importData").addEventListener("change",e=>{const f=e.target.files?.[0];if(f)importData(f);e.target.value=""});
$("saveFirebaseConfig").addEventListener("click",async()=>{try{const raw=$("firebaseConfigInput").value.trim(),cfg=normalizeFirebaseConfig(raw);if(!cfg.apiKey||!cfg.projectId)throw new Error();localStorage.setItem(FIREBASE_KEY,raw);$("settingsDialog").close();await connectFirebase()}catch{toast("Firebase config 형식을 확인해주세요.")}});
$("clearFirebaseConfig").addEventListener("click",async()=>{localStorage.removeItem(FIREBASE_KEY);if(state.firebase.app&&state.firebase.api?.deleteApp)try{await state.firebase.api.deleteApp(state.firebase.app)}catch{}state.firebase={app:null,auth:null,db:null,uid:null,connected:false,api:null};setFirebaseStatus(false);localLoad();toast("Firebase 연결을 해제했습니다.")});
["captureDialog","sourceDialog","threadDialog","linkDialog","projectDialog","attachDialog","settingsDialog"].forEach(id=>$(id).addEventListener("click",e=>{if(e.target===$(id))$(id).close()}));
connectFirebase();

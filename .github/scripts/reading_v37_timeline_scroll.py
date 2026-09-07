from pathlib import Path

js_path=Path('reading.js')
html_path=Path('reading.html')
js=js_path.read_text(encoding='utf-8')
html=html_path.read_text(encoding='utf-8')

# 1) Keep the main Reading screen pinned to the true top on reload/pageshow/nav return.
old_setview='''function setView(view){state.currentView=view;$$('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===view));$$('.nav-btn').forEach(b=>b.classList.toggle('on',b.dataset.viewTarget===view));if(view==="read")renderRead();if(view==="library")renderLibrary();if(view==="timeline")renderTimeline();if(view==="stats")renderStats()}'''
new_setview='''if("scrollRestoration" in history)history.scrollRestoration="manual";
function resetMainScroll(){window.scrollTo(0,0)}
function setView(view){state.currentView=view;$$('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===view));$$('.nav-btn').forEach(b=>b.classList.toggle('on',b.dataset.viewTarget===view));if(view==="read"){renderRead();requestAnimationFrame(resetMainScroll)}if(view==="library")renderLibrary();if(view==="timeline")renderTimeline();if(view==="stats")renderStats()}'''
if old_setview not in js:
    raise SystemExit('setView marker not found')
js=js.replace(old_setview,new_setview,1)

# 2) Firestore document order is not guaranteed. Sort captured entries by creation time inside each session.
old_timeline='''function timelineEvents(bookId=""){const linked=new Set(state.readingEntries.map(e=>e.linkedFragmentId).filter(Boolean)),events=[];for(const s of state.readingSessions.filter(x=>x.endedAt&&(!bookId||x.sourceId===bookId)))events.push({type:"session",date:s.startedAt,session:s,entries:state.readingEntries.filter(e=>e.sessionId===s.id)});for(const e of state.readingEntries.filter(e=>!e.sessionId&&(!bookId||e.sourceId===bookId)))events.push({type:"entry",date:e.createdAt,entry:e});for(const f of state.fragments.filter(f=>f.sourceId&&sourceById(f.sourceId)&&!linked.has(f.id)&&(!bookId||f.sourceId===bookId)))events.push({type:"legacy",date:f.date||f.createdAt,fragment:f});for(const c of state.readingCycles.filter(c=>c.completedAt&&(!bookId||c.sourceId===bookId)))events.push({type:"complete",date:c.completedAt,cycle:c});return events.sort((a,b)=>new Date(b.date)-new Date(a.date))}'''
new_timeline='''function entryCreatedMs(e){const t=new Date(e?.createdAt||e?.updatedAt||0).getTime();return Number.isFinite(t)?t:0}
function sortEntriesChronologically(entries){return entries.slice().sort((a,b)=>entryCreatedMs(a)-entryCreatedMs(b)||String(a.id||"").localeCompare(String(b.id||"")))}
function timelineEvents(bookId=""){const linked=new Set(state.readingEntries.map(e=>e.linkedFragmentId).filter(Boolean)),events=[];for(const s of state.readingSessions.filter(x=>x.endedAt&&(!bookId||x.sourceId===bookId)))events.push({type:"session",date:s.startedAt,session:s,entries:sortEntriesChronologically(state.readingEntries.filter(e=>e.sessionId===s.id))});for(const e of state.readingEntries.filter(e=>!e.sessionId&&(!bookId||e.sourceId===bookId)))events.push({type:"entry",date:e.createdAt,entry:e});for(const f of state.fragments.filter(f=>f.sourceId&&sourceById(f.sourceId)&&!linked.has(f.id)&&(!bookId||f.sourceId===bookId)))events.push({type:"legacy",date:f.date||f.createdAt,fragment:f});for(const c of state.readingCycles.filter(c=>c.completedAt&&(!bookId||c.sourceId===bookId)))events.push({type:"complete",date:c.completedAt,cycle:c});return events.sort((a,b)=>new Date(b.date)-new Date(a.date))}'''
if old_timeline not in js:
    raise SystemExit('timelineEvents marker not found')
js=js.replace(old_timeline,new_timeline,1)

# 3) Put the count beside the label instead of a floating number badge on the right.
old_folder='''    const entryFolder=entries.length
      ? `<div class="timeline-entry-folder"><div class="timeline-entry-folder-head"><span>이 독서시간에 남긴 기록</span><strong>${entries.length}</strong></div><div class="timeline-entry-list">${entries.map(e=>renderEntryHtml(e)).join("")}</div></div>`
      : `<div class="timeline-entry-folder is-empty"><div class="timeline-entry-folder-head"><span>이 독서시간에 남긴 기록</span><strong>0</strong></div><div class="timeline-entry-empty">이 시간에는 따로 남긴 문장·필사·생각이 없습니다.</div></div>`;'''
new_folder='''    const entryFolder=entries.length
      ? `<div class="timeline-entry-folder"><div class="timeline-entry-folder-head"><span>이 독서시간에 남긴 기록 ${entries.length}건</span></div><div class="timeline-entry-list">${entries.map(e=>renderEntryHtml(e)).join("")}</div></div>`
      : `<div class="timeline-entry-folder is-empty"><div class="timeline-entry-folder-head"><span>이 독서시간에 남긴 기록 0건</span></div><div class="timeline-entry-empty">이 시간에는 따로 남긴 문장·필사·생각이 없습니다.</div></div>`;'''
if old_folder not in js:
    raise SystemExit('entry folder marker not found')
js=js.replace(old_folder,new_folder,1)

# 4) Reset scroll at boot and on BFCache/pageshow restore too.
old_boot='''async function boot(){restoreLocalReadingState();bindEvents();setupHandwriting();renderRead();state.idb=await openIdb();await loadSnapshot();if(!state.currentBookId)state.currentBookId=chooseCurrentBookId();state.loading=false;renderAll();updateSyncInfo();initFirebase().catch(err=>{console.error(err);$("authGate").classList.remove("hidden");$("authGateStatus").textContent=`Firebase 연결 실패: ${err.message}`})}
boot();'''
new_boot='''async function boot(){resetMainScroll();restoreLocalReadingState();bindEvents();setupHandwriting();renderRead();state.idb=await openIdb();await loadSnapshot();if(!state.currentBookId)state.currentBookId=chooseCurrentBookId();state.loading=false;renderAll();updateSyncInfo();initFirebase().catch(err=>{console.error(err);$("authGate").classList.remove("hidden");$("authGateStatus").textContent=`Firebase 연결 실패: ${err.message}`})}
window.addEventListener("pageshow",()=>{if(state.currentView==="read")requestAnimationFrame(resetMainScroll)});
boot();'''
if old_boot not in js:
    raise SystemExit('boot marker not found')
js=js.replace(old_boot,new_boot,1)

# Cache-bust only the changed Reading runtime.
old_ver='./reading.js?v=20260908-reading-v36'
new_ver='./reading.js?v=20260908-reading-v37'
if old_ver not in html:
    raise SystemExit('reading.js version marker not found')
html=html.replace(old_ver,new_ver,1)

js_path.write_text(js,encoding='utf-8')
html_path.write_text(html,encoding='utf-8')
print('PASS: Reading v37 timeline ordering/count/scroll patch applied')

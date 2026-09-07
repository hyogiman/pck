from pathlib import Path

js_path=Path('reading.js')
html_path=Path('reading.html')
js=js_path.read_text(encoding='utf-8')
html=html_path.read_text(encoding='utf-8')

# 1) Handwriting icon: use note/paper icon consistently in Reading Garden UI.
js=js.replace('✍','📝')
html=html.replace('✍','📝')
html=html.replace('./reading.js?v=20260907-reading-v35','./reading.js?v=20260908-reading-v36',1)

# 2) Restore active reading state from localStorage before IndexedDB/Firebase work.
init_marker='''async function initFirebase(){'''
restore_fn='''function restoreLocalReadingState(){
  const activeRaw=localStorage.getItem(ACTIVE_SESSION_KEY);
  if(activeRaw){
    try{const session=JSON.parse(activeRaw);state.activeSession=session&&!session.endedAt?session:null;if(!state.activeSession)localStorage.removeItem(ACTIVE_SESSION_KEY)}
    catch{state.activeSession=null;localStorage.removeItem(ACTIVE_SESSION_KEY)}
  }
  const savedBook=localStorage.getItem(CURRENT_BOOK_KEY);if(savedBook)state.currentBookId=savedBook;
}

'''
if 'function restoreLocalReadingState(){' not in js:
    if init_marker not in js: raise SystemExit('initFirebase marker not found')
    js=js.replace(init_marker,restore_fn+init_marker,1)

old_cloud='''  for(const name of COLLECTIONS){const data=await loadCollection(name);if(data)state[name]=data}
  const activeRaw=localStorage.getItem(ACTIVE_SESSION_KEY);if(activeRaw){try{state.activeSession=JSON.parse(activeRaw)}catch{localStorage.removeItem(ACTIVE_SESSION_KEY)}}state.currentBookId=localStorage.getItem(CURRENT_BOOK_KEY)||chooseCurrentBookId();state.loading=false;await cacheSnapshot();updateSyncInfo();'''
new_cloud='''  const loaded=await Promise.all(COLLECTIONS.map(async name=>[name,await loadCollection(name)]));
  for(const [name,data] of loaded)if(data)state[name]=data;
  if(!state.currentBookId)state.currentBookId=chooseCurrentBookId();state.loading=false;await cacheSnapshot();updateSyncInfo();'''
if old_cloud not in js: raise SystemExit('loadCloudData marker not found')
js=js.replace(old_cloud,new_cloud,1)

old_read='''function renderRead(){
  const box=$("readHero");if(state.loading){box.innerHTML=`<div class="empty-hero"><p>서재를 불러오고 있어요…</p></div>`;return}
  if(state.activeSession&&!state.activeSession.endedAt){const s=sourceById(state.activeSession.sourceId);box.innerHTML=`<div class="read-hero-inner"><div class="notice rg-active-session-notice">진행 중이던 독서가 있어요.</div>${coverHtml(s)}<h2 class="hero-title">${esc(s?.title||"읽던 책")}</h2><p class="hero-author">${esc(s?.creator||"")}</p><button class="btn primary block start-btn" data-resume-session type="button">▶ 독서 계속하기</button><button class="text-btn switch-book" data-abandon-session type="button">종료 처리하기</button></div>`;return}
'''
new_read='''function renderRead(){
  const box=$("readHero");
  if(state.activeSession&&!state.activeSession.endedAt){const s=sourceById(state.activeSession.sourceId),paused=!!state.activeSession.pauseStartedAt;box.innerHTML=`<div class="read-hero-inner"><div class="notice rg-active-session-notice">${paused?"일시정지 중인 독서가 있어요.":"진행 중이던 독서가 있어요."}</div>${coverHtml(s)}<h2 class="hero-title">${esc(s?.title||"읽던 책")}</h2><p class="hero-author">${esc(s?.creator||"")}</p><button class="btn primary block start-btn" data-resume-session type="button">${paused?"▶ 다시 읽기":"▶ 독서 계속하기"}</button><button class="text-btn switch-book" data-abandon-session type="button">종료 처리하기</button></div>`;return}
  if(state.loading){box.innerHTML=`<div class="empty-hero"><p>서재를 불러오고 있어요…</p></div>`;return}
'''
if old_read not in js: raise SystemExit('renderRead marker not found')
js=js.replace(old_read,new_read,1)

old_boot='''async function boot(){state.idb=await openIdb();await loadSnapshot();bindEvents();setupHandwriting();renderAll();updateSyncInfo();initFirebase().catch(err=>{console.error(err);$("authGate").classList.remove("hidden");$("authGateStatus").textContent=`Firebase 연결 실패: ${err.message}`})}'''
new_boot='''async function boot(){restoreLocalReadingState();bindEvents();setupHandwriting();renderRead();state.idb=await openIdb();await loadSnapshot();if(!state.currentBookId)state.currentBookId=chooseCurrentBookId();state.loading=false;renderAll();updateSyncInfo();initFirebase().catch(err=>{console.error(err);$("authGate").classList.remove("hidden");$("authGateStatus").textContent=`Firebase 연결 실패: ${err.message}`})}'''
if old_boot not in js: raise SystemExit('boot marker not found')
js=js.replace(old_boot,new_boot,1)

# 3) Put the end-of-session note directly beneath the reading-time header, before captured entries.
old_order='''      ${entryFolder}
      ${ev.session.sessionNote&&filter==="all"?`<div class="session-note">“${esc(ev.session.sessionNote)}”</div>`:""}'''
new_order='''      ${ev.session.sessionNote&&filter==="all"?`<div class="session-note">“${esc(ev.session.sessionNote)}”</div>`:""}
      ${entryFolder}'''
if old_order not in js: raise SystemExit('session note order marker not found')
js=js.replace(old_order,new_order,1)

js_path.write_text(js,encoding='utf-8')
html_path.write_text(html,encoding='utf-8')
print('PASS: Reading Garden v36 UX/session fixes applied')

from pathlib import Path

js_path = Path('reading.js')
html_path = Path('reading.html')
js = js_path.read_text(encoding='utf-8')
html = html_path.read_text(encoding='utf-8')

# 1) Firebase Functions client: Reading Garden must explicitly call the same
# Thought Garden indexing function after a real thought change.
old = 'import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";\n'
new = old + 'import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";\n'
if old not in js or 'firebase-functions.js' in js:
    raise SystemExit('functions import marker missing/already patched')
js = js.replace(old, new, 1)

# 2) IndexedDB v2 adds a separate durable AI-index queue. Keeping it separate
# prevents a slow AI call from blocking ordinary reading/file synchronization.
if 'const DB_VERSION=1;' not in js:
    raise SystemExit('DB_VERSION marker not found')
js = js.replace('const DB_VERSION=1;', 'const DB_VERSION=2;', 1)

old = '  user:null,db:null,storage:null,cloudReady:false,loading:true,\n'
new = '  user:null,db:null,storage:null,functions:null,thoughtIndexCallable:null,cloudReady:false,loading:true,\n'
if old not in js:
    raise SystemExit('state firebase marker not found')
js = js.replace(old, new, 1)

old = '  idb:null,syncing:false,bookApiResults:[],bookSearch:{query:"",page:0,total:0,hasMore:false,loading:false},entrySaving:false,bookInfoLoading:new Set()\n'
new = '  idb:null,syncing:false,aiIndexSyncing:false,bookApiResults:[],bookSearch:{query:"",page:0,total:0,hasMore:false,loading:false},entrySaving:false,bookInfoLoading:new Set()\n'
if old not in js:
    raise SystemExit('state sync marker not found')
js = js.replace(old, new, 1)

old = '      if(!db.objectStoreNames.contains("meta"))db.createObjectStore("meta",{keyPath:"key"});\n'
new = old + '      if(!db.objectStoreNames.contains("aiIndexOutbox"))db.createObjectStore("aiIndexOutbox",{keyPath:"id"});\n'
if old not in js:
    raise SystemExit('indexeddb store marker not found')
js = js.replace(old, new, 1)

# 3) Durable, retryable bridge from Reading fragments to Thought Garden AI.
marker = 'async function cacheSnapshot(){\n'
if marker not in js:
    raise SystemExit('cacheSnapshot marker not found')
helpers = '''async function queueThoughtIndex(fragmentId){
  if(!fragmentId)return;
  if(!state.idb){
    if(state.cloudReady&&navigator.onLine&&state.thoughtIndexCallable){
      void state.thoughtIndexCallable({fragmentId}).catch(err=>console.warn("Reading thought index request failed",fragmentId,err?.code||err?.message||err));
    }
    return;
  }
  await idbPut("aiIndexOutbox",{id:fragmentId,fragmentId,queuedAt:nowIso()});
  updateSyncInfo();
  /* flushSync writes any queued Fragment first; its finally block then starts AI indexing. */
  void flushSync();
}
async function cancelThoughtIndex(fragmentId){
  if(!state.idb||!fragmentId)return;
  try{await idbDelete("aiIndexOutbox",fragmentId)}catch{}
}
async function flushThoughtIndexQueue(){
  if(state.aiIndexSyncing||!state.cloudReady||!navigator.onLine||!state.idb||!state.thoughtIndexCallable)return;
  state.aiIndexSyncing=true;
  try{
    const tasks=await idbGetAll("aiIndexOutbox");
    for(const task of tasks){
      try{
        await state.thoughtIndexCallable({fragmentId:task.fragmentId});
        await idbDelete("aiIndexOutbox",task.id);
      }catch(err){
        /* Keep the task durable. The callable is hash-idempotent, so retrying is safe. */
        console.warn("Reading thought index queued for retry",task.fragmentId,err?.code||err?.message||err);
        break;
      }
    }
  }finally{
    state.aiIndexSyncing=false;
    updateSyncInfo();
  }
}
function fragmentHasCompleteAiIndex(fragment){
  return !!(fragment&&fragment.embeddingTextHash&&fragment.embeddingVersion&&fragment.aiIndex);
}
async function queueMissingReadingThoughtIndexes(){
  if(!state.idb)return 0;
  const linkedIds=[...new Set(state.readingEntries
    .filter(entry=>entry.linkedFragmentId&&safeText(entry.thought))
    .map(entry=>entry.linkedFragmentId))];
  let queued=0;
  for(const fragmentId of linkedIds){
    const fragment=state.fragments.find(item=>item.id===fragmentId);
    if(!fragment||!safeText(fragment.thought)||fragmentHasCompleteAiIndex(fragment))continue;
    await idbPut("aiIndexOutbox",{id:fragmentId,fragmentId,queuedAt:nowIso(),reason:"reading-history-backfill-v1"});
    queued++;
  }
  if(queued)updateSyncInfo();
  return queued;
}

'''
js = js.replace(marker, helpers + marker, 1)

# 4) Fragment deletion must also cancel a pending AI job.
old = '''async function cloudDelete(collectionName,docId){
  if(!state.cloudReady||!navigator.onLine){await queueOp(collectionName,docId,null,"delete");return false}
  try{await deleteDoc(doc(state.db,"users",state.user.uid,collectionName,docId));return true}catch(err){await queueOp(collectionName,docId,null,"delete");return false}
}'''
new = '''async function cloudDelete(collectionName,docId){
  if(collectionName==="fragments")await cancelThoughtIndex(docId);
  if(!state.cloudReady||!navigator.onLine){await queueOp(collectionName,docId,null,"delete");return false}
  try{await deleteDoc(doc(state.db,"users",state.user.uid,collectionName,docId));return true}catch(err){await queueOp(collectionName,docId,null,"delete");return false}
}'''
if old not in js:
    raise SystemExit('cloudDelete marker not found')
js = js.replace(old, new, 1)

# 5) Ordinary sync always completes first, then the independent AI queue runs.
old = '  }finally{state.syncing=false;updateSyncInfo();cacheSnapshot()}\n}\nasync function updateSyncInfo(){if(!state.idb)return;const [ops,files]=await Promise.all([idbGetAll("outbox"),idbGetAll("files")]);const n=ops.length+files.length;if($("syncInfo"))$("syncInfo").textContent=n?`☁️ 동기화 대기 ${n}건 · 기기에 안전하게 보관 중`:state.cloudReady&&navigator.onLine?"☁️ 동기화 완료":"☁️ 오프라인 저장 중"}\n'
new = '  }finally{state.syncing=false;updateSyncInfo();cacheSnapshot();void flushThoughtIndexQueue()}\n}\nasync function updateSyncInfo(){if(!state.idb)return;const [ops,files,aiTasks]=await Promise.all([idbGetAll("outbox"),idbGetAll("files"),idbGetAll("aiIndexOutbox")]);const n=ops.length+files.length+aiTasks.length;if($("syncInfo"))$("syncInfo").textContent=n?`☁️ 동기화 대기 ${n}건 · 기기에 안전하게 보관 중`:state.cloudReady&&navigator.onLine?"☁️ 동기화 완료":"☁️ 오프라인 저장 중"}\n'
if old not in js:
    raise SystemExit('flush/update sync marker not found')
js = js.replace(old, new, 1)

# 6) Initialize the existing production callable in the same Firebase project.
old = '  const app=initializeApp(FIREBASE_CONFIG),auth=getAuth(app);state.db=getFirestore(app);state.storage=getStorage(app);\n'
new = '  const app=initializeApp(FIREBASE_CONFIG),auth=getAuth(app);state.db=getFirestore(app);state.storage=getStorage(app);state.functions=getFunctions(app,"us-central1");state.thoughtIndexCallable=httpsCallable(state.functions,"thoughtIndexFragment");\n'
if old not in js:
    raise SystemExit('initFirebase marker not found')
js = js.replace(old, new, 1)

old = '$("accountInfo").textContent=user.displayName||user.email||"Google 계정 연결됨";await loadCloudData();await flushSync();renderAll()'
new = '$("accountInfo").textContent=user.displayName||user.email||"Google 계정 연결됨";await loadCloudData();await queueMissingReadingThoughtIndexes();await flushSync();void flushThoughtIndexQueue();renderAll()'
if old not in js:
    raise SystemExit('auth load marker not found')
js = js.replace(old, new, 1)

# 7) Sacred boundary: ONLY this existing thoughtChanged block may enqueue AI.
old = '        await cloudSet("fragments",fragmentId,fragment,{silent:true});\n'
new = '        await cloudSet("fragments",fragmentId,fragment,{silent:true});\n        await queueThoughtIndex(fragmentId);\n'
if js.count(old) != 1:
    raise SystemExit(f'expected one Fragment save marker, found {js.count(old)}')
js = js.replace(old, new, 1)

# Add origin metadata for future diagnostics without changing shared core fields.
old = 'fragment={id:fragmentId,type:"source",sourceId,externalText:quote,locator,thought,threadIds:old?.threadIds||[],date:localDate(entry.createdAt),createdAt:old?.createdAt||entry.createdAt,updatedAt:nowIso()}'
new = 'fragment={id:fragmentId,type:"source",sourceId,externalText:quote,locator,thought,threadIds:old?.threadIds||[],origin:"reading-garden",readingEntryId:entry.id,date:localDate(entry.createdAt),createdAt:old?.createdAt||entry.createdAt,updatedAt:nowIso()}'
if old not in js:
    raise SystemExit('fragment construction marker not found')
js = js.replace(old, new, 1)

# 8) Reconnect retries both normal sync and AI indexing.
old = 'window.addEventListener("online",()=>{toast("인터넷에 연결되었습니다. 동기화를 확인합니다.");flushSync()});'
new = 'window.addEventListener("online",()=>{toast("인터넷에 연결되었습니다. 동기화를 확인합니다.");flushSync();flushThoughtIndexQueue()});'
if old not in js:
    raise SystemExit('online listener marker not found')
js = js.replace(old, new, 1)

# 9) Cache-bust the changed module.
old = './reading.js?v=20260908-reading-v42'
new = './reading.js?v=20260908-reading-v43'
if old not in html:
    raise SystemExit('reading.js cache marker not found')
html = html.replace(old, new, 1)

js_path.write_text(js, encoding='utf-8')
html_path.write_text(html, encoding='utf-8')
print('PASS: Reading v43 Thought Garden AI sync bridge applied')

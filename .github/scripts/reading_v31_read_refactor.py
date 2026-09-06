from pathlib import Path

p=Path('reading.js')
s=p.read_text(encoding='utf-8')

old='import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";'
new='import { getFirestore, collection, getDocs, query, where, doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";'
assert s.count(old)==1, 'firestore import changed unexpectedly'
s=s.replace(old,new,1)

old='''async function cacheSnapshot(){
  if(!state.idb)return;
  const snapshot={key:"snapshot",savedAt:nowIso(),sources:state.sources.filter(s=>s.type==="book"),readingProfiles:state.readingProfiles,readingCycles:state.readingCycles,readingSessions:state.readingSessions,readingEntries:state.readingEntries.map(e=>({...e,handwritingLocalUrl:undefined})),readingPaths:state.readingPaths};
  try{await idbPut("meta",snapshot)}catch{}
}
async function loadSnapshot(){
  if(!state.idb)return false;
  const x=await idbGet("meta","snapshot");if(!x)return false;
  for(const k of ["sources","readingProfiles","readingCycles","readingSessions","readingEntries","readingPaths"])state[k]=Array.isArray(x[k])?x[k]:[];
  return true;
}'''
new='''async function cacheSnapshot(){
  if(!state.idb)return;
  const bookSources=state.sources.filter(s=>s.type==="book"),bookIds=new Set(bookSources.map(s=>s.id));
  const snapshot={key:"snapshot",savedAt:nowIso(),sources:bookSources,fragments:state.fragments.filter(f=>bookIds.has(f.sourceId)),readingProfiles:state.readingProfiles,readingCycles:state.readingCycles,readingSessions:state.readingSessions,readingEntries:state.readingEntries.map(e=>({...e,handwritingLocalUrl:undefined})),readingPaths:state.readingPaths};
  try{await idbPut("meta",snapshot)}catch{}
}
async function loadSnapshot(){
  if(!state.idb)return false;
  const x=await idbGet("meta","snapshot");if(!x)return false;
  for(const k of ["sources","fragments","readingProfiles","readingCycles","readingSessions","readingEntries","readingPaths"])state[k]=Array.isArray(x[k])?x[k]:[];
  return true;
}'''
assert s.count(old)==1, 'snapshot block changed unexpectedly'
s=s.replace(old,new,1)

old='''async function loadCollection(name){try{const snap=await getDocs(collection(state.db,"users",state.user.uid,name));return snap.docs.map(d=>({id:d.id,...d.data()}))}catch(err){console.warn("load collection failed",name,err);return null}}
async function loadCloudData(){
  state.loading=true;const sources=await loadCollection("sources");if(sources)state.sources=sources.filter(s=>s.type==="book");else await loadSnapshot();const fragments=await loadCollection("fragments");state.fragments=fragments||[];for(const name of COLLECTIONS){const data=await loadCollection(name);if(data)state[name]=data}
  const activeRaw=localStorage.getItem(ACTIVE_SESSION_KEY);if(activeRaw){try{state.activeSession=JSON.parse(activeRaw)}catch{localStorage.removeItem(ACTIVE_SESSION_KEY)}}state.currentBookId=localStorage.getItem(CURRENT_BOOK_KEY)||chooseCurrentBookId();state.loading=false;await cacheSnapshot();updateSyncInfo();
}'''
new='''async function loadCollection(name){try{const snap=await getDocs(collection(state.db,"users",state.user.uid,name));return snap.docs.map(d=>({id:d.id,...d.data()}))}catch(err){console.warn("load collection failed",name,err);return null}}
async function loadBookSources(){
  try{const ref=collection(state.db,"users",state.user.uid,"sources"),snap=await getDocs(query(ref,where("type","==","book")));return snap.docs.map(d=>({id:d.id,...d.data()}))}
  catch(err){console.warn("load book sources failed",err);return null}
}
async function loadBookFragments(sourceIds){
  const ids=[...new Set((sourceIds||[]).filter(Boolean))];if(!ids.length)return [];
  try{const ref=collection(state.db,"users",state.user.uid,"fragments"),rows=[];for(let i=0;i<ids.length;i+=30){const snap=await getDocs(query(ref,where("sourceId","in",ids.slice(i,i+30))));rows.push(...snap.docs.map(d=>({id:d.id,...d.data()})))}return rows}
  catch(err){console.warn("load book fragments failed",err);return null}
}
async function loadCloudData(){
  state.loading=true;
  const sources=await loadBookSources();if(sources)state.sources=sources;else await loadSnapshot();
  const fragments=await loadBookFragments(state.sources.map(s=>s.id));if(fragments)state.fragments=fragments;
  for(const name of COLLECTIONS){const data=await loadCollection(name);if(data)state[name]=data}
  const activeRaw=localStorage.getItem(ACTIVE_SESSION_KEY);if(activeRaw){try{state.activeSession=JSON.parse(activeRaw)}catch{localStorage.removeItem(ACTIVE_SESSION_KEY)}}state.currentBookId=localStorage.getItem(CURRENT_BOOK_KEY)||chooseCurrentBookId();state.loading=false;await cacheSnapshot();updateSyncInfo();
}'''
assert s.count(old)==1, 'cloud load block changed unexpectedly'
s=s.replace(old,new,1)

p.write_text(s,encoding='utf-8')

# Cache-bust the Reading shell/runtime without touching UI or behavior.
for name in ['reading.html','reading-pwa-v7.js']:
    q=Path(name);t=q.read_text(encoding='utf-8');assert '20260906-reading-v30' in t, f'{name} v30 marker missing';q.write_text(t.replace('20260906-reading-v30','20260906-reading-v31').replace('독서의 정원 v30','독서의 정원 v31'),encoding='utf-8')

q=Path('sw.js');t=q.read_text(encoding='utf-8');assert 'garden-v30-reading-style-single-source-v81' in t,'sw v30 cache marker missing';t=t.replace('garden-v30-reading-style-single-source-v81','garden-v31-reading-read-scope-v82',1).replace('v30: 독서의 정원 CSS와 화면 스타일을 reading.css 하나로 통합하고 진행률 표현 호환성을 고정한다.','v31: 독서의 정원 UI는 유지하고 Firestore 조회 범위를 책 데이터로 제한한다.',1);q.write_text(t,encoding='utf-8')

# Static regression assertions for this targeted refactor.
s=Path('reading.js').read_text(encoding='utf-8')
assert 'loadCollection("fragments")' not in s
assert 'loadCollection("sources")' not in s
assert 'where("type","==","book")' in s
assert 'where("sourceId","in"' in s
assert 'fragments:state.fragments.filter' in s
print('PASS: Reading Garden full sources/fragments scans removed without changing reading-owned collections')

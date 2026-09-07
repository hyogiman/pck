from pathlib import Path
import re

js_path=Path('reading.js')
css_path=Path('reading.css')
html_path=Path('reading.html')
swipe_path=Path('reading-swipe-v8.js')
pwa_path=Path('reading-pwa-v7.js')

js=js_path.read_text(encoding='utf-8')
css=css_path.read_text(encoding='utf-8')
html=html_path.read_text(encoding='utf-8')
swipe=swipe_path.read_text(encoding='utf-8')

# 1) Core state + home button
old='idb:null,syncing:false,bookApiResults:[],bookSearch:{query:"",page:0,total:0,hasMore:false,loading:false},entrySaving:false'
new='idb:null,syncing:false,bookApiResults:[],bookSearch:{query:"",page:0,total:0,hasMore:false,loading:false},entrySaving:false,bookInfoLoading:new Set()'
if old not in js: raise SystemExit('state marker not found')
js=js.replace(old,new,1)

old='<span class="hero-service">${esc(serviceText(p))}</span>${!isPhysical&&p?.lastReadAt?`<div class="hero-locator"><small>최근 독서</small><strong class="rg-relative-date">${esc(relativeDate(p.lastReadAt))}</strong></div>`:""}'
new='<div class="hero-meta-actions"><span class="hero-service">${esc(serviceText(p))}</span><button class="hero-info-btn" data-open-book-info="${esc(s.id)}" type="button">ⓘ 책 정보</button></div>${!isPhysical&&p?.lastReadAt?`<div class="hero-locator"><small>최근 독서</small><strong class="rg-relative-date">${esc(relativeDate(p.lastReadAt))}</strong></div>`:""}'
if old not in js: raise SystemExit('home meta marker not found')
js=js.replace(old,new,1)

# 2) Book detail: add info tab and entry point
old='function openBookDetail(id){state.detailBookId=id;state.detailTab="timeline";renderBookDetail();openLayer("bookDetail")}'
new='''function openBookDetail(id){state.detailBookId=id;state.detailTab="timeline";renderBookDetail();openLayer("bookDetail")}
function openBookInfo(id){state.detailBookId=id;state.detailTab="info";renderBookDetail();openLayer("bookDetail");void ensureBookInfo(id).then(changed=>{if(changed&&state.detailBookId===id&&state.detailTab==="info")renderBookDetail()})}'''
if old not in js: raise SystemExit('openBookDetail marker not found')
js=js.replace(old,new,1)

pattern=r'function renderBookDetail\(\)\{.*?\}\nfunction renderBookStatsHtml\(id\)'
m=re.search(pattern,js,re.S)
if not m: raise SystemExit('renderBookDetail block not found')
new_block='''function renderBookDetail(){const s=sourceById(state.detailBookId);if(!s)return;const p=getProfile(s.id),m=bookMetrics(s.id),detailTimeline=renderTimelineHtml({bookId:s.id,embedded:true}),tabBody=state.detailTab==="timeline"?detailTimeline:state.detailTab==="stats"?renderBookStatsHtml(s.id):renderBookInfoHtml(s);$("bookDetailBody").innerHTML=`<div class="detail-hero">${coverHtml(s,"detail-cover")}<div class="detail-meta"><h2>${esc(s.title)}</h2><p>${esc(s.creator||"")}</p><div class="detail-tags"><span class="mini-tag">${esc(STATUS_LABELS[p.status])}</span><span class="mini-tag">${esc(serviceText(p))}</span>${p.currentLocator?`<span class="mini-tag">${esc(p.currentLocator)}</span>`:""}</div></div></div><button class="btn primary block detail-start" data-start-book="${esc(s.id)}" type="button">▶ 읽기 시작</button><div class="detail-metrics"><div class="detail-metric"><small>총 독서시간</small><strong>${fmtMinutes(m.mins)}</strong></div><div class="detail-metric"><small>읽은 날</small><strong>${m.days}일</strong></div></div><div id="bookMoreMenu" class="more-menu hidden"><button class="btn" data-edit-profile="${esc(s.id)}" type="button">읽기 설정 수정</button><button class="btn" data-complete-book="${esc(s.id)}" type="button">◉ 완독 처리</button><button class="btn" data-print-book="${esc(s.id)}" type="button">📄 이 책 기록 PDF / 인쇄</button></div><div class="segmented detail-tabs"><button class="seg ${state.detailTab==="timeline"?"on":""}" data-detail-tab="timeline" type="button">기록</button><button class="seg ${state.detailTab==="stats"?"on":""}" data-detail-tab="stats" type="button">통계</button><button class="seg ${state.detailTab==="info"?"on":""}" data-detail-tab="info" type="button">책 정보</button></div><div id="detailTabBody">${tabBody}</div>`}
function renderBookInfoHtml(s){
  const facts=[["출판사",safeText(s.publisher)],["출간일",safeText(s.pubDate)],["분량",s.pages?`${Number(s.pages)}쪽`:""],["ISBN",safeText(s.isbn13||s.isbn)]].filter(x=>x[1]);
  const intro=safeText(s.bookIntroduction),summary=safeText(s.bookSummary),toc=safeText(s.tableOfContents),sub=safeText(s.subTitle||s.subtitle),provider=safeText(s.provider);
  const empty=!intro&&!summary&&!toc;
  return `<section class="book-info-panel">${sub?`<p class="book-info-subtitle">${esc(sub)}</p>`:""}${facts.length?`<dl class="book-info-facts">${facts.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`:""}${intro?`<article class="book-info-section"><h3>책 소개</h3><div>${esc(intro)}</div></article>`:""}${summary&&summary!==intro?`<article class="book-info-section"><h3>책 요약</h3><div>${esc(summary)}</div></article>`:""}${toc?`<details class="book-info-toc"><summary>목차 펼치기</summary><div>${esc(toc)}</div></details>`:""}${empty?`<div class="book-info-empty">${state.bookInfoLoading.has(s.id)?"YES24에서 책 정보를 확인하고 있어요…":"저장된 상세 정보가 없습니다. 설정의 ‘책 정보 갱신’에서 다시 확인할 수 있어요."}</div>`:""}${provider?`<p class="book-info-source">정보 출처 · ${esc(provider)}</p>`:""}</section>`
}
function renderBookStatsHtml(id)'''
js=js[:m.start()]+new_block+js[m.end():]

# 3) YES24 detail refresh helpers, using existing bookSearch endpoint
marker='function dedupeBookResults(items){'
if marker not in js: raise SystemExit('dedupe marker not found')
helpers='''function hasRichBookInfo(s){return !!safeText(s?.bookIntroduction||s?.bookSummary||s?.tableOfContents)}
function bookInfoKey(v){return safeText(v).toLowerCase().replace(/[^0-9a-z가-힣]/g,"")}
function normalizeBookInfoItem(x={}){return {title:safeText(x.title),creator:safeText(x.author||x.creator),publisher:safeText(x.publisher),isbn13:safeText(x.isbn13||x.isbn),categoryName:safeText(x.categoryName),pubDate:safeText(x.pubDate||x.publishDate),externalLink:safeText(x.link||x.externalLink),provider:safeText(x.provider),externalId:String(x.itemId||x.externalId||""),subTitle:safeText(x.subTitle),pages:Number(x.pages)||null,bookIntroduction:safeText(x.bookIntroduction),bookSummary:safeText(x.bookSummary),tableOfContents:safeText(x.tableOfContents)}}
async function fetchBookInfoCandidates(q){const r=await fetch(`${BOOK_SEARCH_PROXY}?q=${encodeURIComponent(q)}&page=1`),j=await r.json();if(!r.ok||!j.ok)throw new Error(j?.error||`도서 정보 서버 ${r.status}`);return (j.items||[]).map(normalizeBookInfoItem)}
function pickBookInfoMatch(items,s){const targetIsbn=String(s?.isbn13||s?.isbn||"").replace(/\\D/g,""),title=bookInfoKey(s?.title),creator=bookInfoKey(s?.creator);if(targetIsbn){const exact=items.find(x=>String(x.isbn13||"").replace(/\\D/g,"")===targetIsbn);if(exact)return exact}const sameTitle=items.filter(x=>bookInfoKey(x.title)===title);if(creator){const sameAuthor=sameTitle.find(x=>bookInfoKey(x.creator).includes(creator)||creator.includes(bookInfoKey(x.creator)));if(sameAuthor)return sameAuthor}return sameTitle[0]||null}
async function refreshBookInfoForSource(sourceId,{force=false,silent=false}={}){
  const s=sourceById(sourceId);if(!s||(!force&&hasRichBookInfo(s))||state.bookInfoLoading.has(sourceId)||!navigator.onLine)return false;
  state.bookInfoLoading.add(sourceId);if(state.detailBookId===sourceId&&state.detailTab==="info")renderBookDetail();
  try{
    const isbn=String(s.isbn13||s.isbn||"").replace(/\\D/g,""),titleQuery=[s.title,s.creator].filter(Boolean).join(" ");let items=[],hit=null;
    if(isbn){items=await fetchBookInfoCandidates(isbn);hit=pickBookInfoMatch(items,s)}
    if(!hit&&titleQuery){items=await fetchBookInfoCandidates(titleQuery);hit=pickBookInfoMatch(items,s)}
    if(!hit){if(!silent)toast("YES24에서 정확히 일치하는 책 정보를 찾지 못했습니다.");return false}
    const patch={};
    for(const key of ["publisher","pubDate","externalLink","provider","externalId","subTitle","bookIntroduction","bookSummary","tableOfContents"]){if(hit[key])patch[key]=hit[key]}
    if(hit.pages)patch.pages=hit.pages;
    if(hit.isbn13)patch.isbn13=hit.isbn13;
    if(hit.categoryName){patch.rawCategories=[hit.categoryName];patch.primaryGenre=normalizeGenre(hit.categoryName)}
    Object.assign(s,patch,{bookInfoUpdatedAt:nowIso(),updatedAt:nowIso()});
    await cloudSet("sources",s.id,s,{silent:true});await cacheSnapshot();return true
  }catch(err){console.warn("book info refresh failed",sourceId,err);if(!silent)toast("책 정보를 갱신하지 못했습니다. 잠시 후 다시 시도해주세요.");return false}
  finally{state.bookInfoLoading.delete(sourceId);if(state.detailBookId===sourceId&&state.detailTab==="info")renderBookDetail()}
}
async function ensureBookInfo(sourceId){return refreshBookInfoForSource(sourceId,{force:false,silent:true})}
async function refreshAllBookInfo(){
  const btn=$("refreshBookInfoBtn"),status=$("bookInfoRefreshStatus"),books=state.sources.filter(s=>s.type==="book");if(!books.length)return toast("갱신할 책이 없습니다.");if(btn){btn.disabled=true;btn.textContent="책 정보 갱신 중…"}let updated=0;
  try{for(let i=0;i<books.length;i++){if(status)status.textContent=`${i+1} / ${books.length} 확인 중…`;if(await refreshBookInfoForSource(books[i].id,{force:true,silent:true}))updated++}if(status)status.textContent=`완료 · ${books.length}권 확인, ${updated}권 갱신`;renderAll();if(state.detailBookId)renderBookDetail();toast(`책 정보 ${updated}권을 갱신했습니다. 📚`)}finally{if(btn){btn.disabled=false;btn.textContent="서재 책 정보 갱신"}}
}
'''
js=js.replace(marker,helpers+marker,1)

# 4) Event hooks
old='const nav=e.target.closest("[data-view-target]");if(nav)return setView(nav.dataset.viewTarget);'
new='const bookInfo=e.target.closest("[data-open-book-info]");if(bookInfo){e.preventDefault();e.stopPropagation();return openBookInfo(bookInfo.dataset.openBookInfo)}const nav=e.target.closest("[data-view-target]");if(nav)return setView(nav.dataset.viewTarget);'
if old not in js: raise SystemExit('nav event marker not found')
js=js.replace(old,new,1)

old='const dt=e.target.closest("[data-detail-tab]");if(dt){state.detailTab=dt.dataset.detailTab;return renderBookDetail()}'
new='const dt=e.target.closest("[data-detail-tab]");if(dt){state.detailTab=dt.dataset.detailTab;renderBookDetail();if(state.detailTab==="info")void ensureBookInfo(state.detailBookId).then(changed=>{if(changed&&state.detailTab==="info")renderBookDetail()});return}'
if old not in js: raise SystemExit('detail tab event marker not found')
js=js.replace(old,new,1)

old='$("openSettings").onclick=()=>openDialog("settingsDialog");$("newPathBtn")'
new='$("openSettings").onclick=()=>openDialog("settingsDialog");$("refreshBookInfoBtn").onclick=refreshAllBookInfo;$("newPathBtn")'
if old not in js: raise SystemExit('settings binding marker not found')
js=js.replace(old,new,1)

# 5) Swipe home: genre + book info in one compact row
old="  const genreHtml=genre?`<span class=\"hero-service rg-home-genre rg-genre-badge\">${rgEsc(genre)}</span>`:'';\n"
new="  const genreHtml=genre?`<span class=\"hero-service rg-home-genre rg-genre-badge\">${rgEsc(genre)}</span>`:'';\n  const metaHtml=`<div class=\"hero-meta-actions\">${genreHtml}<button class=\"hero-info-btn\" data-open-book-info=\"${rgEsc(book.id)}\" type=\"button\">ⓘ 책 정보</button></div>`;\n"
if old not in swipe: raise SystemExit('swipe genre marker not found')
swipe=swipe.replace(old,new,1)
old='    ${genreHtml}${extra}\n'
new='    ${metaHtml}${extra}\n'
if old not in swipe: raise SystemExit('swipe meta output marker not found')
swipe=swipe.replace(old,new,1)

# 6) Settings: only Account/Sync -> Book Info Refresh -> Data Backup
settings_pattern=r'<dialog id="settingsDialog" class="modal-dialog"><div class="modal">.*?</div></dialog>'
sm=re.search(settings_pattern,html,re.S)
if not sm: raise SystemExit('settings dialog not found')
settings='''<dialog id="settingsDialog" class="modal-dialog"><div class="modal"><div class="modal-head"><div><span class="eyebrow">SETTINGS</span><h2>설정</h2></div><button class="close-btn" data-close-dialog="settingsDialog" type="button">✕</button></div>
    <div class="setting-card"><b>계정 · 동기화</b><div id="accountInfo" class="helper">확인 중…</div><div id="syncInfo" class="sync-line">☁️ 연결 확인 중</div><button id="signOutBtn" class="text-btn danger-text" type="button">로그아웃</button></div>
    <div class="setting-card"><b>책 정보 갱신</b><p id="bookInfoRefreshStatus" class="helper">등록된 책의 소개·요약·목차를 YES24 기준으로 다시 확인합니다.</p><button id="refreshBookInfoBtn" class="btn soft block" type="button">서재 책 정보 갱신</button></div>
    <div class="setting-card"><b>데이터 백업</b><div class="setting-actions"><button id="jsonBackupBtn" class="btn" type="button">💾 JSON 백업</button><label class="btn file-btn">♻ JSON 복원<input id="jsonRestoreInput" type="file" accept="application/json" /></label></div></div>
  </div></dialog>'''
html=html[:sm.start()]+settings+html[sm.end():]

# 7) Replace PWA install helper with SW + double-back navigation guard
pwa='''/* 독서의 정원 v41 — PWA 런타임 + 모바일 뒤로가기 보호 */
const RG_SW_VERSION='20260908-reading-v41';
let rgLastRootBackAt=0;
function rgToast(message,ms=2800){const el=document.getElementById('toast');if(!el)return;el.textContent=message;el.classList.add('show');clearTimeout(rgToast.t);rgToast.t=setTimeout(()=>el.classList.remove('show'),ms)}
async function registerSharedWorker(){if(!('serviceWorker' in navigator))return;try{const reg=await navigator.serviceWorker.register(`./sw.js?v=${RG_SW_VERSION}`,{scope:'./',updateViaCache:'none'});await reg.update().catch(()=>{})}catch(err){console.warn('Reading Garden SW registration failed',err)}}
function rgHandleBackInsideApp(){
  const dialogs=[...document.querySelectorAll('dialog[open]')];if(dialogs.length){dialogs.at(-1).close();return true}
  const handwriting=document.getElementById('handwritingLayer');if(handwriting&&!handwriting.classList.contains('hidden')){document.getElementById('closeHandwritingBtn')?.click();return true}
  const session=document.getElementById('sessionLayer');if(session&&!session.classList.contains('hidden')){document.getElementById('sessionBackBtn')?.click();return true}
  const detail=document.getElementById('bookDetail');if(detail&&!detail.classList.contains('hidden')){detail.querySelector('[data-close-layer="bookDetail"]')?.click();return true}
  const read=document.querySelector('[data-view-target="read"]');if(read&&!read.classList.contains('on')){read.click();return true}
  return false
}
function rgArmBackGuard(){
  if(history.state?.rgReadingGuard)return;
  history.replaceState({...history.state,rgReadingBase:true},document.title,location.href);
  history.pushState({rgReadingGuard:true},document.title,location.href)
}
window.addEventListener('popstate',()=>{
  if(rgHandleBackInsideApp()){rgLastRootBackAt=0;history.pushState({rgReadingGuard:true},document.title,location.href);return}
  const now=Date.now();
  if(now-rgLastRootBackAt>1600){rgLastRootBackAt=now;history.pushState({rgReadingGuard:true},document.title,location.href);rgToast('한 번 더 뒤로가면 앱을 닫습니다.',1800);return}
  rgLastRootBackAt=0;history.back()
});
window.addEventListener('pageshow',rgArmBackGuard);
rgArmBackGuard();
registerSharedWorker();
import('./reading-dialogs-v18.js?v=20260907-reading-v33').catch(err=>console.warn('Reading Garden dialog runtime failed',err));
import('./reading-stability-v16.js?v=20260907-reading-v33').catch(err=>console.warn('Reading Garden stability runtime failed',err));
'''

# 8) CSS only in reading.css
css += '''\n\n/* v41 · 첫 화면 책 정보 + 책 상세 정보 */\n.hero-meta-actions{display:flex;align-items:center;justify-content:center;gap:7px;margin-top:12px;flex-wrap:wrap}.hero-meta-actions .hero-service{margin-top:0}.hero-info-btn{border:1px solid var(--line);background:var(--panel);color:#765f4b;border-radius:999px;padding:6px 10px;font-size:.7rem;font-weight:800;box-shadow:var(--card-shadow)}.hero-info-btn:active{transform:scale(.97)}\n.detail-tabs{grid-template-columns:repeat(3,1fr)}.book-info-panel{display:grid;gap:14px;margin-top:16px}.book-info-subtitle{margin:0;color:var(--muted);font-family:var(--serif);font-size:.9rem;line-height:1.6}.book-info-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0}.book-info-facts>div{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:10px}.book-info-facts dt{font-size:.64rem;color:var(--muted);font-weight:800}.book-info-facts dd{margin:4px 0 0;font-size:.78rem;line-height:1.45}.book-info-section{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:15px}.book-info-section h3{font-family:var(--serif);font-size:.95rem;margin:0 0 9px}.book-info-section div,.book-info-toc div{white-space:pre-wrap;font-family:var(--serif);font-size:.86rem;line-height:1.75;color:#4e5048}.book-info-toc{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:13px 15px}.book-info-toc summary{cursor:pointer;font-weight:800;font-size:.78rem;color:#765f4b}.book-info-toc div{padding-top:12px}.book-info-empty{border:1px dashed var(--line);border-radius:14px;padding:18px;text-align:center;color:var(--muted);font-size:.76rem;line-height:1.6}.book-info-source{margin:0;text-align:right;color:var(--muted);font-size:.64rem}\n'''

# 9) Cache busts
versions={
  './reading.css?v=20260908-reading-v40':'./reading.css?v=20260908-reading-v41',
  './reading.js?v=20260908-reading-v40':'./reading.js?v=20260908-reading-v41',
  './reading-pwa-v7.js?v=20260907-reading-v33':'./reading-pwa-v7.js?v=20260908-reading-v41',
  './reading-swipe-v8.js?v=20260908-reading-v40':'./reading-swipe-v8.js?v=20260908-reading-v41',
}
for old,new in versions.items():
    if old not in html: raise SystemExit(f'cache marker not found: {old}')
    html=html.replace(old,new,1)

js_path.write_text(js,encoding='utf-8')
css_path.write_text(css,encoding='utf-8')
html_path.write_text(html,encoding='utf-8')
swipe_path.write_text(swipe,encoding='utf-8')
pwa_path.write_text(pwa,encoding='utf-8')
print('PASS: Reading v41 book info/settings/back guard applied')

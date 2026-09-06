from pathlib import Path
import re


def replace_function(text, name, replacement):
    markers=[f"async function {name}(", f"function {name}("]
    starts=[text.find(m) for m in markers if text.find(m)>=0]
    if not starts:
        raise SystemExit(f"function not found: {name}")
    start=min(starts)
    brace=text.find('{', start)
    if brace<0:
        raise SystemExit(f"opening brace not found: {name}")
    depth=0
    quote=None
    escape=False
    i=brace
    while i<len(text):
        c=text[i]
        if quote:
            if escape:
                escape=False
            elif c=='\\':
                escape=True
            elif c==quote:
                quote=None
        else:
            if c in ('\"', "'", '`'):
                quote=c
            elif c=='{':
                depth+=1
            elif c=='}':
                depth-=1
                if depth==0:
                    return text[:start]+replacement.strip()+text[i+1:]
        i+=1
    raise SystemExit(f"closing brace not found: {name}")

# ------------------------------------------------------------------
# Cloud Function: page-aware YES24 / Aladin search
# ------------------------------------------------------------------
p=Path('functions/index.js')
s=p.read_text(encoding='utf-8')
s=s.replace('async function searchYes24Books(query, apiKey) {','async function searchYes24Books(query, apiKey, page = 1) {',1)
s=s.replace('url.searchParams.set("page", "1");','url.searchParams.set("page", String(Math.max(1, Number(page) || 1)));',1)
s=s.replace('async function searchAladinBooks(query, key) {','async function searchAladinBooks(query, key, page = 1) {',1)
s=s.replace('url.searchParams.set("start", "1");','url.searchParams.set("start", String(Math.max(1, Number(page) || 1)));',1)
needle='''    const query = String(req.query.q || "").trim();
    if (!query) {'''
repl='''    const query = String(req.query.q || "").trim();
    const requestedPage = Number.parseInt(String(req.query.page || "1"), 10);
    const page = Math.max(1, Math.min(50, Number.isFinite(requestedPage) ? requestedPage : 1));
    if (!query) {'''
if needle not in s: raise SystemExit('bookSearch request query block changed')
s=s.replace(needle,repl,1)
s=s.replace('const result = await searchYes24Books(query, yes24Key);','const result = await searchYes24Books(query, yes24Key, page);',1)
s=s.replace('const result = await searchAladinBooks(query, aladinKey);','const result = await searchAladinBooks(query, aladinKey, page);',1)
# Return page metadata from both success paths. Limit replacements to the two bookSearch responses.
s=s.replace('''          provider: "YES24",
          totalResults: result.totalResults,
          items: result.items,''','''          provider: "YES24",
          page,
          pageSize: 20,
          totalResults: result.totalResults,
          items: result.items,''',1)
s=s.replace('''        provider: "Aladin",
        fallbackFrom: "YES24",
        yes24Error,
        totalResults: result.totalResults,
        items: result.items,''','''        provider: "Aladin",
        fallbackFrom: "YES24",
        yes24Error,
        page,
        pageSize: 20,
        totalResults: result.totalResults,
        items: result.items,''',1)
p.write_text(s,encoding='utf-8')

# ------------------------------------------------------------------
# Thought Garden: accumulate pages with a More button
# ------------------------------------------------------------------
p=Path('index.html')
s=p.read_text(encoding='utf-8')
anchor='const BOOK_SEARCH_PROXY="https://us-central1-idea-pocket-56063.cloudfunctions.net/bookSearch";'
if anchor not in s: raise SystemExit('Thought Garden book proxy anchor missing')
s=s.replace(anchor,anchor+'\nlet bookSearchPager={query:"",page:0,total:0,hasMore:false,loading:false};',1)

s=replace_function(s,'googleBooksSearch',r'''
async function googleBooksSearch(query,page=1){
  const key=getApiKeys().youtube;
  if(!key)throw new Error("설정에서 Google API Key를 입력해주세요. 이 키는 Google Books와 YouTube가 함께 사용합니다.");
  const startIndex=Math.max(0,(Math.max(1,Number(page)||1)-1)*20);
  const url=`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=20&startIndex=${startIndex}&printType=books&key=${encodeURIComponent(key)}`;
  const r=await fetch(url,{headers:{Accept:"application/json"}});
  if(!r.ok){
    let detail="";try{detail=(await r.json())?.error?.message||""}catch{}
    throw new Error(`Google Books ${r.status}${detail?` · ${detail}`:""}`);
  }
  const d=await r.json();
  const items=(d.items||[]).map(x=>{
    const v=x.volumeInfo||{};
    const isbn13=(v.industryIdentifiers||[]).find(i=>i.type==="ISBN_13")?.identifier||"";
    const isbn10=(v.industryIdentifiers||[]).find(i=>i.type==="ISBN_10")?.identifier||"";
    return {kind:"book",provider:"Google Books",externalId:x.id||"",title:cleanExternalText(v.title||""),creator:cleanExternalText((v.authors||[]).join(", ")),publisher:cleanExternalText(v.publisher||""),pubDate:v.publishedDate||"",image:(v.imageLinks?.thumbnail||v.imageLinks?.smallThumbnail||"").replace("http://","https://"),isbn13:isbn13||isbn10,link:v.infoLink||""};
  });
  return {items,totalResults:Number(d.totalItems||0)};
}''')

s=replace_function(s,'aladinBookSearch',r'''
async function aladinBookSearch(query,page=1){
  const r=await fetch(`${BOOK_SEARCH_PROXY}?q=${encodeURIComponent(query)}&page=${Math.max(1,Number(page)||1)}`,{headers:{Accept:"application/json"}});
  let d=null;try{d=await r.json()}catch{}
  if(!r.ok||!d?.ok)throw new Error(d?.error||`도서 검색 서버 ${r.status}`);
  const items=(d.items||[]).map(x=>({kind:"book",provider:x.provider||d.provider||"YES24",externalId:String(x.itemId||""),title:cleanAladinTitle(x.title||""),creator:cleanExternalText(x.author||""),publisher:cleanExternalText(x.publisher||""),pubDate:x.pubDate||"",image:(x.cover||"").replace("http://","https://"),isbn13:x.isbn13||x.isbn||"",link:x.link||""}));
  return {items,totalResults:Number(d.totalResults||0),provider:d.provider||items[0]?.provider||"YES24",page:Number(d.page||page)||page};
}''')

s=replace_function(s,'renderCombinedBookResults',r'''
function renderCombinedBookResults(results,status){
  results=(results||[]).map(normalizeApiResult);
  state.apiResults=results;
  const box=$("apiSearchResults");
  const serverText=status.aladinError?`<span class="bad">도서 검색 오류</span><span>${esc(status.aladinError)}</span>`:`<span class="ok">${esc(status.provider||"도서 검색")} ${status.aladinCount}건</span>`;
  const googleText=status.googleError?`<span class="bad">Google Books 오류</span><span>${esc(status.googleError)}</span>`:`<span class="ok">Google Books ${status.googleCount}건</span>`;
  const diagnostic=`<div class="search-diagnostic">${serverText}<span>·</span>${googleText}</div>`;
  if(!results.length){box.innerHTML=diagnostic+empty("📚","두 검색처 모두 결과를 찾지 못했어요.","다른 검색어로 시도하거나 아래에서 직접 작품 정보를 입력해보세요.");return}
  const rows=results.map((r,i)=>{const dup=existingSourceByIsbn(r.isbn13);return `<button class="search-result" data-api-result-index="${i}" type="button"><span class="search-thumb">${r.image?`<img src="${esc(r.image)}" alt="">`:"📚"}</span><span><span class="search-result-title">${esc(r.title||"제목 없음")}</span><span class="search-result-sub">${esc([r.creator,r.publisher,r.pubDate].filter(Boolean).join(" · "))}</span><span class="api-status"><span class="api-badge ${r.provider==="YES24"?"ok":""}">${esc(r.provider||"도서")}</span>${r.isbn13?`<span class="api-badge">ISBN ${esc(r.isbn13)}</span>`:""}${dup?`<span class="api-badge ok">✓ 이미 Library에 있음</span>`:""}</span></span></button>`}).join("");
  const more=status.hasMore?`<button class="btn soft block" data-book-search-more type="button">더보기${status.totalResults?` · ${results.length}/${status.totalResults}`:""}</button>`:"";
  box.innerHTML=diagnostic+rows+more;
}''')

s=replace_function(s,'searchBooksCombined',r'''
async function searchBooksCombined(query,{append=false}={}){
  if(bookSearchPager.loading)return;
  const box=$("apiSearchResults"),sameQuery=bookSearchPager.query===query,page=append&&sameQuery?bookSearchPager.page+1:1;
  bookSearchPager.loading=true;
  if(!append)box.innerHTML='<div class="helper">YES24와 Google Books를 함께 검색 중…</div>';
  else{const btn=box.querySelector('[data-book-search-more]');if(btn){btn.disabled=true;btn.textContent="더 불러오는 중…"}}
  const serverPromise=aladinBookSearch(query,page),googlePromise=googleBooksSearch(query,page);
  const [a,g]=await Promise.allSettled([serverPromise,googlePromise]);
  const server=a.status==="fulfilled"?a.value:{items:[],totalResults:0,provider:"YES24"};
  const google=g.status==="fulfilled"?g.value:{items:[],totalResults:0};
  const pageItems=mergeBookResults(server.items,google.items);
  const merged=append&&sameQuery?mergeBookResults(state.apiResults,pageItems):pageItems;
  const total=Number(server.totalResults||google.totalResults||0);
  const hasMore=server.totalResults?page*20<server.totalResults:google.totalResults?page*20<google.totalResults:(server.items.length>=20||google.items.length>=20);
  bookSearchPager={query,page,total,hasMore,loading:false};
  renderCombinedBookResults(merged,{aladinCount:server.items.length,googleCount:google.items.length,aladinError:a.status==="rejected"?(a.reason?.message||"호출 실패"):"",googleError:g.status==="rejected"?(g.reason?.message||"호출 실패"):"",provider:server.provider||"YES24",hasMore,totalResults:total,page});
}''')

click_anchor='''document.addEventListener("click",async e=>{\n  const apiResult=e.target.closest("[data-api-result-index]");if(apiResult)return applyApiResultByIndex(apiResult.dataset.apiResultIndex);'''
click_repl='''document.addEventListener("click",async e=>{\n  const bookMore=e.target.closest("[data-book-search-more]");if(bookMore){const q=$("apiSearchQuery").value.trim();if(q)return searchBooksCombined(q,{append:true})}\n  const apiResult=e.target.closest("[data-api-result-index]");if(apiResult)return applyApiResultByIndex(apiResult.dataset.apiResultIndex);'''
if click_anchor not in s: raise SystemExit('Thought Garden click anchor missing')
s=s.replace(click_anchor,click_repl,1)
p.write_text(s,encoding='utf-8')

# ------------------------------------------------------------------
# Reading Garden: accumulate pages with a More button
# ------------------------------------------------------------------
p=Path('reading.js')
s=p.read_text(encoding='utf-8')
state_anchor='idb:null,syncing:false,bookApiResults:[],entrySaving:false'
if state_anchor not in s: raise SystemExit('Reading state anchor missing')
s=s.replace(state_anchor,'idb:null,syncing:false,bookApiResults:[],bookSearch:{query:"",page:0,total:0,hasMore:false,loading:false},entrySaving:false',1)

s=replace_function(s,'googleBooksSearch',r'''
async function googleBooksSearch(q,page=1){try{const keys=getThoughtGardenApiKeys(),key=keys.youtube||keys.google||keys.googleBooks||keys.googleApiKey||"",url=new URL("https://www.googleapis.com/books/v1/volumes");url.searchParams.set("q",q);url.searchParams.set("maxResults","20");url.searchParams.set("startIndex",String(Math.max(0,(Math.max(1,Number(page)||1)-1)*20)));if(key)url.searchParams.set("key",key);const r=await fetch(url);if(!r.ok)return [];const j=await r.json();return (j.items||[]).map(item=>{const v=item.volumeInfo||{},isbn=(v.industryIdentifiers||[]).find(x=>x.type==="ISBN_13")?.identifier||(v.industryIdentifiers||[])[0]?.identifier||"";return {title:safeText(v.title),creator:safeText((v.authors||[]).join(", ")),publisher:safeText(v.publisher),image:(v.imageLinks?.thumbnail||v.imageLinks?.smallThumbnail||"").replace(/^http:/,"https:"),isbn13:isbn,categoryName:safeText((v.categories||[]).join(" > ")),pubDate:v.publishedDate||"",externalLink:v.infoLink||"",provider:"Google Books"}}).filter(x=>x.title)}catch{return []}}
''')

s=replace_function(s,'runBookSearch',r'''
async function runBookSearch(options={}){const append=!!options?.append,q=safeText($("bookSearchInput").value);if(!q||state.bookSearch.loading)return;const sameQuery=state.bookSearch.query===q,page=append&&sameQuery?state.bookSearch.page+1:1,box=$("bookSearchResults");state.bookSearch.loading=true;if(!append)box.innerHTML=`<div class="helper">YES24에서 검색 중…</div>`;else{const btn=box.querySelector('[data-book-search-more]');if(btn){btn.disabled=true;btn.textContent="더 불러오는 중…"}}const local=state.sources.filter(s=>`${s.title} ${s.creator}`.toLowerCase().includes(q.toLowerCase())).slice(0,6);let apiPage=[],serverTotal=0,serverCount=0,serverOk=false;try{const r=await fetch(`${BOOK_SEARCH_PROXY}?q=${encodeURIComponent(q)}&page=${page}`),j=await r.json();if(!r.ok||!j.ok)throw new Error(j?.error||`도서 검색 서버 ${r.status}`);apiPage=(j.items||[]).map(x=>({title:safeText(x.title),creator:safeText(x.author),publisher:safeText(x.publisher),image:x.cover||"",isbn13:x.isbn13||x.isbn||"",categoryName:safeText(x.categoryName),pubDate:x.pubDate||x.publishDate||"",externalLink:x.link||"",provider:x.provider||j.provider||"YES24",externalId:String(x.itemId||""),subTitle:safeText(x.subTitle),pages:Number(x.pages)||null,starScore:Number(x.starScore)||null,bookIntroduction:safeText(x.bookIntroduction),bookSummary:safeText(x.bookSummary),tableOfContents:safeText(x.tableOfContents)}));serverTotal=Number(j.totalResults||0);serverCount=apiPage.length;serverOk=true}catch(err){console.warn(err);if(!append)box.innerHTML=`<div class="helper">도서 검색 서버 오류 · Google Books로 보완 검색합니다.</div>`}let googleCount=0;if(apiPage.length<8||!serverOk){const google=await googleBooksSearch(q,page);googleCount=google.length;apiPage=dedupeBookResults([...apiPage,...google])}const merged=append&&sameQuery?dedupeBookResults([...state.bookApiResults,...apiPage]):apiPage;state.bookApiResults=merged;const hasMore=serverTotal?page*20<serverTotal:serverOk?serverCount>=20:googleCount>=20;state.bookSearch={query:q,page,total:serverTotal,hasMore,loading:false};const more=hasMore?`<button class="btn soft block" data-book-search-more type="button">더보기${serverTotal?` · ${merged.length}/${serverTotal}`:""}</button>`:"";box.innerHTML=(local.length?`<div class="eyebrow book-search-section-label is-existing">이미 내 서재에 있음</div>${local.map(s=>bookSearchRow(s,true)).join("")}`:"")+(merged.length?`<div class="eyebrow book-search-section-label is-results">검색 결과</div>${merged.map((x,i)=>bookSearchRow({...x,_index:i},false)).join("")}${more}`:`<div class="empty-card">검색 결과가 없습니다.</div>`)}
''')

click_anchor='const api=e.target.closest("[data-add-api-book]");if(api)return addApiBook(Number(api.dataset.addApiBook));'
click_repl='const more=e.target.closest("[data-book-search-more]");if(more)return runBookSearch({append:true});const api=e.target.closest("[data-add-api-book]");if(api)return addApiBook(Number(api.dataset.addApiBook));'
if click_anchor not in s: raise SystemExit('Reading click anchor missing')
s=s.replace(click_anchor,click_repl,1)
p.write_text(s,encoding='utf-8')

# Reading shell cache-bust only; no CSS changes.
for name in ['reading.html','reading-pwa-v7.js']:
    q=Path(name);t=q.read_text(encoding='utf-8');
    if '20260906-reading-v31' not in t: raise SystemExit(f'{name} v31 marker missing')
    q.write_text(t.replace('20260906-reading-v31','20260907-reading-v32').replace('독서의 정원 v31','독서의 정원 v32'),encoding='utf-8')
q=Path('sw.js');t=q.read_text(encoding='utf-8');
if 'garden-v31-reading-read-scope-v82' not in t: raise SystemExit('sw v31 cache marker missing')
t=t.replace('garden-v31-reading-read-scope-v82','garden-v32-book-search-pagination-v83',1).replace('v31: 독서의 정원 UI는 유지하고 Firestore 조회 범위를 책 데이터로 제한한다.','v32: 생각의 텃밭과 독서의 정원 도서 검색에 페이지형 더보기를 지원한다.',1)
q.write_text(t,encoding='utf-8')

# Static guards
fn=Path('functions/index.js').read_text(encoding='utf-8')
idx=Path('index.html').read_text(encoding='utf-8')
rd=Path('reading.js').read_text(encoding='utf-8')
assert 'req.query.page' in fn and 'searchYes24Books(query, yes24Key, page)' in fn and 'searchAladinBooks(query, aladinKey, page)' in fn
assert 'data-book-search-more' in idx and 'searchBooksCombined(q,{append:true})' in idx and 'startIndex=${startIndex}' in idx
assert 'data-book-search-more' in rd and 'runBookSearch({append:true})' in rd and '&page=${page}' in rd
assert 'if(thought){' in rd and 'else if(entry.linkedFragmentId)' in rd
print('PASS: page-aware backend and More buttons patched in both apps')

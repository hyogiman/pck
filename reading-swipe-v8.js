/* 독서의 정원 v8 — 첫 화면에서 좌우 스와이프로 읽는 중 책을 선택한다. */
const RG_SWIPE_DB='readingGarden_v1';
const RG_SWIPE_CURRENT='readingGarden_currentBook_v1';
const RG_GENRES=new Set(['소설','에세이','인문·철학','사회·정치','역사','심리','경제·경영','과학·기술','예술·문화','자기계발','육아·교육']);
let rgSwipeSnapshot=null;
let rgSwipeBusy=false;
let rgSwipeQueued=false;

const rgEsc=(v='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const rgSafe=v=>String(v??'').trim();

function rgRelativeDate(v){
  if(!v)return '';
  const d=new Date(v),today=new Date();
  if(Number.isNaN(d.getTime()))return '';
  today.setHours(0,0,0,0);d.setHours(0,0,0,0);
  const days=Math.round((today-d)/86400000);
  return days===0?'오늘':days===1?'어제':days>1?`${days}일 전`:'최근';
}

function rgReadSnapshot(){
  return new Promise(resolve=>{
    const req=indexedDB.open(RG_SWIPE_DB,1);
    req.onerror=()=>resolve(null);
    req.onupgradeneeded=()=>{};
    req.onsuccess=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('meta')){db.close();resolve(null);return}
      const tx=db.transaction('meta','readonly');
      const r=tx.objectStore('meta').get('snapshot');
      r.onsuccess=()=>{db.close();resolve(r.result||null)};
      r.onerror=()=>{db.close();resolve(null)};
    };
  });
}

function rgProfileFor(snapshot,id){
  const real=(snapshot?.readingProfiles||[]).find(p=>p.sourceId===id);
  if(real)return real;
  const s=(snapshot?.sources||[]).find(x=>x.id===id);
  if(!s)return null;
  return {
    sourceId:id,
    status:s.status==='done'?'completed':'reading',
    format:String(s.platform||'').includes('종이')?'paper':'ebook',
    currentLocator:'',lastReadAt:''
  };
}

function rgReadingBooks(snapshot){
  const books=(snapshot?.sources||[]).filter(s=>s.type==='book'&&rgProfileFor(snapshot,s.id)?.status==='reading');
  books.sort((a,b)=>{
    const pa=rgProfileFor(snapshot,a.id),pb=rgProfileFor(snapshot,b.id);
    return new Date(pb?.lastReadAt||b.updatedAt||b.createdAt||0)-new Date(pa?.lastReadAt||a.updatedAt||a.createdAt||0);
  });
  return books;
}

function rgCover(book){
  return book?.image
    ? `<img class="hero-cover" src="${rgEsc(book.image)}" alt="${rgEsc(book.title)} 표지" />`
    : `<div class="hero-cover placeholder">📕</div>`;
}

function rgGenre(book){return RG_GENRES.has(rgSafe(book?.primaryGenre))?rgSafe(book.primaryGenre):''}

function rgPagerHtml(index,total){
  if(total<2)return '';
  const maxDots=7;
  let dots='';
  if(total<=maxDots){
    dots=Array.from({length:total},(_,i)=>`<i class="${i===index?'on':''}" aria-hidden="true"></i>`).join('');
  }else{
    dots=`<span>${index+1} / ${total}</span>`;
  }
  return `<div class="rg-swipe-nav" aria-label="읽는 중 책 선택">
    <button class="rg-swipe-arrow" data-rg-swipe="prev" type="button" aria-label="이전 책">‹</button>
    <div class="rg-swipe-dots">${dots}</div>
    <button class="rg-swipe-arrow" data-rg-swipe="next" type="button" aria-label="다음 책">›</button>
  </div>`;
}

function rgRenderBook(book,index,total,direction=0){
  const hero=document.getElementById('readHero');if(!hero||!book)return;
  const p=rgProfileFor(rgSwipeSnapshot,book.id)||{};
  const genre=rgGenre(book);
  const isPhysical=p.format==='paper'||p.format==='pdf';
  const locator=rgSafe(p.currentLocator);
  const extra=isPhysical&&locator
    ? `<div class="hero-locator"><small>지난번 위치</small><strong>${rgEsc(locator)}</strong></div>`
    : p.lastReadAt
      ? `<div class="hero-locator"><small>최근 독서</small><strong style="font-size:1rem">${rgEsc(rgRelativeDate(p.lastReadAt))}</strong></div>`
      : '';
  const genreHtml=genre?`<span class="hero-service rg-home-genre rg-genre-badge">${rgEsc(genre)}</span>`:'';
  hero.innerHTML=`<div class="read-hero-inner rg-swipe-card ${direction>0?'rg-enter-right':direction<0?'rg-enter-left':''}" data-rg-swipe-ready>
    ${rgCover(book)}
    <h2 class="hero-title">${rgEsc(book.title)}</h2>
    <p class="hero-author">${rgEsc(book.creator||'')}</p>
    ${genreHtml}${extra}
    <button class="btn primary block start-btn" data-start-book="${rgEsc(book.id)}" type="button">▶ 읽기 시작</button>
    ${rgPagerHtml(index,total)}
    <button class="text-btn switch-book" data-open-book-picker type="button">다른 책 선택 ›</button>
  </div>`;
  requestAnimationFrame(()=>hero.querySelector('.rg-swipe-card')?.classList.remove('rg-enter-right','rg-enter-left'));
  rgBindHeroPointer();
}

async function rgRefreshSnapshot(){
  const snap=await rgReadSnapshot();
  if(snap)rgSwipeSnapshot=snap;
  return rgSwipeSnapshot;
}

async function rgSwitchBook(step){
  if(rgSwipeBusy)return;
  rgSwipeBusy=true;
  try{
    await rgRefreshSnapshot();
    const books=rgReadingBooks(rgSwipeSnapshot);
    if(books.length<2)return;
    const hero=document.getElementById('readHero');
    const currentId=hero?.querySelector('[data-start-book]')?.dataset.startBook||localStorage.getItem(RG_SWIPE_CURRENT)||books[0].id;
    let index=books.findIndex(b=>b.id===currentId);if(index<0)index=0;
    const next=(index+step+books.length)%books.length;
    const card=hero?.querySelector('.read-hero-inner');
    if(card){
      card.classList.add(step>0?'rg-exit-left':'rg-exit-right');
      await new Promise(r=>setTimeout(r,120));
    }
    const book=books[next];
    localStorage.setItem(RG_SWIPE_CURRENT,book.id);
    rgRenderBook(book,next,books.length,step>0?1:-1);
  }finally{rgSwipeBusy=false}
}

let rgPointer=null;
function rgBindHeroPointer(){
  const hero=document.getElementById('readHero');if(!hero||hero.dataset.rgSwipeBound==='1')return;
  hero.dataset.rgSwipeBound='1';
  hero.addEventListener('pointerdown',e=>{
    if(e.button!==undefined&&e.button!==0)return;
    if(e.target.closest('button,a,input,textarea,select,label'))return;
    if(!hero.querySelector('[data-start-book]'))return;
    rgPointer={id:e.pointerId,x:e.clientX,y:e.clientY,dragging:false};
    try{hero.setPointerCapture(e.pointerId)}catch{}
  });
  hero.addEventListener('pointermove',e=>{
    if(!rgPointer||e.pointerId!==rgPointer.id)return;
    const dx=e.clientX-rgPointer.x,dy=e.clientY-rgPointer.y;
    if(Math.abs(dx)>10&&Math.abs(dx)>Math.abs(dy)*1.15)rgPointer.dragging=true;
    if(!rgPointer.dragging)return;
    const card=hero.querySelector('.read-hero-inner');
    if(card){card.style.transition='none';card.style.transform=`translateX(${Math.max(-64,Math.min(64,dx*.28))}px)`;card.style.opacity=String(Math.max(.76,1-Math.abs(dx)/650))}
  });
  const finish=e=>{
    if(!rgPointer||e.pointerId!==rgPointer.id)return;
    const dx=e.clientX-rgPointer.x,dy=e.clientY-rgPointer.y,dragging=rgPointer.dragging;
    rgPointer=null;
    const card=hero.querySelector('.read-hero-inner');
    if(card){card.style.transition='';card.style.transform='';card.style.opacity=''}
    if(dragging&&Math.abs(dx)>=52&&Math.abs(dx)>Math.abs(dy)*1.15)rgSwitchBook(dx<0?1:-1);
  };
  hero.addEventListener('pointerup',finish);
  hero.addEventListener('pointercancel',e=>{if(rgPointer&&e.pointerId===rgPointer.id){rgPointer=null;const card=hero.querySelector('.read-hero-inner');if(card){card.style.transition='';card.style.transform='';card.style.opacity=''}}});
}

async function rgEnhanceHero(){
  const readView=document.getElementById('readView');
  if(!readView?.classList.contains('active'))return;
  const hero=document.getElementById('readHero');if(!hero)return;
  rgBindHeroPointer();
  const start=hero.querySelector('[data-start-book]');
  if(!start)return; // 진행 중 세션 화면은 건드리지 않는다.
  await rgRefreshSnapshot();
  const books=rgReadingBooks(rgSwipeSnapshot);if(!books.length)return;
  const desired=localStorage.getItem(RG_SWIPE_CURRENT)||start.dataset.startBook;
  let index=books.findIndex(b=>b.id===desired);if(index<0)index=books.findIndex(b=>b.id===start.dataset.startBook);if(index<0)index=0;
  const target=books[index];
  if(start.dataset.startBook!==target.id){rgRenderBook(target,index,books.length);return}
  const inner=hero.querySelector('.read-hero-inner');if(!inner)return;
  if(!inner.querySelector('.rg-swipe-nav')&&books.length>1){
    const switchBtn=inner.querySelector('[data-open-book-picker]');
    const wrap=document.createElement('div');wrap.innerHTML=rgPagerHtml(index,books.length);
    switchBtn?.insertAdjacentElement('beforebegin',wrap.firstElementChild);
  }
  inner.setAttribute('data-rg-swipe-ready','');
}

function rgScheduleEnhance(){
  if(rgSwipeQueued)return;rgSwipeQueued=true;
  requestAnimationFrame(()=>{rgSwipeQueued=false;rgEnhanceHero().catch(()=>{})});
}

document.addEventListener('click',e=>{
  const btn=e.target.closest('[data-rg-swipe]');
  if(btn){e.preventDefault();e.stopPropagation();rgSwitchBook(btn.dataset.rgSwipe==='next'?1:-1);return}
  if(e.target.closest('[data-view-target="read"]'))setTimeout(rgScheduleEnhance,0);
},true);

new MutationObserver(rgScheduleEnhance).observe(document.body,{subtree:true,childList:true});
window.addEventListener('storage',e=>{if(e.key===RG_SWIPE_CURRENT)rgScheduleEnhance()});
rgScheduleEnhance();

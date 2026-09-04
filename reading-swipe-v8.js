/* 독서의 정원 v9.1 — 첫 화면에서 책 영역만 좌우 스와이프. 읽기 시작 버튼 이하는 고정한다. */
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
  return {sourceId:id,status:s.status==='done'?'completed':'reading',format:String(s.platform||'').includes('종이')?'paper':'ebook',currentLocator:'',lastReadAt:''};
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
  let dots='';
  if(total<=7)dots=Array.from({length:total},(_,i)=>`<i class="${i===index?'on':''}" aria-hidden="true"></i>`).join('');
  else dots=`<span>${index+1} / ${total}</span>`;
  return `<div class="rg-swipe-nav" data-rg-index="${index}" data-rg-total="${total}" aria-label="읽는 중 책 선택">
    <button class="rg-swipe-arrow" data-rg-swipe="prev" type="button" aria-label="이전 책">‹</button>
    <div class="rg-swipe-dots">${dots}</div>
    <button class="rg-swipe-arrow" data-rg-swipe="next" type="button" aria-label="다음 책">›</button>
  </div>`;
}

function rgBookContentHtml(book,direction=0){
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
  return `<div class="rg-swipe-book-content ${direction>0?'rg-enter-right':direction<0?'rg-enter-left':''}" data-rg-book-content>
    ${rgCover(book)}
    <h2 class="hero-title">${rgEsc(book.title)}</h2>
    <p class="hero-author">${rgEsc(book.creator||'')}</p>
    ${genreHtml}${extra}
  </div>`;
}

function rgRenderBook(book,index,total,direction=0){
  const hero=document.getElementById('readHero');if(!hero||!book)return;
  hero.innerHTML=`<div class="read-hero-inner" data-rg-swipe-ready>
    <div class="rg-swipe-stage">${rgBookContentHtml(book,direction)}</div>
    <button class="btn primary block start-btn" data-start-book="${rgEsc(book.id)}" type="button">▶ 읽기 시작</button>
    ${rgPagerHtml(index,total)}
    <button class="text-btn switch-book" data-open-book-picker type="button">다른 책 선택 ›</button>
  </div>`;
  requestAnimationFrame(()=>hero.querySelector('[data-rg-book-content]')?.classList.remove('rg-enter-right','rg-enter-left'));
  rgBindHeroPointer();
}

function rgUpdateFixedControls(book,index,total){
  const hero=document.getElementById('readHero');if(!hero)return;
  const start=hero.querySelector('[data-start-book]');if(start&&start.dataset.startBook!==book.id)start.dataset.startBook=book.id;
  const nav=hero.querySelector('.rg-swipe-nav');
  if(total<2){nav?.remove();return}
  if(nav&&Number(nav.dataset.rgIndex)===index&&Number(nav.dataset.rgTotal)===total)return;
  const wrap=document.createElement('div');wrap.innerHTML=rgPagerHtml(index,total);
  if(nav)nav.replaceWith(wrap.firstElementChild);
  else hero.querySelector('[data-open-book-picker]')?.insertAdjacentElement('beforebegin',wrap.firstElementChild);
}

async function rgRefreshSnapshot(){const snap=await rgReadSnapshot();if(snap)rgSwipeSnapshot=snap;return rgSwipeSnapshot}

async function rgSwitchBook(step){
  if(rgSwipeBusy)return;
  rgSwipeBusy=true;
  try{
    await rgRefreshSnapshot();
    const books=rgReadingBooks(rgSwipeSnapshot);if(books.length<2)return;
    const hero=document.getElementById('readHero');
    const currentId=hero?.querySelector('[data-start-book]')?.dataset.startBook||localStorage.getItem(RG_SWIPE_CURRENT)||books[0].id;
    let index=books.findIndex(b=>b.id===currentId);if(index<0)index=0;
    const next=(index+step+books.length)%books.length;
    const current=hero?.querySelector('[data-rg-book-content]');
    if(current){
      current.classList.add(step>0?'rg-exit-left':'rg-exit-right');
      await new Promise(r=>setTimeout(r,115));
    }
    const book=books[next];
    localStorage.setItem(RG_SWIPE_CURRENT,book.id);
    const stage=hero?.querySelector('.rg-swipe-stage');
    if(!stage){rgRenderBook(book,next,books.length,step>0?1:-1);return}
    stage.innerHTML=rgBookContentHtml(book,step>0?1:-1);
    rgUpdateFixedControls(book,next,books.length);
    requestAnimationFrame(()=>stage.querySelector('[data-rg-book-content]')?.classList.remove('rg-enter-right','rg-enter-left'));
  }finally{rgSwipeBusy=false}
}

let rgPointer=null;
function rgBindHeroPointer(){
  const hero=document.getElementById('readHero');if(!hero||hero.dataset.rgSwipeBound==='1')return;
  hero.dataset.rgSwipeBound='1';
  hero.addEventListener('pointerdown',e=>{
    if(e.button!==undefined&&e.button!==0)return;
    const content=e.target.closest('[data-rg-book-content]');
    if(!content||!hero.querySelector('[data-start-book]'))return;
    rgPointer={id:e.pointerId,x:e.clientX,y:e.clientY,dragging:false};
    try{hero.setPointerCapture(e.pointerId)}catch{}
  });
  hero.addEventListener('pointermove',e=>{
    if(!rgPointer||e.pointerId!==rgPointer.id)return;
    const dx=e.clientX-rgPointer.x,dy=e.clientY-rgPointer.y;
    if(Math.abs(dx)>10&&Math.abs(dx)>Math.abs(dy)*1.15)rgPointer.dragging=true;
    if(!rgPointer.dragging)return;
    const content=hero.querySelector('[data-rg-book-content]');
    if(content){
      content.style.transition='none';
      content.style.transform=`translateX(${Math.max(-58,Math.min(58,dx*.28))}px)`;
      content.style.opacity=String(Math.max(.8,1-Math.abs(dx)/720));
    }
  });
  const reset=()=>{const content=hero.querySelector('[data-rg-book-content]');if(content){content.style.transition='';content.style.transform='';content.style.opacity=''}};
  const finish=e=>{
    if(!rgPointer||e.pointerId!==rgPointer.id)return;
    const dx=e.clientX-rgPointer.x,dy=e.clientY-rgPointer.y,dragging=rgPointer.dragging;
    rgPointer=null;reset();
    if(dragging&&Math.abs(dx)>=52&&Math.abs(dx)>Math.abs(dy)*1.15)rgSwitchBook(dx<0?1:-1);
  };
  hero.addEventListener('pointerup',finish);
  hero.addEventListener('pointercancel',e=>{if(rgPointer&&e.pointerId===rgPointer.id){rgPointer=null;reset()}});
}

async function rgEnhanceHero(){
  const readView=document.getElementById('readView');if(!readView?.classList.contains('active'))return;
  const hero=document.getElementById('readHero');if(!hero)return;
  rgBindHeroPointer();
  const start=hero.querySelector('[data-start-book]');if(!start)return;
  await rgRefreshSnapshot();
  const books=rgReadingBooks(rgSwipeSnapshot);if(!books.length)return;
  const desired=localStorage.getItem(RG_SWIPE_CURRENT)||start.dataset.startBook;
  let index=books.findIndex(b=>b.id===desired);if(index<0)index=books.findIndex(b=>b.id===start.dataset.startBook);if(index<0)index=0;
  const target=books[index];
  const inner=hero.querySelector('.read-hero-inner');
  const normalized=inner?.querySelector('[data-rg-book-content]');
  if(!normalized||start.dataset.startBook!==target.id){rgRenderBook(target,index,books.length);return}
  rgUpdateFixedControls(target,index,books.length);
  inner.setAttribute('data-rg-swipe-ready','');
}

function rgScheduleEnhance(){if(rgSwipeQueued)return;rgSwipeQueued=true;requestAnimationFrame(()=>{rgSwipeQueued=false;rgEnhanceHero().catch(()=>{})})}

document.addEventListener('click',e=>{
  const btn=e.target.closest('[data-rg-swipe]');
  if(btn){e.preventDefault();e.stopPropagation();rgSwitchBook(btn.dataset.rgSwipe==='next'?1:-1);return}
  if(e.target.closest('[data-view-target="read"]'))setTimeout(rgScheduleEnhance,0);
},true);
new MutationObserver(rgScheduleEnhance).observe(document.body,{subtree:true,childList:true});
window.addEventListener('storage',e=>{if(e.key===RG_SWIPE_CURRENT)rgScheduleEnhance()});
rgScheduleEnhance();

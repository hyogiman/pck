/* 독서의 정원 v6 — 배지 의미 정리: 첫 화면은 서비스가 아니라 장르를 보여준다. */
const GENRES=new Set(["소설","에세이","인문·철학","사회·정치","역사","심리","경제·경영","과학·기술","예술·문화","자기계발","육아·교육"]);

function cleanGenericServiceBadges(){
  document.querySelectorAll('.book-card-meta, .detail-tags').forEach(box=>{
    const tags=[...box.querySelectorAll(':scope > .mini-tag:not(.rg-genre-badge)')];
    for(const tag of tags){
      if((tag.textContent||'').trim()==='기타') tag.remove();
    }
  });
}

function syncHomeGenreBadge(){
  const hero=document.getElementById('readHero');
  const badge=hero?.querySelector('.hero-service');
  if(!hero||!badge)return;

  const sourceId=hero.querySelector('[data-start-book]')?.dataset.startBook||'';
  if(!sourceId){
    badge.style.display='none';
    badge.classList.remove('rg-home-genre');
    return;
  }

  let card=null;
  try{card=document.querySelector(`.book-card[data-open-book="${CSS.escape(sourceId)}"]`)}catch{}
  const genre=(card?.querySelector('.rg-genre-badge')?.textContent||'').trim();

  /* 캐시가 먼저 뜰 때 source.platform(과거 오염값: 출판사 등)이나 '기타'가 잠깐 보이지 않게 한다. */
  if(!GENRES.has(genre)){
    badge.style.display='none';
    badge.classList.remove('rg-home-genre');
    return;
  }

  badge.textContent=genre;
  badge.style.display='inline-flex';
  badge.classList.add('rg-home-genre','rg-genre-badge');
}

let queued=false;
function scheduleClean(){
  if(queued)return;
  queued=true;
  requestAnimationFrame(()=>{
    queued=false;
    cleanGenericServiceBadges();
    syncHomeGenreBadge();
  });
}

new MutationObserver(scheduleClean).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
document.addEventListener('click',scheduleClean,true);
scheduleClean();

/* 독서의 정원 v6 — 의미 없는 '기타' 서비스 배지는 숨긴다. */
function cleanGenericServiceBadges(){
  document.querySelectorAll('.book-card-meta, .detail-tags').forEach(box=>{
    const tags=[...box.querySelectorAll(':scope > .mini-tag:not(.rg-genre-badge)')];
    for(const tag of tags){
      if((tag.textContent||'').trim()==='기타') tag.remove();
    }
  });
}
let queued=false;
function scheduleClean(){
  if(queued)return;
  queued=true;
  requestAnimationFrame(()=>{queued=false;cleanGenericServiceBadges()});
}
new MutationObserver(scheduleClean).observe(document.body,{subtree:true,childList:true});
document.addEventListener('click',scheduleClean,true);
scheduleClean();

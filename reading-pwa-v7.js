/* 독서의 정원 v41 — PWA 런타임 + 모바일 뒤로가기 보호 */
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

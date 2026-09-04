/* 독서의 정원 v18 — 독립 PWA 설치 보조 + 안정성/모달 런타임 로드 */
let deferredInstallPrompt=null;
const READING_INSTALL_MARK='readingGarden_pwa_installed_v1';
const RG_SW_VERSION='20260904-reading-v18';

function rgToast(message,ms=2800){
  const el=document.getElementById('toast');
  if(!el)return;
  el.textContent=message;el.classList.add('show');
  clearTimeout(rgToast.t);rgToast.t=setTimeout(()=>el.classList.remove('show'),ms);
}

function inStandaloneContext(){
  return window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true;
}
function readingInstallKnown(){
  return localStorage.getItem(READING_INSTALL_MARK)==='1';
}

async function registerSharedWorker(){
  if(!('serviceWorker' in navigator))return;
  try{
    const reg=await navigator.serviceWorker.register(`./sw.js?v=${RG_SW_VERSION}`,{scope:'./',updateViaCache:'none'});
    await reg.update().catch(()=>{});
  }catch(err){console.warn('Reading Garden SW registration failed',err)}
}

function ensureInstallCard(){
  const modal=document.querySelector('#settingsDialog .modal');
  if(!modal||modal.querySelector('.rg-install-card'))return;
  const card=document.createElement('div');
  card.className='setting-card rg-install-card';
  card.innerHTML=`<b>독서의 정원 앱</b><p class="helper rg-install-copy"></p><button class="btn soft rg-install-btn" type="button">📲 앱으로 설치</button>`;
  const thoughtCard=[...modal.querySelectorAll('.setting-card')].find(x=>x.textContent.includes('Thought Garden'));
  (thoughtCard||modal.querySelector('.setting-card:last-of-type'))?.insertAdjacentElement('beforebegin',card);
  card.querySelector('.rg-install-btn').addEventListener('click',installApp);
  refreshInstallCard();
}

function setTextIfChanged(el,text){if(el&&el.textContent!==text)el.textContent=text}
function setDisabledIfChanged(el,value){if(el&&el.disabled!==value)el.disabled=value}

function refreshInstallCard(){
  const card=document.querySelector('.rg-install-card');if(!card)return;
  const copy=card.querySelector('.rg-install-copy'),btn=card.querySelector('.rg-install-btn');

  if(readingInstallKnown()){
    setTextIfChanged(copy,'독서의 정원을 별도 앱으로 설치한 기록이 있습니다.');
    setTextIfChanged(btn,'✓ 독서의 정원 설치됨');setDisabledIfChanged(btn,true);return;
  }

  if(inStandaloneContext()){
    setTextIfChanged(copy,'지금은 기존 설치 앱(예: 생각의 텃밭) 안에서 열린 상태일 수 있습니다. 독서의 정원은 별도로 설치할 수 있어요.');
    setTextIfChanged(btn,'↗ Chrome에서 설치하기');setDisabledIfChanged(btn,false);return;
  }

  setTextIfChanged(copy,'생각의 텃밭과 별개의 아이콘으로 설치할 수 있습니다. 데이터와 Firebase는 그대로 공유합니다.');
  setTextIfChanged(btn,deferredInstallPrompt?'📲 독서의 정원 설치':'📲 앱으로 설치');setDisabledIfChanged(btn,false);
}

function openBrowserInstallPage(){
  const url=new URL('./reading.html',location.href);
  url.searchParams.set('install','reading-garden');
  const opened=window.open(url.href,'_blank','noopener,noreferrer');
  rgToast(opened?'새 창에서 독서의 정원을 열었습니다. Chrome 메뉴의 ‘앱 설치’를 선택해주세요.':'Chrome에서 독서의 정원 주소를 직접 연 뒤 ‘앱 설치’를 선택해주세요.',4200);
}

async function installApp(){
  if(readingInstallKnown()){rgToast('독서의 정원은 이미 별도 앱으로 설치된 것으로 기록되어 있습니다.');return}
  if(inStandaloneContext()&&!deferredInstallPrompt){openBrowserInstallPage();return}
  if(deferredInstallPrompt){
    const prompt=deferredInstallPrompt;deferredInstallPrompt=null;
    try{
      await prompt.prompt();
      const choice=await prompt.userChoice;
      if(choice?.outcome==='accepted')localStorage.setItem(READING_INSTALL_MARK,'1');
    }catch{}
    refreshInstallCard();return;
  }
  rgToast('Chrome 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택해주세요.',3600);
}

window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();deferredInstallPrompt=event;ensureInstallCard();refreshInstallCard();
});
window.addEventListener('appinstalled',()=>{
  localStorage.setItem(READING_INSTALL_MARK,'1');
  deferredInstallPrompt=null;rgToast('독서의 정원을 별도 앱으로 설치했습니다. 🌿');refreshInstallCard();
});

/* 이전 버전은 document.body 전체를 MutationObserver로 감시하면서
   설정창이 열린 동안 refreshInstallCard()가 다시 DOM mutation을 만들고,
   그 mutation이 observer를 다시 깨우는 반복이 생길 수 있었다.
   정적 설정 DOM에서는 감시가 필요 없으므로 최초 1회 생성하고,
   설정 버튼을 누를 때만 상태를 갱신한다. */
ensureInstallCard();
document.getElementById('openSettings')?.addEventListener('click',()=>{
  ensureInstallCard();
  requestAnimationFrame(refreshInstallCard);
});

registerSharedWorker();

/* 필기 성능 최적화는 reading.js 원본에 통합했다.
   v18은 브라우저 기본 confirm/alert를 앱 모달로 통일하고,
   필사 미리보기의 base64 복제를 막아 태블릿 메모리 사용을 줄인다. */
import('./reading-dialogs-v18.js?v=20260904-reading-v18').catch(err=>console.warn('Reading Garden dialog runtime failed',err));
import('./reading-stability-v16.js?v=20260904-reading-v18').catch(err=>console.warn('Reading Garden stability runtime failed',err));

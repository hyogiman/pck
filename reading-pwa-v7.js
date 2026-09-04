/* 독서의 정원 v13 — 독립 PWA 설치 보조 + 업데이트 즉시 확인 */
let deferredInstallPrompt=null;
const READING_INSTALL_MARK='readingGarden_pwa_installed_v1';
const RG_SW_VERSION='20260904-reading-v13';

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

function refreshInstallCard(){
  const card=document.querySelector('.rg-install-card');if(!card)return;
  const copy=card.querySelector('.rg-install-copy'),btn=card.querySelector('.rg-install-btn');

  if(readingInstallKnown()){
    copy.textContent='독서의 정원을 별도 앱으로 설치한 기록이 있습니다.';
    btn.textContent='✓ 독서의 정원 설치됨';btn.disabled=true;return;
  }

  if(inStandaloneContext()){
    copy.textContent='지금은 기존 설치 앱(예: 생각의 텃밭) 안에서 열린 상태일 수 있습니다. 독서의 정원은 별도로 설치할 수 있어요.';
    btn.textContent='↗ Chrome에서 설치하기';btn.disabled=false;return;
  }

  copy.textContent='생각의 텃밭과 별개의 아이콘으로 설치할 수 있습니다. 데이터와 Firebase는 그대로 공유합니다.';
  btn.textContent=deferredInstallPrompt?'📲 독서의 정원 설치':'📲 앱으로 설치';btn.disabled=false;
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

const observer=new MutationObserver(()=>{ensureInstallCard();if(document.getElementById('settingsDialog')?.open)refreshInstallCard()});
observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','class']});

registerSharedWorker();ensureInstallCard();

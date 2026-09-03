/* 독서의 정원 v7 — 독립 PWA 설치 보조. 생각의 텃밭과 같은 SW를 공유하되 manifest ID는 분리한다. */
let deferredInstallPrompt=null;

function rgToast(message,ms=2800){
  const el=document.getElementById('toast');
  if(!el)return;
  el.textContent=message;el.classList.add('show');
  clearTimeout(rgToast.t);rgToast.t=setTimeout(()=>el.classList.remove('show'),ms);
}

function isStandalone(){
  return window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true;
}

async function registerSharedWorker(){
  if(!('serviceWorker' in navigator))return;
  try{await navigator.serviceWorker.register('./sw.js',{scope:'./'})}
  catch(err){console.warn('Reading Garden SW registration failed',err)}
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
  if(isStandalone()){
    copy.textContent='현재 독서의 정원 앱으로 실행 중입니다.';
    btn.textContent='✓ 앱으로 설치됨';btn.disabled=true;return;
  }
  copy.textContent='생각의 텃밭과 별개의 아이콘으로 홈 화면에 설치할 수 있습니다. 데이터와 Firebase는 그대로 공유합니다.';
  btn.textContent='📲 앱으로 설치';btn.disabled=false;
}

async function installApp(){
  if(isStandalone()){rgToast('이미 독서의 정원 앱으로 실행 중입니다.');return}
  if(deferredInstallPrompt){
    const prompt=deferredInstallPrompt;deferredInstallPrompt=null;
    try{await prompt.prompt();await prompt.userChoice}catch{}
    refreshInstallCard();return;
  }
  rgToast('Chrome 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택해주세요.',3600);
}

window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();deferredInstallPrompt=event;ensureInstallCard();refreshInstallCard();
});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;rgToast('독서의 정원을 앱으로 설치했습니다. 🌿');refreshInstallCard()});

const observer=new MutationObserver(()=>{ensureInstallCard();if(document.getElementById('settingsDialog')?.open)refreshInstallCard()});
observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','class']});

registerSharedWorker();ensureInstallCard();

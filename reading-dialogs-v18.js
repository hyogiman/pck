/* 독서의 정원 v18 — 기본 브라우저 confirm/alert 제거 + 필사 미리보기 메모리 절약 */
const RG_DIALOG_VERSION='20260904-reading-v18';
const approvals=[];
const replayClicks=new WeakSet();
const replayChanges=new WeakSet();
let activeDialogResolve=null;
let infoQueued=false;

function injectStyle(){
  if(document.getElementById('rgDialogV18Style'))return;
  const style=document.createElement('style');
  style.id='rgDialogV18Style';
  style.textContent=`
    #rgAppConfirmDialog{border:0;padding:0;background:transparent;color:var(--text)}
    #rgAppConfirmDialog::backdrop{background:rgba(49,39,31,.42);backdrop-filter:blur(2px)}
    #rgAppConfirmDialog .rg-confirm-card{
      width:min(430px,calc(100vw - 34px));margin:auto;padding:24px;border:1px solid rgba(118,86,61,.16);
      border-radius:22px;background:#fffaf2;box-shadow:0 24px 70px rgba(49,39,31,.24)
    }
    #rgAppConfirmDialog .rg-confirm-icon{width:42px;height:42px;display:grid;place-items:center;border-radius:50%;background:#f1e7d9;font-size:1.2rem;margin-bottom:13px}
    #rgAppConfirmDialog h3{margin:0 0 9px;font-family:var(--serif);font-size:1.16rem;color:var(--text)}
    #rgAppConfirmDialog .rg-confirm-message{margin:0;color:var(--muted);font-size:.79rem;line-height:1.65;white-space:pre-line}
    #rgAppConfirmDialog .rg-confirm-option{display:flex;gap:9px;align-items:flex-start;margin:17px 0 0;padding:12px;border-radius:13px;background:#f5eee4;font-size:.75rem;line-height:1.5;color:var(--text)}
    #rgAppConfirmDialog .rg-confirm-option input{margin-top:3px;accent-color:#76563d}
    #rgAppConfirmDialog .rg-confirm-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:21px}
    #rgAppConfirmDialog .rg-confirm-actions.one{grid-template-columns:1fr}
    #rgAppConfirmDialog .rg-confirm-danger{background:#8a4f43;color:white;border-color:#8a4f43}
    #rgAppConfirmDialog .rg-confirm-danger:hover,#rgAppConfirmDialog .rg-confirm-danger:active{background:#784238}

    /* 실제 이미지 썸네일을 다시 base64로 만들지 않는다. 상태 카드만 보여준다. */
    #rgHandwritingSavePreview img{display:none!important}
    #rgHandwritingSavePreview::before{
      content:'✍';width:46px;height:46px;flex:0 0 46px;display:grid;place-items:center;
      border-radius:12px;background:#fffaf2;border:1px solid rgba(118,86,61,.12);font-size:1.18rem
    }
  `;
  document.head.appendChild(style);
}

function ensureDialog(){
  let dialog=document.getElementById('rgAppConfirmDialog');
  if(dialog)return dialog;
  dialog=document.createElement('dialog');
  dialog.id='rgAppConfirmDialog';
  dialog.innerHTML=`<div class="rg-confirm-card">
    <div class="rg-confirm-icon">🌿</div>
    <h3 id="rgConfirmTitle">확인</h3>
    <p id="rgConfirmMessage" class="rg-confirm-message"></p>
    <label id="rgConfirmOption" class="rg-confirm-option" hidden><input id="rgConfirmCheckbox" type="checkbox"><span id="rgConfirmOptionText"></span></label>
    <div id="rgConfirmActions" class="rg-confirm-actions">
      <button id="rgConfirmCancel" class="btn" type="button">취소</button>
      <button id="rgConfirmOk" class="btn primary" type="button">확인</button>
    </div>
  </div>`;
  document.body.appendChild(dialog);
  const finish=value=>{
    if(!dialog.open)return;
    const resolve=activeDialogResolve;activeDialogResolve=null;
    dialog.close();
    if(resolve)resolve(value);
  };
  dialog.querySelector('#rgConfirmCancel').addEventListener('click',()=>finish({ok:false,checked:false}));
  dialog.querySelector('#rgConfirmOk').addEventListener('click',()=>finish({ok:true,checked:dialog.querySelector('#rgConfirmCheckbox').checked}));
  dialog.addEventListener('cancel',e=>{e.preventDefault();finish({ok:false,checked:false})});
  dialog.addEventListener('click',e=>{if(e.target===dialog)finish({ok:false,checked:false})});
  return dialog;
}

function ask({title='확인',message='',confirmText='확인',cancelText='취소',danger=false,infoOnly=false,checkboxText='',checkboxChecked=false}={}){
  injectStyle();
  const dialog=ensureDialog();
  if(dialog.open){try{dialog.close()}catch{};if(activeDialogResolve){activeDialogResolve({ok:false,checked:false});activeDialogResolve=null}}
  dialog.querySelector('#rgConfirmTitle').textContent=title;
  dialog.querySelector('#rgConfirmMessage').textContent=String(message||'');
  const option=dialog.querySelector('#rgConfirmOption'),check=dialog.querySelector('#rgConfirmCheckbox');
  option.hidden=!checkboxText;
  dialog.querySelector('#rgConfirmOptionText').textContent=checkboxText||'';
  check.checked=!!checkboxChecked;
  const cancel=dialog.querySelector('#rgConfirmCancel'),ok=dialog.querySelector('#rgConfirmOk'),actions=dialog.querySelector('#rgConfirmActions');
  cancel.textContent=cancelText;cancel.hidden=!!infoOnly;
  ok.textContent=confirmText;ok.classList.toggle('rg-confirm-danger',!!danger);
  actions.classList.toggle('one',!!infoOnly);
  return new Promise(resolve=>{activeDialogResolve=resolve;dialog.showModal()});
}

function pruneApprovals(){
  const now=Date.now();
  for(let i=approvals.length-1;i>=0;i--)if(approvals[i].expiresAt<now)approvals.splice(i,1);
}
function clearApprovals(prefix){
  for(let i=approvals.length-1;i>=0;i--)if(approvals[i].prefix===prefix)approvals.splice(i,1);
}
function authorize(prefix,value,ttl=90000){
  clearApprovals(prefix);
  approvals.push({prefix,value:!!value,expiresAt:Date.now()+ttl});
}

/* 기존 코드의 sync confirm 계약은 유지하되 네이티브 팝업은 절대 띄우지 않는다. */
window.confirm=function(message){
  const text=String(message||'');pruneApprovals();
  const i=approvals.findIndex(x=>text.startsWith(x.prefix));
  if(i>=0){const [{value}]=approvals.splice(i,1);return value}
  console.warn('Reading Garden blocked legacy confirm:',text);
  if(!infoQueued){
    infoQueued=true;
    queueMicrotask(async()=>{infoQueued=false;await ask({title:'확인이 필요한 작업',message:text||'이 작업은 확인이 필요합니다.',confirmText:'확인',infoOnly:true})});
  }
  return false;
};
window.alert=function(message){void ask({title:'알림',message:String(message||''),confirmText:'확인',infoOnly:true})};
window.rgConfirm=async options=>(await ask(options)).ok;

function replayClick(target){replayClicks.add(target);target.click()}

async function interceptClick(e){
  const target=e.target.closest('[data-rg-remove-book],.rg-session-delete,#deleteEntryBtn');
  if(!target)return;
  if(replayClicks.has(target)){replayClicks.delete(target);return}
  e.preventDefault();e.stopImmediatePropagation();

  if(target.matches('[data-rg-remove-book]')){
    const result=await ask({
      title:'서재에서 제거할까요?',
      message:'이 책은 독서의 정원 서재에서만 숨겨집니다.\n생각의 텃밭에 있는 책·생각과 지금까지의 독서 기록은 그대로 보존됩니다.',
      confirmText:'서재에서 제거',danger:true
    });
    if(!result.ok)return;
    authorize('이 책을 독서의 정원 서재에서 제거할까요?',true);
    replayClick(target);return;
  }

  if(target.matches('.rg-session-delete')){
    const card=target.closest('.timeline-session');
    const title=card?.querySelector('.timeline-session-head h3')?.textContent?.trim()||'이 독서시간';
    const meta=card?.querySelector('.timeline-session-head p')?.textContent?.trim()||'';
    const result=await ask({
      title:'독서시간 기록을 삭제할까요?',
      message:`${title}${meta?`\n${meta}`:''}\n\n이 세션 안에 남긴 문장·필사·생각은 삭제하지 않고 기록으로 남겨둡니다.`,
      confirmText:'독서시간 삭제',danger:true
    });
    if(!result.ok)return;
    authorize('이 독서시간 기록을 삭제할까요?',true,120000);
    replayClick(target);return;
  }

  if(target.id==='deleteEntryBtn'){
    clearApprovals('연결된 생각의 텃밭 생각도 함께 삭제할까요?');
    const result=await ask({
      title:'독서 기록을 삭제할까요?',
      message:'이 기록을 삭제하면 독서의 정원 타임라인에서 사라집니다.',
      confirmText:'기록 삭제',danger:true,
      checkboxText:'연결된 생각의 텃밭 생각도 함께 삭제'
    });
    if(!result.ok)return;
    authorize('이 독서 기록을 삭제할까요?',true,120000);
    authorize('연결된 생각의 텃밭 생각도 함께 삭제할까요?',result.checked,120000);
    replayClick(target);
  }
}

document.addEventListener('click',interceptClick,true);

document.addEventListener('change',async e=>{
  const input=e.target.closest('#jsonRestoreInput');if(!input)return;
  if(replayChanges.has(input)){replayChanges.delete(input);return}
  const file=input.files?.[0];if(!file)return;
  e.preventDefault();e.stopImmediatePropagation();
  const result=await ask({
    title:'백업을 복원할까요?',
    message:`${file.name}\n\n백업 데이터를 현재 독서의 정원에 합칩니다. 같은 ID의 기록은 백업 내용으로 갱신됩니다.`,
    confirmText:'백업 복원'
  });
  if(!result.ok){input.value='';return}
  authorize('백업 데이터를 현재 독서의 정원에 합칠까요?',true,120000);
  replayChanges.add(input);
  input.dispatchEvent(new Event('change',{bubbles:true}));
},true);

function installHandwritingMemoryGuard(){
  injectStyle();
  const canvas=document.getElementById('writingCanvas');if(!canvas)return;
  /* reading-detail-v12의 미리보기용 PNG/base64 복제를 차단한다. 저장 WebP Blob과는 무관하다. */
  try{Object.defineProperty(canvas,'toDataURL',{configurable:true,value:()=>''})}catch{}

  const releaseWhenConverted=()=>{
    let tries=0;
    const check=()=>{
      const layer=document.getElementById('handwritingLayer');
      const ocr=document.getElementById('ocrDialog');
      if((layer?.classList.contains('hidden')||ocr?.open)&&canvas.width>1){
        canvas.width=1;canvas.height=1;return;
      }
      if(++tries<50)setTimeout(check,40);
    };
    setTimeout(check,0);
  };
  document.addEventListener('click',e=>{
    if(e.target.closest('#convertHandwritingBtn'))releaseWhenConverted();
    if(e.target.closest('#confirmOcrBtn,#saveEntryBtn'))requestAnimationFrame(syncHandwritingCard);
  });
}

function setTextIfChanged(el,text){if(el&&el.textContent!==text)el.textContent=text}
function syncHandwritingCard(){
  const box=document.getElementById('rgHandwritingSavePreview');if(!box)return;
  box.querySelector('img')?.remove();
  const strong=box.querySelector('strong'),copy=box.querySelector('span');
  if(box.classList.contains('is-saving')){
    setTextIfChanged(strong,'필사 원본 보관 중…');
    setTextIfChanged(copy,'필사 이미지를 기기에 먼저 저장한 뒤 클라우드 동기화를 이어갑니다.');
  }else{
    setTextIfChanged(strong,'✍ 필사 원본 이미지 포함');
    setTextIfChanged(copy,'필사 원본 이미지만 저장합니다. 펜 획 데이터는 남기지 않습니다.');
  }
}

function installCardCleanup(){
  const record=document.querySelector('#recordDialog .sheet');if(!record)return;
  const observer=new MutationObserver(()=>syncHandwritingCard());
  observer.observe(record,{subtree:true,childList:true});
  syncHandwritingCard();
}

function boot(){injectStyle();ensureDialog();installHandwritingMemoryGuard();installCardCleanup()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();

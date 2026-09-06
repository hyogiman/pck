/* 독서의 정원 v26 — 앱 모달(confirm/alert 대체) + 타임라인 삭제 확인 정리 */
const RG_DIALOG_VERSION='20260906-reading-v29';
const approvals=[];
const replayClicks=new WeakSet();
const replayChanges=new WeakSet();
let activeDialogResolve=null;
let infoQueued=false;

function injectStyle(){}

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

  /* v26의 독립 독서기록 삭제 버튼은 세션 삭제 버튼과 같은 CSS class를 쓰므로 먼저 분기한다. */
  if(target.dataset.rgDeleteEntry){
    const card=target.closest('.timeline-session');
    const title=card?.querySelector('.timeline-session-head h3')?.textContent?.trim()||'이 기록';
    const hasLinkedThought=!!card?.querySelector('.entry-thought');
    clearApprovals('연결된 생각의 텃밭 생각도 함께 삭제할까요?');
    const result=await ask({
      title:'독서 기록을 삭제할까요?',
      message:`${title}\n\n이 기록을 삭제하면 독서의 정원 타임라인에서 사라집니다.`,
      confirmText:'기록 삭제',danger:true,
      checkboxText:hasLinkedThought?'연결된 생각의 텃밭 생각도 함께 삭제':''
    });
    if(!result.ok)return;
    authorize('이 독서 기록을 삭제할까요?',true,120000);
    authorize('연결된 생각의 텃밭 생각도 함께 삭제할까요?',hasLinkedThought&&result.checked,120000);
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
    const hasLinkedThought=!!document.getElementById('entryThought')?.value.trim();
    clearApprovals('연결된 생각의 텃밭 생각도 함께 삭제할까요?');
    const result=await ask({
      title:'독서 기록을 삭제할까요?',
      message:'이 기록을 삭제하면 독서의 정원 타임라인에서 사라집니다.',
      confirmText:'기록 삭제',danger:true,
      checkboxText:hasLinkedThought?'연결된 생각의 텃밭 생각도 함께 삭제':''
    });
    if(!result.ok)return;
    authorize('이 독서 기록을 삭제할까요?',true,120000);
    authorize('연결된 생각의 텃밭 생각도 함께 삭제할까요?',hasLinkedThought&&result.checked,120000);
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

function boot(){injectStyle();ensureDialog()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
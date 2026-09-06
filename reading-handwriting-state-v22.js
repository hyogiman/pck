/* 독서의 정원 v22 — 필사 첨부 상태를 이미지 미리보기와 분리해서 표시 */
const CARD_ID='rgHandwritingSavePreview';

function ensureCard(){
  const quote=document.getElementById('entryQuote');
  const field=quote?.closest('.field');
  if(!field)return null;
  let box=document.getElementById(CARD_ID);
  if(!box){
    box=document.createElement('div');
    box.id=CARD_ID;
    box.className='rg-handwriting-save-preview hidden';
    box.innerHTML='<div class="rg-hw-copy"><strong>✍ 필사 원본 첨부됨</strong><span>작성한 필사 이미지가 이 기록과 함께 저장됩니다.</span></div><i class="rg-hw-spinner" aria-hidden="true"></i>';
    field.insertAdjacentElement('afterend',box);
  }
  return box;
}

function showAttached(){
  const box=ensureCard();if(!box)return;
  box.querySelector('img')?.remove();
  box.classList.remove('hidden','is-saving');
  const strong=box.querySelector('strong'),copy=box.querySelector('span');
  if(strong)strong.textContent='✍ 필사 원본 첨부됨';
  if(copy)copy.textContent='작성한 필사 이미지가 이 기록과 함께 저장됩니다.';
  box.dataset.rgHandwritingAttached='1';
}

function hideAttached(){
  const box=document.getElementById(CARD_ID);if(!box)return;
  box.classList.add('hidden');
  box.classList.remove('is-saving');
  delete box.dataset.rgHandwritingAttached;
}

function boot(){
  ensureCard();

  /* OCR 값 유무와 관계없이 '확정' 자체가 필사 원본 첨부의 명확한 신호다.
     capture 단계에서 먼저 표시해, 빈 OCR 우회가 stopImmediatePropagation을 해도 상태가 남는다. */
  document.addEventListener('click',e=>{
    if(e.target.closest('#confirmOcrBtn')){
      showAttached();
      requestAnimationFrame(showAttached);
      return;
    }
    if(e.target.closest('#openHandwritingBtn,#redoHandwritingBtn')){
      hideAttached();
      return;
    }
  },true);

  const record=document.getElementById('recordDialog');
  record?.addEventListener('close',()=>{
    /* 저장 후 다음 새 기록에 이전 필사 표시가 남지 않게 한다. */
    setTimeout(()=>{
      if(!record.open)hideAttached();
    },0);
  });
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();

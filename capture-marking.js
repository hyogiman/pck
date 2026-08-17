/* Thought Garden · capture-time star/lens controls · 2026-08-17
   Reuses the existing fragment schema: starred + lenses[].
   No Firestore schema change is required. */
(function installCaptureMarking(){
  const dialog=document.getElementById("captureDialog");
  const text=document.getElementById("captureText");
  const fileInput=document.getElementById("captureFiles");
  const saveBtn=document.getElementById("saveCapture");
  if(!dialog||!text||!fileInput||!saveBtn||typeof persist!=="function"){
    console.warn("[capture-marking] required capture elements were not found; patch skipped.");
    return;
  }

  const lensDefs=(typeof LENSES!=="undefined"&&Array.isArray(LENSES))?LENSES:[
    {id:"question",e:"❓",label:"질문"},
    {id:"decision",e:"⚖️",label:"결정"},
    {id:"desire",e:"🧭",label:"욕망"},
    {id:"seed",e:"✨",label:"씨앗"}
  ];

  const marking={starred:false,lens:null,pending:null};

  const style=document.createElement("style");
  style.textContent=`
    .capture-thought-title-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px}
    .capture-thought-title-row>label{margin-bottom:0!important}
    #captureStarToggle{margin:-5px -4px -5px 0;flex:0 0 auto}
    .capture-marking-field{margin-top:14px!important;padding-top:2px}
    .capture-marking-field>label{margin-bottom:9px}
  `;
  document.head.appendChild(style);

  // 1) "내 생각" 라인의 맨 오른쪽에 별표를 둔다.
  const thoughtField=text.closest(".field");
  const thoughtLabel=thoughtField?.querySelector('label[for="captureText"]');
  let starBtn=document.getElementById("captureStarToggle");
  if(thoughtField&&thoughtLabel&&!starBtn){
    const row=document.createElement("div");
    row.className="capture-thought-title-row";
    thoughtLabel.parentNode.insertBefore(row,thoughtLabel);
    row.appendChild(thoughtLabel);
    starBtn=document.createElement("button");
    starBtn.className="star-toggle";
    starBtn.id="captureStarToggle";
    starBtn.type="button";
    starBtn.setAttribute("aria-label","중요한 생각으로 표시");
    starBtn.title="중요한 생각으로 표시";
    row.appendChild(starBtn);
  }

  // 2) 사진·음성·영상 첨부 영역 바로 아래에 기존 Lens 분류를 둔다.
  const attachmentField=fileInput.closest(".field");
  let lensField=document.getElementById("captureMarkingField");
  if(attachmentField&&!lensField){
    lensField=document.createElement("div");
    lensField.className="field capture-marking-field";
    lensField.id="captureMarkingField";
    lensField.innerHTML=`<label>이 생각을 조금 더 표시해둘까요? <span style="color:var(--muted);font-weight:500">(선택하지 않아도 됩니다)</span></label><div class="lens-row" id="captureLensRow"></div>`;
    attachmentField.insertAdjacentElement("afterend",lensField);
  }
  const lensRow=document.getElementById("captureLensRow");

  function render(){
    if(starBtn){
      starBtn.classList.toggle("on",marking.starred);
      starBtn.textContent=marking.starred?"★":"☆";
      starBtn.setAttribute("aria-pressed",marking.starred?"true":"false");
      starBtn.title=marking.starred?"중요 표시 해제":"중요한 생각으로 표시";
    }
    if(lensRow){
      lensRow.innerHTML=lensDefs.map(L=>`<button class="lens-chip ${marking.lens===L.id?"on":""}" data-capture-lens="${L.id}" type="button">${L.e} ${L.label}</button>`).join("");
    }
  }

  function reset(){
    marking.starred=false;
    marking.lens=null;
    marking.pending=null;
    render();
  }

  starBtn?.addEventListener("click",()=>{
    marking.starred=!marking.starred;
    render();
  });

  lensRow?.addEventListener("click",e=>{
    const btn=e.target.closest("[data-capture-lens]");
    if(!btn)return;
    const id=btn.dataset.captureLens;
    marking.lens=marking.lens===id?null:id;
    render();
  });

  // saveCapture의 기존 click listener보다 먼저 선택값을 고정한다.
  saveBtn.addEventListener("click",()=>{
    marking.pending={starred:marking.starred,lens:marking.lens,at:Date.now()};
  },true);

  // 기존 saveCapture가 fragment를 persist할 때 기존 데이터 필드에 선택값을 주입한다.
  const originalPersist=persist;
  persist=async function captureMarkingPersist(collectionName,obj,...rest){
    const p=marking.pending;
    const isCaptureFragment=collectionName==="fragments"&&p&&obj&&obj.id&&obj.type==="thought"&&(dialog.open||Date.now()-p.at<30000);
    if(isCaptureFragment){
      if(p.starred)obj.starred=true;
      if(p.lens)obj.lenses=[p.lens];
    }
    try{
      const result=await originalPersist(collectionName,obj,...rest);
      if(isCaptureFragment)marking.pending=null;
      return result;
    }catch(error){
      throw error;
    }
  };

  // 캡처창을 새로 열 때마다 선택값은 비워 둔다.
  const observer=new MutationObserver(()=>{
    if(dialog.hasAttribute("open"))reset();
  });
  observer.observe(dialog,{attributes:true,attributeFilter:["open"]});

  render();
  console.info("[capture-marking] capture star/lens controls enabled.");
})();

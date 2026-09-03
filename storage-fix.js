/* Thought Garden local cache policy · 2026-08-15
   Firebase/Firestore is the source of truth.
   When Firebase mode is active, localStorage keeps only a small 3-day emergency
   snapshot. In true local-only mode, the original full local save is preserved
   so user-authored data is never silently discarded. */
(function installThoughtGardenStorageFix(){
  if(typeof localSave!=="function"){
    console.warn("[storage-fix] localSave not found; patch skipped.");
    return;
  }

  const originalLocalSave=localSave;
  const LOCAL_KEY="thoughtGarden_v02";
  const RETENTION_DAYS=3;
  const RETENTION_MS=RETENTION_DAYS*86400000;

  function firebaseConnected(){
    try{return !!(state&&state.firebase&&state.firebase.connected&&state.firebase.db&&state.firebase.uid)}
    catch(_){return false}
  }

  function toMillis(value){
    if(!value)return NaN;
    try{
      if(typeof value.toDate==="function")return value.toDate().getTime();
      if(typeof value==="object"&&Number.isFinite(value.seconds))return value.seconds*1000;
      const ms=Date.parse(String(value));
      return Number.isFinite(ms)?ms:NaN;
    }catch(_){return NaN}
  }

  function recordMillis(record){
    if(!record)return NaN;
    for(const value of [record.updatedAt,record.deletedAt,record.createdAt,record.date]){
      const ms=toMillis(value);if(Number.isFinite(ms))return ms;
    }
    return NaN;
  }

  function isRecent(record){
    const ms=recordMillis(record);
    return Number.isFinite(ms)&&ms>=Date.now()-RETENTION_MS;
  }

  function derivedDataReplacer(key,value){
    // These fields are generated from cloud data and can be restored/recreated.
    if(key==="aiIndex"||key==="updatedAtServer"||/embedding/i.test(key))return undefined;
    return value;
  }

  function recentSnapshotFromState(){
    const all=typeof allFragments==="function"?allFragments():[];
    const fragments=(Array.isArray(all)?all:[]).filter(isRecent);

    // Keep only the small amount of metadata needed to make those recent records
    // readable while offline. Old Library/Thread/Studio data stays in Firestore.
    const sourceIds=new Set(fragments.map(f=>f&&f.sourceId).filter(Boolean));
    const threadIds=new Set();
    for(const f of fragments){
      for(const id of (Array.isArray(f&&f.threadIds)?f.threadIds:[]))if(id)threadIds.add(id);
    }

    const sources=(Array.isArray(state.sources)?state.sources:[])
      .filter(s=>sourceIds.has(s.id)||isRecent(s));
    const threads=(Array.isArray(state.threads)?state.threads:[])
      .filter(t=>threadIds.has(t.id)||isRecent(t));
    const projects=(Array.isArray(state.projects)?state.projects:[])
      .filter(isRecent);

    return {sources,fragments,threads,projects};
  }

  function stringifyRecentSnapshot(){
    return JSON.stringify(recentSnapshotFromState(),derivedDataReplacer);
  }

  function quotaError(error){
    return !!error&&(
      error.name==="QuotaExceededError"||
      error.name==="NS_ERROR_DOM_QUOTA_REACHED"||
      /quota|exceeded/i.test(String(error.message||""))
    );
  }

  localSave=function thoughtGardenSafeLocalSave(){
    // No Firebase account/data mode: localStorage is still the user's real storage,
    // so keep the original full-save behavior rather than pruning their only copy.
    if(!firebaseConnected())return originalLocalSave();

    const payload=stringifyRecentSnapshot();
    try{
      localStorage.setItem(LOCAL_KEY,payload);
      return true;
    }catch(error){
      if(!quotaError(error))throw error;

      // An old oversized snapshot may still be occupying the quota. It is only a
      // cache in Firebase mode, so remove it and retry once with the 3-day payload.
      try{
        localStorage.removeItem(LOCAL_KEY);
        localStorage.setItem(LOCAL_KEY,payload);
        console.info("[storage-fix] oversized legacy cache replaced with 3-day cache.");
        return true;
      }catch(retryError){
        console.warn("[storage-fix] cloud data is safe; local emergency cache could not be written.",retryError);
        return false;
      }
    }
  };

  // The injected patch can run while Firebase login is still starting. Once the
  // connection becomes active, rewrite the old full snapshot down to 3 days even
  // if the user does not immediately create/edit a record.
  [500,1500,4000].forEach(ms=>setTimeout(()=>{
    if(!firebaseConnected())return;
    try{localSave()}catch(error){console.warn("[storage-fix] cache compaction failed",error)}
  },ms));

  console.info(`[storage-fix] Firebase mode local cache limited to ${RETENTION_DAYS} days.`);
})();

/* Studio Gardener V2 usage UI compatibility patch · 2026-09-04
   The server already returns separate Luna/Terra/retrieval usage. Keep the
   existing operations screen for all other AI features, and replace only the
   legacy Studio Gardener block after the original renderer has finished. */
(function installStudioGardenerV2UsageUi(){
  if(typeof window.renderStudioUsage!=="function"){
    console.warn("[studio-v2-usage-ui] renderStudioUsage not found; patch skipped.");
    return;
  }

  const originalRenderStudioUsage=window.renderStudioUsage;
  const number=value=>{
    const n=Number(value);
    return Number.isFinite(n)&&n>0?n:0;
  };
  const tokenText=value=>number(value).toLocaleString("ko-KR");
  const money=value=>{
    const n=number(value);
    if(typeof window.formatUsdEstimate==="function")return window.formatUsdEstimate(n);
    if(n<=0)return "$0.0000";
    if(n<0.01)return "$"+n.toFixed(4);
    return "$"+n.toFixed(3);
  };
  const callTokenText=part=>{
    const calls=number(part?.calls);
    const input=number(part?.inputTokens);
    const cached=number(part?.cachedInputTokens);
    const output=number(part?.outputTokens);
    return `${calls}회 · 입력 ${tokenText(input)} · 출력 ${tokenText(output)}${cached?` · 캐시 ${tokenText(cached)}`:""}`;
  };

  function replaceGardenerBlock(grid,data){
    const titles=[...grid.querySelectorAll(".ai-usage-section-title")];
    const legacyTitle=titles.find(el=>/정원사/.test(String(el.textContent||"")));
    if(!legacyTitle)return;

    const studio=data?.studioV2||{};
    const planner=studio.planner||{};
    const generator=studio.generator||{};
    const used=number(data?.used);
    const limit=Math.max(30,number(data?.limit)||30);
    const remaining=Math.max(0,Number(data?.remaining??(limit-used))||0);
    const spoken=number(studio.spokenInterventions);
    const silent=number(studio.silentRuns);
    const gardenerCost=number(data?.gardenerEstimatedCostUsd??studio.generationEstimatedCostUsd);

    const html=`
      <span class="ai-usage-section-title">🌿 Studio 정원사 V2 · Luna → Terra</span>
      <span>오늘 분석</span><span class="value">${used} / ${limit}회</span>
      <span>남은 분석</span><span class="value">${remaining}회</span>
      <span>개입 결과</span><span class="value">질문·제안 ${spoken}회 · 침묵 ${silent}회</span>
      <span>Luna 판단</span><span class="value">${callTokenText(planner)}</span>
      <span>Luna 추정 비용</span><span class="value">약 ${money(planner.estimatedCostUsd)}</span>
      <span>Terra 표현</span><span class="value">${callTokenText(generator)}</span>
      <span>Terra 추정 비용</span><span class="value">약 ${money(generator.estimatedCostUsd)}</span>
      <span>정원사 생성비 합계</span><span class="value">약 ${money(gardenerCost)}</span>`;

    legacyTitle.insertAdjacentHTML("beforebegin",html);

    let node=legacyTitle;
    while(node){
      const next=node.nextElementSibling;
      node.remove();
      if(!next||next.classList?.contains("ai-usage-section-title"))break;
      node=next;
    }
  }

  function addGardenerRetrievalRow(grid,data){
    const studio=data?.studioV2||{};
    const retrieval=studio.retrieval||{};
    const tokens=number(data?.studioGardenerRetrievalEmbeddingTokens??retrieval.embeddingTokens);
    const count=number(data?.studioGardenerRetrievalEmbeddingCount??retrieval.embeddingCount);

    const labels=[...grid.querySelectorAll("span:not(.value)")];
    const materialLabel=labels.find(el=>String(el.textContent||"").trim()==="Studio 재료 검색");
    if(!materialLabel)return;

    const materialValue=materialLabel.nextElementSibling;
    const label=document.createElement("span");
    const value=document.createElement("span");
    label.textContent="정원사 교차 검색";
    value.className="value";
    value.textContent=`${tokenText(tokens)} tokens${count?` · ${count}건`:""}`;

    if(materialValue){
      materialValue.insertAdjacentElement("afterend",value);
      materialValue.insertAdjacentElement("afterend",label);
    }
  }

  function prependGardenerExplanation(note){
    if(!note)return;
    note.insertAdjacentHTML("afterbegin",
      `<b>Studio 정원사 V2</b>는 먼저 의미 검색으로 관련 생각을 찾고, Luna가 지금 개입할 가치와 방식을 판단합니다. Luna가 침묵을 선택하면 Terra는 호출하지 않습니다. Terra는 실제로 보여줄 질문이나 다듬기 제안만 표현합니다. 같은 글 맥락의 서버 캐시가 있으면 의미 검색·Luna·Terra를 다시 호출하지 않습니다.<br><br>`
    );
  }

  window.renderStudioUsage=function renderStudioUsageV2(data){
    originalRenderStudioUsage(data);
    const grid=document.getElementById("studioUsageGrid");
    const note=document.getElementById("studioUsageNote");
    if(!grid)return;

    replaceGardenerBlock(grid,data);
    addGardenerRetrievalRow(grid,data);
    prependGardenerExplanation(note);
  };

  console.info("[studio-v2-usage-ui] Luna/Terra usage breakdown enabled.");
})();

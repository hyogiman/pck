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

/* AI V2 operations usage UI · 2026-09-04
   Keep the legacy renderer as a compatibility base, then replace only the
   sections whose production engines have moved to GPT-5.6 V2. */
(function installAiV2OperationsUsageUi(){
  if(typeof window.renderStudioUsage!=="function"){
    console.warn("[ai-v2-usage-ui] renderStudioUsage not found; patch skipped.");
    return;
  }

  const originalRenderStudioUsage=window.renderStudioUsage;

  const number=value=>{
    const n=Number(value);
    return Number.isFinite(n)&&n>0?n:0;
  };

  const tokenText=value=>
    number(value)
      .toLocaleString("ko-KR");

  const money=value=>{
    const n=number(value);

    if(typeof window.formatUsdEstimate==="function"){
      return window.formatUsdEstimate(n);
    }

    if(n<=0)return "$0.0000";
    if(n<0.01)return "$"+n.toFixed(4);
    return "$"+n.toFixed(3);
  };

  const routeText=part=>{
    const calls=number(part?.calls);
    const input=number(part?.inputTokens);
    const cached=number(part?.cachedInputTokens);
    const output=number(part?.outputTokens);

    return `${calls}회 · 입력 ${tokenText(input)} · 출력 ${tokenText(output)}${cached?` · 캐시 ${tokenText(cached)}`:""}`;
  };

  function replaceSection(
    grid,
    matcher,
    html
  ){
    const titles=[
      ...grid.querySelectorAll(
        ".ai-usage-section-title"
      )
    ];

    const title=
      titles.find(
        el=>
          matcher.test(
            String(
              el.textContent||""
            )
          )
      );

    if(!title)return;

    title.insertAdjacentHTML(
      "beforebegin",
      html
    );

    let node=title;

    while(node){
      const next=
        node.nextElementSibling;

      node.remove();

      if(
        !next ||
        next.classList
          ?.contains(
            "ai-usage-section-title"
          )
      ){
        break;
      }

      node=next;
    }
  }

  function gardenerHtml(data){
    const studio=data?.studioV2||{};
    const luna=studio.planner||{};
    const terra=studio.generator||{};

    const used=number(data?.used);
    const limit=Math.max(30,number(data?.limit)||30);
    const remaining=Math.max(0,Number(data?.remaining??(limit-used))||0);

    return `
      <span class="ai-usage-section-title">🌿 Studio 정원사 V2 · Luna → Terra</span>
      <span>오늘 분석</span><span class="value">${used} / ${limit}회</span>
      <span>남은 분석</span><span class="value">${remaining}회</span>
      <span>개입 결과</span><span class="value">질문·제안 ${number(studio.spokenInterventions)}회 · 침묵 ${number(studio.silentRuns)}회</span>
      <span>Luna 판단</span><span class="value">${routeText(luna)}</span>
      <span>Luna 비용</span><span class="value">약 ${money(luna.estimatedCostUsd)}</span>
      <span>Terra 표현</span><span class="value">${routeText(terra)}</span>
      <span>Terra 비용</span><span class="value">약 ${money(terra.estimatedCostUsd)}</span>
      <span>V2 생성비 합계</span><span class="value">약 ${money(studio.generationEstimatedCostUsd)}</span>`;
  }

  function bloomingHtml(data){
    const v2=data?.bloomingV2||{};
    const luna=v2.luna||{};
    const terra=v2.terra||{};

    const legacyCount=number(data?.bloomingInterviewQuestions);
    const legacyCost=number(data?.bloomingInterviewEstimatedCostUsd);

    return `
      <span class="ai-usage-section-title">🎙️ Blooming Interview V2 · Luna → Terra</span>
      <span>V2 준비 분석</span><span class="value">${number(v2.runs)}회</span>
      <span>준비된 질문</span><span class="value">${number(v2.preparedQuestions)}개</span>
      <span>Luna 후보 선별</span><span class="value">${routeText(luna)}</span>
      <span>Luna 비용</span><span class="value">약 ${money(luna.estimatedCostUsd)}</span>
      <span>Terra 질문 생성</span><span class="value">${routeText(terra)}</span>
      <span>Terra 비용</span><span class="value">약 ${money(terra.estimatedCostUsd)}</span>
      <span>V2 비용 합계</span><span class="value">약 ${money(v2.totalEstimatedCostUsd)}</span>
      ${legacyCount||legacyCost
        ?`<span>이전 GPT-5.4 mini 기록</span><span class="value">${legacyCount}회 · 약 ${money(legacyCost)}</span>`
        :""
      }`;
  }

  function betweenHtml(data){
    const v2=data?.betweenThoughtsV2||{};
    const luna=v2.luna||{};
    const terra=v2.terra||{};

    const legacyCount=number(data?.betweenThoughtsCurations);
    const legacyCost=number(data?.betweenThoughtsEstimatedCostUsd);

    return `
      <span class="ai-usage-section-title">🌿 두 생각 사이 V2 · Luna → Terra → Luna</span>
      <span>후보 묶음 요청</span><span class="value">${number(v2.curationAttempts)} / 4회</span>
      <span>질문 요청</span><span class="value">${number(v2.questionAttempts)} / 12회</span>
      <span>완료</span><span class="value">큐레이션 ${number(v2.curations)}회 · 질문 ${number(v2.questions)}개</span>
      <span>Luna 탐색·검증·판정</span><span class="value">${routeText(luna)}</span>
      <span>Luna 비용</span><span class="value">약 ${money(luna.estimatedCostUsd)}</span>
      <span>Terra 질문 생성</span><span class="value">${routeText(terra)}</span>
      <span>Terra 비용</span><span class="value">약 ${money(terra.estimatedCostUsd)}</span>
      <span>V2 비용 합계</span><span class="value">약 ${money(v2.totalEstimatedCostUsd)}</span>
      ${number(v2.unclassifiedTotalTokens)
        ?`<span>분리 계측 전 V2 기록</span><span class="value">${tokenText(v2.unclassifiedTotalTokens)} tokens · 모델별 비용 분리 불가</span>`
        :""
      }
      ${legacyCount||legacyCost
        ?`<span>이전 GPT-5.4 mini 기록</span><span class="value">${legacyCount}회 · 약 ${money(legacyCost)}</span>`
        :""
      }`;
  }

  function addGardenerRetrievalRow(
    grid,
    data
  ){
    const studio=data?.studioV2||{};
    const retrieval=studio.retrieval||{};

    const tokens=
      number(
        data?.studioGardenerRetrievalEmbeddingTokens ??
        retrieval.embeddingTokens
      );

    const count=
      number(
        data?.studioGardenerRetrievalEmbeddingCount ??
        retrieval.embeddingCount
      );

    const labels=[
      ...grid.querySelectorAll(
        "span:not(.value)"
      )
    ];

    const materialLabel=
      labels.find(
        el=>
          String(
            el.textContent||""
          ).trim()===
          "Studio 재료 검색"
      );

    if(!materialLabel)return;

    // 중복 삽입 방지
    if(
      labels.some(
        el=>
          String(
            el.textContent||""
          ).trim()===
          "정원사 교차 검색"
      )
    ){
      return;
    }

    const materialValue=
      materialLabel
        .nextElementSibling;

    if(!materialValue)return;

    const label=
      document.createElement(
        "span"
      );

    const value=
      document.createElement(
        "span"
      );

    label.textContent=
      "정원사 교차 검색";

    value.className=
      "value";

    value.textContent=
      `${tokenText(tokens)} tokens${count?` · ${count}건`:""}`;

    materialValue
      .insertAdjacentElement(
        "afterend",
        value
      );

    materialValue
      .insertAdjacentElement(
        "afterend",
        label
      );
  }

  function renderExplanation(
    note
  ){
    if(!note)return;

    note.innerHTML=
      `<b>현재 production 모델 구조</b><br>
      Studio 정원사는 Luna가 개입 여부를 판단하고 Terra가 실제 질문·다듬기 제안을 표현합니다.
      Blooming Interview는 Luna가 과거 생각 후보를 선별한 뒤 Terra가 질문을 만듭니다.
      두 생각 사이는 Luna가 후보 탐색·원문 검증·최종 판정을 맡고 Terra가 실제 질문을 생성합니다.
      다층 생각 색인과 글의 갈래 찾기는 현재 production에서 아직 GPT-5.4 mini를 사용합니다.
      의미 검색은 text-embedding-3-small을 사용합니다.<br><br>
      실제 청구액이 아니라 OpenAI 응답의 실제 토큰 사용량에 각 모델의 현재 단가를 곱한 추정값입니다.
      같은 맥락의 서버 캐시가 사용되거나 AI가 호출되지 않은 단계는 토큰이 추가되지 않습니다.`;
  }

  window.renderStudioUsage=
    function renderStudioUsageV2(
      data
    ){
      originalRenderStudioUsage(
        data
      );

      const grid=
        document.getElementById(
          "studioUsageGrid"
        );

      const note=
        document.getElementById(
          "studioUsageNote"
        );

      if(!grid)return;

      replaceSection(
        grid,
        /정원사/,
        gardenerHtml(data)
      );

      replaceSection(
        grid,
        /Blooming Interview/,
        bloomingHtml(data)
      );

      replaceSection(
        grid,
        /두 생각 사이/,
        betweenHtml(data)
      );

      // 다층 생각 색인과 글의 갈래 찾기는
      // 실제 production이 아직 GPT-5.4 mini이므로
      // 기존 renderer의 정확한 라벨을 그대로 둔다.

      addGardenerRetrievalRow(
        grid,
        data
      );

      renderExplanation(
        note
      );
    };

  console.info(
    "[ai-v2-usage-ui] full production model breakdown enabled."
  );
})();

/* Fragment badge runtime v75 · 2026-09-04
   Only 발견/고민/방향/시도 are selectable now. Historical badges remain
   readable on existing Fragments without being mixed into the current lens set. */
(function installFragmentBadgeV75(){
  if(window.__fragmentBadgesV75Installed)return;
  if(typeof LENSES==="undefined"||typeof effectiveLens!=="function"){
    console.warn("[fragment-badges-v75] lens runtime not found; patch skipped.");
    return;
  }
  window.__fragmentBadgesV75Installed=true;

  const CURRENT_LENSES=[
    {id:"discovery",e:"👀",label:"발견"},
    {id:"concern",e:"💭",label:"고민"},
    {id:"direction",e:"🧭",label:"방향"},
    {id:"experiment",e:"🧪",label:"시도"}
  ];
  const LEGACY_LENSES=[
    {id:"question",e:"❓",label:"질문"},
    {id:"decision",e:"⚖️",label:"결정"},
    {id:"desire",e:"🧭",label:"욕망"},
    {id:"seed",e:"✨",label:"씨앗"}
  ];
  const BADGE_BY_ID=new Map([...CURRENT_LENSES,...LEGACY_LENSES].map(x=>[x.id,x]));
  const LEGACY_IDS=new Set(LEGACY_LENSES.map(x=>x.id));

  // The app-wide selectable lens source contains current choices only.
  LENSES.splice(0,LENSES.length,...CURRENT_LENSES);

  lensBadge=function lensBadgeV75(f){
    const id=effectiveLens(f);if(!id)return "";
    const lens=BADGE_BY_ID.get(id);if(!lens)return "";
    return `<span class="lens-badge">${lens.e} ${lens.label}</span>`;
  };

  const filter=document.getElementById("fragLens");
  if(filter){
    filter.innerHTML=`
      <option value="all">전체 표시</option>
      <option value="discovery">👀 발견</option>
      <option value="concern">💭 고민</option>
      <option value="direction">🧭 방향</option>
      <option value="experiment">🧪 시도</option>`;
    filter.value="all";
  }

  const editLensRow=document.getElementById("editLensRow");
  const editLensLabel=editLensRow?.closest(".field")?.querySelector("label");
  if(editLensLabel){
    editLensLabel.innerHTML=`이 생각은 지금 내게 어떤 역할을 하나요? <span style="color:var(--muted);font-weight:500">(선택하지 않아도 됩니다)</span>`;
  }

  renderEditLens=function renderEditLensV75(){
    const box=$("editLensRow");if(!box)return;
    const legacy=LEGACY_IDS.has(state.editLens)?BADGE_BY_ID.get(state.editLens):null;
    const legacyNotice=legacy
      ?`<div class="helper" style="width:100%;margin:0 0 2px">기존 표시: ${legacy.e} ${legacy.label} · 그대로 유지됩니다. 새 뱃지를 고를 때만 바뀝니다.</div>`
      :"";
    box.innerHTML=legacyNotice+CURRENT_LENSES.map(L=>`<button class="lens-chip ${state.editLens===L.id?"on":""}" data-lens-pick="${L.id}" type="button">${L.e} ${L.label}</button>`).join("");
  };

  // Seed is historical metadata only, never a Studio material mode now.
  const oldStyle=document.getElementById("fragment-badges-v74-style");
  if(oldStyle)oldStyle.remove();
  let style=document.getElementById("fragment-badges-v75-style");
  if(!style){
    style=document.createElement("style");
    style.id="fragment-badges-v75-style";
    document.head.appendChild(style);
  }
  style.textContent='[data-pool-mode="seed"],[data-attach-mode="seed"]{display:none!important}';

  if(typeof currentPool==="function"){
    const baseCurrentPool=currentPool;
    currentPool=function currentPoolV75(){
      if(state.poolMode==="seed")state.poolMode=state.poolThread?"thread":"all";
      return baseCurrentPool();
    };
  }

  console.info("[fragment-badges-v75] current badges only; legacy display compatibility enabled.");
})();

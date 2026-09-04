from pathlib import Path

index_path=Path('index.html')
sw_path=Path('sw.js')
capture_patch_path=Path('capture-marking.js')

index=index_path.read_text(encoding='utf-8')
sw=sw_path.read_text(encoding='utf-8')


def replace_once(text, old, new, label):
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    return text.replace(old,new,1)

# 1) Keep all capture/badge styling in index.html instead of injecting a <style> from JS.
css_anchor='''    .lens-badge{font-size:.66rem;color:var(--accent);background:var(--accent2);border-radius:999px;padding:2px 8px;font-weight:700;flex:0 0 auto}\n    .lens-legacy-note{width:100%;margin:0 0 2px}\n'''
css_new=css_anchor+'''    .capture-thought-title-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:7px}\n    .capture-thought-title-row>label{margin-bottom:0!important}\n    #captureStarToggle{margin:-5px -4px -5px 0;flex:0 0 auto}\n    .capture-marking-field{margin-top:14px!important;padding-top:2px}\n    .capture-marking-field>label{margin-bottom:9px}\n'''
index=replace_once(index,css_anchor,css_new,'capture marking css anchor')

# 2) Make the capture star control real source HTML.
old_thought='''    <div class="field">\n      <label for="captureText">내 생각</label>\n      <textarea class="textarea capture-main" id="captureText" placeholder="떠오른 그대로 적어보세요. 한 줄이어도 충분합니다."></textarea>\n    </div>'''
new_thought='''    <div class="field">\n      <div class="capture-thought-title-row">\n        <label for="captureText">내 생각</label>\n        <button class="star-toggle" id="captureStarToggle" type="button" aria-label="중요한 생각으로 표시" aria-pressed="false" title="중요한 생각으로 표시">☆</button>\n      </div>\n      <textarea class="textarea capture-main" id="captureText" placeholder="떠오른 그대로 적어보세요. 한 줄이어도 충분합니다."></textarea>\n    </div>'''
index=replace_once(index,old_thought,new_thought,'capture thought field')

# 3) Remove the helper that the runtime patch used to delete, and source-own the badge picker markup.
old_attachment='''    <div class="field">\n      <label>사진 · 음성 · 영상 · 기록 날짜 <span style="color:var(--muted);font-weight:500">(선택)</span></label>\n      <div class="capture-extra-row">\n        <label class="btn file-pick">📎 파일 추가<input id="captureFiles" type="file" accept="image/*,audio/*,video/*" multiple></label>\n        <span class="date-inline">🗓 <input class="input date-input" type="date" id="captureDate" title="지난 날짜로 기록하려면 바꿔주세요"></span>\n      </div>\n      <div class="selected-files" id="captureFileList"></div>\n      <div class="helper">Firebase Storage가 연결된 경우에만 파일이 실제로 저장됩니다.</div>\n    </div>'''
new_attachment='''    <div class="field">\n      <label>사진 · 음성 · 영상 · 기록 날짜 <span style="color:var(--muted);font-weight:500">(선택)</span></label>\n      <div class="capture-extra-row">\n        <label class="btn file-pick">📎 파일 추가<input id="captureFiles" type="file" accept="image/*,audio/*,video/*" multiple></label>\n        <span class="date-inline">🗓 <input class="input date-input" type="date" id="captureDate" title="지난 날짜로 기록하려면 바꿔주세요"></span>\n      </div>\n      <div class="selected-files" id="captureFileList"></div>\n    </div>\n\n    <div class="field capture-marking-field" id="captureMarkingField">\n      <label>이 생각은 지금 내게 어떤 역할을 하나요? <span style="color:var(--muted);font-weight:500">(선택하지 않아도 됩니다)</span></label>\n      <div class="lens-row" id="captureLensRow"></div>\n    </div>'''
index=replace_once(index,old_attachment,new_attachment,'capture attachment and badge field')

# 4) Move capture state/rendering into the main app, next to the one canonical badge taxonomy.
js_anchor='''const LEGACY_LENS_IDS=new Set(LEGACY_LENSES.map(L=>L.id));\n'''
js_new=js_anchor+'''\nconst captureMarking={starred:false,lens:null};\nfunction renderCaptureMarking(){\n  const star=$("captureStarToggle"),row=$("captureLensRow");\n  if(star){\n    star.classList.toggle("on",captureMarking.starred);\n    star.textContent=captureMarking.starred?"★":"☆";\n    star.setAttribute("aria-pressed",String(captureMarking.starred));\n    star.title=captureMarking.starred?"중요 표시 해제":"중요한 생각으로 표시";\n  }\n  if(row){\n    row.innerHTML=LENSES.map(L=>`<button class="lens-chip ${captureMarking.lens===L.id?"on":""}" data-capture-lens="${L.id}" type="button">${L.e} ${L.label}</button>`).join("");\n  }\n}\nfunction resetCaptureMarking(){\n  captureMarking.starred=false;\n  captureMarking.lens=null;\n  renderCaptureMarking();\n}\n'''
index=replace_once(index,js_anchor,js_new,'capture marking state')

# 5) Reset the optional marking controls whenever Capture opens.
open_anchor='''  $("captureDate").value=today();\n  if(!prefill){'''
open_new='''  $("captureDate").value=today();\n  resetCaptureMarking();\n  if(!prefill){'''
index=replace_once(index,open_anchor,open_new,'capture reset on open')

# 6) Save star/lens directly in saveCapture(). No persist() monkey-patching.
save_anchor='''    ...(ctx&&ctx.kind==="weekly-theme"?{gardenReportTheme:ctx.theme||"",gardenReportWeek:ctx.weekKey||""}:{}),\n    threadIds:(ctx&&(ctx.kind==="thread"||ctx.kind==="thread-child")&&ctx.threadId)?[ctx.threadId]:[],attachments:[],date:$("captureDate").value||today(),createdAt,updatedAt:createdAt\n'''
save_new='''    ...(ctx&&ctx.kind==="weekly-theme"?{gardenReportTheme:ctx.theme||"",gardenReportWeek:ctx.weekKey||""}:{}),\n    ...(captureMarking.starred?{starred:true}:{}),\n    ...(captureMarking.lens?{lenses:[captureMarking.lens]}:{}),\n    threadIds:(ctx&&(ctx.kind==="thread"||ctx.kind==="thread-child")&&ctx.threadId)?[ctx.threadId]:[],attachments:[],date:$("captureDate").value||today(),createdAt,updatedAt:createdAt\n'''
index=replace_once(index,save_anchor,save_new,'saveCapture marking fields')

# 7) Wire the source-owned controls directly.
event_anchor='''$("saveCapture").addEventListener("click",saveCapture);$("saveBloomingReflection").addEventListener("click",saveBloomingReflection);["captureText","captureExternal","captureLocator"].forEach(id=>$(id).addEventListener("input",()=>saveCaptureDraft()));$("captureDate").addEventListener("change",()=>saveCaptureDraft());$("saveSource").addEventListener("click",saveSource);$("saveThread").addEventListener("click",saveThread);$("saveProject").addEventListener("click",saveProject);\n'''
event_new=event_anchor+'''$("captureStarToggle").addEventListener("click",()=>{captureMarking.starred=!captureMarking.starred;renderCaptureMarking()});\n$("captureLensRow").addEventListener("click",e=>{const btn=e.target.closest("[data-capture-lens]");if(!btn)return;const id=btn.dataset.captureLens;captureMarking.lens=captureMarking.lens===id?null:id;renderCaptureMarking()});\n'''
index=replace_once(index,event_anchor,event_new,'capture marking events')

# 8) Service worker must not inject or specially route capture-marking.js anymore.
sw=replace_once(sw,'v24: Fragment badge v77 source refactor 반영을 위해 캐시를 갱신한다.','v25: Capture marking을 본체로 통합하고 런타임 주입을 제거한다.','sw comment')
sw=replace_once(sw,'garden-v24-fragment-badge-source-v77','garden-v25-capture-marking-source-v78','sw cache')
sw=replace_once(sw,'20260904-1810-fragment-badge-source-v77','20260904-1845-capture-marking-source-v78','sw patch version')
sw=replace_once(sw,'  `<script src="./capture-marking.js?v=${PATCH_VERSION}"></script>`,\n','', 'sw patch tag')
sw=replace_once(sw,'(?:storage-fix|capture-marking|ai-v2-test-runtime|blooming-v2-runtime)','(?:storage-fix|ai-v2-test-runtime|blooming-v2-runtime)','sw html cleanup regex')
sw=replace_once(sw,'    url.pathname.endsWith("/storage-fix.js")||url.pathname.endsWith("/capture-marking.js")||\n','    url.pathname.endsWith("/storage-fix.js")||\n','sw runtime patch routing')

index_path.write_text(index,encoding='utf-8')
sw_path.write_text(sw,encoding='utf-8')

# 9) Remove the obsolete runtime patch only after the migrated source is in place.
if not capture_patch_path.exists():
    raise SystemExit('capture-marking.js missing before migration')
capture_patch_path.unlink()

# Strong source-of-truth guards.
index_check=index_path.read_text(encoding='utf-8')
sw_check=sw_path.read_text(encoding='utf-8')
if '이 생각을 조금 더 표시해둘까요?' in index_check:
    raise SystemExit('old capture wording remains in index.html')
if index_check.count('이 생각은 지금 내게 어떤 역할을 하나요?') < 2:
    raise SystemExit('new role wording must exist in both edit and capture UI')
for required in [
    'id="captureStarToggle"', 'id="captureLensRow"',
    'const captureMarking={starred:false,lens:null};',
    '...(captureMarking.starred?{starred:true}:{})',
    '...(captureMarking.lens?{lenses:[captureMarking.lens]}:{})'
]:
    if required not in index_check:
        raise SystemExit(f'missing migrated capture feature: {required}')
if 'capture-marking.js' in sw_check:
    raise SystemExit('service worker still references capture-marking.js')
if 'garden-v25-capture-marking-source-v78' not in sw_check:
    raise SystemExit('service worker cache was not rotated')

print('capture marking v78 source refactor verified')

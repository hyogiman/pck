from pathlib import Path
import re


def replace_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {n}")
    return text.replace(old, new, 1)


# ---- reading.js: one authoritative handwriting/save flow ----
p = Path("reading.js")
s = p.read_text(encoding="utf-8")

s = replace_once(
    s,
    '  idb:null,syncing:false,bookApiResults:[]\n};',
    '  idb:null,syncing:false,bookApiResults:[],entrySaving:false\n};',
    "state entrySaving",
)

old = '''function openRecord({entry=null,fromSession=true}={}){state.recordReturnToSession=fromSession;state.editingEntryId=entry?.id||null;$("entryLocator").value=entry?.locator||(state.activeSession?getProfile(state.activeSession.sourceId)?.currentLocator||"":"");$("entryQuote").value=entry?.quoteText||entry?.confirmedText||"";$("entryThought").value=entry?.thought||"";$("deleteEntryBtn").classList.toggle("hidden",!entry);$("saveEntryBtn").textContent=entry?"수정 저장":"기록 저장";state.handwriting.draft=entry?.inputMethod==="handwriting"?{rawOcrText:entry.rawOcrText||"",suggestedText:entry.suggestedText||"",confirmedText:entry.confirmedText||entry.quoteText||"",existing:true}:null;openDialog("recordDialog")}
async function saveEntry(){
  const quote=safeText($("entryQuote").value),thought=safeText($("entryThought").value),locator=safeText($("entryLocator").value);if(!quote&&!thought)return toast("책의 문장이나 내 생각 중 하나는 남겨주세요.");const editing=state.editingEntryId?state.readingEntries.find(e=>e.id===state.editingEntryId):null,sourceId=editing?.sourceId||state.activeSession?.sourceId||state.detailBookId||state.currentBookId;if(!sourceId)return toast("연결할 책을 찾지 못했습니다.");const cycle=editing?.cycleId?state.readingCycles.find(c=>c.id===editing.cycleId):ensureCycle(sourceId),d=state.handwriting.draft,entry=editing||{id:uid(),sourceId,cycleId:cycle?.id||null,sessionId:state.activeSession?.id||null,createdAt:nowIso()};Object.assign(entry,{locator,quoteText:quote,thought,inputMethod:d?"handwriting":"typing",rawOcrText:d?.rawOcrText||entry.rawOcrText||"",suggestedText:d?.suggestedText||entry.suggestedText||"",confirmedText:d?.confirmedText||quote,updatedAt:nowIso()});
  if(thought){let fragmentId=entry.linkedFragmentId||uid();entry.linkedFragmentId=fragmentId;const old=state.fragments.find(f=>f.id===fragmentId),fragment={id:fragmentId,type:"source",sourceId,externalText:quote,locator,thought,threadIds:old?.threadIds||[],date:localDate(entry.createdAt),createdAt:old?.createdAt||entry.createdAt,updatedAt:nowIso()},fi=state.fragments.findIndex(f=>f.id===fragmentId);if(fi>=0)state.fragments[fi]=fragment;else state.fragments.push(fragment);await cloudSet("fragments",fragmentId,fragment,{silent:true})}else if(entry.linkedFragmentId){await cloudDelete("fragments",entry.linkedFragmentId);state.fragments=state.fragments.filter(f=>f.id!==entry.linkedFragmentId);entry.linkedFragmentId=null}
  const i=state.readingEntries.findIndex(e=>e.id===entry.id);if(i>=0)state.readingEntries[i]=entry;else state.readingEntries.push(entry);await cloudSet("readingEntries",entry.id,entry,{silent:true});if(d?.imageBlob&&!d.existing)await saveHandwritingFiles(entry);await cacheSnapshot();closeDialog("recordDialog");state.editingEntryId=null;state.handwriting.draft=null;renderTimeline();if(state.detailBookId)renderBookDetail();toast(d?.imageBlob?"기록했습니다. 필사 이미지는 동기화 중입니다. ✍":"기록했습니다 🌱")
}'''

new = '''function ensureHandwritingAttachmentCard(){
  const quote=$("entryQuote"),field=quote?.closest(".field");if(!field)return null;
  let box=$("rgHandwritingSavePreview");
  if(!box){box=document.createElement("div");box.id="rgHandwritingSavePreview";box.className="rg-handwriting-save-preview hidden";box.innerHTML='<div class="rg-hw-copy"><strong>✍ 필사 원본 첨부됨</strong><span>작성한 필사 이미지가 이 기록과 함께 저장됩니다.</span></div><i class="rg-hw-spinner" aria-hidden="true"></i>';field.insertAdjacentElement("afterend",box)}
  return box
}
function syncHandwritingAttachmentCard(){
  const box=ensureHandwritingAttachmentCard();if(!box)return;
  const editing=state.editingEntryId?state.readingEntries.find(e=>e.id===state.editingEntryId):null;
  const attached=!!state.handwriting.draft||editing?.inputMethod==="handwriting";
  box.classList.toggle("hidden",!attached);box.classList.toggle("is-saving",attached&&state.entrySaving);
  if(attached){const strong=box.querySelector("strong"),copy=box.querySelector("span");if(strong)strong.textContent=state.entrySaving?"필사 원본 보관 중…":"✍ 필사 원본 첨부됨";if(copy)copy.textContent=state.entrySaving?"기록은 먼저 저장하고, 필사 이미지는 이어서 동기화합니다.":"작성한 필사 이미지가 이 기록과 함께 저장됩니다."}
}
function setEntrySaving(saving){
  state.entrySaving=!!saving;const btn=$("saveEntryBtn");if(btn){btn.disabled=!!saving;btn.setAttribute("aria-busy",saving?"true":"false");if(saving){if(!btn.dataset.originalText)btn.dataset.originalText=btn.textContent||"기록 저장";btn.textContent=state.handwriting.draft?.imageBlob?"✍ 필사 기록 저장 중…":"기록 저장 중…"}else if(btn.dataset.originalText){btn.textContent=btn.dataset.originalText;delete btn.dataset.originalText}}syncHandwritingAttachmentCard()
}
function openRecord({entry=null,fromSession=true}={}){state.recordReturnToSession=fromSession;state.editingEntryId=entry?.id||null;$("entryLocator").value=entry?.locator||(state.activeSession?getProfile(state.activeSession.sourceId)?.currentLocator||"":"");$("entryQuote").value=entry?.quoteText||entry?.confirmedText||"";$("entryThought").value=entry?.thought||"";$("deleteEntryBtn").classList.toggle("hidden",!entry);$("saveEntryBtn").textContent=entry?"수정 저장":"기록 저장";state.handwriting.draft=entry?.inputMethod==="handwriting"?{rawOcrText:entry.rawOcrText||"",suggestedText:entry.suggestedText||"",confirmedText:entry.confirmedText||entry.quoteText||"",existing:true}:null;setEntrySaving(false);syncHandwritingAttachmentCard();openDialog("recordDialog")}
async function saveEntry(){
  if(state.entrySaving)return;
  const quote=safeText($("entryQuote").value),thought=safeText($("entryThought").value),locator=safeText($("entryLocator").value),editing=state.editingEntryId?state.readingEntries.find(e=>e.id===state.editingEntryId):null,d=state.handwriting.draft,hasHandwriting=!!d?.imageBlob||!!(editing?.inputMethod==="handwriting"&&(editing.handwritingImageUrl||editing.handwritingPending||d?.existing));
  if(!quote&&!thought&&!hasHandwriting)return toast("문장, 필사, 생각 중 하나는 남겨주세요.");
  const sourceId=editing?.sourceId||state.activeSession?.sourceId||state.detailBookId||state.currentBookId;if(!sourceId)return toast("연결할 책을 찾지 못했습니다.");
  setEntrySaving(true);
  try{
    const cycle=editing?.cycleId?state.readingCycles.find(c=>c.id===editing.cycleId):ensureCycle(sourceId),entry=editing||{id:uid(),sourceId,cycleId:cycle?.id||null,sessionId:state.activeSession?.id||null,createdAt:nowIso()};Object.assign(entry,{locator,quoteText:quote,thought,inputMethod:hasHandwriting?"handwriting":"typing",rawOcrText:d?.rawOcrText||entry.rawOcrText||"",suggestedText:d?.suggestedText||entry.suggestedText||"",confirmedText:d?.confirmedText||quote,updatedAt:nowIso()});
    if(thought){let fragmentId=entry.linkedFragmentId||uid();entry.linkedFragmentId=fragmentId;const old=state.fragments.find(f=>f.id===fragmentId),fragment={id:fragmentId,type:"source",sourceId,externalText:quote,locator,thought,threadIds:old?.threadIds||[],date:localDate(entry.createdAt),createdAt:old?.createdAt||entry.createdAt,updatedAt:nowIso()},fi=state.fragments.findIndex(f=>f.id===fragmentId);if(fi>=0)state.fragments[fi]=fragment;else state.fragments.push(fragment);await cloudSet("fragments",fragmentId,fragment,{silent:true})}else if(entry.linkedFragmentId){await cloudDelete("fragments",entry.linkedFragmentId);state.fragments=state.fragments.filter(f=>f.id!==entry.linkedFragmentId);entry.linkedFragmentId=null}
    const i=state.readingEntries.findIndex(e=>e.id===entry.id);if(i>=0)state.readingEntries[i]=entry;else state.readingEntries.push(entry);
    if(d?.imageBlob&&!d.existing){entry.handwritingPending=true;await saveHandwritingFiles(entry)}else await cloudSet("readingEntries",entry.id,entry,{silent:true});
    await cacheSnapshot();closeDialog("recordDialog");state.editingEntryId=null;state.handwriting.draft=null;renderTimeline();if(state.detailBookId)renderBookDetail();toast(hasHandwriting?"기록했습니다. 필사 이미지는 이어서 동기화합니다. ✍":"기록했습니다 🌱")
  }catch(err){console.error("saveEntry failed",err);toast("기록 저장에 실패했습니다. 다시 시도해주세요.",3200)}finally{setEntrySaving(false)}
}'''

s = replace_once(s, old, new, "openRecord/saveEntry")

old = '''  const w=Math.max(1,Math.ceil(maxX-minX)),h=Math.max(1,Math.ceil(maxY-minY)),scale=2,out=document.createElement("canvas");out.width=w*scale;out.height=h*scale;const o=out.getContext("2d");o.fillStyle="#fff";o.fillRect(0,0,out.width,out.height);o.save();o.scale(scale,scale);o.translate(-minX,-minY);redrawWriting(o,out);o.restore();const imageBlob=await new Promise(r=>out.toBlob(r,"image/webp",.84));let raw="";if("TextDetector" in window){try{const det=new TextDetector(),found=await det.detect(out);raw=found.map(x=>x.rawValue||"").filter(Boolean).join("\\n")}catch{}}return {imageBlob,rawOcrText:raw,suggestedText:raw,confirmedText:raw};
}
async function convertHandwriting(){const d=await buildHandwritingDraft();if(!d)return;state.handwriting.draft=d;state.handwriting.strokes=[];state.handwriting.current=null;$("ocrConfirmedText").value=d.confirmedText;$("ocrRawText").textContent=d.rawOcrText||"이 기기에서는 브라우저 OCR을 사용할 수 없습니다. 실제 OCR 서버 연결은 다음 개발 단계에서 붙입니다.";$("ocrNotice").textContent=d.rawOcrText?"기기에서 감지한 텍스트입니다. 원문과 비교해 수정한 뒤 확정해주세요.":"필사 원본 이미지는 준비됐습니다. 텍스트를 직접 확인·수정해 확정할 수 있습니다.";closeLayer("handwritingLayer");openDialog("ocrDialog")}
function confirmOcr(){const text=safeText($("ocrConfirmedText").value);if(!text)return toast("확정할 문장을 입력해주세요.");state.handwriting.draft.confirmedText=text;state.handwriting.draft.suggestedText=text;$("entryQuote").value=text;closeDialog("ocrDialog");openDialog("recordDialog")}'''

new = '''  const w=Math.max(1,Math.ceil(maxX-minX)),h=Math.max(1,Math.ceil(maxY-minY)),maxPixels=2200000,scale=Math.min(1.6,Math.max(1,Math.sqrt(maxPixels/(w*h)))),out=document.createElement("canvas");out.width=Math.max(1,Math.round(w*scale));out.height=Math.max(1,Math.round(h*scale));const o=out.getContext("2d");o.fillStyle="#fff";o.fillRect(0,0,out.width,out.height);o.save();o.scale(scale,scale);o.translate(-minX,-minY);redrawWriting(o,out);o.restore();const imageBlob=await new Promise(r=>out.toBlob(r,"image/webp",.8));let raw="";if("TextDetector" in window){try{const det=new TextDetector(),found=await det.detect(out);raw=found.map(x=>x.rawValue||"").filter(Boolean).join("\\n")}catch{}}out.width=1;out.height=1;return {imageBlob,rawOcrText:raw,suggestedText:raw,confirmedText:raw};
}
async function convertHandwriting(){const btn=$("convertHandwritingBtn");if(btn){btn.disabled=true;btn.textContent="필사 이미지 준비 중…"}try{const d=await buildHandwritingDraft();if(!d)return;state.handwriting.draft=d;state.handwriting.strokes=[];state.handwriting.current=null;$("ocrConfirmedText").value=d.confirmedText;$("ocrRawText").textContent=d.rawOcrText||"아직 OCR 엔진이 연결되지 않았습니다. 필사 이미지는 정상적으로 준비됐습니다.";$("ocrNotice").textContent=d.rawOcrText?"기기에서 감지한 텍스트입니다. 원문과 비교해 수정한 뒤 확정해주세요.":"필사 원본 이미지는 준비됐습니다. 텍스트 없이 그대로 확정해도 됩니다.";closeLayer("handwritingLayer");openDialog("ocrDialog")}catch(err){console.error("convertHandwriting failed",err);toast("필사 이미지를 준비하지 못했습니다. 다시 시도해주세요.",3200)}finally{if(btn){btn.disabled=false;btn.textContent="텍스트 변환"}}}
function confirmOcr(){const text=safeText($("ocrConfirmedText").value);if(!state.handwriting.draft)return toast("필사 원본을 찾지 못했습니다. 다시 필사해주세요.");state.handwriting.draft.confirmedText=text;state.handwriting.draft.suggestedText=text;if(text)$("entryQuote").value=text;closeDialog("ocrDialog");syncHandwritingAttachmentCard();openDialog("recordDialog")}'''

s = replace_once(s, old, new, "handwriting conversion/confirm")
p.write_text(s, encoding="utf-8")


# ---- reading-detail-v12.js: keep only book-detail/remove/restore responsibilities ----
p = Path("reading-detail-v12.js")
s = p.read_text(encoding="utf-8")
s = s.replace('let rgEntrySaving=false;\nlet rgSaveFallbackTimer=null;\nlet rgHandwritingPreviewUrl="";\n', "")
start = s.index("function ensureHandwritingPreview(){")
end = s.index("/*\n  v15:", start)
s = s[:start] + s[end:]
s = s.replace("  필사 확정 후에는 record dialog에 원본 이미지 미리보기와 저장 상태를 보여준다.\n", "  필사/저장 UI는 reading.js 원본이 담당한다.\n")
s = s.replace("\n  if(e.target.closest('#confirmOcrBtn')){\n    rgHandwritingPreviewUrl=captureHandwritingPreview();\n    requestAnimationFrame(showHandwritingPreview);\n  }\n  if(e.target.closest('#openHandwritingBtn')){\n    rgHandwritingPreviewUrl='';\n    document.getElementById('rgHandwritingSavePreview')?.classList.add('hidden');\n  }\n", "\n")
s = s.replace("document.addEventListener('click',beginEntrySave,true);\n", "")
s = s.replace("window.addEventListener('pageshow',()=>{scheduleDecorate();setupRecordDialogFeedback()});\n", "window.addEventListener('pageshow',()=>{scheduleDecorate()});\n")
s = s.replace("setupRecordDialogFeedback();\n", "")
s = s.replace("/* 독서의 정원 v15 — 책 상세 안정화 + 필사 저장 중복 방지/시각 피드백 */", "/* 독서의 정원 v24 — 책 상세/서재 제거·복원 전용 */")
p.write_text(s, encoding="utf-8")


# ---- reading-dialogs-v18.js: dialogs only; remove handwriting save hacks ----
p = Path("reading-dialogs-v18.js")
s = p.read_text(encoding="utf-8")
a = s.index("function installHandwritingMemoryGuard(){")
b = s.index("function setTextIfChanged", a)
s = s[:a] + s[b:]
a = s.index("function setTextIfChanged")
b = s.index("function boot(){", a)
s = s[:a] + s[b:]
s = re.sub(r"function boot\(\)\{[^\n]*\}", "function boot(){injectStyle();ensureDialog()}", s, count=1)
s = s.replace("/* 독서의 정원 v20 — 기본 브라우저 confirm/alert 제거 + 필사 메모리 절약 + OCR/텍스트 없는 필사 저장 */", "/* 독서의 정원 v24 — 앱 모달(confirm/alert 대체) 전용 */")
p.write_text(s, encoding="utf-8")


# ---- PWA cache bust ----
p = Path("reading-pwa-v7.js")
s = p.read_text(encoding="utf-8")
for oldver in ("20260904-reading-v21", "20260904-reading-v22", "20260904-reading-v23"):
    s = s.replace(oldver, "20260904-reading-v24")
s = re.sub(r"/\* 독서의 정원 v\d+ — 독립 PWA 설치 보조 \+ [^*]+\*/", "/* 독서의 정원 v24 — 독립 PWA 설치 보조 + 안정성/모달 런타임 로드 */", s, count=1)
s = "\n".join(line for line in s.splitlines() if "reading-handwriting-state-" not in line) + "\n"
p.write_text(s, encoding="utf-8")


# Sanity checks
reading = Path("reading.js").read_text(encoding="utf-8")
detail = Path("reading-detail-v12.js").read_text(encoding="utf-8")
dialogs = Path("reading-dialogs-v18.js").read_text(encoding="utf-8")
assert "hasHandwriting" in reading
assert "if(!quote&&!thought&&!hasHandwriting)" in reading
assert "텍스트 없이 그대로 확정해도 됩니다." in reading
assert "String.prototype.trim" not in dialogs
assert "beginEntrySave" not in detail
assert "captureHandwritingPreview" not in detail
print("Reading Garden v24 patch prepared successfully")

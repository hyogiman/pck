from pathlib import Path

html_path=Path('reading.html')
js_path=Path('reading.js')
html=html_path.read_text(encoding='utf-8')
js=js_path.read_text(encoding='utf-8')

old_html='''      <button id="convertHandwritingBtn" class="btn primary block" type="button">텍스트 변환</button>'''
new_html='''      <div class="two-actions"><button id="saveHandwritingImageBtn" class="btn" type="button">이미지만 저장</button><button id="convertHandwritingBtn" class="btn primary" type="button">OCR · 텍스트 변환</button></div>'''
if old_html not in html:
    raise SystemExit('handwriting action button marker not found')
html=html.replace(old_html,new_html,1)
html=html.replace('./reading.js?v=20260907-reading-v33','./reading.js?v=20260907-reading-v35',1)
html_path.write_text(html,encoding='utf-8')

marker='''async function convertHandwriting(){'''
if marker not in js:
    raise SystemExit('convertHandwriting marker not found')
image_only=r'''async function saveHandwritingImageOnly(){
  const btn=$("saveHandwritingImageBtn");if(btn){btn.disabled=true;btn.textContent="필사 이미지 준비 중…"}
  try{
    const d=await buildHandwritingDraft();if(!d)return;
    /* Image-only mode deliberately skips OCR. Existing typed quote/thought stay untouched. */
    d.rawOcrText="";d.suggestedText="";d.confirmedText="";
    state.handwriting.draft=d;state.handwriting.strokes=[];state.handwriting.current=null;
    closeLayer("handwritingLayer");syncHandwritingAttachmentCard();openDialog("recordDialog");
    toast("필사 이미지를 추가했습니다. 저장하면 이미지 그대로 기록됩니다. ✍")
  }catch(err){console.error("saveHandwritingImageOnly failed",err);toast("필사 이미지를 준비하지 못했습니다. 다시 시도해주세요.",3200)}
  finally{if(btn){btn.disabled=false;btn.textContent="이미지만 저장"}}
}
'''
js=js.replace(marker,image_only+marker,1)

bind_marker='''$("undoStrokeBtn").onclick=()=>{state.handwriting.strokes.pop();redrawWriting()};$("convertHandwritingBtn").onclick=convertHandwriting;'''
bind_replacement='''$("undoStrokeBtn").onclick=()=>{state.handwriting.strokes.pop();redrawWriting()};$("saveHandwritingImageBtn").onclick=saveHandwritingImageOnly;$("convertHandwritingBtn").onclick=convertHandwriting;'''
if bind_marker not in js:
    raise SystemExit('handwriting binding marker not found')
js=js.replace(bind_marker,bind_replacement,1)
js_path.write_text(js,encoding='utf-8')

print('PASS: handwriting image-only and OCR modes separated')

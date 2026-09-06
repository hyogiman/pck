from pathlib import Path

p=Path('reading.js')
s=p.read_text(encoding='utf-8')
start=s.find('function renderEntryHtml(')
end=s.find('function renderEvent(',start)
if start<0 or end<0:
    raise SystemExit('timeline renderer markers missing')
replacement=r'''function renderEntryHtml(e,{legacy=false,deletable=true}={}){
  const quote=safeText(e.quoteText||e.confirmedText||e.externalText),thought=safeText(e.thought),canDelete=!legacy&&deletable;
  return `<div class="timeline-entry${legacy?" is-legacy":""}" ${!legacy?`data-edit-entry="${esc(e.id)}"`:""}>
    <div class="timeline-entry-bar">
      <span class="timeline-entry-type">${esc(entryKindLabel(e))}</span>
      ${canDelete?`<button class="timeline-delete-btn timeline-entry-delete" data-delete-entry="${esc(e.id)}" type="button" aria-label="${esc(entryKindLabel(e))} 삭제" title="이 기록 삭제">${timelineTrashIcon()}</button>`:""}
    </div>
    ${e.locator?`<div class="entry-locator">${esc(e.locator)}</div>`:""}
    ${e.handwritingImageUrl?`<img class="handwriting-preview" src="${esc(e.handwritingImageUrl)}" alt="필사 원본">`:e.inputMethod==="handwriting"&&e.handwritingPending?`<div class="notice">✍ 필사 원본 동기화 중</div>`:""}
    ${quote?`<div class="entry-quote">${esc(quote)}</div>`:""}
    ${thought?`<div class="entry-thought">${esc(thought)}</div>`:""}
    ${legacy?`<span class="legacy-badge">생각의 텃밭에서 남긴 기록</span>`:""}
  </div>`
}
'''
s=s[:start]+replacement+s[end:]
if s.count('function renderEntryHtml(')!=1:
    raise SystemExit('renderEntryHtml must exist exactly once')
if '}={}){const quote=' in s:
    raise SystemExit('old renderer tail still remains')
p.write_text(s,encoding='utf-8')
print('PASS: renderEntryHtml exact replacement cleaned')

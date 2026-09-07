from pathlib import Path

js_path=Path('reading.js')
swipe_path=Path('reading-swipe-v8.js')
html_path=Path('reading.html')
js=js_path.read_text(encoding='utf-8')
swipe=swipe_path.read_text(encoding='utf-8')
html=html_path.read_text(encoding='utf-8')

# 1) Session cards: newest captured record at the top, matching the timeline's newest-date-first direction.
old_sort='''function entryCreatedMs(e){const t=new Date(e?.createdAt||e?.updatedAt||0).getTime();return Number.isFinite(t)?t:0}\nfunction sortEntriesChronologically(entries){return entries.slice().sort((a,b)=>entryCreatedMs(a)-entryCreatedMs(b)||String(a.id||"").localeCompare(String(b.id||"")))}'''
new_sort='''function entryCreatedMs(e){const v=e?.createdAt||e?.updatedAt||0;if(v?.toMillis)return v.toMillis();const t=new Date(v).getTime();return Number.isFinite(t)?t:0}\nfunction sortEntriesChronologically(entries){return entries.slice().sort((a,b)=>entryCreatedMs(b)-entryCreatedMs(a)||String(b.id||"").localeCompare(String(a.id||"")))}\nfunction entryInputTime(v){\n  if(!v)return "";\n  if(typeof v==="string"&&!/[T ]\\d{1,2}:\\d{2}/.test(v))return "";\n  const d=v?.toDate?v.toDate():new Date(v);if(!d||Number.isNaN(d.getTime()))return "";\n  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`\n}'''
if old_sort not in js: raise SystemExit('entry sort marker not found')
js=js.replace(old_sort,new_sort,1)

# 2) Show the original input time (HH:mm:ss) on every Reading entry where createdAt exists.
old_entry='''function renderEntryHtml(e,{legacy=false,deletable=true}={}){\n  const quote=safeText(e.quoteText||e.confirmedText||e.externalText),thought=safeText(e.thought),canDelete=!legacy&&deletable;\n  return `<div class="timeline-entry${legacy?" is-legacy":""}" ${!legacy?`data-edit-entry="${esc(e.id)}"`:""}>\n    <div class="timeline-entry-bar">\n      <span class="timeline-entry-type">${esc(entryKindLabel(e))}</span>'''
new_entry='''function renderEntryHtml(e,{legacy=false,deletable=true}={}){\n  const quote=safeText(e.quoteText||e.confirmedText||e.externalText),thought=safeText(e.thought),canDelete=!legacy&&deletable,inputTime=entryInputTime(e.createdAt);\n  return `<div class="timeline-entry${legacy?" is-legacy":""}" ${!legacy?`data-edit-entry="${esc(e.id)}"`:""}>\n    <div class="timeline-entry-bar">\n      <span class="timeline-entry-type">${esc(entryKindLabel(e))}${inputTime?` · ${esc(inputTime)}`:""}</span>'''
if old_entry not in js: raise SystemExit('renderEntryHtml marker not found')
js=js.replace(old_entry,new_entry,1)

old_legacy='''const f=ev.fragment,e={sourceId:f.sourceId,locator:f.locator,externalText:f.externalText,thought:f.thought};'''
new_legacy='''const f=ev.fragment,e={sourceId:f.sourceId,locator:f.locator,externalText:f.externalText,thought:f.thought,createdAt:f.createdAt||f.date};'''
if old_legacy not in js: raise SystemExit('legacy entry marker not found')
js=js.replace(old_legacy,new_legacy,1)

# 3) Compact home: for paper/PDF, move resume location into the start button instead of a separate vertical block.
old_core='''  state.currentBookId=s.id;const p=getProfile(s.id),isPhysical=p?.format==="paper"||p?.format==="pdf",locator=safeText(p?.currentLocator);\n  box.innerHTML=`<div class="read-hero-inner">${coverHtml(s)}<h2 class="hero-title">${esc(s.title)}</h2><p class="hero-author">${esc(s.creator||"")}</p><span class="hero-service">${esc(serviceText(p))}</span>${isPhysical&&locator?`<div class="hero-locator"><small>지난번 위치</small><strong>${esc(nextLocator(locator,p.format))}</strong></div>`:p?.lastReadAt?`<div class="hero-locator"><small>최근 독서</small><strong class="rg-relative-date">${esc(relativeDate(p.lastReadAt))}</strong></div>`:""}<button class="btn primary block start-btn" data-start-book="${esc(s.id)}" type="button">▶ 읽기 시작</button><button class="text-btn switch-book" data-open-book-picker type="button">다른 책 선택 ›</button></div>`;'''
new_core='''  state.currentBookId=s.id;const p=getProfile(s.id),isPhysical=p?.format==="paper"||p?.format==="pdf",locator=safeText(p?.currentLocator),resumeLabel=isPhysical&&locator?`▶ ${nextLocator(locator,p.format)} 읽기 시작`:"▶ 읽기 시작";\n  box.innerHTML=`<div class="read-hero-inner">${coverHtml(s)}<h2 class="hero-title">${esc(s.title)}</h2><p class="hero-author">${esc(s.creator||"")}</p><span class="hero-service">${esc(serviceText(p))}</span>${!isPhysical&&p?.lastReadAt?`<div class="hero-locator"><small>최근 독서</small><strong class="rg-relative-date">${esc(relativeDate(p.lastReadAt))}</strong></div>`:""}<button class="btn primary block start-btn" data-start-book="${esc(s.id)}" type="button">${resumeLabel}</button><button class="text-btn switch-book" data-open-book-picker type="button">다른 책 선택 ›</button></div>`;'''
if old_core not in js: raise SystemExit('core home marker not found')
js=js.replace(old_core,new_core,1)

# Swipe runtime owns the normal 1/N home presentation, so apply the same compact resume-label rule there.
old_swipe_content='''function rgBookContentHtml(book,direction=0){\n  const p=rgProfileFor(rgSwipeSnapshot,book.id)||{};\n  const genre=rgGenre(book),title=rgTitleParts(book);\n  const isPhysical=p.format==='paper'||p.format==='pdf';\n  const locator=rgSafe(p.currentLocator);\n  const extra=isPhysical&&locator\n    ? `<div class="hero-locator"><small>지난번 위치</small><strong>${rgEsc(locator)}</strong></div>`\n    : p.lastReadAt\n      ? `<div class="hero-locator"><small>최근 독서</small><strong class="rg-relative-date">${rgEsc(rgRelativeDate(p.lastReadAt))}</strong></div>`\n      : '';\n  const genreHtml=genre?`<span class="hero-service rg-home-genre rg-genre-badge">${rgEsc(genre)}</span>`:'';'''
new_swipe_content='''function rgNextLocator(locator,format){if(format!=="paper"&&format!=="pdf")return locator;const m=String(locator).match(/(?:p\\.\\s*)?(\\d+)/i);return m?`p.${Number(m[1])+1}부터`:locator}\nfunction rgStartLabel(book){const p=rgProfileFor(rgSwipeSnapshot,book.id)||{},locator=rgSafe(p.currentLocator),physical=p.format==='paper'||p.format==='pdf';return physical&&locator?`▶ ${rgNextLocator(locator,p.format)} 읽기 시작`:'▶ 읽기 시작'}\nfunction rgBookContentHtml(book,direction=0){\n  const p=rgProfileFor(rgSwipeSnapshot,book.id)||{};\n  const genre=rgGenre(book),title=rgTitleParts(book);\n  const isPhysical=p.format==='paper'||p.format==='pdf';\n  const extra=!isPhysical&&p.lastReadAt\n      ? `<div class="hero-locator"><small>최근 독서</small><strong class="rg-relative-date">${rgEsc(rgRelativeDate(p.lastReadAt))}</strong></div>`\n      : '';\n  const genreHtml=genre?`<span class="hero-service rg-home-genre rg-genre-badge">${rgEsc(genre)}</span>`:'';'''
if old_swipe_content not in swipe: raise SystemExit('swipe content marker not found')
swipe=swipe.replace(old_swipe_content,new_swipe_content,1)

old_swipe_button='''    <button class="btn primary block start-btn" data-start-book="${rgEsc(book.id)}" type="button">▶ 읽기 시작</button>'''
new_swipe_button='''    <button class="btn primary block start-btn" data-start-book="${rgEsc(book.id)}" type="button">${rgEsc(rgStartLabel(book))}</button>'''
if old_swipe_button not in swipe: raise SystemExit('swipe start button marker not found')
swipe=swipe.replace(old_swipe_button,new_swipe_button,1)

old_update='''  const start=hero.querySelector('[data-start-book]');if(start&&start.dataset.startBook!==book.id)start.dataset.startBook=book.id;'''
new_update='''  const start=hero.querySelector('[data-start-book]');if(start){if(start.dataset.startBook!==book.id)start.dataset.startBook=book.id;const label=rgStartLabel(book);if(start.textContent!==label)start.textContent=label}'''
if old_update not in swipe: raise SystemExit('swipe fixed control marker not found')
swipe=swipe.replace(old_update,new_update,1)

# Cache-bust changed runtimes only.
html=html.replace('./reading.js?v=20260908-reading-v37','./reading.js?v=20260908-reading-v38',1)
html=html.replace('./reading-swipe-v8.js?v=20260907-reading-v33','./reading-swipe-v8.js?v=20260908-reading-v38',1)

js_path.write_text(js,encoding='utf-8')
swipe_path.write_text(swipe,encoding='utf-8')
html_path.write_text(html,encoding='utf-8')
print('PASS: Reading v38 record time/order and compact home patch applied')

from pathlib import Path

js_path=Path('reading.js')
css_path=Path('reading.css')
html_path=Path('reading.html')

js=js_path.read_text(encoding='utf-8')
css=css_path.read_text(encoding='utf-8')
html=html_path.read_text(encoding='utf-8')

# 1) Bottom navigation remains visible/useful while a book detail layer is open.
old='function setView(view){state.currentView=view;'
new='function setView(view){const detail=$("bookDetail");if(detail&&!detail.classList.contains("hidden"))closeLayer("bookDetail");state.currentView=view;'
if old not in js:
    raise SystemExit('setView marker not found')
js=js.replace(old,new,1)

# 2) Sanitize YES24 rich text while retaining a small, safe formatting whitelist.
marker='function renderBookInfoHtml(s){\n'
if marker not in js:
    raise SystemExit('renderBookInfoHtml marker not found')
rich='''const BOOK_INFO_RICH_TAGS=new Set(["B","STRONG","I","EM","U","S","BR","P","DIV","UL","OL","LI","SUP","SUB","SMALL","H1","H2","H3","H4","H5","H6"]);\nfunction safeBookRichHtml(raw=""){\n  const template=document.createElement("template");template.innerHTML=String(raw??"");\n  const render=node=>{\n    if(node.nodeType===3)return esc(node.nodeValue||"");\n    if(node.nodeType!==1)return "";\n    const tag=node.tagName.toUpperCase();\n    if(["SCRIPT","STYLE","IFRAME","OBJECT","EMBED","SVG","MATH"].includes(tag))return "";\n    const body=[...node.childNodes].map(render).join("");\n    if(!BOOK_INFO_RICH_TAGS.has(tag))return body;\n    const out=tag.toLowerCase();return out==="br"?"<br>":`<${out}>${body}</${out}>`;\n  };\n  return [...template.content.childNodes].map(render).join("");\n}\n'''
js=js.replace(marker,rich+marker,1)

old='return `<section class="book-info-panel">${sub?`<p class="book-info-subtitle">${esc(sub)}</p>`:""}${facts.length?`<dl class="book-info-facts">${facts.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`:""}${intro?`<article class="book-info-section"><h3>책 소개</h3><div>${esc(intro)}</div></article>`:""}${summary&&summary!==intro?`<article class="book-info-section"><h3>책 요약</h3><div>${esc(summary)}</div></article>`:""}${toc?`<details class="book-info-toc"><summary>목차 펼치기</summary><div>${esc(toc)}</div></details>`:""}${empty?`<div class="book-info-empty">${state.bookInfoLoading.has(s.id)?"YES24에서 책 정보를 확인하고 있어요…":"저장된 상세 정보가 없습니다. 설정의 ‘책 정보 갱신’에서 다시 확인할 수 있어요."}</div>`:""}${provider?`<p class="book-info-source">정보 출처 · ${esc(provider)}</p>`:""}</section>`'
new='return `<section class="book-info-panel">${sub?`<p class="book-info-subtitle">${esc(sub)}</p>`:""}${facts.length?`<dl class="book-info-facts">${facts.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`:""}${intro?`<article class="book-info-section"><h3>책 소개</h3><div class="book-info-rich">${safeBookRichHtml(intro)}</div></article>`:""}${summary&&summary!==intro?`<article class="book-info-section"><h3>책 요약</h3><div class="book-info-rich">${safeBookRichHtml(summary)}</div></article>`:""}${toc?`<details class="book-info-toc"><summary>목차 펼치기</summary><div class="book-info-rich">${safeBookRichHtml(toc)}</div></details>`:""}${empty?`<div class="book-info-empty">${state.bookInfoLoading.has(s.id)?"YES24에서 책 정보를 확인하고 있어요…":"저장된 상세 정보가 없습니다. 설정의 ‘책 정보 갱신’에서 다시 확인할 수 있어요."}</div>`:""}${provider?`<p class="book-info-source">정보 출처 · ${esc(provider)}</p>`:""}</section>`'
if old not in js:
    raise SystemExit('book info output marker not found')
js=js.replace(old,new,1)

# 3) Only the book detail layer sits below persistent bottom nav. Session/handwriting stay modal-fullscreen.
css_add='''\n\n/* v42 · 책 상세 하단 메뉴 유지 + YES24 안전 서식 */\n#bookDetail{z-index:35}\n#bookDetail .layer-shell{padding-bottom:calc(var(--nav) + 30px + env(safe-area-inset-bottom))}\n.book-info-rich{white-space:pre-wrap;font-family:var(--serif);font-size:.86rem;line-height:1.75;color:#4e5048}\n.book-info-rich b,.book-info-rich strong{font-weight:700}\n.book-info-rich i,.book-info-rich em{font-style:italic}\n.book-info-rich u{text-decoration:underline;text-underline-offset:2px}\n.book-info-rich s{text-decoration:line-through}\n.book-info-rich p,.book-info-rich div{margin:.45em 0}\n.book-info-rich ul,.book-info-rich ol{margin:.55em 0;padding-left:1.5em}\n.book-info-rich li{margin:.22em 0}\n.book-info-rich h1,.book-info-rich h2,.book-info-rich h3,.book-info-rich h4,.book-info-rich h5,.book-info-rich h6{font-family:var(--serif);font-size:.95rem;line-height:1.55;margin:.8em 0 .35em;font-weight:700}\n.book-info-rich sup,.book-info-rich sub{font-size:.72em}\n'''
if '/* v42 · 책 상세 하단 메뉴 유지 + YES24 안전 서식 */' in css:
    raise SystemExit('v42 CSS already exists')
css += css_add

# 4) Cache-bust changed runtime files.
for oldv,newv in [
    ('./reading.css?v=20260908-reading-v41','./reading.css?v=20260908-reading-v42'),
    ('./reading.js?v=20260908-reading-v41','./reading.js?v=20260908-reading-v42'),
]:
    if oldv not in html:
        raise SystemExit(f'HTML version marker not found: {oldv}')
    html=html.replace(oldv,newv,1)

js_path.write_text(js,encoding='utf-8')
css_path.write_text(css,encoding='utf-8')
html_path.write_text(html,encoding='utf-8')
print('PASS: Reading v42 persistent nav + rich book info applied')

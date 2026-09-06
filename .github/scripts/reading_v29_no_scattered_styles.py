from pathlib import Path
import re

VERSION = "20260906-reading-v29"


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, text):
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    return text.replace(old, new, 1)

# ------------------------------------------------------------------
# reading.js — no static/dynamic CSS declarations in JS markup.
# JS may choose semantic/state classes; reading.css owns visual values.
# ------------------------------------------------------------------
path = "reading.js"
text = read(path)

text = replace_once(
    text,
    'function openLayer(id){const e=$(id);e.classList.remove("hidden");e.setAttribute("aria-hidden","false");document.body.style.overflow="hidden"}\nfunction closeLayer(id){const e=$(id);e.classList.add("hidden");e.setAttribute("aria-hidden","true");document.body.style.overflow=""}',
    'function openLayer(id){const e=$(id);e.classList.remove("hidden");e.setAttribute("aria-hidden","false");document.body.classList.add("rg-layer-open")}\nfunction closeLayer(id){const e=$(id);e.classList.add("hidden");e.setAttribute("aria-hidden","true");document.body.classList.remove("rg-layer-open")}',
    "layer body style"
)

text = replace_once(
    text,
    '<div class="read-hero-inner"><div class="notice" style="margin-bottom:18px">진행 중이던 독서가 있어요.</div>',
    '<div class="read-hero-inner"><div class="notice rg-active-session-notice">진행 중이던 독서가 있어요.</div>',
    "active-session notice inline style"
)
text = replace_once(
    text,
    '<strong style="font-size:1rem">${esc(relativeDate(p.lastReadAt))}</strong>',
    '<strong class="rg-relative-date">${esc(relativeDate(p.lastReadAt))}</strong>',
    "recent date inline style"
)

insert_before = 'function renderPaths(){'
helper = '''function levelClass(value,max=100){
  const n=Number(value)||0,m=Math.max(1,Number(max)||1),level=Math.max(0,Math.min(20,Math.round(n/m*20)));
  return `rg-level-${level}`;
}
'''
text = replace_once(text, insert_before, helper + insert_before, "levelClass helper")

text = replace_once(
    text,
    '<div class="path-progress"><span style="width:${pct}%"></span></div>',
    '<div class="path-progress"><span class="${levelClass(pct,100)}"></span></div>',
    "path progress inline width"
)

text = replace_once(
    text,
    '<div class="eyebrow" style="margin:10px 0 4px">이미 내 서재에 있음</div>',
    '<div class="eyebrow book-search-section-label is-existing">이미 내 서재에 있음</div>',
    "book search existing label"
)
text = replace_once(
    text,
    '<div class="eyebrow" style="margin:14px 0 4px">검색 결과</div>',
    '<div class="eyebrow book-search-section-label is-results">검색 결과</div>',
    "book search result label"
)
text = replace_once(
    text,
    '<div style="width:48px;height:68px;background:var(--panel2);border-radius:7px;display:grid;place-items:center">📕</div>',
    '<div class="search-book-placeholder">📕</div>',
    "book search placeholder"
)

text = replace_once(
    text,
    '<strong style="font-family:var(--serif);font-size:1.5rem">${es.filter(e=>e.linkedFragmentId).length}개</strong>',
    '<strong class="rg-linked-thought-count">${es.filter(e=>e.linkedFragmentId).length}개</strong>',
    "linked thought stat"
)
text = replace_once(
    text,
    '<span style="height:${Math.max(2,x.value/max*120)}px"></span>',
    '<span class="${levelClass(x.value,max)}"></span>',
    "vertical chart inline height"
)
text = replace_once(
    text,
    '<div class="hbar-fill" style="width:${x.value/max*100}%"></div>',
    '<div class="hbar-fill ${levelClass(x.value,max)}"></div>',
    "horizontal chart inline width"
)
text = replace_once(
    text,
    '<p style="margin-top:5px;color:var(--text)">${esc((r.e?.quoteText||r.e?.thought||r.f?.externalText||r.f?.thought||"").slice(0,120))}</p>',
    '<p class="search-result-excerpt">${esc((r.e?.quoteText||r.e?.thought||r.f?.externalText||r.f?.thought||"").slice(0,120))}</p>',
    "search excerpt inline style"
)
text = replace_once(
    text,
    '<small style="display:block;color:var(--muted)">${esc(s.creator||"")}</small>',
    '<small class="choice-row-author">${esc(s.creator||"")}</small>',
    "path author inline style"
)
text = replace_once(
    text,
    '<div style="font-size:26pt">📖</div>',
    '<div class="print-cover-icon">📖</div>',
    "print icon inline style"
)
text = replace_once(
    text,
    '<div style="width:48px;height:68px;background:var(--panel2);border-radius:7px"></div>',
    '<div class="picker-cover-placeholder"></div>',
    "picker placeholder inline style"
)

write(path, text)

# ------------------------------------------------------------------
# reading-polish-v6.js — visibility is a class, never a JS CSS property.
# ------------------------------------------------------------------
path = "reading-polish-v6.js"
text = read(path)
count = text.count("badge.style.display='none';")
if count != 2:
    raise SystemExit(f"polish hidden style: expected 2 matches, got {count}")
text = text.replace("badge.style.display='none';", "badge.classList.add('hidden');")
text = replace_once(
    text,
    "badge.style.display='inline-flex';",
    "badge.classList.remove('hidden');",
    "polish visible style"
)
write(path, text)

# ------------------------------------------------------------------
# reading-swipe-v8.js — drag feedback uses state classes, not .style.*.
# ------------------------------------------------------------------
path = "reading-swipe-v8.js"
text = read(path)
text = replace_once(
    text,
    "const rgEphemeralBooks=new Map();",
    "const rgEphemeralBooks=new Map();\nconst RG_DRAG_CLASSES=['rg-drag-left-near','rg-drag-left-mid','rg-drag-left-far','rg-drag-right-near','rg-drag-right-mid','rg-drag-right-far'];",
    "drag class constants"
)
text = replace_once(
    text,
    "    if(content){content.style.transition='none';content.style.transform=`translateX(${Math.max(-58,Math.min(58,dx*.28))}px)`;content.style.opacity=String(Math.max(.8,1-Math.abs(dx)/720))}",
    "    if(content){const mag=Math.abs(dx)>=44?'far':Math.abs(dx)>=24?'mid':'near';content.classList.remove(...RG_DRAG_CLASSES);content.classList.add(`rg-drag-${dx<0?'left':'right'}-${mag}`)}",
    "swipe pointer inline styles"
)
text = replace_once(
    text,
    "  const reset=()=>{const content=hero.querySelector('[data-rg-book-content]');if(content){content.style.transition='';content.style.transform='';content.style.opacity=''}};",
    "  const reset=()=>{const content=hero.querySelector('[data-rg-book-content]');if(content)content.classList.remove(...RG_DRAG_CLASSES)};",
    "swipe reset inline styles"
)
write(path, text)

# ------------------------------------------------------------------
# reading.css — canonical location for every visual rule above.
# ------------------------------------------------------------------
path = "reading.css"
css = read(path)
css = css.replace("/* 독서의 정원 v28 — SINGLE CSS SOURCE OF TRUTH", "/* 독서의 정원 v29 — SINGLE CSS SOURCE OF TRUTH", 1)
marker = "/* ===== v29 canonical no-inline-style rules ===== */"
if marker in css:
    raise SystemExit("v29 CSS marker already exists")
levels = "\n".join(f".rg-level-{i}{{--rg-level:{i}}}" for i in range(21))
css += f'''\n\n{marker}
body.rg-layer-open{{overflow:hidden}}
.rg-active-session-notice{{margin-bottom:18px}}
.rg-relative-date{{font-size:1rem}}
.book-search-section-label{{margin-bottom:4px}}
.book-search-section-label.is-existing{{margin-top:10px}}
.book-search-section-label.is-results{{margin-top:14px}}
.search-book-placeholder,.picker-cover-placeholder{{width:48px;height:68px;background:var(--panel2);border-radius:7px;flex:0 0 auto}}
.search-book-placeholder{{display:grid;place-items:center}}
.rg-linked-thought-count{{font-family:var(--serif);font-size:1.5rem}}
.search-result-excerpt{{margin-top:5px!important;color:var(--text)!important}}
.choice-row-author{{display:block;color:var(--muted)}}
.print-cover-icon{{font-size:26pt}}
{levels}
.path-progress span{{width:calc(var(--rg-level,0) * 5%)}}
.bar-col span{{height:max(2px,calc(var(--rg-level,0) * 6px))}}
.hbar-fill{{width:calc(var(--rg-level,0) * 5%)}}
#readHero .rg-swipe-book-content.rg-drag-left-near{{transition:none;transform:translateX(-4px);opacity:.98}}
#readHero .rg-swipe-book-content.rg-drag-left-mid{{transition:none;transform:translateX(-10px);opacity:.95}}
#readHero .rg-swipe-book-content.rg-drag-left-far{{transition:none;transform:translateX(-16px);opacity:.92}}
#readHero .rg-swipe-book-content.rg-drag-right-near{{transition:none;transform:translateX(4px);opacity:.98}}
#readHero .rg-swipe-book-content.rg-drag-right-mid{{transition:none;transform:translateX(10px);opacity:.95}}
#readHero .rg-swipe-book-content.rg-drag-right-far{{transition:none;transform:translateX(16px);opacity:.92}}
'''
write(path, css)

# ------------------------------------------------------------------
# Version all Reading shell/runtime references together so cached old code
# cannot be mixed with the new style contract.
# ------------------------------------------------------------------
path = "reading.html"
html = read(path).replace("20260906-reading-v28", VERSION)
write(path, html)

path = "reading-pwa-v7.js"
pwa = read(path).replace("20260906-reading-v28", VERSION).replace("/* 독서의 정원 v28 —", "/* 독서의 정원 v29 —", 1)
write(path, pwa)

path = "reading-dialogs-v18.js"
dialogs = read(path).replace("20260906-reading-v28", VERSION)
write(path, dialogs)

path = "sw.js"
sw = read(path)
sw = sw.replace("v28: 독서의 정원 CSS를 reading.css 하나로 통합한다.", "v29: 독서의 정원 CSS와 화면 스타일을 reading.css 하나로 통합한다.", 1)
sw = sw.replace('const CACHE = "garden-v28-reading-css-single-source-v79";', 'const CACHE = "garden-v29-reading-style-single-source-v80";', 1)
write(path, sw)

# ------------------------------------------------------------------
# Hard regression assertions. If any of these fail, DO NOT commit.
# ------------------------------------------------------------------
reading_css_files = sorted(p.name for p in Path('.').glob('reading*.css'))
if reading_css_files != ['reading.css']:
    raise SystemExit(f"Reading CSS files must be exactly ['reading.css'], got {reading_css_files}")

html = read('reading.html')
links = re.findall(r'<link\s+rel="stylesheet"\s+href="\./(reading[^"?]*\.css)', html)
if links != ['reading.css']:
    raise SystemExit(f"reading.html must load exactly reading.css, got {links}")

scan_files = [Path('reading.html'), *sorted(Path('.').glob('reading*.js'))]
offenders = []
for p in scan_files:
    t = p.read_text(encoding='utf-8')
    checks = {
        'inline style attribute': re.search(r'\bstyle\s*=', t),
        'dynamic style element': re.search(r'createElement\(\s*[\"\']style[\"\']\s*\)', t),
        'style property mutation': re.search(r'\.style(?:\.|\[|\s*=)', t),
        'setAttribute style': re.search(r'setAttribute\(\s*[\"\']style[\"\']', t),
    }
    for label, hit in checks.items():
        if hit:
            offenders.append(f"{p.name}: {label}: {hit.group(0)}")
if offenders:
    raise SystemExit("scattered style code remains:\n" + "\n".join(offenders))

if VERSION not in html or VERSION not in read('reading-pwa-v7.js'):
    raise SystemExit('v29 version contract not applied consistently')

print('PASS: Reading Garden style source is reading.css only')
print('PASS: no style=, createElement(style), .style mutation, or setAttribute(style) in Reading HTML/JS')
print('PASS: Reading shell/runtime version', VERSION)

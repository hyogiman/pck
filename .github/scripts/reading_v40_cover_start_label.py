from pathlib import Path

css_path=Path('reading.css')
js_path=Path('reading.js')
swipe_path=Path('reading-swipe-v8.js')
html_path=Path('reading.html')

css=css_path.read_text(encoding='utf-8')
js=js_path.read_text(encoding='utf-8')
swipe=swipe_path.read_text(encoding='utf-8')
html=html_path.read_text(encoding='utf-8')

old_cover='.hero-cover{width:min(42vw,185px);aspect-ratio:2/3;border-radius:13px;object-fit:cover;box-shadow:0 20px 42px rgba(36,40,29,.18);background:var(--panel2)}.hero-cover.placeholder{margin:0 auto;display:grid;place-items:center;font-size:3rem}'
new_cover='.hero-cover{width:min(48vw,220px);aspect-ratio:2/3;border-radius:13px;object-fit:contain;box-shadow:0 20px 42px rgba(36,40,29,.18);background:var(--panel2)}.hero-cover.placeholder{margin:0 auto;display:grid;place-items:center;font-size:3rem}'
if old_cover not in css:
    raise SystemExit('hero cover marker not found')
css=css.replace(old_cover,new_cover,1)

old_core='resumeLabel=isPhysical&&locator?`▶ ${nextLocator(locator,p.format)} 읽기 시작`:"▶ 읽기 시작";'
new_core='resumeLabel=isPhysical&&locator?`▶ 읽기 시작 (${nextLocator(locator,p.format)})`:"▶ 읽기 시작";'
if old_core not in js:
    raise SystemExit('core start label marker not found')
js=js.replace(old_core,new_core,1)

old_swipe="return physical&&locator?`▶ ${rgNextLocator(locator,p.format)} 읽기 시작`:'▶ 읽기 시작'}"
new_swipe="return physical&&locator?`▶ 읽기 시작 (${rgNextLocator(locator,p.format)})`:'▶ 읽기 시작'}"
if old_swipe not in swipe:
    raise SystemExit('swipe start label marker not found')
swipe=swipe.replace(old_swipe,new_swipe,1)

versions={
    './reading.css?v=20260907-reading-v33':'./reading.css?v=20260908-reading-v40',
    './reading.js?v=20260908-reading-v39':'./reading.js?v=20260908-reading-v40',
    './reading-swipe-v8.js?v=20260908-reading-v38':'./reading-swipe-v8.js?v=20260908-reading-v40',
}
for old,new in versions.items():
    if old not in html:
        raise SystemExit(f'cache marker not found: {old}')
    html=html.replace(old,new,1)

css_path.write_text(css,encoding='utf-8')
js_path.write_text(js,encoding='utf-8')
swipe_path.write_text(swipe,encoding='utf-8')
html_path.write_text(html,encoding='utf-8')
print('PASS: Reading v40 cover and start label patch applied')

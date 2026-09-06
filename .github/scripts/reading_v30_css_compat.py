from pathlib import Path
import re

VERSION='20260906-reading-v30'

def read(p): return Path(p).read_text(encoding='utf-8')
def write(p,t): Path(p).write_text(t,encoding='utf-8')

# reading.css: remove unsupported calc multiplication and keep all values in CSS.
css=read('reading.css')
if '/* 독서의 정원 v29 — SINGLE CSS SOURCE OF TRUTH' not in css:
    raise SystemExit('expected v29 reading.css header')
css=css.replace('/* 독서의 정원 v29 — SINGLE CSS SOURCE OF TRUTH','/* 독서의 정원 v30 — SINGLE CSS SOURCE OF TRUTH',1)

old_levels='\n'.join(f'.rg-level-{i}{{--rg-level:{i}}}' for i in range(21))
new_levels='\n'.join(f'.rg-level-{i}{{--rg-pct:{i*5}%;--rg-bar-px:{i*6}px}}' for i in range(21))
if css.count(old_levels)!=1:
    raise SystemExit(f'expected one v29 level block, got {css.count(old_levels)}')
css=css.replace(old_levels,new_levels,1)

replacements={
    '.path-progress span{width:calc(var(--rg-level,0) * 5%)}':'.path-progress span{width:var(--rg-pct,0%)}',
    '.bar-col span{height:max(2px,calc(var(--rg-level,0) * 6px))}':'.bar-col span{height:max(2px,var(--rg-bar-px,0px))}',
    '.hbar-fill{width:calc(var(--rg-level,0) * 5%)}':'.hbar-fill{width:var(--rg-pct,0%)}',
}
for old,new in replacements.items():
    if css.count(old)!=1: raise SystemExit(f'expected one CSS expression: {old}')
    css=css.replace(old,new,1)

# Drop one exact duplicate helper declaration left by the initial consolidation.
old='''/* ===== canonical helpers previously expressed as static inline styles ===== */\n.rg-relative-date{font-size:1rem}\n\n\n/* ===== v29 canonical no-inline-style rules ===== */'''
new='''/* ===== v30 canonical no-inline-style rules ===== */'''
if css.count(old)!=1:
    raise SystemExit('expected duplicate helper/canonical marker block')
css=css.replace(old,new,1)
write('reading.css',css)

# Version the entire Reading shell/runtime together.
html=read('reading.html')
if '20260906-reading-v29' not in html: raise SystemExit('reading.html v29 marker missing')
write('reading.html',html.replace('20260906-reading-v29',VERSION))

pwa=read('reading-pwa-v7.js')
if '20260906-reading-v29' not in pwa: raise SystemExit('pwa v29 marker missing')
pwa=pwa.replace('20260906-reading-v29',VERSION).replace('/* 독서의 정원 v29 —','/* 독서의 정원 v30 —',1)
write('reading-pwa-v7.js',pwa)

dialogs=read('reading-dialogs-v18.js')
write('reading-dialogs-v18.js',dialogs.replace('20260906-reading-v29',VERSION))

sw=read('sw.js')
if 'garden-v29-reading-style-single-source-v80' not in sw: raise SystemExit('sw v29 cache marker missing')
sw=sw.replace('v29: 독서의 정원 CSS와 화면 스타일을 reading.css 하나로 통합한다.','v30: 독서의 정원 CSS와 화면 스타일을 reading.css 하나로 통합하고 진행률 표현 호환성을 고정한다.',1)
sw=sw.replace('garden-v29-reading-style-single-source-v80','garden-v30-reading-style-single-source-v81',1)
write('sw.js',sw)

# Assertions.
assert sorted(p.name for p in Path('.').glob('reading*.css'))==['reading.css']
assert 'calc(var(--rg-level' not in read('reading.css')
assert read('reading.css').count('.rg-relative-date{font-size:1rem}')==1
for p in [Path('reading.html'),*sorted(Path('.').glob('reading*.js'))]:
    t=p.read_text(encoding='utf-8')
    assert not re.search(r'\bstyle\s*=',t), f'inline style in {p}'
    assert not re.search(r'createElement\(\s*["\']style["\']\s*\)',t), f'style element in {p}'
    assert not re.search(r'\.style(?:\.|\[|\s*=)',t), f'style property in {p}'
print('PASS: v30 CSS compatibility cleanup')

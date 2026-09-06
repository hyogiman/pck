from pathlib import Path
import re

VERSION = "20260906-reading-v28"
LEGACY_CSS = [
    "reading-theme-v3.css",
    "reading-theme-v4.css",
    "reading-theme-v5.css",
    "reading-swipe-v8.css",
]
DYNAMIC_STYLE_JS = [
    "reading-detail-v12.js",
    "reading-dialogs-v18.js",
    "reading-stability-v16.js",
    "reading-hotfix-v4.js",
]


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, text):
    Path(path).write_text(text, encoding="utf-8")


def extract_inject_style(path):
    text = read(path)
    pattern = re.compile(
        r"function injectStyle\(\)\{.*?\.textContent=`(?P<css>.*?)`;\s*document\.head\.appendChild\([^)]*\);\s*\}",
        re.S,
    )
    m = pattern.search(text)
    if not m:
        raise SystemExit(f"could not find exactly one injectStyle CSS block in {path}")
    css = m.group("css").strip()
    text = text[:m.start()] + "function injectStyle(){}" + text[m.end():]
    write(path, text)
    return css


# 1) Preserve the current visual cascade exactly, but place it in ONE canonical file.
base = read("reading.css").rstrip()
parts = [
    "/* 독서의 정원 v28 — SINGLE CSS SOURCE OF TRUTH\n"
    "   모든 정적 스타일은 이 파일에서만 관리한다.\n"
    "   JS의 <style> 주입과 theme/swipe 보조 CSS 파일은 사용하지 않는다. */\n",
    base,
]
for path in LEGACY_CSS:
    parts.append(f"\n/* ===== consolidated from {path} ===== */\n{read(path).strip()}")

# Runtime-injected styles are appended in a fixed, explicit order.
for path in DYNAMIC_STYLE_JS:
    css = extract_inject_style(path)
    parts.append(f"\n/* ===== consolidated from runtime styles in {path} ===== */\n{css}")

# Static inline declarations that were acting as tiny CSS fragments.
parts.append("""
/* ===== canonical helpers previously expressed as static inline styles ===== */
.rg-relative-date{font-size:1rem}
""".strip())

write("reading.css", "\n\n".join(parts).rstrip() + "\n")

# 2) Remove static inline font-size fragments from generated markup.
for path in ["reading-enhance-v3.js", "reading-swipe-v8.js"]:
    text = read(path)
    text = text.replace('<strong style="font-size:1rem">', '<strong class="rg-relative-date">')
    write(path, text)

# 3) reading.html loads exactly one Reading Garden stylesheet and one version.
html = read("reading.html")
html = re.sub(
    r'\n\s*<link rel="stylesheet" href="\./reading-(?:theme-v3|theme-v4|theme-v5|swipe-v8)\.css\?v=[^"]+"\s*/>',
    "",
    html,
)
html = re.sub(r"20260906-reading-v(?:25|26|27)", VERSION, html)
write("reading.html", html)

# 4) PWA imports and SW registration use the same version.
pwa = read("reading-pwa-v7.js")
pwa = re.sub(r"20260904-reading-v25|20260906-reading-v(?:25|26|27)", VERSION, pwa)
pwa = pwa.replace("/* 독서의 정원 v25 —", "/* 독서의 정원 v28 —")
write("reading-pwa-v7.js", pwa)

# Dialog version marker is diagnostic only; keep it aligned.
dialogs = read("reading-dialogs-v18.js")
dialogs = re.sub(r"const RG_DIALOG_VERSION='[^']+';", f"const RG_DIALOG_VERSION='{VERSION}';", dialogs)
write("reading-dialogs-v18.js", dialogs)

# 5) Shared service worker: one Reading CSS asset, no stale CSS fragments.
sw = read("sw.js")
sw = sw.replace('const CACHE = "garden-v25-capture-marking-source-v78";', 'const CACHE = "garden-v28-reading-css-single-source-v79";')
sw = sw.replace(
    '  "./reading-theme-v3.css", "./reading-enhance-v3.js", "./reading-theme-v4.css", "./reading-hotfix-v4.js",\n'
    '  "./reading-theme-v5.css", "./reading-genre-v5.js", "./reading-polish-v6.js", "./reading-pwa-v7.js",\n'
    '  "./reading-swipe-v8.css", "./reading-swipe-v8.js", "./reading-detail-v12.js",',
    '  "./reading-enhance-v3.js", "./reading-hotfix-v4.js", "./reading-genre-v5.js",\n'
    '  "./reading-polish-v6.js", "./reading-pwa-v7.js", "./reading-swipe-v8.js", "./reading-detail-v12.js",'
)
sw = sw.replace(
    '    url.pathname.endsWith("/reading-theme-v3.css")||url.pathname.endsWith("/reading-enhance-v3.js")||\n'
    '    url.pathname.endsWith("/reading-theme-v4.css")||url.pathname.endsWith("/reading-hotfix-v4.js")||\n'
    '    url.pathname.endsWith("/reading-theme-v5.css")||url.pathname.endsWith("/reading-genre-v5.js")||\n'
    '    url.pathname.endsWith("/reading-polish-v6.js")||url.pathname.endsWith("/reading-pwa-v7.js")||\n'
    '    url.pathname.endsWith("/reading-swipe-v8.css")||url.pathname.endsWith("/reading-swipe-v8.js")||',
    '    url.pathname.endsWith("/reading-enhance-v3.js")||url.pathname.endsWith("/reading-hotfix-v4.js")||\n'
    '    url.pathname.endsWith("/reading-genre-v5.js")||url.pathname.endsWith("/reading-polish-v6.js")||\n'
    '    url.pathname.endsWith("/reading-pwa-v7.js")||url.pathname.endsWith("/reading-swipe-v8.js")||'
)
sw = sw.replace(
    "   v25: Capture marking을 본체로 통합하고 런타임 주입을 제거한다.\n"
    "   독서의 정원은 reading.html 자체가 현재 CSS/JS를 직접 참조한다.\n"
    "   서비스워커 주입에 의존하지 않고, 최신 파일은 network-first로 확인한다. */",
    "   v28: 독서의 정원 CSS를 reading.css 하나로 통합한다.\n"
    "   reading.html은 단 하나의 Reading stylesheet만 직접 참조한다.\n"
    "   서비스워커 주입에 의존하지 않고, 최신 파일은 network-first로 확인한다. */",
)
write("sw.js", sw)

# 6) Delete the now-obsolete CSS fragments. They must not become alternate style sources again.
for path in LEGACY_CSS:
    Path(path).unlink()

# 7) Regression guards: one stylesheet reference, no dynamic <style> creation anywhere in Reading JS.
html = read("reading.html")
reading_css_refs = re.findall(r'<link rel="stylesheet" href="\./(reading[^"?]*\.css)', html)
if reading_css_refs != ["reading.css"]:
    raise SystemExit(f"reading.html must load only reading.css, got: {reading_css_refs}")

style_injection_offenders = []
for path in sorted(Path(".").glob("reading*.js")):
    text = path.read_text(encoding="utf-8")
    if re.search(r"createElement\(\s*['\"]style['\"]\s*\)", text):
        style_injection_offenders.append(path.name)
if style_injection_offenders:
    raise SystemExit("dynamic style injection remains in: " + ", ".join(style_injection_offenders))

for legacy in LEGACY_CSS:
    if legacy in html or legacy in read("sw.js"):
        raise SystemExit(f"stale reference remains: {legacy}")

print("Reading Garden CSS consolidated into reading.css")
print("single stylesheet ref:", reading_css_refs)
print("dynamic style injection offenders: none")

from pathlib import Path
import re

index_path = Path("index.html")
storage_path = Path("storage-fix.js")
sw_path = Path("sw.js")

index = index_path.read_text(encoding="utf-8")
storage = storage_path.read_text(encoding="utf-8")
sw = sw_path.read_text(encoding="utf-8")

# -----------------------------------------------------------------------------
# 1) Make index.html the single source of truth for Fragment badges.
# -----------------------------------------------------------------------------
old_filter = '''        <select class="select" id="fragLens">
          <option value="all">전체 표시</option>
          <option value="question">❓ 질문</option>
          <option value="decision">⚖️ 결정</option>
          <option value="desire">🧭 욕망</option>
          <option value="seed">✨ 씨앗</option>
        </select>'''
new_filter = '''        <select class="select" id="fragLens">
          <option value="all">전체 표시</option>
          <option value="discovery">👀 발견</option>
          <option value="concern">💭 고민</option>
          <option value="direction">🧭 방향</option>
          <option value="experiment">🧪 시도</option>
        </select>'''
if index.count(old_filter) != 1:
    raise SystemExit(f"fragment filter: expected 1 old block, found {index.count(old_filter)}")
index = index.replace(old_filter, new_filter, 1)

old_lenses = '''const LENSES=[
  {id:"question",e:"❓",label:"질문"},
  {id:"decision",e:"⚖️",label:"결정"},
  {id:"desire",e:"🧭",label:"욕망"},
  {id:"seed",e:"✨",label:"씨앗"}
];'''
new_lenses = '''// Fragment badge taxonomy. New choices live in LENSES; legacy values are
// display-only compatibility metadata for Fragments saved before v77.
const LENSES=[
  {id:"discovery",e:"👀",label:"발견"},
  {id:"concern",e:"💭",label:"고민"},
  {id:"direction",e:"🧭",label:"방향"},
  {id:"experiment",e:"🧪",label:"시도"}
];
const LEGACY_LENSES=[
  {id:"question",e:"❓",label:"질문"},
  {id:"decision",e:"⚖️",label:"결정"},
  {id:"desire",e:"🧭",label:"욕망"},
  {id:"seed",e:"✨",label:"씨앗"}
];
const LENS_BY_ID=new Map([...LENSES,...LEGACY_LENSES].map(L=>[L.id,L]));
const LEGACY_LENS_IDS=new Set(LEGACY_LENSES.map(L=>L.id));'''
if index.count(old_lenses) != 1:
    raise SystemExit(f"LENSES block: expected 1 old block, found {index.count(old_lenses)}")
index = index.replace(old_lenses, new_lenses, 1)

old_badge = '''function lensBadge(f){
  const id=effectiveLens(f);if(!id)return "";
  const L=LENSES.find(x=>x.id===id);if(!L)return "";
  return `<span class="lens-badge">${L.e} ${L.label}</span>`;
}'''
new_badge = '''function lensBadge(f){
  const id=effectiveLens(f);if(!id)return "";
  const L=LENS_BY_ID.get(id);if(!L)return "";
  return `<span class="lens-badge">${L.e} ${L.label}</span>`;
}'''
if index.count(old_badge) != 1:
    raise SystemExit(f"lensBadge: expected 1 old function, found {index.count(old_badge)}")
index = index.replace(old_badge, new_badge, 1)

old_render = '''function renderEditLens(){
  const box=$("editLensRow");if(!box)return;
  box.innerHTML=LENSES.map(L=>`<button class="lens-chip ${state.editLens===L.id?"on":""}" data-lens-pick="${L.id}" type="button">${L.e} ${L.label}</button>`).join("");
}'''
new_render = '''function renderEditLens(){
  const box=$("editLensRow");if(!box)return;
  const legacy=LEGACY_LENS_IDS.has(state.editLens)?LENS_BY_ID.get(state.editLens):null;
  const legacyNotice=legacy
    ?`<div class="helper lens-legacy-note">기존 표시: ${legacy.e} ${legacy.label} · 그대로 유지됩니다. 새 뱃지를 고를 때만 바뀝니다.</div>`
    :"";
  box.innerHTML=legacyNotice+LENSES.map(L=>`<button class="lens-chip ${state.editLens===L.id?"on":""}" data-lens-pick="${L.id}" type="button">${L.e} ${L.label}</button>`).join("");
}'''
if index.count(old_render) != 1:
    raise SystemExit(f"renderEditLens: expected 1 old function, found {index.count(old_render)}")
index = index.replace(old_render, new_render, 1)

old_css = '''    .lens-row{display:flex;gap:7px;flex-wrap:wrap}
    .lens-chip{border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:7px 13px;font-size:.78rem;font-weight:700;cursor:pointer;color:#4a4f44;transition:.12s}
    .lens-chip.on{background:var(--accent2);border-color:#bcd3c1;color:var(--accent)}
    .lens-badge{font-size:.66rem;color:var(--accent);background:var(--accent2);border-radius:999px;padding:2px 8px;font-weight:700;flex:0 0 auto}'''
new_css = '''    /* Fragment badges — single styling source */
    .lens-row{display:flex;gap:7px;flex-wrap:wrap}
    .lens-chip{border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:7px 13px;font-size:.78rem;font-weight:700;cursor:pointer;color:#4a4f44;transition:.12s}
    .lens-chip.on{background:var(--accent2);border-color:#bcd3c1;color:var(--accent)}
    .lens-badge{font-size:.66rem;color:var(--accent);background:var(--accent2);border-radius:999px;padding:2px 8px;font-weight:700;flex:0 0 auto}
    .lens-legacy-note{width:100%;margin:0 0 2px}'''
if index.count(old_css) != 1:
    raise SystemExit(f"lens CSS: expected 1 block, found {index.count(old_css)}")
index = index.replace(old_css, new_css, 1)

# -----------------------------------------------------------------------------
# 2) Remove semantic 'seed' as a Studio mode in source, not via hidden CSS.
# -----------------------------------------------------------------------------
old_pool = '''function poolTabs(){
  if(!state.poolThread)return "";
  return `<div class="pool-tabs">
    <button class="pool-tab ${state.poolMode==="thread"?"on":""}" data-pool-mode="thread" type="button">이 Thread ${state.poolThread.length}</button>
    <button class="pool-tab ${state.poolMode==="all"?"on":""}" data-pool-mode="all" type="button">전체 ${state.poolAll.length}</button>
    <button class="pool-tab ${state.poolMode==="seed"?"on":""}" data-pool-mode="seed" type="button">✨ 씨앗 ${state.fragments.filter(f=>effectiveLens(f)==="seed").length}</button>
  </div>`;
}
function currentPool(){
  if(state.poolMode==="seed")return state.fragments.filter(f=>effectiveLens(f)==="seed");
  return (state.poolMode==="thread"&&state.poolThread)?state.poolThread:state.poolAll;
}'''
new_pool = '''function poolTabs(){
  if(!["thread","all"].includes(state.poolMode))state.poolMode=state.poolThread?"thread":"all";
  if(!state.poolThread)return "";
  return `<div class="pool-tabs">
    <button class="pool-tab ${state.poolMode==="thread"?"on":""}" data-pool-mode="thread" type="button">이 Thread ${state.poolThread.length}</button>
    <button class="pool-tab ${state.poolMode==="all"?"on":""}" data-pool-mode="all" type="button">전체 ${state.poolAll.length}</button>
  </div>`;
}
function currentPool(){
  if(!["thread","all"].includes(state.poolMode))state.poolMode=state.poolThread?"thread":"all";
  return (state.poolMode==="thread"&&state.poolThread)?state.poolThread:state.poolAll;
}'''
if index.count(old_pool) != 1:
    raise SystemExit(f"Studio pool seed block: expected 1, found {index.count(old_pool)}")
index = index.replace(old_pool, new_pool, 1)

old_attach_head = '''function renderAttachList(){
  const tabs=$("attachTabs");
  const seedCount=state.fragments.filter(f=>effectiveLens(f)==="seed").length;
  if(tabs)tabs.innerHTML=`<div class="pool-tabs">
    ${state.attachThread?`<button class="pool-tab ${state.attachMode==="thread"?"on":""}" data-attach-mode="thread" type="button">이 Thread ${state.attachThread.length}</button>`:""}
    <button class="pool-tab ${state.attachMode==="all"?"on":""}" data-attach-mode="all" type="button">전체 ${state.attachAll.length}</button>
    ${seedCount?`<button class="pool-tab ${state.attachMode==="seed"?"on":""}" data-attach-mode="seed" type="button">✨ 씨앗 ${seedCount}</button>`:""}</div>`;'''
new_attach_head = '''function renderAttachList(){
  const tabs=$("attachTabs");
  if(!["thread","all"].includes(state.attachMode))state.attachMode=state.attachThread?"thread":"all";
  if(tabs)tabs.innerHTML=`<div class="pool-tabs">
    ${state.attachThread?`<button class="pool-tab ${state.attachMode==="thread"?"on":""}" data-attach-mode="thread" type="button">이 Thread ${state.attachThread.length}</button>`:""}
    <button class="pool-tab ${state.attachMode==="all"?"on":""}" data-attach-mode="all" type="button">전체 ${state.attachAll.length}</button>
  </div>`;'''
if index.count(old_attach_head) != 1:
    raise SystemExit(f"attach seed tabs: expected 1, found {index.count(old_attach_head)}")
index = index.replace(old_attach_head, new_attach_head, 1)

old_attach_pool = '''  let pool=state.attachMode==="seed"?state.fragments.filter(f=>effectiveLens(f)==="seed")
    :(state.attachMode==="thread"&&state.attachThread)?state.attachThread:state.attachAll;'''
new_attach_pool = '''  let pool=(state.attachMode==="thread"&&state.attachThread)?state.attachThread:state.attachAll;'''
if index.count(old_attach_pool) != 1:
    raise SystemExit(f"attach seed pool: expected 1, found {index.count(old_attach_pool)}")
index = index.replace(old_attach_pool, new_attach_pool, 1)

# Label is source-owned now; it must already be the new wording from v76.
old_label = "이 생각을 조금 더 표시해둘까요?"
new_label = "이 생각은 지금 내게 어떤 역할을 하나요?"
if old_label in index:
    raise SystemExit("old edit label still present before v77 refactor")
if index.count(new_label) != 1:
    raise SystemExit(f"new edit label: expected 1 source occurrence, found {index.count(new_label)}")

# -----------------------------------------------------------------------------
# 3) Remove the entire badge runtime monkey-patch from storage-fix.js.
# -----------------------------------------------------------------------------
marker = "/* Fragment badge runtime v76 · 2026-09-04"
if storage.count(marker) != 1:
    raise SystemExit(f"storage badge runtime marker: expected 1, found {storage.count(marker)}")
pos = storage.index(marker)
# v76 badge runtime is intentionally the final block in storage-fix.js.
if "[fragment-badges-v76]" not in storage[pos:]:
    raise SystemExit("storage badge runtime tail did not match expected v76 content")
storage = storage[:pos].rstrip() + "\n"

# -----------------------------------------------------------------------------
# 4) Rotate SW cache only. The service worker still injects storage-fix.js for
#    storage/AI usage fixes, but badge behavior no longer lives there.
# -----------------------------------------------------------------------------
replacements = [
    ("v23: Fragment badge v76 문구·렌더 일치 반영을 위해 캐시를 갱신한다.",
     "v24: Fragment badge v77 source refactor 반영을 위해 캐시를 갱신한다."),
    ('const CACHE = "garden-v23-fragment-badge-v76";',
     'const CACHE = "garden-v24-fragment-badge-source-v77";'),
    ('const PATCH_VERSION = "20260904-1740-fragment-badge-v76";',
     'const PATCH_VERSION = "20260904-1810-fragment-badge-source-v77";'),
]
for old, new in replacements:
    if sw.count(old) != 1:
        raise SystemExit(f"sw marker missing or duplicated: {old}")
    sw = sw.replace(old, new, 1)

# -----------------------------------------------------------------------------
# Guardrails: verify the resulting architecture before writing.
# -----------------------------------------------------------------------------
if 'data-pool-mode="seed"' in index or 'data-attach-mode="seed"' in index:
    raise SystemExit("seed Studio buttons still remain")
if 'state.poolMode==="seed"' in index or 'state.attachMode==="seed"' in index:
    raise SystemExit("seed Studio mode branches still remain")
if 'seedCount=state.fragments.filter(f=>effectiveLens(f)==="seed")' in index:
    raise SystemExit("seed Studio count logic still remains")
if 'Fragment badge runtime' in storage or '[fragment-badges-v' in storage:
    raise SystemExit("badge runtime still remains in storage-fix.js")
if 'fragment-badges-v75-style' in storage or 'fragment-badges-v74-style' in storage:
    raise SystemExit("runtime badge CSS still remains in storage-fix.js")
if 'const LENS_BY_ID=' not in index or 'const LEGACY_LENS_IDS=' not in index:
    raise SystemExit("source compatibility metadata missing")
if index.count('class="helper lens-legacy-note"') != 1:
    raise SystemExit("legacy edit notice is not source-owned exactly once")
if 'garden-v24-fragment-badge-source-v77' not in sw:
    raise SystemExit("service worker v24 marker missing")

index_path.write_text(index, encoding="utf-8")
storage_path.write_text(storage, encoding="utf-8")
sw_path.write_text(sw, encoding="utf-8")

print("Fragment badge v77 source refactor verified")

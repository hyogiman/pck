from pathlib import Path

index_path = Path("index.html")
storage_path = Path("storage-fix.js")
sw_path = Path("sw.js")

old_label = '이 생각을 조금 더 표시해둘까요?'
new_label = '이 생각은 지금 내게 어떤 역할을 하나요?'

# 1) Source HTML itself must contain the new wording, so even a navigation that
# bypasses the service worker shows the correct label.
index = index_path.read_text(encoding="utf-8")
count = index.count(old_label)
if count != 1:
    raise SystemExit(f"index label: expected 1 match, found {count}")
index = index.replace(old_label, new_label, 1)
index_path.write_text(index, encoding="utf-8")

# 2) The edit renderer also enforces the label whenever the dialog is rendered.
# This protects against later DOM rerenders and makes the runtime self-healing.
storage = storage_path.read_text(encoding="utf-8")
old_runtime = '''  renderEditLens=function renderEditLensV75(){
    const box=$("editLensRow");if(!box)return;
    const legacy=LEGACY_IDS.has(state.editLens)?BADGE_BY_ID.get(state.editLens):null;'''
new_runtime = '''  renderEditLens=function renderEditLensV76(){
    const box=$("editLensRow");if(!box)return;
    const field=box.closest(".field");
    const label=field?.querySelector("label");
    if(label)label.innerHTML=`이 생각은 지금 내게 어떤 역할을 하나요? <span style="color:var(--muted);font-weight:500">(선택하지 않아도 됩니다)</span>`;
    const legacy=LEGACY_IDS.has(state.editLens)?BADGE_BY_ID.get(state.editLens):null;'''
if storage.count(old_runtime) != 1:
    raise SystemExit(f"runtime renderer: expected 1 match, found {storage.count(old_runtime)}")
storage = storage.replace(old_runtime, new_runtime, 1)
storage = storage.replace('Fragment badge runtime v75', 'Fragment badge runtime v76', 1)
storage = storage.replace('installFragmentBadgeV75', 'installFragmentBadgeV76', 1)
storage = storage.replace('__fragmentBadgesV75Installed', '__fragmentBadgesV76Installed')
storage = storage.replace('[fragment-badges-v75]', '[fragment-badges-v76]')
storage_path.write_text(storage, encoding="utf-8")

# 3) Rotate the service-worker cache/version so old HTML/runtime cannot linger.
sw = sw_path.read_text(encoding="utf-8")
sw = sw.replace('v22: Fragment badge v75 반영을 위해 런타임 패치 버전과 캐시를 갱신한다.', 'v23: Fragment badge v76 문구·렌더 일치 반영을 위해 캐시를 갱신한다.', 1)
sw = sw.replace('garden-v22-fragment-badge-v75', 'garden-v23-fragment-badge-v76', 1)
sw = sw.replace('20260904-1725-fragment-badge-v75', '20260904-1740-fragment-badge-v76', 1)
sw_path.write_text(sw, encoding="utf-8")

# Guardrails
index_check = index_path.read_text(encoding="utf-8")
storage_check = storage_path.read_text(encoding="utf-8")
sw_check = sw_path.read_text(encoding="utf-8")
if old_label in index_check:
    raise SystemExit("old label still remains in index.html")
if new_label not in index_check:
    raise SystemExit("new label missing in index.html")
if 'renderEditLensV76' not in storage_check or new_label not in storage_check:
    raise SystemExit("v76 runtime label enforcement missing")
if 'garden-v23-fragment-badge-v76' not in sw_check:
    raise SystemExit("service worker v23 cache marker missing")

print("fragment label v76 patch verified")

from pathlib import Path
import re

VERSION = "20260907-reading-v33"


def read(path):
    return Path(path).read_text(encoding="utf-8")


def write(path, text):
    Path(path).write_text(text, encoding="utf-8")


def replace_function(text, name, replacement):
    markers = [f"async function {name}(", f"function {name}("]
    starts = [text.find(m) for m in markers if text.find(m) >= 0]
    if not starts:
        raise SystemExit(f"function not found: {name}")
    start = min(starts)
    brace = text.find("{", start)
    if brace < 0:
        raise SystemExit(f"opening brace not found: {name}")
    depth = 0
    quote = None
    escape = False
    i = brace
    while i < len(text):
        c = text[i]
        if quote:
            if escape:
                escape = False
            elif c == "\\":
                escape = True
            elif c == quote:
                quote = None
        else:
            if c in ('"', "'", "`"):
                quote = c
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return text[:start] + replacement.strip() + text[i + 1:]
        i += 1
    raise SystemExit(f"closing brace not found: {name}")


def replace_between(text, start_marker, end_marker, replacement):
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"missing start marker: {start_marker}")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"missing end marker after {start_marker}: {end_marker}")
    return text[:start] + replacement.rstrip() + "\n" + text[end:]


# ------------------------------------------------------------------
# reading.js — make the session the real outer boundary and own deletes
# ------------------------------------------------------------------
p = Path("reading.js")
s = p.read_text(encoding="utf-8")

safe_anchor = 'const safeText=v=>String(v??"").trim();'
if safe_anchor not in s:
    raise SystemExit("safeText anchor missing")
helpers = r'''
const timelineTrashIcon=()=>'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function entryKindLabel(e){const handwriting=e?.inputMethod==="handwriting",quote=!!safeText(e?.quoteText||e?.confirmedText||e?.externalText),thought=!!safeText(e?.thought);if(handwriting&&thought)return "필사 · 생각";if(handwriting)return "필사";if(quote&&thought)return "문장 · 생각";if(thought)return "생각";if(quote)return "문장";return "독서 기록"}
async function confirmReadingAction({title,message,confirmText="확인",cancelText="취소",danger=true}={}){if(typeof window.rgConfirm==="function")return await window.rgConfirm({title,message,confirmText,cancelText,danger});return window.confirm(message||title||"이 작업을 진행할까요?")}
'''
s = s.replace(safe_anchor, safe_anchor + "\n" + helpers.strip(), 1)

s = replace_function(s, "renderEntryHtml", r'''
function renderEntryHtml(e,{legacy=false,deletable=true}={}){
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
}''')

s = replace_function(s, "renderEvent", r'''
function renderEvent(ev,filter="all"){
  if(ev.type==="session"){
    const source=sourceById(ev.session.sourceId),entries=ev.entries.filter(e=>entryMatches(e,filter));
    if(filter!=="all"&&!entries.length)return "";
    const entryFolder=entries.length
      ? `<div class="timeline-entry-folder"><div class="timeline-entry-folder-head"><span>이 독서시간에 남긴 기록</span><strong>${entries.length}</strong></div><div class="timeline-entry-list">${entries.map(e=>renderEntryHtml(e)).join("")}</div></div>`
      : `<div class="timeline-entry-folder is-empty"><div class="timeline-entry-folder-head"><span>이 독서시간에 남긴 기록</span><strong>0</strong></div><div class="timeline-entry-empty">이 시간에는 따로 남긴 문장·필사·생각이 없습니다.</div></div>`;
    return `<div class="timeline-card"><article class="timeline-session is-reading-session">
      <div class="timeline-session-head">
        ${source?.image?`<img class="timeline-thumb" src="${esc(source.image)}" alt="">`:`<div class="timeline-thumb"></div>`}
        <div class="timeline-session-main"><h3>${esc(source?.title||"책")}</h3><p>${timeText(ev.session.startedAt)}${ev.session.endedAt?` – ${timeText(ev.session.endedAt)}`:""} · ${fmtMinutes(ev.session.finalDurationMinutes)} · ${esc(SERVICE_LABELS[ev.session.service]||"")}</p></div>
        <button class="timeline-delete-btn timeline-session-delete" data-delete-session="${esc(ev.session.id)}" type="button" aria-label="독서시간 기록 삭제" title="독서시간 기록 삭제">${timelineTrashIcon()}</button>
      </div>
      ${entryFolder}
      ${ev.session.sessionNote&&filter==="all"?`<div class="session-note">“${esc(ev.session.sessionNote)}”</div>`:""}
    </article></div>`
  }
  if(ev.type==="entry"){
    if(!entryMatches(ev.entry,filter))return "";
    const source=sourceById(ev.entry.sourceId);
    return `<div class="timeline-card"><article class="timeline-session is-standalone-entry"><div class="timeline-session-head"><div class="timeline-session-main"><h3>${esc(source?.title||"책")}</h3><p>시간 기록 없이 남긴 독서 기록</p></div></div><div class="timeline-entry-folder is-standalone"><div class="timeline-entry-list">${renderEntryHtml(ev.entry)}</div></div></article></div>`
  }
  if(ev.type==="legacy"){
    const f=ev.fragment,e={sourceId:f.sourceId,locator:f.locator,externalText:f.externalText,thought:f.thought};
    if(filter==="handwriting")return "";if(filter==="quote"&&!safeText(f.externalText))return "";if(filter==="thought"&&!safeText(f.thought))return "";
    const source=sourceById(f.sourceId);
    return `<div class="timeline-card"><article class="timeline-session is-standalone-entry is-legacy"><div class="timeline-session-head"><div class="timeline-session-main"><h3>${esc(source?.title||"책")}</h3><p>생각의 텃밭에서 가져온 예전 기록</p></div></div><div class="timeline-entry-folder is-standalone"><div class="timeline-entry-list">${renderEntryHtml(e,{legacy:true,deletable:false})}</div></div></article></div>`
  }
  if(ev.type==="complete"&&filter==="all"){
    const c=ev.cycle,source=sourceById(c.sourceId),m=bookMetrics(c.sourceId);
    return `<div class="timeline-card"><div class="completion-event"><div class="complete-mark">◉</div><h3>${esc(source?.title||"책")} 완독</h3><p>${c.startedAt?`${displayDateFull(c.startedAt)} → `:""}${displayDateFull(c.completedAt)}<br>${fmtMinutes(m.mins)} · ${m.days}일 독서</p>${c.oneLineReflection?`<div class="entry-thought">${esc(c.oneLineReflection)}</div>`:""}</div></div>`
  }
  return ""
}''')

insert_anchor = 'function renderTimelineBookOptions(){'
if insert_anchor not in s:
    raise SystemExit("timeline render anchor missing")
delete_helpers = r'''
async function deleteTimelineEntry(entryId,button){
  const entry=state.readingEntries.find(e=>e.id===entryId);if(!entry)return toast("삭제할 독서 기록을 찾지 못했습니다.");
  if(!await confirmReadingAction({title:"독서 기록을 삭제할까요?",message:"이 문장·필사·생각 기록을 독서의 정원에서 삭제합니다.",confirmText:"기록 삭제"}))return;
  let deleteThought=false;
  if(entry.linkedFragmentId){deleteThought=await confirmReadingAction({title:"연결된 생각도 삭제할까요?",message:"이 기록에는 생각의 텃밭과 연결된 내 생각이 있습니다. 생각을 남기려면 ‘생각은 남기기’를 선택하세요.",confirmText:"생각도 삭제",cancelText:"생각은 남기기"})}
  if(button)button.disabled=true;
  try{
    state.readingEntries=state.readingEntries.filter(e=>e.id!==entryId);
    await cloudDelete("readingEntries",entryId);
    if(deleteThought&&entry.linkedFragmentId){state.fragments=state.fragments.filter(f=>f.id!==entry.linkedFragmentId);await cloudDelete("fragments",entry.linkedFragmentId)}
    if(state.idb){await Promise.all([idbDelete("files",`${entryId}:image`).catch(()=>{}),idbDelete("files",`${entryId}:strokes`).catch(()=>{})])}
    await cacheSnapshot();renderAll();toast(deleteThought?"독서 기록과 연결된 생각을 삭제했습니다.":"독서 기록을 삭제했습니다.")
  }catch(err){console.error("timeline entry delete failed",err);toast("삭제 중 문제가 생겼습니다. 동기화 상태를 확인해주세요.",3200);if(button)button.disabled=false}
}
async function deleteTimelineSession(sessionId,button){
  const session=state.readingSessions.find(s=>s.id===sessionId);if(!session)return toast("삭제할 독서시간 기록을 찾지 못했습니다.");
  const entries=state.readingEntries.filter(e=>e.sessionId===sessionId),source=sourceById(session.sourceId),countText=entries.length?`\n\n이 시간 안의 문장·필사·생각 ${entries.length}개는 삭제하지 않고 ‘시간 기록 없이 남긴 독서 기록’으로 보존합니다.`:"";
  if(!await confirmReadingAction({title:"독서시간 기록을 삭제할까요?",message:`${source?.title||"이 책"} · ${timeText(session.startedAt)}${session.endedAt?`–${timeText(session.endedAt)}`:""} · ${fmtMinutes(session.finalDurationMinutes)}${countText}`,confirmText:"독서시간 삭제"}))return;
  if(button)button.disabled=true;
  try{
    const at=nowIso();
    for(const entry of entries){entry.sessionId=null;entry.updatedAt=at;await cloudSet("readingEntries",entry.id,entry,{silent:true})}
    state.readingSessions=state.readingSessions.filter(s=>s.id!==sessionId);await cloudDelete("readingSessions",sessionId);
    const profile=profileById(session.sourceId),remaining=state.readingSessions.filter(s=>s.sourceId===session.sourceId&&s.endedAt).sort((a,b)=>new Date(b.endedAt||b.startedAt)-new Date(a.endedAt||a.startedAt));
    if(profile){profile.lastReadAt=remaining[0]?.endedAt||remaining[0]?.startedAt||"";if((profile.currentLocator||"")===(session.endLocator||""))profile.currentLocator=remaining[0]?.endLocator||"";profile.updatedAt=at;await cloudSet("readingProfiles",profile.id,profile,{silent:true})}
    await cacheSnapshot();renderAll();toast(entries.length?"독서시간만 삭제했습니다. 안의 기록은 그대로 남겼습니다.":"독서시간 기록을 삭제했습니다.")
  }catch(err){console.error("timeline session delete failed",err);toast("삭제 중 문제가 생겼습니다. 동기화 상태를 확인해주세요.",3200);if(button)button.disabled=false}
}
'''
s = s.replace(insert_anchor, delete_helpers.strip() + "\n\n" + insert_anchor, 1)

bind_anchor = 'function bindEvents(){\n  document.addEventListener("click",async e=>{'
if bind_anchor not in s:
    raise SystemExit("bindEvents click anchor missing")
bind_repl = '''function bindEvents(){\n  document.addEventListener("click",async e=>{\n    const entryDelete=e.target.closest("[data-delete-entry]");if(entryDelete){e.preventDefault();e.stopPropagation();return deleteTimelineEntry(entryDelete.dataset.deleteEntry,entryDelete)}\n    const sessionDelete=e.target.closest("[data-delete-session]");if(sessionDelete){e.preventDefault();e.stopPropagation();return deleteTimelineSession(sessionDelete.dataset.deleteSession,sessionDelete)}'''
s = s.replace(bind_anchor, bind_repl, 1)
p.write_text(s, encoding="utf-8")


# ------------------------------------------------------------------
# reading-enhance-v3.js — remove its second, read-heavy delete subsystem
# ------------------------------------------------------------------
p = Path("reading-enhance-v3.js")
s = p.read_text(encoding="utf-8")
s = replace_between(s, 'let timelineLoaded=false,timelineSessions=[],timelineSources=[];', 'function normalizeGenre', '')
s = s.replace('''    const timeline=document.querySelector('[data-view="timeline"].active');\n    if(timeline){if(!timelineLoaded)loadTimelineDeleteData().catch(()=>{});else enhanceTimeline()}\n''', '', 1)
p.write_text(s, encoding="utf-8")


# ------------------------------------------------------------------
# reading-dialogs-v18.js — modal runtime no longer owns timeline deletes
# ------------------------------------------------------------------
p = Path("reading-dialogs-v18.js")
s = p.read_text(encoding="utf-8")
s = s.replace('/* 독서의 정원 v26 — 앱 모달(confirm/alert 대체) + 타임라인 삭제 확인 정리 */', '/* 독서의 정원 v33 — 공용 앱 모달(confirm/alert 대체) */', 1)
s = re.sub(r"const RG_DIALOG_VERSION='[^']+';", f"const RG_DIALOG_VERSION='{VERSION}';", s, count=1)
s = replace_function(s, "interceptClick", r'''
async function interceptClick(e){
  const target=e.target.closest('[data-rg-remove-book],#deleteEntryBtn');
  if(!target)return;
  if(replayClicks.has(target)){replayClicks.delete(target);return}
  e.preventDefault();e.stopImmediatePropagation();

  if(target.matches('[data-rg-remove-book]')){
    const result=await ask({title:'서재에서 제거할까요?',message:'이 책은 독서의 정원 서재에서만 숨겨집니다.\n생각의 텃밭에 있는 책·생각과 지금까지의 독서 기록은 그대로 보존됩니다.',confirmText:'서재에서 제거',danger:true});
    if(!result.ok)return;
    authorize('이 책을 독서의 정원 서재에서 제거할까요?',true);replayClick(target);return;
  }

  if(target.id==='deleteEntryBtn'){
    const hasLinkedThought=!!document.getElementById('entryThought')?.value.trim();
    clearApprovals('연결된 생각의 텃밭 생각도 함께 삭제할까요?');
    const result=await ask({title:'독서 기록을 삭제할까요?',message:'이 기록을 삭제하면 독서의 정원 타임라인에서 사라집니다.',confirmText:'기록 삭제',danger:true,checkboxText:hasLinkedThought?'연결된 생각의 텃밭 생각도 함께 삭제':''});
    if(!result.ok)return;
    authorize('이 독서 기록을 삭제할까요?',true,120000);
    authorize('연결된 생각의 텃밭 생각도 함께 삭제할까요?',hasLinkedThought&&result.checked,120000);
    replayClick(target);
  }
}''')
p.write_text(s, encoding="utf-8")


# ------------------------------------------------------------------
# reading.css — one canonical timeline hierarchy, no legacy delete CSS
# ------------------------------------------------------------------
p = Path("reading.css")
s = p.read_text(encoding="utf-8")
timeline_css = r'''
.timeline-tools{display:grid;gap:9px;margin-bottom:18px}
.timeline-list{display:grid;gap:25px}
.day-group{position:relative}
.day-title{font-family:var(--serif);font-size:1rem;font-weight:700;margin-bottom:10px}
.timeline-card{position:relative;margin-left:12px;padding:0 0 0 20px;border-left:2px solid #d9ddcf}
.timeline-card:before{content:"";position:absolute;left:-6px;top:3px;width:10px;height:10px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px var(--bg)}
.timeline-session{border:1px solid var(--line);background:var(--panel);border-radius:18px;padding:15px;box-shadow:var(--card-shadow)}
.timeline-session.is-reading-session{border-color:#d7c7b3;box-shadow:0 7px 22px rgba(78,57,39,.065)}
.timeline-session.is-standalone-entry{border-style:dashed}
.timeline-session-head{display:flex;align-items:center;gap:10px;min-height:44px}
.timeline-session-main{flex:1;min-width:0}
.timeline-thumb{width:38px;height:54px;border-radius:6px;object-fit:cover;background:var(--panel2);flex:0 0 auto}
.timeline-session-head h3{font-family:var(--serif);font-size:.92rem;margin:0 0 3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.timeline-session-head p{margin:0;color:var(--muted);font-size:.68rem;line-height:1.45}
.timeline-entry-folder{margin-top:14px;padding:12px;background:#f5ede2;border:1px solid #e0d2c0;border-radius:15px}
.timeline-entry-folder.is-standalone{margin-top:12px;background:#f7f1e8}
.timeline-entry-folder-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;color:#765f4b;font-size:.68rem;font-weight:800}
.timeline-entry-folder-head strong{display:grid;place-items:center;min-width:24px;height:24px;padding:0 7px;border-radius:999px;background:#e7dac9;color:#765f4b;font-size:.66rem}
.timeline-entry-list{display:grid;gap:13px}
.timeline-entry{position:relative;margin:0;padding:12px 12px 13px;border:1px solid #e0d5c7;background:#fffaf3;border-radius:13px;cursor:pointer;box-shadow:0 2px 8px rgba(78,57,39,.035)}
.timeline-entry.is-legacy{cursor:default}
.timeline-entry-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:36px;margin-bottom:7px}
.timeline-entry-type{display:inline-flex;align-items:center;min-height:24px;padding:4px 8px;border-radius:999px;background:#ece5d9;color:#776653;font-size:.62rem;font-weight:800}
.timeline-entry-empty{padding:8px 2px 1px;color:var(--muted);font-size:.7rem;line-height:1.5}
.timeline-delete-btn{width:40px;height:40px;flex:0 0 auto;display:grid;place-items:center;border:0;border-radius:50%;padding:0;background:transparent;color:#91786a;box-shadow:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.timeline-delete-btn svg{width:18px;height:18px;display:block;pointer-events:none}
.timeline-delete-btn:hover{background:#f1e4dc;color:var(--danger)}
.timeline-delete-btn:active{transform:scale(.94);background:#ead9cf}
.timeline-delete-btn:disabled{opacity:.38;cursor:wait}
.timeline-session-delete{margin-left:auto}
.entry-locator{font-size:.65rem;color:var(--accent);font-weight:800;margin-bottom:7px}
.entry-quote{font-family:var(--serif);font-size:.96rem;line-height:1.65;border-left:3px solid var(--accent);padding-left:11px;white-space:pre-wrap}
.entry-thought{margin-top:10px;background:var(--accent3);color:#31533d;border-radius:12px;padding:10px 11px;font-family:var(--serif);font-size:.88rem;line-height:1.6;white-space:pre-wrap}
.entry-thought:before{content:"🌱 내 생각";display:block;font-family:var(--sans);font-size:.62rem;font-weight:850;margin-bottom:5px;color:var(--accent)}
.handwriting-preview{display:block;width:100%;max-height:220px;object-fit:contain;background:#fff;border-radius:10px;margin:6px 0;border:1px solid var(--line)}
.session-note{margin-top:12px;padding-top:10px;border-top:1px dashed #dfd2c1;font-size:.72rem;color:var(--muted);font-style:italic}
.legacy-badge{display:inline-block;font-size:.59rem;color:var(--muted);margin-top:8px}
.completion-event{text-align:center;padding:17px;border:1px solid #d7e2d7;background:linear-gradient(145deg,#fffefa,#eef5ed);border-radius:17px}
.completion-event .complete-mark{font-size:1.4rem;color:var(--accent)}
.completion-event h3{font-family:var(--serif);margin:6px 0}
.completion-event p{font-size:.73rem;color:var(--muted);line-height:1.55}
@media (pointer:coarse){.timeline-delete-btn{width:44px;height:44px}}
@media print{.timeline-delete-btn{display:none!important}}
'''
s = replace_between(s, '.timeline-tools{', '.stats-summary{', timeline_css)
# Remove the old duplicate delete styling blocks that used to be spread across consolidated layers.
s = re.sub(r'/\* 완료된 독서 세션 삭제 \*/.*?/\* 장르 보완 도구 \*/', '/* 장르 보완 도구 */', s, flags=re.S, count=1)
s = s.replace('.rg-session-delete{color:#96766a}\n.rg-session-delete:hover{background:#f3e4df;color:var(--danger)}\n', '', 1)
s = s.replace('@media print{.rg-session-delete,.rg-picker-new,.rg-genre-card{display:none!important}}', '@media print{.rg-picker-new,.rg-genre-card{display:none!important}}', 1)
s = re.sub(r'/\* ===== consolidated from runtime styles in reading-hotfix-v4\.js ===== \*/.*?(?=/\* ===== v30 canonical no-inline-style rules ===== \*/)', '', s, flags=re.S, count=1)
if '.rg-session-delete' in s:
    raise SystemExit('legacy rg-session-delete CSS still remains')
p.write_text(s, encoding="utf-8")


# ------------------------------------------------------------------
# HTML / PWA / SW — remove hotfix runtime and bump cache/version
# ------------------------------------------------------------------
p = Path("reading.html")
s = p.read_text(encoding="utf-8")
s = s.replace('  <script type="module" src="./reading-hotfix-v4.js?v=20260907-reading-v32"></script>\n', '', 1)
s = s.replace('20260907-reading-v32', VERSION)
p.write_text(s, encoding="utf-8")

p = Path("reading-pwa-v7.js")
s = p.read_text(encoding="utf-8")
s = s.replace('/* 독서의 정원 v32 —', '/* 독서의 정원 v33 —', 1)
s = s.replace('20260907-reading-v32', VERSION)
p.write_text(s, encoding="utf-8")

p = Path("sw.js")
s = p.read_text(encoding="utf-8")
s = s.replace('v32: 생각의 텃밭과 독서의 정원 도서 검색에 페이지형 더보기를 지원한다.', 'v33: 독서시간을 상위 경계로 두고 그 안에 문장·필사·생각 기록을 묶는다.', 1)
s = s.replace('const CACHE = "garden-v32-book-search-pagination-v83";', 'const CACHE = "garden-v33-reading-timeline-folders-v84";', 1)
s = s.replace('  "./reading-enhance-v3.js", "./reading-hotfix-v4.js", "./reading-genre-v5.js",', '  "./reading-enhance-v3.js", "./reading-genre-v5.js",', 1)
s = s.replace('    url.pathname.endsWith("/reading-enhance-v3.js")||url.pathname.endsWith("/reading-hotfix-v4.js")||\n', '    url.pathname.endsWith("/reading-enhance-v3.js")||\n', 1)
p.write_text(s, encoding="utf-8")

hotfix = Path("reading-hotfix-v4.js")
if hotfix.exists():
    hotfix.unlink()

# ------------------------------------------------------------------
# Guard the invariants of this refactor.
# ------------------------------------------------------------------
checks = {
    "reading.js": ["timeline-entry-folder", "data-delete-session", "data-delete-entry", "deleteTimelineSession", "deleteTimelineEntry", "if(thought){", "else if(entry.linkedFragmentId)"],
    "reading.css": [".timeline-entry-list{display:grid;gap:13px}", ".timeline-delete-btn{"],
    "reading.html": [VERSION],
}
for path, needles in checks.items():
    text = read(path)
    for needle in needles:
        if needle not in text:
            raise SystemExit(f"missing guard {needle!r} in {path}")

if "loadTimelineDeleteData" in read("reading-enhance-v3.js"):
    raise SystemExit("read-heavy enhancement delete subsystem still present")
if ".rg-session-delete" in read("reading-dialogs-v18.js"):
    raise SystemExit("dialog runtime still intercepts legacy session-delete buttons")
if "reading-hotfix-v4.js" in read("reading.html") or "reading-hotfix-v4.js" in read("sw.js"):
    raise SystemExit("hotfix runtime reference still present")
if Path("reading-hotfix-v4.js").exists():
    raise SystemExit("hotfix runtime file still exists")

print("PASS: Reading timeline now uses session > nested reading records hierarchy")
print("PASS: session and entry deletes are owned by reading.js without extra Firestore scans")
print("PASS: timeline CSS lives only in reading.css; legacy delete CSS removed")
print("PASS: handwriting/thought boundary guards remain")

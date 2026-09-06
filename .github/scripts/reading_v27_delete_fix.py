from pathlib import Path

path = Path('reading-hotfix-v4.js')
text = path.read_text(encoding='utf-8')

replacements = []

old = '''/* 독서의 정원 v26 hotfix — 타임라인 삭제 버튼/동작 단일화 */'''
new = '''/* 독서의 정원 v27 hotfix — 타임라인 삭제 버튼/동작 단일화 + 앱 확인모달 직접 사용 */'''
replacements.append((old, new))

old = '''function iconHtml(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'}\n'''
new = '''function iconHtml(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'}\nasync function confirmAction({title,message,confirmText,cancelText="취소",danger=true}){\n  if(typeof window.rgConfirm==="function")return await window.rgConfirm({title,message,confirmText,cancelText,danger});\n  return window.confirm(message||title);\n}\n'''
replacements.append((old, new))

old = '''  const entries=data.entries.filter(e=>e.sessionId===sessionId),book=titleOf(target.sourceId)||"이 책",extra=entries.length?`\\n\\n이 세션 안의 문장·필사·생각 ${entries.length}개는 삭제하지 않고 독립 기록으로 남깁니다.`:"";\n  if(!confirm(`이 독서시간 기록을 삭제할까요?\\n${book} · ${timeText(target.startedAt)}–${timeText(target.endedAt)} · ${Math.round(Number(target.finalDurationMinutes)||0)}분${extra}`))return;\n'''
new = '''  const entries=data.entries.filter(e=>e.sessionId===sessionId),book=titleOf(target.sourceId)||"이 책",extra=entries.length?`\\n\\n이 세션 안의 문장·필사·생각 ${entries.length}개는 삭제하지 않고 독립 기록으로 남깁니다.`:"";\n  const sessionMessage=`${book} · ${timeText(target.startedAt)}–${timeText(target.endedAt)} · ${Math.round(Number(target.finalDurationMinutes)||0)}분${extra}`;\n  if(!await confirmAction({title:"독서시간 기록을 삭제할까요?",message:sessionMessage,confirmText:"독서시간 삭제"}))return;\n'''
replacements.append((old, new))

old = '''  const data=await loadTimelineData(true),entry=data?.entries.find(e=>e.id===entryId);if(!entry)return toast("삭제할 독서 기록을 찾지 못했습니다. 화면을 다시 열어주세요.");\n  if(!confirm("이 독서 기록을 삭제할까요?"))return;\n  let deleteThought=false;if(entry.linkedFragmentId)deleteThought=confirm("이 기록에 연결된 생각의 텃밭 생각도 함께 삭제할까요?\\n\\n취소를 누르면 생각의 텃밭 생각은 그대로 남깁니다.");\n'''
new = '''  const data=await loadTimelineData(true),entry=data?.entries.find(e=>e.id===entryId);if(!entry)return toast("삭제할 독서 기록을 찾지 못했습니다. 화면을 다시 열어주세요.");\n  if(!await confirmAction({title:"독서 기록을 삭제할까요?",message:"이 기록을 삭제하면 독서의 정원 타임라인에서 사라집니다.",confirmText:"기록 삭제"}))return;\n  let deleteThought=false;\n  if(entry.linkedFragmentId){\n    deleteThought=await confirmAction({\n      title:"연결된 생각도 삭제할까요?",\n      message:"이 독서 기록에 연결된 생각의 텃밭 생각이 있습니다.\\n\\n생각까지 삭제하려면 ‘생각도 삭제’를 누르고, 생각을 남기려면 ‘생각은 남기기’를 누르세요.",\n      confirmText:"생각도 삭제",cancelText:"생각은 남기기"\n    });\n  }\n'''
replacements.append((old, new))

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected exactly one match, got {count}: {old[:90]!r}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('patched reading-hotfix-v4.js for v27 delete flow')

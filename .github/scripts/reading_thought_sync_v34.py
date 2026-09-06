from pathlib import Path

p=Path('reading.js')
s=p.read_text(encoding='utf-8')
start=s.find('async function saveEntry(){')
end=s.find('async function deleteCurrentEntry()', start)
if start < 0 or end < 0:
    raise SystemExit('saveEntry block markers not found')

replacement=r'''async function saveEntry(){
  if(state.entrySaving)return;
  const quote=safeText($("entryQuote").value),thought=safeText($("entryThought").value),locator=safeText($("entryLocator").value),editing=state.editingEntryId?state.readingEntries.find(e=>e.id===state.editingEntryId):null,previousThought=safeText(editing?.thought),previousFragmentId=editing?.linkedFragmentId||null,d=state.handwriting.draft,hasHandwriting=!!d?.imageBlob||!!(editing?.inputMethod==="handwriting"&&(editing.handwritingImageUrl||editing.handwritingPending||d?.existing));
  if(!quote&&!thought&&!hasHandwriting)return toast("문장, 필사, 생각 중 하나는 남겨주세요.");
  const sourceId=editing?.sourceId||state.activeSession?.sourceId||state.detailBookId||state.currentBookId;if(!sourceId)return toast("연결할 책을 찾지 못했습니다.");
  setEntrySaving(true);
  try{
    const cycle=editing?.cycleId?state.readingCycles.find(c=>c.id===editing.cycleId):ensureCycle(sourceId),entry=editing||{id:uid(),sourceId,cycleId:cycle?.id||null,sessionId:state.activeSession?.id||null,createdAt:nowIso()};
    Object.assign(entry,{locator,quoteText:quote,thought,inputMethod:hasHandwriting?"handwriting":"typing",rawOcrText:d?.rawOcrText||entry.rawOcrText||"",suggestedText:d?.suggestedText||entry.suggestedText||"",confirmedText:d?.confirmedText||quote,updatedAt:nowIso()});

    /* Thought Garden boundary:
       - 새 생각은 Fragment를 만든다.
       - 기존 생각의 '내 생각' 텍스트가 실제로 바뀐 경우에만 Fragment를 갱신한다.
       - 문장/위치/OCR/필사 이미지 같은 Reading-only 변경은 Fragment를 절대 다시 쓰지 않는다.
       이렇게 해야 나중에 필사만 덧붙여도 Thought Garden AI/인덱싱 작업이 다시 시작되지 않는다. */
    if(thought){
      const fragmentId=previousFragmentId||uid();
      entry.linkedFragmentId=fragmentId;
      const thoughtChanged=!previousFragmentId||thought!==previousThought;
      if(thoughtChanged){
        const old=state.fragments.find(f=>f.id===fragmentId),fragment={id:fragmentId,type:"source",sourceId,externalText:quote,locator,thought,threadIds:old?.threadIds||[],date:localDate(entry.createdAt),createdAt:old?.createdAt||entry.createdAt,updatedAt:nowIso()},fi=state.fragments.findIndex(f=>f.id===fragmentId);
        if(fi>=0)state.fragments[fi]=fragment;else state.fragments.push(fragment);
        await cloudSet("fragments",fragmentId,fragment,{silent:true});
      }
    }else if(previousFragmentId){
      await cloudDelete("fragments",previousFragmentId);
      state.fragments=state.fragments.filter(f=>f.id!==previousFragmentId);
      entry.linkedFragmentId=null;
    }

    const i=state.readingEntries.findIndex(e=>e.id===entry.id);if(i>=0)state.readingEntries[i]=entry;else state.readingEntries.push(entry);
    if(d?.imageBlob&&!d.existing){entry.handwritingPending=true;await saveHandwritingFiles(entry)}else await cloudSet("readingEntries",entry.id,entry,{silent:true});
    await cacheSnapshot();closeDialog("recordDialog");state.editingEntryId=null;state.handwriting.draft=null;renderTimeline();if(state.detailBookId)renderBookDetail();toast(hasHandwriting?"기록했습니다. 필사 이미지는 이어서 동기화합니다. ✍":"기록했습니다 🌱")
  }catch(err){console.error("saveEntry failed",err);toast("기록 저장에 실패했습니다. 다시 시도해주세요.",3200)}finally{setEntrySaving(false)}
}
'''

s=s[:start]+replacement+s[end:]

if s.count('async function saveEntry(){') != 1:
    raise SystemExit('saveEntry must exist exactly once')
if 'const thoughtChanged=!previousFragmentId||thought!==previousThought;' not in s:
    raise SystemExit('thought-only sync guard missing')
if '문장/위치/OCR/필사 이미지 같은 Reading-only 변경은 Fragment를 절대 다시 쓰지 않는다.' not in s:
    raise SystemExit('Thought Garden boundary comment missing')

p.write_text(s,encoding='utf-8')
print('PASS: Reading fragment sync now depends on thought text changes only')

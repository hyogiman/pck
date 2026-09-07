from pathlib import Path

js_path=Path('reading.js')
html_path=Path('reading.html')
js=js_path.read_text(encoding='utf-8')
html=html_path.read_text(encoding='utf-8')

old='''function serviceText(p){return SERVICE_LABELS[p?.service]||FORMAT_LABELS[p?.format]||"독서"}'''
new='''function serviceText(p){
  const format=p?.format||"",service=p?.service||"";
  if(format==="paper"||service==="paper")return "종이책";
  if(format==="pdf")return "PDF";
  if(format==="audiobook")return "오디오북";
  if(format==="ebook"){
    if(service==="millie")return "밀리의 서재";
    if(service==="yes24")return "YES24";
    return "전자책";
  }
  if(service==="millie")return "밀리의 서재";
  if(service==="yes24")return "YES24";
  return FORMAT_LABELS[format]||"독서";
}'''
if old not in js:
    raise SystemExit('serviceText marker not found')
js=js.replace(old,new,1)

old_session='''${esc(SERVICE_LABELS[ev.session.service]||"")}'''
new_session='''${esc(serviceText(ev.session))}'''
if old_session not in js:
    raise SystemExit('timeline session service marker not found')
js=js.replace(old_session,new_session,1)

old_ver='./reading.js?v=20260908-reading-v38'
new_ver='./reading.js?v=20260908-reading-v39'
if old_ver not in html:
    raise SystemExit('reading.js v38 cache marker not found')
html=html.replace(old_ver,new_ver,1)

js_path.write_text(js,encoding='utf-8')
html_path.write_text(html,encoding='utf-8')
print('PASS: Reading v39 medium labels applied')

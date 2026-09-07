from pathlib import Path

html_path=Path('reading.html')
html=html_path.read_text(encoding='utf-8')
html=html.replace('📝️','📝')
html_path.write_text(html,encoding='utf-8')
print('PASS: cleaned handwriting note emoji variation selector')

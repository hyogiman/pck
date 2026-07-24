# V0.8.0 책 검색 서버 배포

## 왜 바뀌었나
- 알라딘: GitHub Pages 브라우저에서 직접 JSONP 호출하지 않음.
- Firebase Function이 알라딘의 공식 HTTP API endpoint를 서버에서 호출.
- TTB Key는 브라우저가 아니라 Firebase Secret에 보관.
- Google Books: 현재 Google 공식 문서 요구사항에 맞게 API Key를 붙여 호출.

## 1회 배포 명령
이 폴더의 루트(index.html, firebase.json, functions 폴더가 보이는 위치)에서:

```bash
npm install -g firebase-tools
firebase login
firebase functions:secrets:set ALADIN_TTB_KEY
```

마지막 명령에서 알라딘 TTB Key를 입력합니다.

그 다음:

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

정상 배포되면 `bookSearch` 함수 URL이 출력됩니다.
index.html은 기본적으로 아래 주소를 사용하도록 설정되어 있습니다.

`https://us-central1-idea-pocket-56063.cloudfunctions.net/bookSearch`

## Google Books
Google Cloud Console에서 현재 사용 중인 Google API Key에:
- Books API
- YouTube Data API v3

둘 다 허용합니다.

그 키를 생각의 텃밭 설정의 `Google API Key · Books + YouTube`에 입력합니다.

## Firestore Rules
변경 없음.

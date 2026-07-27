# migration.js 통합 방법

## 1) index.js에 export 추가 (기존 bookSearch는 그대로 둡니다)

```js
// functions/index.js 맨 아래에 두 줄만 추가
const migration = require("./migration");
exports.prepareMigration  = migration.prepareMigration;
exports.completeMigration = migration.completeMigration;
```

## 2) package.json 의존성 확인

migration.js가 쓰는 것은 이미 대부분 있을 것입니다. 없는 것만 추가하세요.

```json
{
  "dependencies": {
    "firebase-admin": "^13.0.0",
    "firebase-functions": "^6.0.0"
  },
  "engines": { "node": "20" }
}
```

`@google-cloud/storage`는 firebase-admin에 포함되어 있어 따로 설치할 필요가 없습니다.
`crypto`는 Node 내장입니다.

확인:
```bash
cd functions
npm ls firebase-admin firebase-functions
npm install        # 버전이 낮으면: npm i firebase-admin@latest firebase-functions@latest
```

## 3) 배포 (두 함수만)

```bash
firebase deploy --only functions:prepareMigration,functions:completeMigration
```

bookSearch는 건드리지 않습니다.

## 4) 배포 확인

```bash
firebase functions:list
```
`prepareMigration`, `completeMigration` 이 us-central1에 보이면 성공입니다.

## 5) 첫 테스트 권장 절차

정식 데이터로 바로 하지 마세요.

1. 설정 > 백업 내보내기로 JSON 백업을 먼저 받습니다.
2. 시크릿 창(또는 다른 브라우저)에서 앱을 열어 익명 계정을 새로 만듭니다.
3. 버려도 되는 테스트 데이터를 넣습니다 — 생각 2개 + Library 1개 + 사진 1장 정도.
4. 그 상태에서 기존 Google 계정 연결 → "🌱 기존 텃밭과 합치기".
5. 확인할 것:
   - 조각 수가 기존 + 새것 합계인지
   - 사진이 그대로 보이는지
   - 그 사진이 붙은 조각을 삭제했을 때 Storage에서도 실제로 지워지는지
     (Firebase 콘솔 > Storage > users/{내UID}/fragments 확인)
   - 원본 익명 계정 데이터가 콘솔에 그대로 남아 있는지
6. 여기까지 통과하면 실제 병합을 진행합니다.

## 6) Rules

Firestore Rules / Storage Rules 변경 **불필요**합니다.
- migrationJobs는 최상위 컬렉션이지만 Admin SDK만 접근합니다.
  클라이언트가 읽거나 쓰지 않으므로, 기본 거부 상태 그대로 두는 것이 맞습니다.
- Storage도 Admin SDK가 Rules를 우회해 서버에서 복사하므로,
  users/{uid} 소유권 구조를 그대로 유지합니다.

즉 **콘솔에서 새로 게시할 것이 없습니다.**

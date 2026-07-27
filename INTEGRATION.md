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

## 5) Rules

Firestore Rules / Storage Rules 변경 **불필요**합니다.
- migrationJobs는 최상위 컬렉션이지만 Admin SDK만 접근합니다.
  클라이언트가 읽거나 쓰지 않으므로, 기본 거부 상태 그대로 두는 것이 맞습니다.
- Storage도 Admin SDK가 Rules를 우회해 서버에서 복사하므로,
  users/{uid} 소유권 구조를 그대로 유지합니다.

즉 **콘솔에서 새로 게시할 것이 없습니다.**

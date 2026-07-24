# 생각의 텃밭 V0.1

삶에서 얻은 조각을 **기록 → 인출 → 연결 → 콘텐츠로 발전**시키는 개인용 모바일 웹앱 프로토타입입니다.

## 현재 들어간 기능

- TODAY: 오늘 기록 수, 과거 기록 재노출, 반복 태그 기반 생각 씨앗
- Library: 독서 / 미디어 감상 기록
- Pocket: 빠른 아이디어 기록
- Moments: 사람·사건·감정 / 결정 기록
- Studio: 기록을 콘텐츠 프로젝트의 재료로 연결
- CRUD: 생성 / 조회·검색 / 수정 / 삭제
- JSON 백업 / 복원
- Firebase 미연결 상태에서도 브라우저 localStorage로 즉시 사용 가능
- Firebase 연결 시 Firestore 동기화
- Firebase Anonymous Authentication 기반 개인 데이터 분리

## 가장 먼저 해볼 것

1. `index.html`을 브라우저에서 열어봅니다.
2. 우측 하단 `+` 버튼으로 기록을 하나 남깁니다.
3. 설정(⚙️) → `샘플 기록 넣기`로 전체 흐름을 확인해도 됩니다.
4. 기록 카드에서 `🌱 콘텐츠로 키우기`를 눌러 Studio 프로젝트와 연결합니다.

## Firebase 연결

현재 Firebase 공식 Web 문서의 Browser ESM 예시와 맞춰 Firebase JS SDK 12.16.0을 사용합니다.

### 1) Firebase Console

- 새 프로젝트 생성
- Web 앱 등록
- Authentication → Sign-in method → **Anonymous** 활성화
- Firestore Database 생성

### 2) Firestore Rules

이 폴더의 `firestore.rules` 내용을 Firebase Console → Firestore Database → Rules에 붙여넣고 게시합니다.

### 3) Web App config 복사

Firebase Console → 프로젝트 설정 → 내 앱 → SDK 설정 및 구성에서 `firebaseConfig`를 찾습니다.

예:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

앱 우측 상단 ⚙️ → **Firebase config JSON**에 중괄호 `{ ... }` 부분만 JSON 형식으로 붙여넣고 `Firebase 연결 저장`을 누릅니다.

> Firebase config 값 자체는 클라이언트 앱에서 사용되는 설정 정보이며, 실제 데이터 보호는 Authentication + Firestore Security Rules로 합니다.

## 데이터 구조

```text
users/{uid}/fragments/{fragmentId}
users/{uid}/projects/{projectId}
```

`fragment.type`

- thought
- moment
- book
- media
- decision

## 다음 버전 후보

### V0.2
- Google Books / 알라딘 책 검색
- TMDB 영화·드라마 검색
- YouTube URL/검색 메타정보 자동 입력

### V0.3
- Firebase Storage
- 이미지 / 음성 / 영상 첨부
- 사람(Person) 엔터티와 관계 타임라인

### V0.4
- Garden: 관련 기록 연결, 과거 기록 회고, 태그 클러스터

### V0.5
- AI API
- 자동 태그
- 비슷한 기록 찾기
- 생각을 키우는 질문
- 주간 생각 리포트
- 콘텐츠 아웃라인 제안

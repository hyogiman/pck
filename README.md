# 생각의 텃밭 V0.2

V0.1의 '기록 양식' 중심 구조를 버리고, 아래 흐름으로 재설계한 버전입니다.

**Source → Fragment → Thread → Studio**

- Source: 책/영화/유튜브 등 한 번만 등록하는 작품 공간
- Fragment: 작품·일상에서 떨어져 나온 생각 조각
- Thread: 여러 조각을 한 질문 아래 연결해 생각의 변화 과정을 보는 공간
- Studio: 조각을 Hook/경험/반론/결론 등의 구조에 직접 배치해 콘텐츠 골격을 만드는 작업대

## 핵심 UX 변화

1. 같은 책을 읽을 때 책 정보를 다시 입력하지 않습니다.
2. 책 상세 화면에서 `책의 한 줄 + 내 생각 한 줄`만 빠르게 추가합니다.
3. Pocket/Moments 메뉴를 없애고, 빠른 `+` 입력과 Garden으로 통합했습니다.
4. 태그가 아니라 Thread를 중심으로 생각을 연결합니다.
5. Studio는 AI 없이도 '빈칸 질문 + 재료 배치'로 생각을 구체화하도록 설계했습니다.
6. Firebase 설정창은 JSON뿐 아니라 `const firebaseConfig = { ... };` 형태도 그대로 붙여넣을 수 있습니다.

## Firestore 데이터 구조

```text
users/{uid}/sources/{sourceId}
users/{uid}/fragments/{fragmentId}
users/{uid}/threads/{threadId}
users/{uid}/projects/{projectId}
```

기존 `firestore.rules`의 사용자별 wildcard 규칙으로 위 컬렉션을 모두 보호합니다.

## 바로 확인하는 방법

1. index.html 실행
2. 설정 → `샘플 데이터 넣기`
3. Library에서 '미드나잇 라이브러리' 열기
4. Garden에서 '꾸준함에 대하여' Thread 열기
5. Studio에서 '나는 왜 늘 시작하고 그만둘까' 작업대 열기

## V0.1 마이그레이션

같은 브라우저에서 V0.1을 사용했다면 설정 → `V0.1 기록 가져오기`로 기존 localStorage 기록을 V0.2의 Fragment로 가져올 수 있습니다.

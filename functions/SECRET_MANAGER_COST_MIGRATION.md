# Secret Manager 비용 절감: YES24 단일 검색 + 비용 조회 일반 설정

Firebase 프로젝트: `idea-pocket-56063` / Functions 리전: `us-central1`.

## 변경 이유와 범위
- `bookSearch`: **YES24 전용**. `ALADIN_TTB_KEY`는 더 이상 함수에 바인딩하지 않음. YES24 실패 시 오류를 반환하며 알라딘으로 전환하지 않음.
- `firebaseOfficialCost`: 아래 3개 값은 API 비밀번호가 아닌 일반 배포 설정(Firebase `defineString`)으로 전환. 기존 BigQuery 조회 및 관리자 이메일 확인 로직은 유지:
  - `GCP_BILLING_EXPORT_TABLE`
  - `GCP_BILLING_EXPORT_LOCATION`
  - `COST_DASHBOARD_ALLOWED_EMAIL`
- 남겨둘 실제 Secret: `YES24_API_KEY`, `OPENAI_API_KEY`, `OPENAI_ADMIN_KEY` (현재 pck Functions 기준).
- **GitHub Pages 배포는 Cloud Functions를 배포하지 않습니다.** 저장소 코드 변경만으로 Secret Manager 과금은 중단되지 않습니다.

## 실제 Cloud Functions 전환 순서 (값 노출 주의)
1. Google Cloud Secret Manager에서 위 3개 일반 설정 각각의 **현재 유효한 버전 값**을 확인한다. `GCP_BILLING_EXPORT_TABLE`은 `project.dataset.table`, `GCP_BILLING_EXPORT_LOCATION`은 실제 BigQuery 위치, `COST_DASHBOARD_ALLOWED_EMAIL`은 접근을 허용하는 본인 이메일 목록이다. 값을 채팅/GitHub 이슈/커밋에 붙이지 않는다.
2. 저장소 최신 `main`을 받아 프로젝트 루트에서 `firebase login` (필요한 경우) 후 다음 한 명령어로 두 함수만 배포한다.

   ```bash
   firebase deploy --project idea-pocket-56063 --only functions:bookSearch,functions:firebaseOfficialCost
   ```

3. Firebase CLI가 최초 `defineString` 구성값 3개를 묻는다. 1번에서 확인한 **기존과 같은 값**을 입력한다. CLI가 `functions/.env.idea-pocket-56063`에 저장할 수 있다. 이 파일은 `.gitignore`의 `functions/.env*`로 Git 추적에서 제외되어 있다. 기존 값과 다르게 입력하면 비용 조회 실패 또는 권한 거부가 발생할 수 있다.
4. 배포 완료 후 **기능 확인**:
   - 생각의 텃밭 및 독서의 정원 검색에서 YES24 책을 검색하고 `더보기`도 확인.
   - 생각의 텃밭 비용 조회 화면에서 기존 관리자 계정으로 `firebaseOfficialCost` 호출 결과와 월별/일별 비용이 정상 표시되는지 확인.
   - 필요하다면 Cloud Run의 `bookSearch`, `firebaseOfficialCost` **최신 리비전**에 더 이상 제거 대상 Secret 바인딩이 없는지 확인.
5. 위 기능이 모두 정상인 것이 확인된 **후에만** Secret Manager에서 `ALADIN_TTB_KEY` 및 일반 설정값 3개 (`GCP_BILLING_EXPORT_TABLE`, `GCP_BILLING_EXPORT_LOCATION`, `COST_DASHBOARD_ALLOWED_EMAIL`)의 **불필요한 활성 버전**을 폐기하거나 Secret을 삭제한다. Secret Manager 삭제는 되돌릴 수 없으므로, 다른 프로젝트/함수가 이 값을 사용하지 않는지도 확인한다.
6. Secret Manager에서 남은 각 Secret의 버전 상태를 확인하고, 별도로 남아 있는 활성/중지 구버전이 있다면 참조 여부를 확인한 뒤 정리한다. **요금은 Secret 이름 수가 아닌 활성 버전의 시간/접근 수에 따라 청구되므로** 이전 비용이 소급 환불되는 것은 아니다.

## 주의
- Cloud Functions 재배포 전에는 기존 Secret을 삭제하지 말 것 (이전 배포된 리비전에서 참조함).
- 기존 `OPENAI_API_KEY`, `OPENAI_ADMIN_KEY`, `YES24_API_KEY`는 일반 환경변수로 이전하지 말 것.
- `COST_DASHBOARD_ALLOWED_EMAIL`은 보안 비밀번호는 아니지만 계정 이메일이므로 공개 저장소에는 실값을 기록하지 말 것.
- `firebaseOfficialCost`의 전용 서비스 계정, 인증 검사, BigQuery 접근 제한은 삭제하거나 완화하지 말 것.
- 이 문서/CI는 **코드 계약 검사**다. 실제 비용 절감/실서비스 정상 동작 확인은 2~6번 완료 후에만 가능하다.

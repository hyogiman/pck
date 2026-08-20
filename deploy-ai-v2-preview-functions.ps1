param(
  [string]$ProjectId = "idea-pocket-56063"
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  Write-Host "";
  Write-Host "중단: $Message" -ForegroundColor Red
  exit 1
}

Write-Host "=== Thought Garden AI v2 시험 배포 준비 ===" -ForegroundColor Cyan
Write-Host "대상 프로젝트: $ProjectId" -ForegroundColor DarkGray
Write-Host "배포 대상은 새 테스트 함수 3개뿐입니다." -ForegroundColor Yellow
Write-Host "  - bloomingInterviewQuestionV2"
Write-Host "  - bloomingInterviewAutoPreviewV2"
Write-Host "  - bloomingInterviewSyntheticEvalV2"
Write-Host "기존 Blooming/정원사/두 생각 사이 함수는 배포 대상으로 지정하지 않습니다." -ForegroundColor Yellow
Write-Host ""

$Npm = Get-Command npm -ErrorAction SilentlyContinue
$Npx = Get-Command npx -ErrorAction SilentlyContinue
if (-not $Npm -or -not $Npx) {
  Fail "npm/npx를 찾지 못했습니다. Node.js가 설치된 PC에서 실행해주세요."
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "functions\package.json"))) {
  Fail "functions/package.json을 찾지 못했습니다. 저장소 루트에서 실행해주세요."
}

Write-Host "=== 1/4 브랜치 확인 ===" -ForegroundColor Cyan
$Git = Get-Command git -ErrorAction SilentlyContinue
if ($Git) {
  $branch = (& git -C $PSScriptRoot branch --show-current 2>$null | Out-String).Trim()
  if ($branch -ne "ai-v2-phase1-foundation") {
    Fail "현재 브랜치가 ai-v2-phase1-foundation이 아닙니다. 현재: $branch"
  }
  Write-Host "브랜치 PASS: $branch" -ForegroundColor Green
} else {
  Write-Host "git 명령을 찾지 못해 브랜치 자동 확인은 건너뜁니다." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== 2/4 AI v2 자동검사 ===" -ForegroundColor Cyan
Push-Location (Join-Path $PSScriptRoot "functions")
try {
  & npm run verify:ai-v2
  if ($LASTEXITCODE -ne 0) { Fail "npm run verify:ai-v2가 실패했습니다. 배포하지 않습니다." }
} finally {
  Pop-Location
}
Write-Host "자동검사 PASS" -ForegroundColor Green

Write-Host ""
Write-Host "=== 3/4 새 테스트 Functions만 선택 배포 ===" -ForegroundColor Cyan
$only = "functions:bloomingInterviewQuestionV2,functions:bloomingInterviewAutoPreviewV2,functions:bloomingInterviewSyntheticEvalV2"
Push-Location $PSScriptRoot
try {
  & npx --yes firebase-tools@latest deploy --only $only --project $ProjectId
  if ($LASTEXITCODE -ne 0) { Fail "Firebase Functions 시험 배포가 실패했습니다." }
} finally {
  Pop-Location
}
Write-Host "시험 Functions 배포 PASS" -ForegroundColor Green

Write-Host ""
Write-Host "=== 4/4 Firebase Hosting 상태 읽기 전용 확인 ===" -ForegroundColor Cyan
Write-Host "모바일 테스트 주소를 만들기 전에 기존 Hosting site가 있는지 확인합니다." -ForegroundColor DarkGray
Push-Location $PSScriptRoot
try {
  & npx --yes firebase-tools@latest hosting:sites:list --project $ProjectId
  $hostingExit = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($hostingExit -ne 0) {
  Write-Host "Hosting 상태 확인은 실패했지만 Functions 시험 배포는 완료되었습니다." -ForegroundColor Yellow
  Write-Host "이 단계에서는 Hosting을 생성하거나 변경하지 않았습니다." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "AI v2 시험 Functions 준비 완료" -ForegroundColor Green
Write-Host "기존 production 함수 교체: 하지 않음" -ForegroundColor Green
Write-Host "main merge: 하지 않음" -ForegroundColor Green
Write-Host "Hosting 변경: 하지 않음" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "다음 단계:" -ForegroundColor Cyan
Write-Host "1. 테스트실에서 Synthetic Eval(smoke 6개 + Luna 선별 2개)을 먼저 실행합니다."
Write-Host "2. 가상 표준시험이 이상하면 실제 개인 기록 테스트로 넘어가지 않습니다."
Write-Host "3. 위 Hosting 목록 출력 전체를 ChatGPT에 보내주세요."
Write-Host "4. 기존 서비스와 충돌하지 않는 모바일 테스트 주소를 정합니다."
Write-Host "5. 그 주소에서 ?ai-v2-test=1 테스트실을 열어 실제 기록 dry-run을 시작합니다."

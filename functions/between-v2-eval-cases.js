"use strict";

/**
 * Fictional Between Thoughts v2 evaluation pairs.
 * Never place the user's real Thought Garden text in this file.
 */
const BETWEEN_V2_SYNTHETIC_CASES = Object.freeze([
  {
    id: "silent-duplicate-conclusion",
    group: "silent",
    label: "같은 결론을 반복하는 두 기록",
    expectedDecision: "silent",
    a: "회의가 너무 길었다. 다음부터는 안건을 미리 정리해서 회의 시간을 줄여야겠다.",
    b: "오늘 회의도 두 시간이 넘었다. 역시 회의 전에 안건을 정리해 두는 게 필요하다.",
    why: "두 기록이 거의 같은 결론이다. 함께 놓아도 제3의 생각이 생기지 않는다."
  },
  {
    id: "silent-keyword-only",
    group: "silent",
    label: "단어만 겹치는 연결",
    expectedDecision: "silent",
    a: "이번 주 운동 기록을 표로 정리했다. 숫자로 보니 빠진 날이 한눈에 보인다.",
    b: "오늘 낮 기온이 38도까지 올라 지역 최고 기록을 깼다는 뉴스를 봤다. 너무 더워서 퇴근 후에는 밖에 나가지 않기로 했다.",
    why: "둘 다 '기록'이라는 표현이 있지만 의미와 맥락이 다르다. 같은 단어만으로 둘을 함께 볼 이유는 없다."
  },
  {
    id: "silent-unrelated",
    group: "silent",
    label: "의미상 무관한 두 기록",
    expectedDecision: "silent",
    a: "점심에 새로 생긴 국수집에 갔다. 국물이 깔끔해서 다음에 또 가고 싶다.",
    b: "노트북 배터리가 빨리 닳아서 충전기를 하나 더 사무실에 두기로 했다.",
    why: "억지로 연결하면 어떤 질문도 범용적이거나 장식적이 된다."
  },
  {
    id: "silent-one-source-dominates",
    group: "silent",
    label: "한쪽만으로 질문이 이미 성립",
    expectedDecision: "silent",
    a: "새 팀으로 옮길 기회가 생겼다. 더 배울 수 있지만 업무량도 크게 늘 것 같아서 무엇을 기준으로 결정해야 할지 모르겠다.",
    b: "요즘 회사 구내식당 메뉴가 예전보다 다양해졌다.",
    why: "A만으로 충분히 좋은 선택 질문이 생긴다. B를 끼우면 장식일 뿐이다."
  },
  {
    id: "silent-both-closed",
    group: "silent",
    label: "각자 이미 닫힌 두 기록",
    expectedDecision: "silent",
    a: "주말 약속을 취소하고 집에서 쉬었다. 피곤했던 만큼 잘한 선택이었다.",
    b: "이번 휴가에는 멀리 가지 않고 집 근처에서 쉬었다. 지금은 이런 휴식이 더 필요했다.",
    why: "주제가 비슷해도 두 기록 모두 이미 닫혀 있고 새 질문을 만들 필요가 없다."
  },
  {
    id: "silent-thin-pair",
    group: "silent",
    label: "너무 얇은 사실 두 개",
    expectedDecision: "silent",
    a: "오늘은 평소보다 일찍 출근했다.",
    b: "저녁에는 평소보다 일찍 잠들었다.",
    why: "함께 놓아도 의미 있는 연결을 만들 근거가 부족하다."
  },
  {
    id: "speak-rest-versus-making",
    group: "speak",
    label: "휴식 욕구와 창작의 생동감",
    expectedDecision: "speak",
    a: "요즘 아무것도 하지 않고 쉬고 싶다고 자주 생각한다. 그런데 시간이 생기면 또 작은 프로젝트를 시작하고 있다.",
    b: "무언가를 내 손으로 만들고 있을 때는 시간이 빨리 가고, 오히려 내가 내 삶을 살고 있다는 느낌이 든다.",
    why: "두 기록을 함께 봐야 '휴식=무활동'이 아니라 '스스로 고른 활동'일 가능성을 새로 탐색할 수 있다."
  },
  {
    id: "speak-parenting-and-aliveness",
    group: "speak",
    label: "방해처럼 느낀 돌봄과 삶의 열정",
    expectedDecision: "speak",
    a: "글을 쓰려고 앉을 때마다 아이가 깨서 흐름이 끊긴다. 내 시간을 내가 쓰지 못한다는 답답함이 크다.",
    b: "아이와 공원에서 처음 비눗방울을 쫓아다니는 모습을 봤다. 이상하게 그 순간 삶을 더 열심히 살아보고 싶다는 마음이 들었다.",
    why: "같은 돌봄이 한 기록에서는 자기 삶의 방해, 다른 기록에서는 삶의 열정으로 나타난다. 둘을 함께 봐야 '내 삶'의 정의를 확장할 수 있다."
  },
  {
    id: "speak-control-and-serendipity",
    group: "speak",
    label: "통제 욕구와 우연한 만족",
    expectedDecision: "speak",
    a: "여행 일정이 정해져 있지 않으면 불안해서 식당과 이동시간까지 미리 정해두는 편이다.",
    b: "지난 여행에서 계획한 가게가 문을 닫아 그냥 골목을 걷다가 작은 시장을 발견했는데 그 시간이 가장 좋았다.",
    why: "계획의 필요와 계획 밖 만족이 충돌하면서 '좋은 여행에 필요한 통제의 정도'라는 새 기준이 생긴다."
  },
  {
    id: "speak-solo-choice-group-deference",
    group: "speak",
    label: "혼자일 때의 선택과 함께일 때의 양보",
    expectedDecision: "speak",
    a: "혼자 여행할 때는 어디서 먹고 어디로 갈지 내가 바로 정한다. 그럴 때는 선택하는 일이 전혀 어렵지 않다.",
    b: "여럿이 점심을 먹으면 내가 먹고 싶은 메뉴보다 다른 사람들이 무난하게 먹을 메뉴부터 생각한다.",
    why: "두 상황을 함께 놓아야 결정 어려움 자체가 아니라 '타인이 있을 때 바뀌는 선택 기준'을 탐색할 수 있다."
  },
  {
    id: "speak-value-shift-over-time",
    group: "speak",
    label: "시간이 지나며 달라진 성공 기준",
    expectedDecision: "speak",
    a: "몇 년 전에는 연봉이 오르고 직급이 올라가는 게 잘 살고 있다는 가장 분명한 증거라고 생각했다.",
    b: "요즘은 하루에 한 시간이라도 내가 좋아하는 일을 만들 시간이 있으면 그날을 잘 보냈다는 생각이 든다.",
    why: "두 시점이 함께 있어야 성공의 기준이 어디서 어디로 이동했는지를 묻는 질문이 생긴다."
  },
  {
    id: "speak-money-and-experience",
    group: "speak",
    label: "안전을 위한 저축과 경험을 위한 지출",
    expectedDecision: "speak",
    a: "통장 잔액이 줄어드는 게 싫어서 특별한 목적이 없어도 가능한 한 돈을 쓰지 않으려 한다. 돈이 있으면 마음이 조금 안전하다.",
    b: "친구들과 짧은 여행을 다녀왔는데 예상보다 돈은 많이 썼지만 몇 달 만에 가장 선명하게 기억나는 주말이 됐다.",
    why: "안전과 경험이라는 돈의 두 기능이 함께 있어야 '어떤 지출이 내게 가치 있는가'라는 제3의 기준을 탐색할 수 있다."
  }
]);

function betweenCasesForMode(mode) {
  const normalized = String(mode || "smoke").toLowerCase();
  if (normalized === "full") return [...BETWEEN_V2_SYNTHETIC_CASES];
  const ids = new Set([
    "silent-duplicate-conclusion",
    "silent-keyword-only",
    "silent-one-source-dominates",
    "speak-rest-versus-making",
    "speak-parenting-and-aliveness",
    "speak-solo-choice-group-deference"
  ]);
  return BETWEEN_V2_SYNTHETIC_CASES.filter((item) => ids.has(item.id));
}

module.exports = { BETWEEN_V2_SYNTHETIC_CASES, betweenCasesForMode };

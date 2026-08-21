"use strict";

/**
 * Fictional Blooming Interview evaluation cases.
 *
 * Never put the user's real Thought Garden text in this repository. These cases
 * are deliberately synthetic and exist to make the model repeatedly answer the
 * same product questions: when should Blooming stay silent, and when is an old
 * thought genuinely worth reopening?
 */

const BLOOMING_SYNTHETIC_CASES = Object.freeze([
  {
    id: "silent-meal-log",
    group: "silent",
    label: "단순 일상 기록",
    expectedDecision: "silent",
    thought: "점심에 회사 앞 식당에서 순두부찌개를 먹었다. 생각보다 맛있었고 다음에 또 먹어도 괜찮겠다.",
    why: "이미 완결된 소소한 사실 기록이다. 깊은 질문을 억지로 붙일 이유가 없다."
  },
  {
    id: "silent-closed-reasoning",
    group: "silent",
    label: "이유와 결론이 이미 닫힌 기록",
    expectedDecision: "silent",
    thought: "이번 모임에는 가지 않기로 했다. 요즘 주말마다 일정이 있어서 쉬는 시간이 부족했고, 이번 주만큼은 집에서 쉬는 게 더 중요하다. 미안한 마음은 있지만 지금은 휴식을 선택하는 게 맞다.",
    why: "선택·이유·감정·결론까지 이미 충분히 적혀 있다. 같은 이유를 다시 묻지 않아야 한다."
  },
  {
    id: "silent-simple-gratitude",
    group: "silent",
    label: "그 자체로 충분한 감사 기록",
    expectedDecision: "silent",
    thought: "퇴근길에 비가 그치고 하늘이 맑아졌다. 버스 창밖을 보는데 괜히 기분이 좋아졌다. 별일 없는 하루였지만 이런 순간도 꽤 좋다.",
    why: "더 캐내지 않아도 그 순간의 의미가 충분하다. Blooming이 모든 감정을 분석하려 들면 안 된다."
  },
  {
    id: "silent-task-note",
    group: "silent",
    label: "업무 메모",
    expectedDecision: "silent",
    thought: "내일 오전에 발표자료 마지막 장 숫자만 다시 확인하고, 팀장에게 보내기 전에 오탈자를 한 번 더 볼 것.",
    why: "행동 메모다. 성찰 질문을 붙이는 순간 기능의 정체성이 흐려진다."
  },
  {
    id: "silent-answered-why",
    group: "silent",
    label: "이미 스스로 질문하고 답한 기록",
    expectedDecision: "silent",
    thought: "왜 요즘 운동을 자꾸 미루는지 생각해봤다. 운동이 싫어서라기보다 퇴근하면 선택할 힘이 남아 있지 않은 것 같다. 그래서 이번 주에는 의욕을 기다리지 않고 귀가하자마자 15분만 걷기로 했다.",
    why: "원인 탐색과 다음 행동까지 이미 적었다. '왜 미루나요?' 같은 재질문은 실패다."
  },
  {
    id: "silent-observation-no-gap",
    group: "silent",
    label: "완결된 관찰",
    expectedDecision: "silent",
    thought: "몇 달 동안 쓰던 키보드를 바꿨는데 손목이 훨씬 편하다. 작은 도구 하나가 하루의 피로를 꽤 줄여준다는 게 신기하다.",
    why: "추가 질문이 없어도 생각이 자연스럽게 닫힌다."
  },
  {
    id: "speak-choice-underneath",
    group: "speak",
    label: "선택 뒤에 남은 핵심 기준",
    expectedDecision: "speak",
    thought: "새로운 팀으로 옮길 기회가 생겼다. 지금 팀보다 배울 건 많아 보이는데, 업무량도 훨씬 늘 것 같다. 좋은 기회라는 생각과 굳이 더 바쁘게 살아야 하나 하는 생각이 계속 번갈아 든다.",
    why: "선택지는 보이지만 무엇을 기준으로 결정하고 싶은지는 아직 쓰이지 않았다."
  },
  {
    id: "speak-repeated-contradiction",
    group: "speak",
    label: "반복되는 행동과 바람의 충돌",
    expectedDecision: "speak",
    thought: "요즘 계속 쉬고 싶다고 말하면서 막상 시간이 생기면 또 뭔가를 시작한다. 어제도 아무것도 하지 말자고 해놓고 밤에 새 프로젝트 폴더를 만들었다. 왜 나는 쉬는 시간을 그냥 쉬는 시간으로 두기 어려울까.",
    why: "사용자가 스스로 발견한 반복 패턴이 있고, 그 패턴의 의미는 아직 열려 있다."
  },
  {
    id: "speak-value-cost",
    group: "speak",
    label: "원하는 것과 치러야 할 비용",
    expectedDecision: "speak",
    thought: "언젠가는 내 이름으로 작은 가게를 해보고 싶다. 손님과 직접 이야기하고 내가 고른 물건을 소개하는 장면을 상상하면 설렌다. 그런데 안정적인 월급을 포기하는 건 아직 겁난다.",
    why: "욕구와 두려움이 모두 구체적이지만 어떤 위험까지 감수할 수 있는지는 열려 있다."
  },
  {
    id: "speak-change-in-self",
    group: "speak",
    label: "과거의 나와 달라진 지점",
    expectedDecision: "speak",
    thought: "예전에는 사람 많은 자리에 가면 에너지를 얻는다고 생각했는데, 요즘은 약속이 두 개만 연달아 있어도 지친다. 단순히 체력이 떨어진 건지 내가 원하는 생활이 달라진 건지 잘 모르겠다.",
    why: "변화는 분명하지만 그 변화가 무엇을 말하는지는 아직 정리되지 않았다."
  },
  {
    id: "speak-concrete-scene-meaning",
    group: "speak",
    label: "구체적 장면 뒤의 아직 말하지 않은 의미",
    expectedDecision: "speak",
    thought: "회의에서 내가 준비한 아이디어를 다른 사람이 먼저 말했는데 다들 좋은 반응을 보였다. 기분이 묘했다. 내가 인정받지 못해서 속상한 건지, 말을 꺼내지 못한 나 자신이 답답한 건지 아직 잘 모르겠다.",
    why: "구체적인 사건과 두 가지 가능한 감정 해석이 있지만 사용자에게 중요한 지점이 아직 열려 있다."
  },
  {
    id: "speak-desire-without-picture",
    group: "speak",
    label: "원하는 변화는 있으나 모습이 비어 있음",
    expectedDecision: "speak",
    thought: "지금 생활을 조금 바꾸고 싶다는 생각이 계속 든다. 큰 불만이 있는 건 아닌데 이대로 몇 년이 더 지나가는 건 싫다. 그렇다고 정확히 무엇을 바꾸고 싶은지는 아직 잘 모르겠다.",
    why: "변화 욕구는 반복적으로 드러나지만 사용자가 원하는 삶의 구체적인 모습은 아직 비어 있다."
  }
]);

function casesForMode(mode) {
  const normalized = String(mode || "smoke").toLowerCase();
  if (normalized === "full") return [...BLOOMING_SYNTHETIC_CASES];
  // Smoke set deliberately mixes obvious silence, a closed reflection and
  // several distinct kinds of worthwhile reopening.
  const ids = new Set([
    "silent-meal-log",
    "silent-closed-reasoning",
    "silent-answered-why",
    "speak-choice-underneath",
    "speak-repeated-contradiction",
    "speak-concrete-scene-meaning"
  ]);
  return BLOOMING_SYNTHETIC_CASES.filter((item) => ids.has(item.id));
}

module.exports = { BLOOMING_SYNTHETIC_CASES, casesForMode };

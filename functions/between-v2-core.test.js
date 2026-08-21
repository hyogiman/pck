"use strict";

const assert = require("node:assert/strict");
const {
  validateBetweenCandidate,
  validatePairJudge,
  selectBestBetweenQuestion
} = require("./between-v2-core");

const scores = {
  grounded: 5,
  novel: 5,
  specific: 5,
  clear: 5,
  naturalKorean: 5,
  insightPotential: 5,
  addsValue: 5,
  nonLeading: 5,
  relevantNow: 5
};

const sources = {
  a: "일을 줄이고 싶다고 생각했는데, 막상 시간이 생기면 또 새 프로젝트를 시작한다.",
  b: "한편으로는 무언가를 만드는 시간이 있을 때 내가 내 삶을 산다는 느낌이 가장 강하다."
};

const good = {
  mode: "integration",
  question: "쉬고 싶다는 마음과 만들고 있을 때 살아 있다는 느낌을 함께 보면, 지금 당신에게 필요한 휴식은 아무것도 하지 않는 시간일까요, 만들 일을 스스로 고를 수 있는 시간일까요?",
  evidence: {
    a: "시간이 생기면 또 새 프로젝트를 시작한다",
    b: "무언가를 만드는 시간이 있을 때 내가 내 삶을 산다는 느낌이 가장 강하다"
  },
  scores,
  pairCheck: {
    requiresBoth: true,
    worksFromAAlone: false,
    worksFromBAlone: false,
    createsThirdThought: true,
    pairNecessity: 5,
    thirdThoughtPotential: 5,
    reason: "A의 휴식 욕구와 B의 창작에서 느끼는 생동감을 함께 봐야 휴식의 정의를 다시 묻게 된다."
  }
};

const goodCheck = validateBetweenCandidate(good, sources);
assert.equal(goodCheck.ok, true, JSON.stringify(goodCheck));

// Core regression: citing both sources is not enough. If the model admits that
// essentially the same question works from A alone, the pair must fail.
const decorativeB = validateBetweenCandidate({
  ...good,
  pairCheck: {
    ...good.pairCheck,
    requiresBoth: false,
    worksFromAAlone: true,
    pairNecessity: 2,
    reason: "B는 질문을 꾸미는 데만 쓰였고 A의 반복 행동만으로 질문이 성립한다."
  }
}, sources);
assert.equal(decorativeB.ok, false);
assert.ok(decorativeB.reasons.includes("works-from-a-alone"));
assert.ok(decorativeB.reasons.includes("pair-not-required"));
assert.ok(decorativeB.reasons.includes("low-pair-necessity"));

const decorativeA = validateBetweenCandidate({
  ...good,
  pairCheck: {
    ...good.pairCheck,
    requiresBoth: false,
    worksFromBAlone: true,
    pairNecessity: 2
  }
}, sources);
assert.equal(decorativeA.ok, false);
assert.ok(decorativeA.reasons.includes("works-from-b-alone"));

const noThirdThought = validateBetweenCandidate({
  ...good,
  pairCheck: {
    ...good.pairCheck,
    createsThirdThought: false,
    thirdThoughtPotential: 2,
    reason: "두 기록이 비슷하다는 사실만 다시 확인한다."
  }
}, sources);
assert.equal(noThirdThought.ok, false);
assert.ok(noThirdThought.reasons.includes("no-third-thought"));
assert.ok(noThirdThought.reasons.includes("low-third-thought-potential"));

// Existing shared Question Gate remains active underneath the pair gate.
const fakeEvidence = validateBetweenCandidate({
  ...good,
  evidence: { a: "원문에 없는 문장", b: good.evidence.b }
}, sources);
assert.equal(fakeEvidence.ok, false);
assert.ok(fakeEvidence.reasons.includes("ungrounded-evidence"));

// A second-pass ablation judge can veto a candidate even when the generator's
// own pairCheck claimed it was good.
const judgeFail = validatePairJudge({
  requiresBoth: false,
  worksFromAAlone: true,
  worksFromBAlone: false,
  createsThirdThought: false,
  pairNecessity: 2,
  thirdThoughtPotential: 2,
  reason: "A만으로 거의 같은 질문을 만들 수 있다."
});
assert.equal(judgeFail.ok, false);

const judgedCandidate = validateBetweenCandidate(good, sources, judgeFail.judge);
assert.equal(judgedCandidate.ok, false);
assert.ok(judgedCandidate.reasons.includes("judge-works-from-a-alone"));

const judgePass = {
  requiresBoth: true,
  worksFromAAlone: false,
  worksFromBAlone: false,
  createsThirdThought: true,
  pairNecessity: 5,
  thirdThoughtPotential: 5,
  reason: "A의 반복과 B의 생동감이 만나야 질문의 중심인 '휴식의 정의'가 생긴다."
};
const judgedPass = validateBetweenCandidate(good, sources, judgePass);
assert.equal(judgedPass.ok, true, JSON.stringify(judgedPass));

const selected = selectBestBetweenQuestion({
  decision: "speak",
  reason: "두 기록 사이에 새 기준이 생긴다.",
  observation: "한 기록에서는 쉬고 싶어 하면서도 새 일을 시작했고, 다른 기록에서는 만드는 시간에 삶의 감각을 느꼈다고 적었다.",
  candidates: [
    { ...good, pairCheck: { ...good.pairCheck, pairNecessity: 4, thirdThoughtPotential: 4 } },
    good
  ]
}, {
  sources,
  pairJudges: [judgePass, judgePass]
});
assert.equal(selected.decision, "speak");
assert.equal(selected.selectedIndex, 1);
assert.equal(selected.pairCheck.pairNecessity, 5);

const allRejected = selectBestBetweenQuestion({
  decision: "speak",
  reason: "",
  observation: "",
  candidates: [{
    ...good,
    pairCheck: { ...good.pairCheck, worksFromAAlone: true, requiresBoth: false, pairNecessity: 1 }
  }]
}, { sources });
assert.equal(allRejected.decision, "silent");
assert.equal(allRejected.reason, "between-pair-gate-rejected-all");

console.log("BETWEEN_V2_CORE_TEST_PASS");

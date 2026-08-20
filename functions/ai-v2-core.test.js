"use strict";
const assert = require("node:assert/strict");
const {
  MODEL_ROUTES,
  containsEvidence,
  validateQuestionCandidate,
  selectBestQuestion
} = require("./ai-v2-core");

assert.equal(MODEL_ROUTES.index, "gpt-5.6-luna");
assert.equal(MODEL_ROUTES.speaking, "gpt-5.6-terra");
assert.equal(containsEvidence("육아 때문에 글의 흐름이 끊겼다", "글의 흐름이 끊겼다"), true);
assert.equal(containsEvidence("육아 때문에 글의 흐름이 끊겼다", "자유를 잃었다"), false);

const scores = {
  grounded:5, novel:5, specific:5, clear:5,
  naturalKorean:5, insightPotential:5, addsValue:5, nonLeading:5, relevantNow:5
};

const goodBetween = {
  question:"글을 쓰지 못해 답답했던 순간과 아기의 성장에서 삶의 열정을 느낀 순간을 함께 보면, 지금 ‘내 삶을 산다’는 건 어떤 모습에 더 가까운가요?",
  evidence:{a:"글의 흐름이 끊겼다",b:"삶의 진한 열정"},
  scores,
  mode:"connect"
};
const goodCheck = validateQuestionCandidate(goodBetween, {
  mode:"between",
  sources:{a:"육아 때문에 글의 흐름이 끊겼다.",b:"아기를 보며 삶의 진한 열정을 느꼈다."}
});
assert.equal(goodCheck.ok, true, JSON.stringify(goodCheck));

const vague = {
  question:"그다음 한 걸음을 어떤 방식으로 다시 붙잡고 있나요?",
  evidence:{primary:"다시 해보자"},
  scores,
  mode:"deepen"
};
const vagueCheck = validateQuestionCandidate(vague, {
  mode:"blooming",
  sources:{primary:"그래도 다시 해보자고 생각했다."}
});
assert.equal(vagueCheck.ok, false);
assert.ok(vagueCheck.reasons.includes("generic-language") || vagueCheck.reasons.includes("unnatural-shape"));

const result = selectBestQuestion({decision:"speak",reason:"",observation:"",candidates:[goodBetween]}, {
  mode:"between",
  sources:{a:"육아 때문에 글의 흐름이 끊겼다.",b:"아기를 보며 삶의 진한 열정을 느꼈다."}
});
assert.equal(result.decision,"speak");

const rejected = selectBestQuestion({
  decision:"speak",
  reason:"",
  observation:"",
  reopenValue:"worth_reopening",
  reopenReason:"아직 탐색할 여지가 있다.",
  candidates:[vague]
}, {
  mode:"blooming",
  sources:{primary:"그래도 다시 해보자고 생각했다."}
});
assert.equal(rejected.decision,"silent");

// Regression: a closed reflection can still tempt the model into producing a
// polished follow-up. Blooming must stop before candidate quality can override
// the fact that the source itself is already resolved.
const closedSource = "이번 모임에는 가지 않기로 했다. 요즘 주말마다 일정이 있어서 쉬는 시간이 부족했고, 이번 주만큼은 집에서 쉬는 게 더 중요하다. 미안한 마음은 있지만 지금은 휴식을 선택하는 게 맞다.";
const superficiallyGood = {
  question:"그날 쉬고 난 뒤에는 미안한 마음과 휴식 중 무엇이 더 크게 남았나요?",
  evidence:{primary:"미안한 마음"},
  scores,
  mode:"deepen"
};
const closedResult = selectBestQuestion({
  decision:"speak",
  reason:"더 물어볼 수 있다.",
  observation:"",
  reopenValue:"already_closed",
  reopenReason:"선택과 이유, 감정과 결론이 이미 적혀 있다.",
  candidates:[superficiallyGood]
}, {
  mode:"blooming",
  sources:{primary:closedSource}
});
assert.equal(closedResult.decision,"silent");
assert.equal(closedResult.reason,"blooming-source-not-worth-reopening");

// Regression: even if the source is legitimately open, a question that only
// adds optional retrospective detail is not worth interrupting the user for.
const lowValueCheck = validateQuestionCandidate({
  ...superficiallyGood,
  scores:{...scores, addsValue:2}
}, {
  mode:"blooming",
  sources:{primary:closedSource}
});
assert.equal(lowValueCheck.ok,false);
assert.ok(lowValueCheck.reasons.includes("quality-score"));

// Regression from the first real automatic Blooming dry-run: the source says
// the user delayed decisions and speculates about wanting approval, but it never
// says they were worried or afraid of another person's reaction. A polished
// question must not smuggle that inner state into its premise.
const socialChoiceSource = "그런데 정작 타인과 함께하는 이벤트에서는 결정과 판단을 미뤘던것 같다. 회식메뉴 정하는것도 결국 내가 먹고 싶은걸 밀어부치는게 아닌, 다 같이 먹는 메뉴위주. 왜 그런걸까? 타인에게 인정과 칭찬을 받고 싶어서였을까? 그럴지도 모르지. 고맙다는 말이 듣고 싶어서, 좋은 사람으로 기억되고 싶어서.";
const assumedWorry = validateQuestionCandidate({
  question:"회식 메뉴에서 내 의견을 먼저 냈다면, 가장 걱정됐을 반응은 무엇이었을까?",
  evidence:{primary:"결정과 판단을 미뤘던것 같다"},
  scores,
  mode:"question"
}, {
  mode:"blooming",
  sources:{primary:socialChoiceSource}
});
assert.equal(assumedWorry.ok,false);
assert.ok(assumedWorry.reasons.includes("assumed-inner-state"), JSON.stringify(assumedWorry));

// The same vocabulary is allowed when the user actually wrote the state.
const groundedWorry = validateQuestionCandidate({
  question:"그때 가장 걱정됐던 반응은 무엇이었나요?",
  evidence:{primary:"사람들이 싫어할까 걱정됐다"},
  scores,
  mode:"question"
}, {
  mode:"blooming",
  sources:{primary:"내 의견을 먼저 말하면 사람들이 싫어할까 걱정됐다. 그래서 그냥 다 같이 먹는 메뉴로 맞췄다."}
});
assert.equal(groundedWorry.ok,true, JSON.stringify(groundedWorry));

// nonLeading is now a hard minimum, not a score that can be hidden by other 5s.
const leadingScoreCheck = validateQuestionCandidate({
  question:"지금 AI에게서 가장 받고 싶은 것은 답인가요, 아니면 판단해도 된다는 확신인가요?",
  evidence:{primary:"AI에게 맡기고 싶어지는건"},
  scores:{...scores, nonLeading:3},
  mode:"question"
}, {
  mode:"blooming",
  sources:{primary:"AI에게 맡기고 싶어지는건 내가 스스로 판단하면 틀릴 수 있다는 걱정 때문이다."}
});
assert.equal(leadingScoreCheck.ok,false);
assert.ok(leadingScoreCheck.reasons.includes("quality-score"));

console.log("AI_V2_CORE_TEST_PASS");
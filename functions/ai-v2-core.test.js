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
  naturalKorean:5, insightPotential:5, nonLeading:5, relevantNow:5
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
  scores
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

const rejected = selectBestQuestion({decision:"speak",reason:"",observation:"",candidates:[vague]}, {
  mode:"blooming",
  sources:{primary:"그래도 다시 해보자고 생각했다."}
});
assert.equal(rejected.decision,"silent");

console.log("AI_V2_CORE_TEST_PASS");

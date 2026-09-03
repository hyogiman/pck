"use strict";

const assert = require("node:assert/strict");

const {
  validateStudioPlan,
  selectStudioPlan,
  validateStudioQuestionCandidate,
  validateStudioEditCandidate
} = require("./studio-gardener-v2-core");

const questionScores = {
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

const planScores = {
  grounded: 5,
  novel: 5,
  addsValue: 5,
  contextFit: 5,
  thinkingDeveloped: 4
};

const editScores = {
  grounded: 5,
  specific: 5,
  clear: 5,
  naturalKorean: 5,
  addsValue: 5,
  preservesVoice: 5,
  relevantNow: 5
};

const context = {
  projectTitle: "회사 일을 줄이고 내가 고른 일을 만드는 삶",
  previousSlots: [
    {
      id: "hook",
      text: "회사에서 가장 지치는 건 일이 많다는 사실보다 내가 정하지 않은 일을 계속 처리해야 한다는 느낌이다.",
      gardenerQuestion: "회사 일에서 가장 지치는 순간은 언제였어?"
    }
  ],
  currentDraft:
    "퇴근 후에도 새 프로젝트를 만들 때는 힘든데도 이상하게 시간이 빨리 간다. 회사 일은 줄이고 싶지만 만드는 일 자체를 멈추고 싶은 건 아니다.",
  previousGardenerQuestions: [
    "회사 일에서 가장 지치는 순간은 언제였어?"
  ],
  materials: [
    {
      id: "frag-freedom",
      text: "예전에 나는 자유가 아무것도 안 하는 상태가 아니라 내가 할 일을 고를 수 있는 상태라고 적었다."
    }
  ]
};

// 1. Cross-garden connection requires evidence from BOTH the current Studio
// context and a real retrieved material.
const connectPlan = validateStudioPlan({
  decision: "act",
  mode: "connect",
  reason: "현재 글의 선택권 문제와 과거 자유에 대한 기록이 직접 이어진다.",
  primaryEvidence: "만드는 일 자체를 멈추고 싶은 건 아니다",
  materialId: "frag-freedom",
  materialEvidence: "내가 할 일을 고를 수 있는 상태",
  scores: planScores
}, context);

assert.equal(connectPlan.ok, true, JSON.stringify(connectPlan));

const fakeMaterialPlan = validateStudioPlan({
  decision: "act",
  mode: "connect",
  reason: "",
  primaryEvidence: "만드는 일 자체를 멈추고 싶은 건 아니다",
  materialId: "frag-freedom",
  materialEvidence: "원문에 없는 자유의 정의",
  scores: planScores
}, context);

assert.equal(fakeMaterialPlan.ok, false);
assert.ok(fakeMaterialPlan.reasons.includes("ungrounded-material-evidence"));

// 2. Edit is not allowed merely because an editor could say something.
// The planner must judge the thinking itself sufficiently developed.
const prematureEdit = validateStudioPlan({
  decision: "act",
  mode: "edit",
  reason: "",
  primaryEvidence: "회사 일은 줄이고 싶지만",
  scores: { ...planScores, thinkingDeveloped: 2 }
}, context);

assert.equal(prematureEdit.ok, false);
assert.ok(prematureEdit.reasons.includes("edit-before-thinking-developed"));

// 3. Silence is a first-class valid result.
const silent = selectStudioPlan({
  decision: "silent",
  reason: "지금은 새 질문보다 사용자가 계속 쓰는 편이 낫다."
}, context);

assert.equal(silent.decision, "silent");
assert.equal(silent.mode, "silent");

// 4. A grounded connect question passes the shared Question Gate plus the
// Studio material-evidence gate.
const connectQuestion = {
  mode: "connect",
  question:
    "예전에 자유를 내가 할 일을 고를 수 있는 상태라고 적었는데, 지금 회사 일을 줄이고 싶은 마음도 일의 양보다 선택권에 더 가까운 걸까?",
  evidence: {
    primary: "회사 일은 줄이고 싶지만 만드는 일 자체를 멈추고 싶은 건 아니다",
    materialId: "frag-freedom",
    material: "내가 할 일을 고를 수 있는 상태"
  },
  scores: questionScores
};

const connectQuestionCheck = validateStudioQuestionCandidate(
  connectQuestion,
  {
    context,
    mode: "connect",
    selectedMaterialId: "frag-freedom"
  }
);

assert.equal(
  connectQuestionCheck.ok,
  true,
  JSON.stringify(connectQuestionCheck)
);


// 5. Primary evidence must come from authored Studio text, not merely from a
// retrieved material.
const materialUsedAsPrimary = validateStudioQuestionCandidate(
  {
    ...connectQuestion,

    evidence: {
      primary:
        "내가 할 일을 고를 수 있는 상태",

      materialId:
        "frag-freedom",

      material:
        "내가 할 일을 고를 수 있는 상태"
    }
  },

  {
    context,
    mode: "connect",
    selectedMaterialId:
      "frag-freedom"
  }
);

assert.equal(
  materialUsedAsPrimary.ok,
  false
);

assert.ok(
  materialUsedAsPrimary
    .reasons
    .includes(
      "ungrounded-primary-evidence"
    )
);
// 5. Merely naming a material is not enough. Its quoted evidence must really
// exist in that Fragment.
const inventedConnection = validateStudioQuestionCandidate(
  {
    ...connectQuestion,
    evidence: {
      ...connectQuestion.evidence,
      material: "사실 자유는 혼자 있는 시간이라고 적었다"
    }
  },
  {
    context,
    mode: "connect",
    selectedMaterialId: "frag-freedom"
  }
);

assert.equal(inventedConnection.ok, false);
assert.ok(
  inventedConnection.reasons.includes("ungrounded-material-evidence")
);

// 6. Exact/near-exact previous Gardener questions cannot simply be recycled.
const repeated = validateStudioQuestionCandidate(
  {
    mode: "deepen",
    question: "회사 일에서 가장 지치는 순간은 언제였어?",
    evidence: {
      primary: "회사에서 가장 지치는 건 일이 많다는 사실보다"
    },
    scores: questionScores
  },
  { context, mode: "deepen" }
);

assert.equal(repeated.ok, false);
assert.ok(repeated.reasons.includes("repeated-question"));

// 7. A normal deepen question still uses the shared V2 Question Gate.
const deepen = validateStudioQuestionCandidate(
  {
    mode: "deepen",
    question:
      "만드는 일은 멈추고 싶지 않다고 했는데, 회사 일과 스스로 고른 프로젝트 사이에서 피로감이 가장 달라지는 순간은 언제야?",
    evidence: {
      primary: "만드는 일 자체를 멈추고 싶은 건 아니다"
    },
    scores: questionScores
  },
  { context, mode: "deepen" }
);

assert.equal(deepen.ok, true, JSON.stringify(deepen));

// 8. Short editorial guidance has its own evidence/quality gate.
const edit = validateStudioEditCandidate({
  suggestion:
    "첫 문단에서는 회사 일을 줄이고 싶다는 마음과 만드는 일은 멈추고 싶지 않다는 대비를 먼저 선명하게 보여줘.",
  evidence: {
    primary: "회사 일은 줄이고 싶지만 만드는 일 자체를 멈추고 싶은 건 아니다"
  },
  scores: editScores
}, context);

assert.equal(edit.ok, true, JSON.stringify(edit));

const ungroundedEdit = validateStudioEditCandidate({
  suggestion: "첫 문단에서 가족과의 갈등 장면을 먼저 보여줘.",
  evidence: {
    primary: "가족과 갈등했다"
  },
  scores: editScores
}, context);

assert.equal(ungroundedEdit.ok, false);
assert.ok(
  ungroundedEdit.reasons.includes("ungrounded-edit-evidence")
);

console.log("STUDIO_GARDENER_V2_CORE_TEST_PASS");
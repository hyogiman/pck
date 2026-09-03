"use strict";

const assert = require("node:assert/strict");

const {
  STUDIO_ACTION_MODES,
  STUDIO_PLAN_SCORE_FIELDS
} = require("./studio-gardener-v2-core");

const {
  studioPlanSchema,
  studioPlannerPrompt,
  compactPlannerMaterial,
  buildStudioPlannerInput
} = require("./studio-gardener-v2-planner");

const schema = studioPlanSchema();

assert.equal(schema.type, "object");
assert.equal(schema.additionalProperties, false);

assert.deepEqual(
  schema.properties.decision.enum,
  ["silent", "act"]
);

assert.deepEqual(
  schema.properties.mode.enum,
  [
    "silent",
    ...STUDIO_ACTION_MODES
  ]
);

assert.deepEqual(
  schema.required,
  [
    "decision",
    "mode",
    "reason",
    "primaryEvidence",
    "materialId",
    "materialEvidence",
    "scores"
  ]
);

assert.deepEqual(
  schema.properties.scores.required,
  [...STUDIO_PLAN_SCORE_FIELDS]
);

assert.equal(
  schema.properties.scores.additionalProperties,
  false
);

for (const field of STUDIO_PLAN_SCORE_FIELDS) {
  const score =
    schema.properties.scores.properties[field];

  assert.equal(score.type, "integer");
  assert.equal(score.minimum, 0);
  assert.equal(score.maximum, 5);
}

const prompt = studioPlannerPrompt();

for (const mode of [
  "silent",
  "connect",
  "deepen",
  "challenge",
  "edit"
]) {
  assert.ok(
    prompt.includes(mode),
    `planner prompt must explain ${mode}`
  );
}

assert.ok(
  prompt.includes(
    "개입이 지금 글쓰기에 분명한 가치를 더하지 못하면 silent"
  )
);

assert.ok(
  prompt.includes(
    "사용자에게 직접 질문이나 문장을 작성하지 않는다"
  )
);

assert.ok(prompt.includes("materialEvidence"));
assert.ok(prompt.includes("thinkingDeveloped"));
assert.ok(prompt.includes("referenceMaterials"));
assert.ok(prompt.includes("previousGardenerQuestions"));
assert.ok(
  prompt.includes(
    "새로 발견한 연결인 것처럼"
  )
);

const compacted =
  compactPlannerMaterial({
    id: "frag-1",
    date: "2026-09-03",
    thought: "a".repeat(4000),
    context: "b".repeat(1200),
    sourceExcerpt: "c".repeat(1600),
    retrieval: {
      distance: 0.21,
      score: 0.79
    }
  });

assert.equal(compacted.id, "frag-1");
assert.equal(compacted.thought.length, 3200);
assert.equal(compacted.context.length, 900);
assert.equal(compacted.sourceExcerpt.length, 1200);
assert.equal(compacted.retrieval.distance, 0.21);
assert.equal(compacted.retrieval.score, 0.79);

assert.equal(
  compactPlannerMaterial({
    thought: "ID가 없는 재료"
  }),
  null
);

const input =
  buildStudioPlannerInput({
    projectTitle: "기록에 대한 글",
    format: "blog",
    targetSlotTitle: "외부 연결",
    targetSlotPurpose: "과거 생각과 연결한다.",
    targetSlotGuide: "의미 있는 연결만 찾는다.",
    currentDraft: "d".repeat(7000),
    threadTitle: "기록 습관",
    threadQuestion: "왜 기록을 계속하지 못할까?",

    startingPath: {
      title:
        "기록의 의미",

      summary:
        "기록이 나에게 왜 필요한지 살펴본다.",

      guidingQuestion:
        "나는 왜 기록하려는가?",

      shape:
        "meaning"
    },

    previousGardenerQuestions: [
      "이 칸에서 전에 받은 질문?"
    ],

    referenceMaterials: [
      {
        id: "r1",
        role: "attached",
        thought:
          "현재 칸에 직접 붙인 생각"
      },

      {
        id: "r2",
        role: "starting",
        thought:
          "Studio를 시작한 생각"
      }
    ],

    previousSlots: [
      { id: "slot-1", text: "1" },
      { id: "slot-2", text: "2" },
      { id: "slot-3", text: "3" },
      { id: "slot-4", text: "4" },
      { id: "slot-5", text: "5" }
    ],

    materials: [
      { id: "m1", thought: "one" },
      { id: "m2", thought: "two" },
      { id: "m3", thought: "three" },
      { id: "m4", thought: "four" },
      { id: "m5", thought: "five" },
      { id: "m6", thought: "six" },
      { id: "m7", thought: "seven" }
    ]
  });

assert.equal(input.currentDraft.length, 6000);

assert.equal(
  input.startingPath.title,
  "기록의 의미"
);

assert.deepEqual(
  input.previousGardenerQuestions,
  [
    "이 칸에서 전에 받은 질문?"
  ]
);

assert.deepEqual(
  input.referenceMaterials.map(
    (material) =>
      material.id
  ),
  [
    "r1",
    "r2"
  ]
);

assert.equal(
  input.referenceMaterials[0].role,
  "attached"
);

assert.deepEqual(
  input.previousSlots.map(
    (slot) => slot.id
  ),
  [
    "slot-2",
    "slot-3",
    "slot-4",
    "slot-5"
  ]
);

assert.deepEqual(
  input.materials.map(
    (material) => material.id
  ),
  [
    "m1",
    "m2",
    "m3",
    "m4",
    "m5",
    "m6"
  ]
);

assert.equal(
  Object.prototype.hasOwnProperty.call(
    input,
    "excludedFragmentIds"
  ),
  false
);

console.log(
  "STUDIO_GARDENER_V2_PLANNER_TEST_PASS"
);
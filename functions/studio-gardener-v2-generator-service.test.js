"use strict";

const assert =
  require(
    "node:assert/strict"
  );

const {
  QUESTION_SCORE_FIELDS
} = require("./ai-v2-core");

const {
  STUDIO_EDIT_SCORE_FIELDS
} = require("./studio-gardener-v2-core");

const {
  generateStudioGardenerIntervention
} = require("./studio-gardener-v2-generator-service");

function allScores(
  fields,
  value = 5
) {
  return Object.fromEntries(
    fields.map(
      (key) => [
        key,
        value
      ]
    )
  );
}

const material = {
  id:
    "frag-record",

  thought:
    "좋은 기록에는 과정+경험+깨달은 점이 함께 들어간다."
};

const context = {
  projectTitle:
    "기록을 잘 하는 사람이 되고 싶다",

  format: "blog",

  targetSlotTitle:
    "외부의 시선",

  targetSlotPurpose:
    "기록의 의미를 확장한다.",

  targetSlotGuide:
    "과거 생각과 연결한다.",

  currentDraft:
    "기록을 통해 만들어 내는 다양한 결과물들을 보면서 나도 꾸준히 기록하면 자신감을 얻을 수 있겠다는 생각이 들었다.",

  previousSlots: [
    {
      id: "hook",
      title: "시작",

      text:
        "나는 기록을 꾸준히 하고 싶다.",

      gardenerQuestion:
        "기록을 멈추게 되는 가장 큰 이유는 무엇일까?"
    }
  ],

  materials: [
    material
  ]
};

const connectPlan = {
  decision: "act",
  mode: "connect",

  reason:
    "현재 기록의 가치와 과거 기록 방식이 연결된다.",

  primaryEvidence:
    "기록을 통해 만들어 내는 다양한 결과물들을 보면서",

  materialId:
    "frag-record",

  materialEvidence:
    "과정+경험+깨달은 점",

  scores: {
    grounded: 5,
    novel: 4,
    addsValue: 5,
    contextFit: 5,
    thinkingDeveloped: 3
  }
};

async function testValidConnect() {
  const usage = {
    inputTokens: 500,
    cachedInputTokens: 0,
    outputTokens: 100,
    reasoningTokens: 30,
    totalTokens: 600
  };

  const result =
    await generateStudioGardenerIntervention({
      context,
      plan:
        connectPlan,

      callGenerator:
        async (
          request
        ) => {
          assert.equal(
            request.input
              .selectedMaterial
              .id,
            "frag-record"
          );

          assert.match(
            request.systemPrompt,
            /connect/
          );

          return {
            ok: true,

            parsed: {
              decision:
                "speak",

              reason:
                "좋은 연결 질문이 있다.",

              candidates: [
                {
                  question:
                    "예전에는 좋은 기록에 과정·경험·깨달은 점이 함께 들어간다고 봤는데, 지금 만들고 싶은 기록에는 이 셋이 어떻게 들어가면 좋을까?",

                  evidence: {
                    primary:
                      "기록을 통해 만들어 내는 다양한 결과물들을 보면서",

                    materialId:
                      "frag-record",

                    material:
                      "과정+경험+깨달은 점"
                  },

                  scores:
                    allScores(
                      QUESTION_SCORE_FIELDS
                    )
                }
              ]
            },

            usage,

            responseId:
              "resp_connect",

            status: 200
          };
        }
    });

  assert.equal(
    result.generatorOk,
    true
  );

  assert.equal(
    result.decision,
    "speak"
  );

  assert.equal(
    result.type,
    "question"
  );

  assert.equal(
    result.mode,
    "connect"
  );

  assert.equal(
    result.responseId,
    "resp_connect"
  );

  assert.deepEqual(
    result.usage,
    usage
  );
}


async function testPrimaryPlanDriftRejected() {
  const result =
    await generateStudioGardenerIntervention({
      context,
      plan:
        connectPlan,

      callGenerator:
        async () => ({
          decision:
            "speak",

          reason:
            "다른 문장을 근거로 질문한다.",

          candidates: [
            {
              question:
                "꾸준히 기록하면서 자신감이 생긴다면, 기록 방식은 앞으로 어떻게 달라질까?",

              evidence: {
                primary:
                  "나도 꾸준히 기록하면 자신감을 얻을 수 있겠다는 생각이 들었다",

                materialId:
                  "frag-record",

                material:
                  "과정+경험+깨달은 점"
              },

              scores:
                allScores(
                  QUESTION_SCORE_FIELDS
                )
            }
          ]
        })
    });

  assert.equal(
    result.decision,
    "silent"
  );

  assert.equal(
    result.reason,
    "studio-question-gate-rejected-all"
  );

  assert.ok(
    result.rejected[0]
      .reasons
      .includes(
        "primary-evidence-plan-mismatch"
      )
  );
}
async function testRepeatedQuestionRejected() {
  const repeated =
    "기록을 멈추게 되는 가장 큰 이유는 무엇일까?";

  const result =
    await generateStudioGardenerIntervention({
      context,

      plan: {
        ...connectPlan,
        mode: "deepen",
        materialId: "",
        materialEvidence: ""
      },

      callGenerator:
        async () => ({
          decision:
            "speak",

          reason:
            "질문",

          candidates: [
            {
              question:
                repeated,

              evidence: {
                primary:
                  "기록을 통해 만들어 내는 다양한 결과물들을 보면서",

                materialId: "",
                material: ""
              },

              scores:
                allScores(
                  QUESTION_SCORE_FIELDS
                )
            }
          ]
        })
    });

  assert.equal(
    result.decision,
    "silent"
  );

  assert.equal(
    result.reason,
    "studio-question-gate-rejected-all"
  );

  assert.ok(
    result.rejected[0]
      .reasons
      .includes(
        "repeated-question"
      )
  );
}

async function testValidEdit() {
  const result =
    await generateStudioGardenerIntervention({
      context,

      plan: {
        decision:
          "act",

        mode:
          "edit",

        reason:
          "생각이 충분히 나온 상태에서 문장을 선명하게 다듬을 수 있다.",

        primaryEvidence:
          "나도 꾸준히 기록하면 자신감을 얻을 수 있겠다는 생각이 들었다.",

        materialId: "",
        materialEvidence: "",

        scores: {
          grounded: 5,
          novel: 4,
          addsValue: 5,
          contextFit: 5,
          thinkingDeveloped: 5
        }
      },

      callGenerator:
        async () => ({
          decision:
            "speak",

          reason:
            "간결하게 다듬는다.",

          candidates: [
            {
              suggestion:
                "꾸준히 기록하면 결과물만 쌓이는 것이 아니라, 내가 계속 해낼 수 있다는 자신감도 함께 쌓일 것 같다.",

              evidence: {
                primary:
                  "나도 꾸준히 기록하면 자신감을 얻을 수 있겠다는 생각이 들었다."
              },

              scores:
                allScores(
                  STUDIO_EDIT_SCORE_FIELDS
                )
            }
          ]
        })
    });

  assert.equal(
    result.decision,
    "speak"
  );

  assert.equal(
    result.type,
    "edit"
  );

  assert.match(
    result.suggestion,
    /자신감/
  );
}

async function testThrownFailureSafeSilent() {
  const result =
    await generateStudioGardenerIntervention({
      context,
      plan:
        connectPlan,

      callGenerator:
        async () => {
          const error =
            new Error(
              "network down"
            );

          error.name =
            "FetchError";

          throw error;
        }
    });

  assert.equal(
    result.generatorOk,
    false
  );

  assert.equal(
    result.decision,
    "silent"
  );

  assert.equal(
    result.reason,
    "generator-call-failed"
  );

  assert.equal(
    result.errorName,
    "FetchError"
  );

  assert.equal(
    result.usage.totalTokens,
    0
  );
}

async function testPlannerSilentSkipsCall() {
  let calls = 0;

  const result =
    await generateStudioGardenerIntervention({
      context,

      plan: {
        decision:
          "silent",
        mode:
          "silent"
      },

      callGenerator:
        async () => {
          calls += 1;

          throw new Error(
            "must not call"
          );
        }
    });

  assert.equal(
    calls,
    0
  );

  assert.equal(
    result.decision,
    "silent"
  );

  assert.equal(
    result.reason,
    "planner-silent"
  );
}

async function main() {
  await testValidConnect();
  await testPrimaryPlanDriftRejected();
  await testRepeatedQuestionRejected();
  await testValidEdit();
  await testThrownFailureSafeSilent();
  await testPlannerSilentSkipsCall();

  console.log(
    "STUDIO_GARDENER_V2_GENERATOR_SERVICE_TEST_PASS"
  );
}

main().catch(
  (error) => {
    console.error(error);
    process.exitCode = 1;
  }
);
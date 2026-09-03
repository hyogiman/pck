"use strict";

const assert =
  require(
    "node:assert/strict"
  );

const {
  QUESTION_SCORE_FIELDS
} = require("./ai-v2-core");

const {
  runStudioGardenerFullPipeline
} = require("./studio-gardener-v2-orchestrator");

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
    "기록을 통해 여러 결과물이 만들어지는 걸 보면서 나도 기록을 계속하고 싶다는 생각이 들었다.",

  previousSlots: [],

  previousGardenerQuestions: [],

  threadTitle: "",
  threadQuestion: ""
};

const material = {
  id:
    "frag-record",

  thought:
    "좋은 기록에는 과정+경험+깨달은 점이 함께 들어간다."
};

const validPlan = {
  decision: "act",
  mode: "connect",

  reason:
    "현재 기록 의지와 과거 기록 방식이 연결된다.",

  primaryEvidence:
    "기록을 계속하고 싶다는 생각이 들었다",

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

async function testFullConnectFlow() {
  let retrievalCalls = 0;
  let plannerCalls = 0;
  let generatorCalls = 0;

  const result =
    await runStudioGardenerFullPipeline({
      context,

      retrieveMaterials:
        async () => {
          retrievalCalls += 1;

          return {
            retrievalVersion: 1,

            reason:
              "related-materials-found",

            queryChars: 500,

            embeddingInputTokens:
              120,

            candidateCount: 1,

            materials: [
              material
            ]
          };
        },

      callPlanner:
        async (request) => {
          plannerCalls += 1;

          assert.equal(
            request.input
              .materials[0]
              .id,
            "frag-record"
          );

          return {
            ok: true,

            parsed:
              validPlan,

            usage: {
              inputTokens: 300,
              cachedInputTokens: 0,
              outputTokens: 80,
              reasoningTokens: 20,
              totalTokens: 380
            },

            responseId:
              "resp_luna_full",

            status: 200
          };
        },

      callGenerator:
        async (request) => {
          generatorCalls += 1;

          assert.equal(
            request.input
              .selectedMaterial
              .id,
            "frag-record"
          );

          assert.equal(
            request.input.action,
            "connect"
          );

          return {
            ok: true,

            parsed: {
              decision:
                "speak",

              reason:
                "두 기록 관점을 함께 볼 가치가 있다.",

              candidates: [
                {
                  question:
                    "예전에 좋은 기록에는 과정·경험·깨달은 점이 함께 들어간다고 봤는데, 지금 기록을 계속한다면 이 셋 중 무엇을 가장 먼저 더 남겨보고 싶을까?",

                  evidence: {
                    primary:
                      "기록을 계속하고 싶다는 생각이 들었다",

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

            usage: {
              inputTokens: 400,
              cachedInputTokens: 0,
              outputTokens: 100,
              reasoningTokens: 30,
              totalTokens: 500
            },

            responseId:
              "resp_terra_full",

            status: 200
          };
        }
    });

  assert.equal(
    retrievalCalls,
    1
  );

  assert.equal(
    plannerCalls,
    1
  );

  assert.equal(
    generatorCalls,
    1
  );

  assert.equal(
    result.decision,
    "speak"
  );

  assert.equal(
    result.mode,
    "connect"
  );

  assert.equal(
    result.intervention.type,
    "question"
  );

  assert.match(
    result.intervention.question,
    /과정/
  );

  assert.equal(
    result.retrieval
      .materialCount,
    1
  );

  assert.equal(
    result.plannerUsage
      .totalTokens,
    380
  );

  assert.equal(
    result.generatorUsage
      .totalTokens,
    500
  );

  assert.equal(
    result.plannerResponseId,
    "resp_luna_full"
  );

  assert.equal(
    result.generatorResponseId,
    "resp_terra_full"
  );
}

async function testPlannerSilentSkipsTerra() {
  let generatorCalls = 0;

  const result =
    await runStudioGardenerFullPipeline({
      context,

      retrieveMaterials:
        async () => ({
          reason:
            "no-related-materials",

          materials: []
        }),

      callPlanner:
        async () => ({
          decision:
            "silent",

          mode:
            "silent",

          reason:
            "지금은 계속 쓰는 편이 낫다."
        }),

      callGenerator:
        async () => {
          generatorCalls += 1;

          throw new Error(
            "must not call Terra"
          );
        }
    });

  assert.equal(
    generatorCalls,
    0
  );

  assert.equal(
    result.decision,
    "silent"
  );

  assert.equal(
    result.generatorOk,
    true
  );

  assert.equal(
    result.generatorUsage
      .totalTokens,
    0
  );
}

async function testShortDraftSkipsEverything() {
  let retrievalCalls = 0;
  let plannerCalls = 0;
  let generatorCalls = 0;

  const result =
    await runStudioGardenerFullPipeline({
      context: {
        ...context,

        currentDraft:
          "아직 짧게 쓰는 중"
      },

      retrieveMaterials:
        async () => {
          retrievalCalls += 1;

          throw new Error(
            "must not retrieve"
          );
        },

      callPlanner:
        async () => {
          plannerCalls += 1;

          throw new Error(
            "must not plan"
          );
        },

      callGenerator:
        async () => {
          generatorCalls += 1;

          throw new Error(
            "must not generate"
          );
        }
    });

  assert.equal(
    retrievalCalls,
    0
  );

  assert.equal(
    plannerCalls,
    0
  );

  assert.equal(
    generatorCalls,
    0
  );

  assert.equal(
    result.decision,
    "silent"
  );

  assert.equal(
    result.intervention.reason,
    "not-enough-current-draft"
  );
}

async function main() {
  await testFullConnectFlow();
  await testPlannerSilentSkipsTerra();
  await testShortDraftSkipsEverything();

  console.log(
    "STUDIO_GARDENER_V2_FULL_PIPELINE_TEST_PASS"
  );
}

main().catch(
  (error) => {
    console.error(error);
    process.exitCode = 1;
  }
);
"use strict";

const assert =
  require(
    "node:assert/strict"
  );

const {
  QUESTION_SCORE_FIELDS
} = require(
  "./ai-v2-core"
);

const {
  createStudioGardenerFullPreviewHandler
} = require(
  "./studio-gardener-v2-full-preview"
);

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
    "기록을 통해 만들어 내는 다양한 결과물들을 보면서 나도 꾸준히 기록하면 자신감을 얻을 수 있겠다는 생각이 들었다.",

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

const plan = {
  decision: "act",
  mode: "connect",

  reason:
    "현재 기록의 의미와 과거 기록 방식이 연결된다.",

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

async function testFullFlow() {
  let adapterCalls = 0;
  let retrievalCalls = 0;
  let plannerCalls = 0;
  let generatorCalls = 0;

  const handler =
    createStudioGardenerFullPreviewHandler({
      db: {
        marker:
          "fake-db"
      },

      loadStateFn:
        async () => ({
          enabled: true,
          uid:
            "user-1",

          projectId:
            "project-1",

          slotId:
            "outside",

          context
        }),

      apiKeyProvider:
        () =>
          "test-api-key",

      createRetrievalAdaptersFn:
        (args) => {
          adapterCalls += 1;

          assert.equal(
            args.uid,
            "user-1"
          );

          assert.equal(
            args.apiKey,
            "test-api-key"
          );

          return {
            embedQuery:
              "fake-embed",

            vectorSearch:
              "fake-vector",

            loadFragments:
              "fake-load"
          };
        },

      retrieveMaterialsFn:
        async (args) => {
          retrievalCalls += 1;

          assert.equal(
            args.embedQuery,
            "fake-embed"
          );

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

      requestPlannerFn:
        async (request) => {
          plannerCalls += 1;

          assert.equal(
            request.apiKey,
            "test-api-key"
          );

          assert.equal(
            request.input
              .materials[0]
              .id,
            "frag-record"
          );

          return {
            ok: true,

            parsed:
              plan,

            usage: {
              inputTokens: 300,
              cachedInputTokens: 0,
              outputTokens: 80,
              reasoningTokens: 20,
              totalTokens: 380
            },

            responseId:
              "resp_luna_preview",

            status: 200
          };
        },

      requestGeneratorFn:
        async (request) => {
          generatorCalls += 1;

          assert.equal(
            request.apiKey,
            "test-api-key"
          );

          assert.equal(
            request.input.action,
            "connect"
          );

          assert.equal(
            request.input
              .selectedMaterial
              .id,
            "frag-record"
          );

          return {
            ok: true,

            parsed: {
              decision:
                "speak",

              reason:
                "연결 질문을 만들 가치가 있다.",

              candidates: [
                {
                  question:
                    "예전에 좋은 기록에는 과정·경험·깨달은 점이 함께 들어간다고 봤는데, 지금 꾸준히 기록한다면 이 셋 중 무엇을 가장 먼저 더 남겨보고 싶을까?",

                  evidence: {
                    primary:
                      plan.primaryEvidence,

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
              "resp_terra_preview",

            status: 200
          };
        }
    });

  const result =
    await handler({});

  assert.equal(
    adapterCalls,
    1
  );

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
    result.enabled,
    true
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

  assert.equal(
    result.plannerResponseId,
    "resp_luna_preview"
  );

  assert.equal(
    result.generatorResponseId,
    "resp_terra_preview"
  );

  assert.equal(
    result.retrieval
      .embeddingInputTokens,
    120
  );
}

async function testShortDraftSkipsAi() {
  let adapters = 0;

  const handler =
    createStudioGardenerFullPreviewHandler({
      db: {},

      loadStateFn:
        async () => ({
          enabled: true,
          uid:
            "user-1",

          projectId:
            "project-1",

          slotId:
            "outside",

          context: {
            ...context,

            currentDraft:
              "아직 짧게 쓰는 중"
          }
        }),

      apiKeyProvider:
        () => {
          throw new Error(
            "must not request key"
          );
        },

      createRetrievalAdaptersFn:
        () => {
          adapters += 1;

          throw new Error(
            "must not create adapters"
          );
        }
    });

  const result =
    await handler({});

  assert.equal(
    adapters,
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

  assert.equal(
    result.plannerUsage
      .totalTokens,
    0
  );

  assert.equal(
    result.generatorUsage
      .totalTokens,
    0
  );
}

async function testDisabledSkipsAi() {
  const handler =
    createStudioGardenerFullPreviewHandler({
      db: {},

      loadStateFn:
        async () => ({
          enabled: false,

          uid:
            "user-1",

          projectId:
            "project-1",

          slotId:
            "outside",

          context: null
        }),

      apiKeyProvider:
        () => {
          throw new Error(
            "must not request key"
          );
        }
    });

  const result =
    await handler({});

  assert.equal(
    result.enabled,
    false
  );

  assert.equal(
    result.decision,
    "silent"
  );
}

async function main() {
  await testFullFlow();
  await testShortDraftSkipsAi();
  await testDisabledSkipsAi();

  console.log(
    "STUDIO_GARDENER_V2_FULL_PREVIEW_TEST_PASS"
  );
}

main().catch(
  (error) => {
    console.error(error);
    process.exitCode = 1;
  }
);
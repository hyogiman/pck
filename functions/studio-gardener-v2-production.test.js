"use strict";

const fs =
  require("node:fs");

const path =
  require("node:path");

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
  studioGardenerContextHash,
  studioGardenerProductionResponse,
  studioGardenerUsageDelta,
  createStudioGardenerProductionHandler
} = require(
  "./studio-gardener-v2-production"
);

function scores(
  value = 5
) {
  return Object.fromEntries(
    QUESTION_SCORE_FIELDS.map(
      (field) => [
        field,
        value
      ]
    )
  );
}

const context = {
  projectTitle:
    "기록을 잘 하는 사람이 되고 싶다",

  format:
    "blog",

  targetSlotTitle:
    "외부의 시선",

  targetSlotPurpose:
    "외부 재료와 연결한다.",

  targetSlotGuide:
    "의미 있는 연결만 찾는다.",

  currentDraft:
    "기록을 통해 만들어지는 결과물을 보면서 나도 꾸준히 기록하고 싶다는 생각이 들었다.",

  previousSlots: [],

  previousGardenerQuestions: [],

  referenceMaterials: [],

  materials: [],

  threadTitle: "",
  threadQuestion: "",

  attachedMaterialIds: [],
  startingMaterialIds: [],
  excludedFragmentIds: [],
  threadMaterialIds: []
};

const material = {
  id:
    "frag-record",

  thought:
    "좋은 기록에는 과정+경험+깨달은 점이 함께 들어간다."
};

const plan = {
  decision:
    "act",

  mode:
    "connect",

  reason:
    "기록의 방식과 현재 생각이 연결된다.",

  primaryEvidence:
    "나도 꾸준히 기록하고 싶다는 생각이 들었다",

  materialId:
    "frag-record",

  materialEvidence:
    "과정+경험+깨달은 점",

  scores: {
    grounded: 5,
    novel: 5,
    addsValue: 5,
    contextFit: 5,
    thinkingDeveloped: 3
  }
};

async function testCachedQuestionSkipsAi() {
  let quotaCalls = 0;
  let adapterCalls = 0;

  const hash =
    studioGardenerContextHash(
      context
    );

  const handler =
    createStudioGardenerProductionHandler({
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

          context
        }),

      readCacheFn:
        async () => ({
          contextHash:
            hash,

          decision:
            "speak",

          stable: true,

          question:
            "캐시 질문?",

          type:
            "deepen",

          mode:
            "deepen",

          model:
            "gpt-5.6-terra"
        }),

      reserveQuotaFn:
        async () => {
          quotaCalls += 1;

          throw new Error(
            "must not reserve"
          );
        },

      createRetrievalAdaptersFn:
        () => {
          adapterCalls += 1;

          throw new Error(
            "must not create adapters"
          );
        }
    });

  const result =
    await handler({
      data: {
        generate: true
      }
    });

  assert.equal(
    quotaCalls,
    0
  );

  assert.equal(
    adapterCalls,
    0
  );

  assert.equal(
    result.cached,
    true
  );

  assert.equal(
    result.question,
    "캐시 질문?"
  );
}

async function testShortDraftSkipsQuotaAndKey() {
  let quotaCalls = 0;

  const handler =
    createStudioGardenerProductionHandler({
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
              "아직 짧다"
          }
        }),

      readCacheFn:
        async () =>
          null,

      reserveQuotaFn:
        async () => {
          quotaCalls += 1;

          throw new Error(
            "must not reserve"
          );
        },

      apiKeyProvider:
        () => {
          throw new Error(
            "must not request key"
          );
        }
    });

  const result =
    await handler({
      data: {
        generate: true
      }
    });

  assert.equal(
    quotaCalls,
    0
  );

  assert.equal(
    result.decision,
    "silent"
  );

  assert.equal(
    result.reason,
    "not-enough-current-draft"
  );
}

async function testFullQuestionRun() {
  let retrievalCalls = 0;
  let plannerCalls = 0;
  let generatorCalls = 0;
  let writeCalls = 0;

  let persisted = null;

  const handler =
    createStudioGardenerProductionHandler({
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

      readCacheFn:
        async () =>
          null,

      apiKeyProvider:
        () =>
          "test-api-key",

      reserveQuotaFn:
        async () => ({
          used: 4,
          limit: 30
        }),

      createRetrievalAdaptersFn:
        () => ({
          embedQuery:
            "fake-embed",

          vectorSearch:
            "fake-vector",

          loadFragments:
            "fake-load"
        }),

      retrieveMaterialsFn:
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

      requestPlannerFn:
        async () => {
          plannerCalls += 1;

          return {
            ok: true,

            parsed:
              plan,

            usage: {
              inputTokens: 300,
              cachedInputTokens: 20,
              outputTokens: 80,
              reasoningTokens: 20,
              totalTokens: 380
            },

            responseId:
              "resp-luna",

            status: 200
          };
        },

      requestGeneratorFn:
        async () => {
          generatorCalls += 1;

          return {
            ok: true,

            parsed: {
              decision:
                "speak",

              reason:
                "좋은 질문",

              candidates: [
                {
                  question:
                    "예전에 좋은 기록에는 과정·경험·깨달은 점이 함께 들어간다고 봤는데, 지금은 이 셋 중 무엇을 가장 더 남겨보고 싶을까?",

                  evidence: {
                    primary:
                      "나도 꾸준히 기록하고 싶다는 생각이 들었다",

                    materialId:
                      "frag-record",

                    material:
                      "과정+경험+깨달은 점"
                  },

                  scores:
                    scores()
                }
              ]
            },

            usage: {
              inputTokens: 400,
              cachedInputTokens: 50,
              outputTokens: 100,
              reasoningTokens: 30,
              totalTokens: 500
            },

            responseId:
              "resp-terra",

            status: 200
          };
        },

      writeRunFn:
        async (args) => {
          writeCalls += 1;
          persisted = args;
        }
    });

  const result =
    await handler({
      data: {
        generate: true
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
    writeCalls,
    1
  );

  assert.equal(
    result.decision,
    "speak"
  );

  assert.equal(
    result.type,
    "connect"
  );

  assert.match(
    result.question,
    /과정/
  );

  assert.equal(
    result.dailyUsed,
    4
  );

  assert.equal(
    persisted.uid,
    "user-1"
  );

  const delta =
    studioGardenerUsageDelta(
      persisted.result
    );

  assert.equal(
    delta.retrievalEmbeddingTokens,
    120
  );

  assert.equal(
    delta.plannerInputTokens,
    300
  );

  assert.equal(
    delta.generatorInputTokens,
    400
  );
}

function testEditLegacyCompatibility() {
  const result =
    studioGardenerProductionResponse({
      result: {
        plannerOk: true,
        generatorOk: true,

        decision:
          "speak",

        mode:
          "edit",

        intervention: {
          decision:
            "speak",

          type:
            "edit",

          suggestion:
            "이 문장을 조금 더 선명하게 다듬어보세요."
        }
      }
    });

  assert.equal(
    result.type,
    "edit"
  );

  assert.equal(
    result.question,
    "이 문장을 조금 더 선명하게 다듬어보세요."
  );

  assert.equal(
    result.suggestion,
    result.question
  );
}

function testFrontendContract() {
  const html =
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "index.html"
      ),
      "utf8"
    );

  assert.match(
    html,
    /studioGardenerInterventionLabel/
  );

  assert.match(
    html,
    /res\?\.suggestion/
  );

  assert.match(
    html,
    /다듬기 제안/
  );

  assert.match(
    html,
    /지금은 새로 끼어들지 않고/
  );
}

async function main() {
  await testCachedQuestionSkipsAi();
  await testShortDraftSkipsQuotaAndKey();
  await testFullQuestionRun();

  testEditLegacyCompatibility();
  testFrontendContract();

  console.log(
    "STUDIO_GARDENER_V2_PRODUCTION_TEST_PASS"
  );
}

main().catch(
  (error) => {
    console.error(error);
    process.exitCode = 1;
  }
);

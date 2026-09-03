"use strict";

const assert =
  require(
    "node:assert/strict"
  );

const {
  createStudioGardenerPlanPreviewHandler
} = require(
  "./studio-gardener-v2-plan-preview"
);

const fullContext = {
  projectTitle:
    "회사 일을 줄이고 내가 고른 일을 만드는 삶",

  format:
    "blog",

  targetSlotTitle:
    "외부의 시선",

  targetSlotPurpose:
    "현재 생각을 다른 기록과 연결한다.",

  targetSlotGuide:
    "의미 있는 연결만 찾는다.",

  previousSlots: [],

  currentDraft:
    "회사 일은 줄이고 싶지만 만드는 일 자체를 멈추고 싶은 건 아니다. 내가 고를 수 있는 일을 늘리고 싶다.",

  threadTitle:
    "자유와 일",

  threadQuestion:
    "나는 어떤 일을 선택하고 싶은가?",

  attachedMaterialIds: [],
  startingMaterialIds: [],
  excludedFragmentIds: [],
  threadMaterialIds: []
};

const retrievedMaterial = {
  id:
    "frag-freedom",

  thought:
    "예전에 나는 자유가 아무것도 안 하는 상태가 아니라 내가 할 일을 고를 수 있는 상태라고 적었다.",

  retrieval: {
    distance: 0.22,
    score: 0.78
  }
};

const validConnectPlan = {
  decision:
    "act",

  mode:
    "connect",

  reason:
    "현재의 선택권 문제와 과거 자유의 정의가 직접 연결된다.",

  primaryEvidence:
    "내가 고를 수 있는 일을 늘리고 싶다",

  materialId:
    "frag-freedom",

  materialEvidence:
    "내가 할 일을 고를 수 있는 상태",

  scores: {
    grounded: 5,
    novel: 5,
    addsValue: 5,
    contextFit: 5,
    thinkingDeveloped: 3
  }
};

async function testDisabledSkipsEverything() {
  let adapterCalls = 0;
  let retrievalCalls = 0;
  let plannerCalls = 0;

  const handler =
    createStudioGardenerPlanPreviewHandler({
      db: {},

      loadStateFn:
        async () => ({
          enabled: false,
          uid: "user-1",
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
        },

      createRetrievalAdaptersFn:
        () => {
          adapterCalls += 1;

          throw new Error(
            "must not create adapters"
          );
        },

      retrieveMaterialsFn:
        async () => {
          retrievalCalls += 1;

          throw new Error(
            "must not retrieve"
          );
        },

      requestPlannerFn:
        async () => {
          plannerCalls += 1;

          throw new Error(
            "must not plan"
          );
        }
    });

  const result =
    await handler({});

  assert.equal(
    adapterCalls,
    0
  );

  assert.equal(
    retrievalCalls,
    0
  );

  assert.equal(
    plannerCalls,
    0
  );

  assert.equal(
    result.enabled,
    false
  );

  assert.equal(
    result.decision,
    "silent"
  );
}

async function testShortDraftSkipsKeyAndAi() {
  let adapterCalls = 0;

  const handler =
    createStudioGardenerPlanPreviewHandler({
      db: {},

      loadStateFn:
        async () => ({
          enabled: true,
          uid: "user-1",
          projectId:
            "project-1",
          slotId:
            "outside",

          context: {
            ...fullContext,

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
          adapterCalls += 1;

          throw new Error(
            "must not create adapters"
          );
        }
    });

  const result =
    await handler({});

  assert.equal(
    adapterCalls,
    0
  );

  assert.equal(
    result.enabled,
    true
  );

  assert.equal(
    result.decision,
    "silent"
  );

  assert.equal(
    result.plan.reason,
    "not-enough-current-draft"
  );

  assert.equal(
    result.retrieval.attempted,
    false
  );

  assert.equal(
    result.plannerUsage.totalTokens,
    0
  );
}

async function testEnabledConnectFlow() {
  let adapterCalls = 0;
  let retrievalCalls = 0;
  let plannerCalls = 0;

  const handler =
    createStudioGardenerPlanPreviewHandler({
      db: {
        marker:
          "fake-db"
      },

      loadStateFn:
        async () => ({
          enabled: true,
          uid: "user-1",
          projectId:
            "project-1",
          slotId:
            "outside",
          context:
            fullContext
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
              "fake-loader"
          };
        },

      retrieveMaterialsFn:
        async (args) => {
          retrievalCalls += 1;

          assert.equal(
            args.context
              .currentDraft,
            fullContext
              .currentDraft
          );

          assert.equal(
            args.embedQuery,
            "fake-embed"
          );

          return {
            retrievalVersion: 1,
            reason: "ok",
            queryChars: 510,

            embeddingInputTokens:
              120,

            candidateCount: 3,

            materials: [
              retrievedMaterial
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
            request
              .input
              .materials[0]
              .id,
            "frag-freedom"
          );

          return {
            ok: true,

            parsed:
              validConnectPlan,

            usage: {
              inputTokens: 130,
              cachedInputTokens: 0,
              outputTokens: 30,
              reasoningTokens: 10,
              totalTokens: 160
            },

            responseId:
              "resp_plan_preview",

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
    result.enabled,
    true
  );

  assert.equal(
    result.decision,
    "act"
  );

  assert.equal(
    result.mode,
    "connect"
  );

  assert.equal(
    result.plan.materialId,
    "frag-freedom"
  );

  assert.equal(
    result.retrieval.materialCount,
    1
  );

  assert.equal(
    result.retrieval
      .embeddingInputTokens,
    120
  );

  assert.equal(
    result.plannerUsage
      .totalTokens,
    160
  );

  assert.equal(
    result.responseId,
    "resp_plan_preview"
  );
}

async function main() {
  await testDisabledSkipsEverything();
  await testShortDraftSkipsKeyAndAi();
  await testEnabledConnectFlow();

  console.log(
    "STUDIO_GARDENER_V2_PLAN_PREVIEW_TEST_PASS"
  );
}

main().catch(
  (error) => {
    console.error(
      error
    );

    process.exitCode = 1;
  }
);
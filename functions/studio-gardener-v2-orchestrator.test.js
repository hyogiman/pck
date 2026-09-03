"use strict";

const assert = require("node:assert/strict");

const {
  STUDIO_GARDENER_MIN_DRAFT_CHARS,
  studioGardenerPreflight,
  runStudioGardenerPipeline
} = require("./studio-gardener-v2-orchestrator");

const baseContext = {
  projectTitle:
    "나는 왜 늘 시작하고 잘 그만둘까?",

  format:
    "blog",

  targetSlotTitle:
    "나의 해석",

  targetSlotPurpose:
    "반복되는 패턴의 의미를 더 깊게 생각한다.",

  targetSlotGuide:
    "이미 쓴 내용을 반복하지 않고 아직 덜 탐색된 지점을 찾는다.",

  previousSlots: [],

  currentDraft:
    "무언가를 시작할 때는 늘 신나는데, 어느 순간부터 결과보다 새로움이 사라졌다는 느낌에 더 민감해지는 것 같다.",

  threadTitle: "",
  threadQuestion: ""
};

function testPreflightBoundary() {
  const short =
    studioGardenerPreflight({
      currentDraft:
        "a".repeat(
          STUDIO_GARDENER_MIN_DRAFT_CHARS - 1
        )
    });

  assert.equal(
    short.eligible,
    false
  );

  const enough =
    studioGardenerPreflight({
      currentDraft:
        "a".repeat(
          STUDIO_GARDENER_MIN_DRAFT_CHARS
        )
    });

  assert.equal(
    enough.eligible,
    true
  );
}

async function testShortDraftSkipsAllAiWork() {
  let retrievalCalls = 0;
  let plannerCalls = 0;

  const result =
    await runStudioGardenerPipeline({
      context: {
        ...baseContext,
        currentDraft:
          "아직 생각을 쓰는 중"
      },

      retrieveMaterials:
        async () => {
          retrievalCalls += 1;

          throw new Error(
            "must not be called"
          );
        },

      callPlanner:
        async () => {
          plannerCalls += 1;

          throw new Error(
            "must not be called"
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
    result.decision,
    "silent"
  );

  assert.equal(
    result.mode,
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
    result.retrieval.embeddingInputTokens,
    0
  );

  assert.equal(
    result.plannerUsage.totalTokens,
    0
  );
}

async function testRetrievalFailureStillAllowsDeepen() {
  let retrievalCalls = 0;
  let plannerCalls = 0;

  const result =
    await runStudioGardenerPipeline({
      context:
        baseContext,

      retrieveMaterials:
        async () => {
          retrievalCalls += 1;

          throw new Error(
            "vector search unavailable"
          );
        },

      callPlanner:
        async (request) => {
          plannerCalls += 1;

          assert.deepEqual(
            request.input.materials,
            []
          );

          return {
            decision: "act",

            mode: "deepen",

            reason:
              "현재 글 안에서 새로움이 사라지는 순간과 중단 사이의 관계가 아직 충분히 탐색되지 않았다.",

            primaryEvidence:
              "새로움이 사라졌다는 느낌에 더 민감해지는 것 같다",

            materialId: "",
            materialEvidence: "",

            scores: {
              grounded: 5,
              novel: 5,
              addsValue: 5,
              contextFit: 5,
              thinkingDeveloped: 3
            }
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
    result.retrieval.ok,
    false
  );

  assert.equal(
    result.retrieval.reason,
    "retrieval-failed"
  );

  assert.equal(
    result.retrieval.materialCount,
    0
  );

  assert.equal(
    result.plannerOk,
    true
  );

  assert.equal(
    result.decision,
    "act"
  );

  assert.equal(
    result.mode,
    "deepen"
  );
}

async function main() {
  testPreflightBoundary();
  await testShortDraftSkipsAllAiWork();
  await testRetrievalFailureStillAllowsDeepen();

  console.log(
    "STUDIO_GARDENER_V2_ORCHESTRATOR_TEST_PASS"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
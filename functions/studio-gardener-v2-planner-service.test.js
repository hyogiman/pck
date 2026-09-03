"use strict";

const assert = require("node:assert/strict");

const {
  planStudioGardener
} = require("./studio-gardener-v2-planner-service");

const {
  requestStudioLuna
} = require("./studio-gardener-v2-luna-adapter");

const context = {
  projectTitle:
    "회사 일을 줄이고 내가 고른 일을 만드는 삶",

  format:
    "blog",

  targetSlotTitle:
    "외부 연결",

  targetSlotPurpose:
    "현재 생각을 과거 기록과 연결한다.",

  targetSlotGuide:
    "단순 유사성이 아니라 새로운 의미가 생기는 연결을 찾는다.",

  previousSlots: [
    {
      id: "hook",
      title: "시작",
      text:
        "회사에서 가장 지치는 건 일이 많아서라기보다 내가 정하지 않은 일을 계속 처리해야 한다는 느낌이다.",
      gardenerQuestion:
        "회사 일에서 가장 지치는 순간은 언제였어?"
    }
  ],

  currentDraft:
    "회사 일은 줄이고 싶지만 만드는 일 자체를 멈추고 싶은 건 아니다.",

  threadTitle:
    "자유와 일",

  threadQuestion:
    "나는 어떤 일을 선택하고 싶은가?",

  materials: [
    {
      id:
        "frag-freedom",

      thought:
        "예전에 나는 자유가 아무것도 안 하는 상태가 아니라 내가 할 일을 고를 수 있는 상태라고 적었다.",

      retrieval: {
        distance: 0.22,
        score: 0.78
      }
    }
  ]
};

const validConnectPlan = {
  decision: "act",

  mode: "connect",

  reason:
    "현재 글의 선택권 문제와 과거 자유에 대한 정의가 직접 연결된다.",

  primaryEvidence:
    "만드는 일 자체를 멈추고 싶은 건 아니다",

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

async function testDirectPlanStillWorks() {
  let received = null;

  const result =
    await planStudioGardener({
      context,

      callPlanner:
        async (request) => {
          received = request;
          return validConnectPlan;
        }
    });

  assert.ok(received);

  assert.equal(
    typeof received.systemPrompt,
    "string"
  );

  assert.equal(
    received.input.materials[0].id,
    "frag-freedom"
  );

  assert.equal(
    received.schema.type,
    "object"
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
    "connect"
  );

  assert.equal(
    result.plan.materialId,
    "frag-freedom"
  );
}

async function testRejectedPlanBecomesSilent() {
  const result =
    await planStudioGardener({
      context,

      callPlanner:
        async () => ({
          ...validConnectPlan,

          scores: {
            grounded: 5,
            novel: 2,
            addsValue: 3,
            contextFit: 5,
            thinkingDeveloped: 3
          }
        })
    });

  assert.equal(
    result.plannerOk,
    true
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
    "studio-plan-gate-rejected"
  );

  assert.ok(
    result.plan.rejectedReasons.includes(
      "low-novel"
    )
  );

  assert.ok(
    result.plan.rejectedReasons.includes(
      "low-addsValue"
    )
  );
}

async function testAdapterEnvelopeWorks() {
  const usage = {
    inputTokens: 400,
    cachedInputTokens: 50,
    outputTokens: 100,
    reasoningTokens: 30,
    totalTokens: 500
  };

  const result =
    await planStudioGardener({
      context,

      callPlanner:
        async () => ({
          ok: true,
          parsed: validConnectPlan,
          usage,
          responseId:
            "resp_studio_luna",
          status: 200
        })
    });

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
    "connect"
  );

  assert.deepEqual(
    result.usage,
    usage
  );

  assert.equal(
    result.responseId,
    "resp_studio_luna"
  );

  assert.equal(
    result.status,
    200
  );
}

async function testAdapterFailureBecomesSafeSilent() {
  const usage = {
    inputTokens: 20,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 20
  };

  const result =
    await planStudioGardener({
      context,

      callPlanner:
        async () => ({
          ok: false,
          parsed: null,
          usage,
          responseId:
            "resp_failed",
          status: 429
        })
    });

  assert.equal(
    result.ok,
    true
  );

  assert.equal(
    result.plannerOk,
    false
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
    "planner-call-failed"
  );

  assert.deepEqual(
    result.usage,
    usage
  );

  assert.equal(
    result.responseId,
    "resp_failed"
  );

  assert.equal(
    result.status,
    429
  );
}


async function testRealAdapterSeamWithFakeFetch() {
  let fetchCount = 0;

  const fakeFetch =
    async (url, options) => {
      fetchCount += 1;

      assert.equal(
        url,
        "https://api.openai.com/v1/responses"
      );

      const body =
        JSON.parse(
          options.body
        );

      assert.equal(
        body.text.format.strict,
        true
      );

      return {
        ok: true,
        status: 200,

        text:
          async () =>
            JSON.stringify({
              id:
                "resp_integrated",

              output_text:
                JSON.stringify(
                  validConnectPlan
                ),

              usage: {
                input_tokens: 250,
                output_tokens: 80,
                total_tokens: 330
              }
            })
      };
    };

  const result =
    await planStudioGardener({
      context,

      callPlanner:
        async (request) =>
          requestStudioLuna({
            ...request,

            apiKey:
              "test-api-key",

            fetchImpl:
              fakeFetch
          })
    });

  assert.equal(
    fetchCount,
    1
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
    "connect"
  );

  assert.equal(
    result.plan.materialId,
    "frag-freedom"
  );

  assert.equal(
    result.responseId,
    "resp_integrated"
  );

  assert.equal(
    result.usage.totalTokens,
    330
  );
}

async function main() {
  await testDirectPlanStillWorks();
  await testRejectedPlanBecomesSilent();
  await testAdapterEnvelopeWorks();
  await testAdapterFailureBecomesSafeSilent();
  await testRealAdapterSeamWithFakeFetch();

  console.log(
    "STUDIO_GARDENER_V2_PLANNER_SERVICE_TEST_PASS"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
"use strict";

const assert =
  require(
    "node:assert/strict"
  );

const {
  STUDIO_GARDENER_V2_PRICING,
  estimatedTextCostUsd,
  summarizeStudioV2Usage
} = require(
  "./studio-gardener-v2-usage"
);

function near(
  actual,
  expected,
  epsilon = 1e-12
) {
  assert.ok(
    Math.abs(
      actual - expected
    ) <= epsilon,
    `${actual} != ${expected}`
  );
}

const plannerCost =
  estimatedTextCostUsd({
    inputTokens: 1000,
    cachedInputTokens: 100,
    outputTokens: 200,

    pricing:
      STUDIO_GARDENER_V2_PRICING
        .planner
  });

near(
  plannerCost,
  0.000422
);

const summary =
  summarizeStudioV2Usage({
    studioV2Runs: 3,
    studioV2SpokenInterventions: 2,
    studioV2SilentRuns: 1,

    studioV2PlannerCalls: 3,
    studioV2PlannerInputTokens: 1000,
    studioV2PlannerCachedInputTokens: 100,
    studioV2PlannerOutputTokens: 200,
    studioV2PlannerReasoningTokens: 80,

    studioV2GeneratorCalls: 2,
    studioV2GeneratorInputTokens: 2000,
    studioV2GeneratorCachedInputTokens: 500,
    studioV2GeneratorOutputTokens: 300,
    studioV2GeneratorReasoningTokens: 120,

    studioV2RetrievalEmbeddingTokens: 809,
    studioV2RetrievalEmbeddingCount: 3
  });

assert.equal(
  summary.runs,
  3
);

assert.equal(
  summary.inputTokens,
  3000
);

assert.equal(
  summary.cachedInputTokens,
  600
);

assert.equal(
  summary.outputTokens,
  500
);

assert.equal(
  summary.reasoningTokens,
  200
);

assert.equal(
  summary.retrieval
    .embeddingTokens,
  809
);

near(
  summary.generator
    .estimatedCostUsd,
  0.0067
);

near(
  summary.retrieval
    .estimatedCostUsd,
  0.00001618
);

near(
  summary.totalEstimatedCostUsd,
  0.00713818
);

console.log(
  "STUDIO_GARDENER_V2_USAGE_TEST_PASS"
);

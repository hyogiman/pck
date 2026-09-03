"use strict";

const assert =
  require(
    "node:assert/strict"
  );

const {
  buildV2UsageOverview
} = require(
  "./ai-v2-usage-overview"
);

const result =
  buildV2UsageOverview(
    {
      totalEstimatedCostUsd:
        0.01
    },

    {
      bloomingV2Runs: 1,
      bloomingV2PreparedQuestions: 1,

      bloomingV2LunaCalls: 1,
      bloomingV2LunaInputTokens: 1000,
      bloomingV2LunaOutputTokens: 100,

      bloomingV2TerraCalls: 1,
      bloomingV2TerraInputTokens: 1000,
      bloomingV2TerraOutputTokens: 100,

      betweenThoughtsV2CurationAttempts: 1,
      betweenThoughtsV2QuestionAttempts: 1,
      betweenThoughtsV2Curations: 1,
      betweenThoughtsV2Questions: 1,

      betweenThoughtsV2InputTokens: 4000,
      betweenThoughtsV2OutputTokens: 800,
      betweenThoughtsV2TotalTokens: 4800,

      betweenThoughtsV2LunaCalls: 3,
      betweenThoughtsV2LunaInputTokens: 2000,
      betweenThoughtsV2LunaOutputTokens: 400,

      betweenThoughtsV2TerraCalls: 1,
      betweenThoughtsV2TerraInputTokens: 1000,
      betweenThoughtsV2TerraOutputTokens: 200
    }
  );

assert.equal(
  result
    .bloomingV2
    .luna.calls,
  1
);

assert.equal(
  result
    .bloomingV2
    .terra.calls,
  1
);

assert.equal(
  result
    .betweenThoughtsV2
    .luna.calls,
  3
);

assert.equal(
  result
    .betweenThoughtsV2
    .terra.calls,
  1
);

assert.equal(
  result
    .betweenThoughtsV2
    .unclassifiedTotalTokens,
  1200
);

assert.ok(
  result
    .totalEstimatedCostUsd >
  0.01
);

console.log(
  "AI_V2_USAGE_OVERVIEW_TEST_PASS"
);

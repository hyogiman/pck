"use strict";

const assert =
  require(
    "node:assert/strict"
  );

const {
  normalizedUsage,
  usageHasTokens,
  mergeNormalizedUsage,
  summarizeLunaTerra
} = require(
  "./ai-v2-feature-usage"
);

assert.deepEqual(
  normalizedUsage({
    inputTokens: 10,
    outputTokens: 4
  }),
  {
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 4,
    reasoningTokens: 0,
    totalTokens: 14
  }
);

assert.equal(
  usageHasTokens({
    totalTokens: 1
  }),
  true
);

assert.equal(
  usageHasTokens({}),
  false
);

assert.deepEqual(
  mergeNormalizedUsage(
    {
      inputTokens: 10,
      outputTokens: 2
    },
    {
      inputTokens: 4,
      outputTokens: 3
    }
  ),
  {
    inputTokens: 14,
    cachedInputTokens: 0,
    outputTokens: 5,
    reasoningTokens: 0,
    totalTokens: 19
  }
);

const summary =
  summarizeLunaTerra(
    {
      sampleLunaCalls: 2,
      sampleLunaInputTokens: 1000,
      sampleLunaCachedInputTokens: 100,
      sampleLunaOutputTokens: 200,

      sampleTerraCalls: 1,
      sampleTerraInputTokens: 2000,
      sampleTerraCachedInputTokens: 500,
      sampleTerraOutputTokens: 300
    },
    "sample"
  );

assert.equal(
  summary.luna.calls,
  2
);

assert.equal(
  summary.terra.calls,
  1
);

assert.equal(
  summary.inputTokens,
  3000
);

assert.equal(
  summary.outputTokens,
  500
);

assert.ok(
  summary.totalEstimatedCostUsd >
    0
);

console.log(
  "AI_V2_FEATURE_USAGE_TEST_PASS"
);

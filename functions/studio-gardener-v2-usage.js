"use strict";

const STUDIO_GARDENER_V2_PRICING =
  Object.freeze({
    planner: Object.freeze({
      model:
        "gpt-5.6-luna",

      inputUsdPerMillion:
        0.20,

      cachedInputUsdPerMillion:
        0.02,

      outputUsdPerMillion:
        1.20
    }),

    generator: Object.freeze({
      model:
        "gpt-5.6-terra",

      inputUsdPerMillion:
        2.00,

      cachedInputUsdPerMillion:
        0.20,

      outputUsdPerMillion:
        12.00
    }),

    embedding: Object.freeze({
      model:
        "text-embedding-3-small",

      inputUsdPerMillion:
        0.02
    })
  });

function nonnegative(
  value
) {
  const n =
    Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return Math.max(
    0,
    n
  );
}

function estimatedTextCostUsd({
  inputTokens = 0,
  cachedInputTokens = 0,
  outputTokens = 0,
  pricing
} = {}) {
  const input =
    nonnegative(
      inputTokens
    );

  const cached =
    Math.min(
      input,
      nonnegative(
        cachedInputTokens
      )
    );

  const uncached =
    Math.max(
      0,
      input - cached
    );

  const output =
    nonnegative(
      outputTokens
    );

  const rates =
    pricing || {};

  return (
    uncached *
      nonnegative(
        rates
          .inputUsdPerMillion
      ) +

    cached *
      nonnegative(
        rates
          .cachedInputUsdPerMillion
      ) +

    output *
      nonnegative(
        rates
          .outputUsdPerMillion
      )
  ) / 1_000_000;
}

function summarizeStudioV2Usage(
  data = {}
) {
  const planner = {
    model:
      String(
        data
          .studioV2PlannerModel ||
        STUDIO_GARDENER_V2_PRICING
          .planner.model
      ),

    calls:
      nonnegative(
        data
          .studioV2PlannerCalls
      ),

    inputTokens:
      nonnegative(
        data
          .studioV2PlannerInputTokens
      ),

    cachedInputTokens:
      nonnegative(
        data
          .studioV2PlannerCachedInputTokens
      ),

    outputTokens:
      nonnegative(
        data
          .studioV2PlannerOutputTokens
      ),

    reasoningTokens:
      nonnegative(
        data
          .studioV2PlannerReasoningTokens
      )
  };

  planner.estimatedCostUsd =
    estimatedTextCostUsd({
      ...planner,

      pricing:
        STUDIO_GARDENER_V2_PRICING
          .planner
    });

  const generator = {
    model:
      String(
        data
          .studioV2GeneratorModel ||
        STUDIO_GARDENER_V2_PRICING
          .generator.model
      ),

    calls:
      nonnegative(
        data
          .studioV2GeneratorCalls
      ),

    inputTokens:
      nonnegative(
        data
          .studioV2GeneratorInputTokens
      ),

    cachedInputTokens:
      nonnegative(
        data
          .studioV2GeneratorCachedInputTokens
      ),

    outputTokens:
      nonnegative(
        data
          .studioV2GeneratorOutputTokens
      ),

    reasoningTokens:
      nonnegative(
        data
          .studioV2GeneratorReasoningTokens
      )
  };

  generator.estimatedCostUsd =
    estimatedTextCostUsd({
      ...generator,

      pricing:
        STUDIO_GARDENER_V2_PRICING
          .generator
    });

  const retrieval = {
    model:
      String(
        data
          .studioV2EmbeddingModel ||
        STUDIO_GARDENER_V2_PRICING
          .embedding.model
      ),

    embeddingTokens:
      nonnegative(
        data
          .studioV2RetrievalEmbeddingTokens
      ),

    embeddingCount:
      nonnegative(
        data
          .studioV2RetrievalEmbeddingCount
      )
  };

  retrieval.estimatedCostUsd =
    (
      retrieval.embeddingTokens /
      1_000_000
    ) *
    STUDIO_GARDENER_V2_PRICING
      .embedding
      .inputUsdPerMillion;

  const runs =
    nonnegative(
      data.studioV2Runs
    );

  const spokenInterventions =
    nonnegative(
      data
        .studioV2SpokenInterventions
    );

  const silentRuns =
    nonnegative(
      data
        .studioV2SilentRuns
    );

  const generationEstimatedCostUsd =
    planner.estimatedCostUsd +
    generator.estimatedCostUsd;

  return {
    runs,
    spokenInterventions,
    silentRuns,

    planner,
    generator,
    retrieval,

    inputTokens:
      planner.inputTokens +
      generator.inputTokens,

    cachedInputTokens:
      planner.cachedInputTokens +
      generator.cachedInputTokens,

    outputTokens:
      planner.outputTokens +
      generator.outputTokens,

    reasoningTokens:
      planner.reasoningTokens +
      generator.reasoningTokens,

    generationEstimatedCostUsd,

    totalEstimatedCostUsd:
      generationEstimatedCostUsd +
      retrieval.estimatedCostUsd
  };
}

module.exports = {
  STUDIO_GARDENER_V2_PRICING,
  nonnegative,
  estimatedTextCostUsd,
  summarizeStudioV2Usage
};

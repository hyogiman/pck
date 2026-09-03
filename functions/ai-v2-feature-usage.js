"use strict";

const {
  FieldValue
} = require(
  "firebase-admin/firestore"
);

const {
  MODEL_ROUTES
} = require(
  "./ai-v2-core"
);

const {
  STUDIO_GARDENER_V2_PRICING,
  estimatedTextCostUsd
} = require(
  "./studio-gardener-v2-usage"
);

function koreaDateKey(
  now = new Date()
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Seoul",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit"
      }
    )
      .formatToParts(now);

  const get =
    (type) =>
      parts.find(
        (part) =>
          part.type === type
      )?.value || "";

  return (
    `${get("year")}-${get("month")}-${get("day")}`
  );
}

function nonnegative(
  value
) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? Math.max(0, n)
    : 0;
}

function emptyUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0
  };
}

function normalizedUsage(
  value
) {
  const raw =
    value &&
    typeof value === "object"
      ? value
      : {};

  const result = {
    inputTokens:
      nonnegative(
        raw.inputTokens
      ),

    cachedInputTokens:
      nonnegative(
        raw.cachedInputTokens
      ),

    outputTokens:
      nonnegative(
        raw.outputTokens
      ),

    reasoningTokens:
      nonnegative(
        raw.reasoningTokens
      ),

    totalTokens:
      nonnegative(
        raw.totalTokens
      )
  };

  if (!result.totalTokens) {
    result.totalTokens =
      result.inputTokens +
      result.outputTokens;
  }

  return result;
}

function usageHasTokens(
  value
) {
  const u =
    normalizedUsage(value);

  return Boolean(
    u.inputTokens ||
    u.outputTokens ||
    u.totalTokens
  );
}

function mergeNormalizedUsage(
  a,
  b
) {
  const x =
    normalizedUsage(a);

  const y =
    normalizedUsage(b);

  return {
    inputTokens:
      x.inputTokens +
      y.inputTokens,

    cachedInputTokens:
      x.cachedInputTokens +
      y.cachedInputTokens,

    outputTokens:
      x.outputTokens +
      y.outputTokens,

    reasoningTokens:
      x.reasoningTokens +
      y.reasoningTokens,

    totalTokens:
      x.totalTokens +
      y.totalTokens
  };
}

function routeUsagePatch({
  prefix,
  route,
  usage,
  calls = 0,
  model
} = {}) {
  const p =
    String(prefix || "");

  const r =
    String(route || "");

  if (!p || !r) {
    throw new TypeError(
      "prefix and route are required"
    );
  }

  const u =
    normalizedUsage(usage);

  return {
    [`${p}${r}Calls`]:
      FieldValue.increment(
        nonnegative(calls)
      ),

    [`${p}${r}InputTokens`]:
      FieldValue.increment(
        u.inputTokens
      ),

    [`${p}${r}CachedInputTokens`]:
      FieldValue.increment(
        u.cachedInputTokens
      ),

    [`${p}${r}OutputTokens`]:
      FieldValue.increment(
        u.outputTokens
      ),

    [`${p}${r}ReasoningTokens`]:
      FieldValue.increment(
        u.reasoningTokens
      ),

    [`${p}${r}Model`]:
      String(model || "")
  };
}

function summarizeRoute(
  data,
  prefix,
  route,
  pricing,
  defaultModel
) {
  const src =
    data &&
    typeof data === "object"
      ? data
      : {};

  const result = {
    model:
      String(
        src[
          `${prefix}${route}Model`
        ] ||
        defaultModel ||
        ""
      ),

    calls:
      nonnegative(
        src[
          `${prefix}${route}Calls`
        ]
      ),

    inputTokens:
      nonnegative(
        src[
          `${prefix}${route}InputTokens`
        ]
      ),

    cachedInputTokens:
      nonnegative(
        src[
          `${prefix}${route}CachedInputTokens`
        ]
      ),

    outputTokens:
      nonnegative(
        src[
          `${prefix}${route}OutputTokens`
        ]
      ),

    reasoningTokens:
      nonnegative(
        src[
          `${prefix}${route}ReasoningTokens`
        ]
      )
  };

  result.totalTokens =
    result.inputTokens +
    result.outputTokens;

  result.estimatedCostUsd =
    estimatedTextCostUsd({
      ...result,
      pricing
    });

  return result;
}

function summarizeLunaTerra(
  data,
  prefix
) {
  const luna =
    summarizeRoute(
      data,
      prefix,
      "Luna",
      STUDIO_GARDENER_V2_PRICING
        .planner,
      MODEL_ROUTES.discovery
    );

  const terra =
    summarizeRoute(
      data,
      prefix,
      "Terra",
      STUDIO_GARDENER_V2_PRICING
        .generator,
      MODEL_ROUTES.speaking
    );

  return {
    luna,
    terra,

    inputTokens:
      luna.inputTokens +
      terra.inputTokens,

    cachedInputTokens:
      luna.cachedInputTokens +
      terra.cachedInputTokens,

    outputTokens:
      luna.outputTokens +
      terra.outputTokens,

    reasoningTokens:
      luna.reasoningTokens +
      terra.reasoningTokens,

    totalTokens:
      luna.totalTokens +
      terra.totalTokens,

    totalEstimatedCostUsd:
      luna.estimatedCostUsd +
      terra.estimatedCostUsd
  };
}

module.exports = {
  koreaDateKey,
  nonnegative,
  emptyUsage,
  normalizedUsage,
  usageHasTokens,
  mergeNormalizedUsage,
  routeUsagePatch,
  summarizeRoute,
  summarizeLunaTerra
};

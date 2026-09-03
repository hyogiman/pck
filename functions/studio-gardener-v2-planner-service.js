"use strict";

const {
  selectStudioPlan
} = require("./studio-gardener-v2-core");

const {
  studioPlanSchema,
  studioPlannerPrompt,
  buildStudioPlannerInput
} = require("./studio-gardener-v2-planner");

function emptyPlannerUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0
  };
}

function normalizePlannerCallResult(
  result
) {
  const isEnvelope =
    result &&
    typeof result === "object" &&
    (
      Object.prototype.hasOwnProperty.call(
        result,
        "parsed"
      ) ||
      Object.prototype.hasOwnProperty.call(
        result,
        "usage"
      )
    );

  if (!isEnvelope) {
    return {
      plannerOk: true,
      rawPlan: result,
      usage: emptyPlannerUsage(),
      responseId: "",
      status: 0
    };
  }

  return {
    plannerOk:
      result.ok === true &&
      Boolean(result.parsed),

    rawPlan:
      result.parsed || null,

    usage:
      result.usage &&
      typeof result.usage === "object"
        ? result.usage
        : emptyPlannerUsage(),

    responseId:
      String(
        result.responseId || ""
      ),

    status:
      Number(
        result.status || 0
      )
  };
}

async function planStudioGardener({
  context = {},
  callPlanner
} = {}) {
  if (typeof callPlanner !== "function") {
    throw new TypeError(
      "callPlanner adapter is required"
    );
  }

  const input =
    buildStudioPlannerInput(context);

  let callResult;

  try {
    callResult =
      await callPlanner({
        systemPrompt:
          studioPlannerPrompt(),

        input,

        schema:
          studioPlanSchema()
      });
  } catch (error) {
    return {
      ok: true,
      plannerOk: false,
      decision: "silent",
      mode: "silent",

      plan: {
        decision: "silent",
        mode: "silent",
        reason:
          "planner-call-failed"
      },

      input,

      usage:
        emptyPlannerUsage(),

      responseId: "",
      status: 0,

      errorName:
        String(
          error?.name || "Error"
        )
    };
  }

  const normalized =
    normalizePlannerCallResult(
      callResult
    );

  if (!normalized.plannerOk) {
    const plan = {
      decision: "silent",
      mode: "silent",
      reason: "planner-call-failed"
    };

    return {
      ok: true,
      plannerOk: false,
      decision: "silent",
      mode: "silent",
      plan,
      input,
      usage: normalized.usage,
      responseId:
        normalized.responseId,
      status:
        normalized.status
    };
  }

  const selected =
    selectStudioPlan(
      normalized.rawPlan,
      context
    );

  return {
    ok: true,
    plannerOk: true,

    decision:
      selected.decision,

    mode:
      selected.mode,

    plan:
      selected,

    input,

    usage:
      normalized.usage,

    responseId:
      normalized.responseId,

    status:
      normalized.status
  };
}

module.exports = {
  emptyPlannerUsage,
  normalizePlannerCallResult,
  planStudioGardener
};
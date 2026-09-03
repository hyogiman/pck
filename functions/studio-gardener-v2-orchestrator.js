"use strict";

const {
  cleanText
} = require("./ai-v2-core");

const {
  planStudioGardener
} = require("./studio-gardener-v2-planner-service");

const STUDIO_GARDENER_MIN_DRAFT_CHARS =
  24;

function studioGardenerPreflight(
  context = {}
) {
  const currentDraft =
    cleanText(
      context.currentDraft,
      6000
    );

  if (
    currentDraft.length <
    STUDIO_GARDENER_MIN_DRAFT_CHARS
  ) {
    return {
      eligible: false,
      reason:
        "not-enough-current-draft",
      currentDraftChars:
        currentDraft.length
    };
  }

  return {
    eligible: true,
    reason: "ready",
    currentDraftChars:
      currentDraft.length
  };
}

async function runStudioGardenerPipeline({
  context = {},
  retrieveMaterials,
  callPlanner
} = {}) {
  const preflight =
    studioGardenerPreflight(
      context
    );

  if (!preflight.eligible) {
    return {
      ok: true,
      plannerOk: true,
      decision: "silent",
      mode: "silent",

      plan: {
        decision: "silent",
        mode: "silent",
        reason:
          preflight.reason
      },

      preflight,

      retrieval: {
        ok: true,
        attempted: false,
        reason:
          "skipped-before-retrieval",
        embeddingInputTokens: 0,
        candidateCount: 0,
        materials: []
      },

      plannerUsage: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0
      }
    };
  }

  if (
    typeof retrieveMaterials !==
    "function"
  ) {
    throw new TypeError(
      "retrieveMaterials adapter is required"
    );
  }

  if (
    typeof callPlanner !==
    "function"
  ) {
    throw new TypeError(
      "callPlanner adapter is required"
    );
  }

  let retrieval;

  try {
    retrieval =
      await retrieveMaterials(
        context
      );
  } catch (error) {
    retrieval = {
      ok: false,
      attempted: true,
      reason:
        "retrieval-failed",
      errorName:
        String(
          error?.name || "Error"
        ),
      embeddingInputTokens: 0,
      candidateCount: 0,
      materials: []
    };
  }

  const materials =
    Array.isArray(
      retrieval?.materials
    )
      ? retrieval.materials
      : [];

  const plannerContext = {
    ...context,
    materials
  };

  const planned =
    await planStudioGardener({
      context:
        plannerContext,
      callPlanner
    });

  return {
    ok: true,

    plannerOk:
      planned.plannerOk,

    decision:
      planned.decision,

    mode:
      planned.mode,

    plan:
      planned.plan,

    preflight,

    retrieval: {
      ok:
        retrieval?.ok !== false,

      attempted: true,

      reason:
        String(
          retrieval?.reason || ""
        ),

      retrievalVersion:
        Number(
          retrieval
            ?.retrievalVersion || 0
        ),

      queryChars:
        Number(
          retrieval?.queryChars || 0
        ),

      embeddingInputTokens:
        Number(
          retrieval
            ?.embeddingInputTokens || 0
        ),

      candidateCount:
        Number(
          retrieval
            ?.candidateCount || 0
        ),

      materialCount:
        materials.length
    },

    plannerUsage:
      planned.usage,

    responseId:
      planned.responseId,

    status:
      planned.status
  };
}

module.exports = {
  STUDIO_GARDENER_MIN_DRAFT_CHARS,
  studioGardenerPreflight,
  runStudioGardenerPipeline
};
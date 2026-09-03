"use strict";

const {
  cleanText
} = require("./ai-v2-core");

const {
  planStudioGardener
} = require("./studio-gardener-v2-planner-service");

const {
  generateStudioGardenerIntervention
} = require("./studio-gardener-v2-generator-service");

const STUDIO_GARDENER_MIN_DRAFT_CHARS =
  24;

function emptyAiUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0
  };
}

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

function summarizeRetrieval(
  retrieval,
  materials
) {
  return {
    ok:
      retrieval?.ok !== false,

    attempted:
      retrieval?.attempted !== false,

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
        retrieval
          ?.queryChars || 0
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
      Array.isArray(materials)
        ? materials.length
        : 0
  };
}

async function prepareStudioGardenerPlanning({
  context = {},
  retrieveMaterials,
  callPlanner
} = {}) {
  const preflight =
    studioGardenerPreflight(
      context
    );

  if (!preflight.eligible) {
    const materials = [];

    return {
      shortCircuit: true,

      preflight,

      retrieval: {
        ok: true,
        attempted: false,

        reason:
          "skipped-before-retrieval",

        embeddingInputTokens: 0,
        candidateCount: 0,
        materials
      },

      materials,

      plannerContext: {
        ...context,
        materials
      },

      planned: {
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

        usage:
          emptyAiUsage(),

        responseId: "",
        status: 0
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
    shortCircuit: false,
    preflight,
    retrieval,
    materials,
    plannerContext,
    planned
  };
}

function planningResultFromStage(
  stage
) {
  if (stage.shortCircuit) {
    return {
      ok: true,
      plannerOk: true,

      decision: "silent",
      mode: "silent",

      plan:
        stage.planned.plan,

      preflight:
        stage.preflight,

      retrieval: {
        ok: true,
        attempted: false,

        reason:
          "skipped-before-retrieval",

        embeddingInputTokens: 0,
        candidateCount: 0,
        materials: []
      },

      plannerUsage:
        emptyAiUsage()
    };
  }

  return {
    ok: true,

    plannerOk:
      stage.planned
        .plannerOk,

    decision:
      stage.planned
        .decision,

    mode:
      stage.planned
        .mode,

    plan:
      stage.planned
        .plan,

    preflight:
      stage.preflight,

    retrieval:
      summarizeRetrieval(
        stage.retrieval,
        stage.materials
      ),

    plannerUsage:
      stage.planned
        .usage,

    responseId:
      stage.planned
        .responseId,

    status:
      stage.planned
        .status
  };
}

/*
 * Planner-only pipeline.
 *
 * Kept for the existing Luna preview and backwards compatibility.
 */
async function runStudioGardenerPipeline({
  context = {},
  retrieveMaterials,
  callPlanner
} = {}) {
  const stage =
    await prepareStudioGardenerPlanning({
      context,
      retrieveMaterials,
      callPlanner
    });

  return planningResultFromStage(
    stage
  );
}

/*
 * Full Studio Gardener pipeline:
 *
 * context
 *   -> retrieval
 *   -> Luna plan
 *   -> Terra generation
 *   -> deterministic question/edit gate
 */
async function runStudioGardenerFullPipeline({
  context = {},
  retrieveMaterials,
  callPlanner,
  callGenerator
} = {}) {
  const stage =
    await prepareStudioGardenerPlanning({
      context,
      retrieveMaterials,
      callPlanner
    });

  const planning =
    planningResultFromStage(
      stage
    );

  if (
    stage.planned
      .decision !== "act" ||
    stage.planned
      .mode === "silent"
  ) {
    return {
      ok: true,

      plannerOk:
        stage.planned
          .plannerOk,

      generatorOk: true,

      decision:
        "silent",

      mode:
        stage.planned
          .mode,

      plan:
        stage.planned
          .plan,

      intervention: {
        decision:
          "silent",

        type: null,
        question: null,
        suggestion: null,

        reason:
          stage.shortCircuit
            ? stage.preflight.reason
            : "planner-silent"
      },

      preflight:
        planning.preflight,

      retrieval:
        planning.retrieval,

      plannerUsage:
        stage.planned
          .usage ||
        emptyAiUsage(),

      generatorUsage:
        emptyAiUsage(),

      plannerResponseId:
        String(
          stage.planned
            .responseId || ""
        ),

      generatorResponseId:
        "",

      plannerStatus:
        Number(
          stage.planned
            .status || 0
        ),

      generatorStatus: 0
    };
  }

  if (
    typeof callGenerator !==
    "function"
  ) {
    throw new TypeError(
      "callGenerator adapter is required"
    );
  }

  const generated =
    await generateStudioGardenerIntervention({
      context:
        stage.plannerContext,

      plan:
        stage.planned.plan,

      callGenerator
    });

  return {
    ok: true,

    plannerOk:
      stage.planned
        .plannerOk,

    generatorOk:
      generated
        .generatorOk,

    decision:
      generated
        .decision,

    mode:
      stage.planned
        .mode,

    plan:
      stage.planned
        .plan,

    intervention: {
      decision:
        generated
          .decision,

      type:
        generated
          .type || null,

      question:
        generated
          .question || null,

      suggestion:
        generated
          .suggestion || null,

      reason:
        generated
          .reason || "",

      scores:
        generated
          .scores || null,

      evidence:
        generated
          .evidence || {},

      rejected:
        Array.isArray(
          generated.rejected
        )
          ? generated.rejected
          : []
    },

    preflight:
      stage.preflight,

    retrieval:
      summarizeRetrieval(
        stage.retrieval,
        stage.materials
      ),

    plannerUsage:
      stage.planned
        .usage ||
      emptyAiUsage(),

    generatorUsage:
      generated
        .usage ||
      emptyAiUsage(),

    plannerResponseId:
      String(
        stage.planned
          .responseId || ""
      ),

    generatorResponseId:
      String(
        generated
          .responseId || ""
      ),

    plannerStatus:
      Number(
        stage.planned
          .status || 0
      ),

    generatorStatus:
      Number(
        generated
          .status || 0
      )
  };
}

module.exports = {
  STUDIO_GARDENER_MIN_DRAFT_CHARS,
  emptyAiUsage,
  studioGardenerPreflight,
  summarizeRetrieval,
  prepareStudioGardenerPlanning,
  runStudioGardenerPipeline,
  runStudioGardenerFullPipeline
};
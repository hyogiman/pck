"use strict";

const {
  STUDIO_ACTION_MODES,
  validateStudioQuestionCandidate,
  validateStudioEditCandidate
} = require("./studio-gardener-v2-core");

const {
  STUDIO_TERRA_SCHEMA_NAME,
  studioQuestionGenerationSchema,
  studioEditGenerationSchema,
  studioGeneratorPrompt,
  buildStudioGeneratorInput
} = require("./studio-gardener-v2-generator");

function emptyGeneratorUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0
  };
}

function normalizeGeneratorCallResult(
  result
) {
  const isEnvelope =
    result &&
    typeof result === "object" &&
    (
      Object.prototype
        .hasOwnProperty.call(
          result,
          "parsed"
        ) ||
      Object.prototype
        .hasOwnProperty.call(
          result,
          "usage"
        )
    );

  if (!isEnvelope) {
    return {
      generatorOk: true,
      raw:
        result,

      usage:
        emptyGeneratorUsage(),

      responseId: "",
      status: 0
    };
  }

  return {
    generatorOk:
      result.ok === true &&
      Boolean(
        result.parsed
      ),

    raw:
      result.parsed || null,

    usage:
      result.usage &&
      typeof result.usage ===
        "object"
        ? result.usage
        : emptyGeneratorUsage(),

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

function scoreTotal(
  scores
) {
  return Object.values(
    scores || {}
  ).reduce(
    (sum, value) =>
      sum +
      Number(
        value || 0
      ),
    0
  );
}

function selectQuestionGeneration(
  raw,
  context,
  plan
) {
  if (
    !raw ||
    raw.decision !==
      "speak"
  ) {
    return {
      decision: "silent",
      reason:
        String(
          raw?.reason ||
          "generator-chose-silence"
        )
    };
  }

  const candidates =
    Array.isArray(
      raw.candidates
    )
      ? raw.candidates.slice(0, 3)
      : [];

  const checked =
    candidates.map(
      (candidate, index) => ({
        index,
        candidate,

        validation:
          validateStudioQuestionCandidate(
            candidate,
            {
              context,

              mode:
                plan.mode,

              selectedMaterialId:
                plan.materialId
            }
          )
      })
    );

  const passing =
    checked.filter(
      (row) =>
        row.validation.ok
    );

  if (!passing.length) {
    return {
      decision: "silent",

      reason:
        "studio-question-gate-rejected-all",

      rejected:
        checked.map(
          (row) => ({
            index:
              row.index,

            reasons:
              row.validation
                .reasons
          })
        )
    };
  }

  passing.sort(
    (a, b) =>
      scoreTotal(
        b.validation
          .scores
      ) -
      scoreTotal(
        a.validation
          .scores
      )
  );

  const best =
    passing[0];

  return {
    decision: "speak",
    type: "question",

    question:
      best.validation
        .question,

    scores:
      best.validation
        .scores,

    evidence:
      best.candidate
        .evidence || {},

    selectedIndex:
      best.index
  };
}

function selectEditGeneration(
  raw,
  context
) {
  if (
    !raw ||
    raw.decision !==
      "speak"
  ) {
    return {
      decision: "silent",

      reason:
        String(
          raw?.reason ||
          "generator-chose-silence"
        )
    };
  }

  const candidates =
    Array.isArray(
      raw.candidates
    )
      ? raw.candidates.slice(0, 3)
      : [];

  const checked =
    candidates.map(
      (candidate, index) => ({
        index,
        candidate,

        validation:
          validateStudioEditCandidate(
            candidate,
            context
          )
      })
    );

  const passing =
    checked.filter(
      (row) =>
        row.validation.ok
    );

  if (!passing.length) {
    return {
      decision: "silent",

      reason:
        "studio-edit-gate-rejected-all",

      rejected:
        checked.map(
          (row) => ({
            index:
              row.index,

            reasons:
              row.validation
                .reasons
          })
        )
    };
  }

  passing.sort(
    (a, b) =>
      scoreTotal(
        b.validation
          .scores
      ) -
      scoreTotal(
        a.validation
          .scores
      )
  );

  const best =
    passing[0];

  return {
    decision: "speak",
    type: "edit",

    suggestion:
      best.validation
        .suggestion,

    scores:
      best.validation
        .scores,

    evidence:
      best.candidate
        .evidence || {},

    selectedIndex:
      best.index
  };
}

async function generateStudioGardenerIntervention({
  context = {},
  plan = {},
  callGenerator
} = {}) {
  if (
    plan?.decision !==
      "act" ||
    plan?.mode ===
      "silent"
  ) {
    return {
      ok: true,
      generatorOk: true,

      decision:
        "silent",

      reason:
        "planner-silent",

      usage:
        emptyGeneratorUsage()
    };
  }

  if (
    !STUDIO_ACTION_MODES
      .includes(
        plan.mode
      )
  ) {
    return {
      ok: true,
      generatorOk: true,

      decision:
        "silent",

      reason:
        "invalid-plan-mode",

      usage:
        emptyGeneratorUsage()
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

  const isEdit =
    plan.mode ===
      "edit";

  const input =
    buildStudioGeneratorInput({
      context,
      plan
    });

  let callResult;

  try {
    callResult =
      await callGenerator({
        systemPrompt:
          studioGeneratorPrompt(
            plan.mode
          ),

        input,

        schema:
          isEdit
            ? studioEditGenerationSchema()
            : studioQuestionGenerationSchema(),

        schemaName:
          `${STUDIO_TERRA_SCHEMA_NAME}_${plan.mode}`
      });
  } catch (error) {
    return {
      ok: true,
      generatorOk: false,

      decision:
        "silent",

      reason:
        "generator-call-failed",

      input,

      usage:
        emptyGeneratorUsage(),

      responseId: "",
      status: 0,

      errorName:
        String(
          error?.name ||
          "Error"
        )
    };
  }

  const normalized =
    normalizeGeneratorCallResult(
      callResult
    );

  if (
    !normalized.generatorOk
  ) {
    return {
      ok: true,
      generatorOk: false,

      decision:
        "silent",

      reason:
        "generator-call-failed",

      input,

      usage:
        normalized.usage,

      responseId:
        normalized.responseId,

      status:
        normalized.status
    };
  }

  const selected =
    isEdit
      ? selectEditGeneration(
          normalized.raw,
          context
        )
      : selectQuestionGeneration(
          normalized.raw,
          context,
          plan
        );

  return {
    ok: true,
    generatorOk: true,

    ...selected,

    mode:
      plan.mode,

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
  emptyGeneratorUsage,
  normalizeGeneratorCallResult,
  scoreTotal,
  selectQuestionGeneration,
  selectEditGeneration,
  generateStudioGardenerIntervention
};
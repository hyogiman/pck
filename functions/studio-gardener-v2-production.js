"use strict";

const crypto =
  require("node:crypto");

const {
  onCall,
  HttpsError
} = require(
  "firebase-functions/v2/https"
);

const {
  getApps,
  initializeApp
} = require(
  "firebase-admin/app"
);

const {
  getFirestore,
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
  loadStudioPlanPreviewState
} = require(
  "./studio-gardener-v2-plan-preview"
);

const {
  retrieveStudioGardenMaterials
} = require(
  "./studio-gardener-v2-retrieval-service"
);

const {
  createStudioRetrievalAdapters
} = require(
  "./studio-gardener-v2-retrieval-adapters"
);

const {
  requestStudioLuna
} = require(
  "./studio-gardener-v2-luna-adapter"
);

const {
  requestStudioTerra
} = require(
  "./studio-gardener-v2-terra-adapter"
);

const {
  studioGardenerPreflight,
  runStudioGardenerFullPipeline
} = require(
  "./studio-gardener-v2-orchestrator"
);

if (!getApps().length) {
  initializeApp();
}

const db =
  getFirestore();

const STUDIO_GARDENER_BASE_DAILY_LIMIT =
  30;

const STUDIO_GARDENER_MAX_DAILY_LIMIT =
  100;

const STUDIO_GARDENER_PRODUCTION_VERSION =
  2;

function koreaDateKey() {
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
      .formatToParts(
        new Date()
      );

  const map =
    Object.fromEntries(
      parts.map(
        (part) => [
          part.type,
          part.value
        ]
      )
    );

  return (
    `${map.year}-${map.month}-${map.day}`
  );
}

function studioGardenerContextHash(
  context = {}
) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        version:
          STUDIO_GARDENER_PRODUCTION_VERSION,

        context
      })
    )
    .digest("hex");
}

function studioGardenerCacheId(
  projectId,
  slotId
) {
  return (
    `${String(projectId)}__${String(slotId)}`
  );
}

async function readStudioGardenerCache({
  db,
  uid,
  projectId,
  slotId
} = {}) {
  const ref =
    db
      .collection("users")
      .doc(uid)
      .collection("aiStudioQuestions")
      .doc(
        studioGardenerCacheId(
          projectId,
          slotId
        )
      );

  const snap =
    await ref.get();

  return snap.exists
    ? snap.data() || {}
    : null;
}

async function reserveStudioGardenerQuotaV2({
  db,
  uid
} = {}) {
  const ref =
    db
      .collection("users")
      .doc(uid)
      .collection("aiUsage")
      .doc(
        koreaDateKey()
      );

  return db.runTransaction(
    async (tx) => {
      const snap =
        await tx.get(ref);

      const data =
        snap.exists
          ? snap.data() || {}
          : {};

      const used =
        Math.max(
          0,
          Number(
            data.studioQuestions ||
            0
          )
        );

      const limit =
        Math.max(
          STUDIO_GARDENER_BASE_DAILY_LIMIT,

          Math.min(
            STUDIO_GARDENER_MAX_DAILY_LIMIT,

            Number(
              data.studioDailyLimit ||
              STUDIO_GARDENER_BASE_DAILY_LIMIT
            )
          )
        );

      if (used >= limit) {
        throw new HttpsError(
          "resource-exhausted",

          `Studio 정원사는 오늘 ${limit}번까지 새 개입을 만듭니다. 설정에서 10회씩 한도를 늘릴 수 있습니다.`
        );
      }

      tx.set(
        ref,

        {
          studioQuestions:
            used + 1,

          studioDailyLimit:
            limit,

          updatedAt:
            FieldValue
              .serverTimestamp()
        },

        {
          merge: true
        }
      );

      return {
        used:
          used + 1,

        limit
      };
    }
  );
}

function studioGardenerProductionOutcome(
  result = {}
) {
  const intervention =
    result.intervention &&
    typeof result.intervention ===
      "object"
      ? result.intervention
      : {};

  const interventionType =
    String(
      intervention.type || ""
    );

  const mode =
    String(
      result.mode || ""
    );

  let text = "";

  if (
    interventionType ===
    "edit"
  ) {
    text =
      String(
        intervention.suggestion ||
        ""
      ).trim();
  } else {
    text =
      String(
        intervention.question ||
        ""
      ).trim();
  }

  const speak =
    result.decision ===
      "speak" &&
    Boolean(text);

  return {
    decision:
      speak
        ? "speak"
        : "silent",

    text:
      speak
        ? text
        : "",

    type:
      speak
        ? (
            interventionType ===
              "edit"
              ? "edit"
              : (
                  mode ||
                  "question"
                )
          )
        : "",

    mode,

    reason:
      speak
        ? ""
        : String(
            intervention.reason ||
            result.plan?.reason ||
            "studio-gardener-silent"
          )
  };
}

function studioGardenerUsageDelta(
  result = {}
) {
  const planner =
    result.plannerUsage || {};

  const generator =
    result.generatorUsage || {};

  const retrieval =
    result.retrieval || {};

  const outcome =
    studioGardenerProductionOutcome(
      result
    );

  const plannerTotal =
    Math.max(
      0,
      Number(
        planner.totalTokens ||
        0
      )
    );

  const generatorTotal =
    Math.max(
      0,
      Number(
        generator.totalTokens ||
        0
      )
    );

  const embeddingTokens =
    Math.max(
      0,
      Number(
        retrieval
          .embeddingInputTokens ||
        0
      )
    );

  return {
    runs: 1,

    spoken:
      outcome.decision ===
        "speak"
        ? 1
        : 0,

    silent:
      outcome.decision ===
        "silent"
        ? 1
        : 0,

    plannerCalls:
      plannerTotal > 0
        ? 1
        : 0,

    plannerInputTokens:
      Math.max(
        0,
        Number(
          planner.inputTokens ||
          0
        )
      ),

    plannerCachedInputTokens:
      Math.max(
        0,
        Number(
          planner.cachedInputTokens ||
          0
        )
      ),

    plannerOutputTokens:
      Math.max(
        0,
        Number(
          planner.outputTokens ||
          0
        )
      ),

    plannerReasoningTokens:
      Math.max(
        0,
        Number(
          planner.reasoningTokens ||
          0
        )
      ),

    generatorCalls:
      generatorTotal > 0
        ? 1
        : 0,

    generatorInputTokens:
      Math.max(
        0,
        Number(
          generator.inputTokens ||
          0
        )
      ),

    generatorCachedInputTokens:
      Math.max(
        0,
        Number(
          generator.cachedInputTokens ||
          0
        )
      ),

    generatorOutputTokens:
      Math.max(
        0,
        Number(
          generator.outputTokens ||
          0
        )
      ),

    generatorReasoningTokens:
      Math.max(
        0,
        Number(
          generator.reasoningTokens ||
          0
        )
      ),

    retrievalEmbeddingTokens:
      embeddingTokens,

    retrievalEmbeddingCount:
      embeddingTokens > 0
        ? 1
        : 0
  };
}

function studioGardenerProductionResponse({
  result,
  cached = false,
  dailyUsed = null,
  dailyLimit = null
} = {}) {
  const outcome =
    studioGardenerProductionOutcome(
      result
    );

  return {
    ok: true,
    enabled: true,
    cached,

    decision:
      outcome.decision,

    mode:
      outcome.mode,

    // Legacy frontend contract:
    // edit도 question에 text를 함께 넣어
    // 구버전 UI에서도 결과가 사라지지 않게 한다.
    question:
      outcome.text || null,

    suggestion:
      outcome.type ===
        "edit"
        ? outcome.text
        : null,

    type:
      outcome.type,

    model:
      outcome.decision ===
        "speak"
        ? MODEL_ROUTES.speaking
        : MODEL_ROUTES.discovery,

    reason:
      outcome.reason,

    ...(dailyUsed === null
      ? {}
      : {
          dailyUsed
        }),

    ...(dailyLimit === null
      ? {}
      : {
          dailyLimit
        })
  };
}

function cachedStudioGardenerResponse(
  cache
) {
  const question =
    String(
      cache?.question || ""
    ).trim();

  const type =
    String(
      cache?.type || ""
    );

  if (question) {
    return {
      ok: true,
      enabled: true,
      cached: true,
      decision:
        "speak",

      mode:
        String(
          cache?.mode || type
        ),

      question,

      suggestion:
        type === "edit"
          ? question
          : null,

      type,

      model:
        String(
          cache?.model ||
          MODEL_ROUTES.speaking
        ),

      reason: ""
    };
  }

  if (
    cache?.decision ===
      "silent" &&
    cache?.stable === true
  ) {
    return {
      ok: true,
      enabled: true,
      cached: true,

      decision:
        "silent",

      mode:
        String(
          cache?.mode || "silent"
        ),

      question: null,
      suggestion: null,
      type: "",

      model:
        String(
          cache?.model ||
          MODEL_ROUTES.discovery
        ),

      reason:
        String(
          cache?.reason ||
          "studio-gardener-silent"
        )
    };
  }

  return null;
}

async function writeStudioGardenerRun({
  db,
  uid,
  projectId,
  slotId,
  contextHash,
  dailyUsed,
  result
} = {}) {
  const userRef =
    db
      .collection("users")
      .doc(uid);

  const cacheRef =
    userRef
      .collection("aiStudioQuestions")
      .doc(
        studioGardenerCacheId(
          projectId,
          slotId
        )
      );

  const usageRef =
    userRef
      .collection("aiUsage")
      .doc(
        koreaDateKey()
      );

  const outcome =
    studioGardenerProductionOutcome(
      result
    );

  const delta =
    studioGardenerUsageDelta(
      result
    );

  const stable =
    result.plannerOk ===
      true &&
    result.generatorOk ===
      true;

  const batch =
    db.batch();

  if (stable) {
    batch.set(
      cacheRef,

      {
        projectId,
        slotId,

        version:
          STUDIO_GARDENER_PRODUCTION_VERSION,

        contextHash,

        stable: true,

        decision:
          outcome.decision,

        mode:
          outcome.mode,

        question:
          outcome.text,

        type:
          outcome.type,

        reason:
          outcome.reason,

        model:
          outcome.decision ===
            "speak"
            ? MODEL_ROUTES.speaking
            : MODEL_ROUTES.discovery,

        plannerModel:
          MODEL_ROUTES.discovery,

        generatorModel:
          MODEL_ROUTES.speaking,

        dailyUsed,

        generatedAt:
          FieldValue
            .serverTimestamp()
      },

      {
        merge: true
      }
    );
  }

  batch.set(
    usageRef,

    {
      studioV2Runs:
        FieldValue.increment(
          delta.runs
        ),

      studioV2SpokenInterventions:
        FieldValue.increment(
          delta.spoken
        ),

      studioV2SilentRuns:
        FieldValue.increment(
          delta.silent
        ),

      studioV2PlannerCalls:
        FieldValue.increment(
          delta.plannerCalls
        ),

      studioV2PlannerInputTokens:
        FieldValue.increment(
          delta.plannerInputTokens
        ),

      studioV2PlannerCachedInputTokens:
        FieldValue.increment(
          delta.plannerCachedInputTokens
        ),

      studioV2PlannerOutputTokens:
        FieldValue.increment(
          delta.plannerOutputTokens
        ),

      studioV2PlannerReasoningTokens:
        FieldValue.increment(
          delta.plannerReasoningTokens
        ),

      studioV2GeneratorCalls:
        FieldValue.increment(
          delta.generatorCalls
        ),

      studioV2GeneratorInputTokens:
        FieldValue.increment(
          delta.generatorInputTokens
        ),

      studioV2GeneratorCachedInputTokens:
        FieldValue.increment(
          delta.generatorCachedInputTokens
        ),

      studioV2GeneratorOutputTokens:
        FieldValue.increment(
          delta.generatorOutputTokens
        ),

      studioV2GeneratorReasoningTokens:
        FieldValue.increment(
          delta.generatorReasoningTokens
        ),

      studioV2RetrievalEmbeddingTokens:
        FieldValue.increment(
          delta.retrievalEmbeddingTokens
        ),

      studioV2RetrievalEmbeddingCount:
        FieldValue.increment(
          delta.retrievalEmbeddingCount
        ),

      studioV2PlannerModel:
        MODEL_ROUTES.discovery,

      studioV2GeneratorModel:
        MODEL_ROUTES.speaking,

      studioV2EmbeddingModel:
        MODEL_ROUTES.embedding,

      updatedAt:
        FieldValue
          .serverTimestamp()
    },

    {
      merge: true
    }
  );

  await batch.commit();
}

function createStudioGardenerProductionHandler({
  db,

  loadStateFn =
    loadStudioPlanPreviewState,

  readCacheFn =
    readStudioGardenerCache,

  reserveQuotaFn =
    reserveStudioGardenerQuotaV2,

  writeRunFn =
    writeStudioGardenerRun,

  createRetrievalAdaptersFn =
    createStudioRetrievalAdapters,

  retrieveMaterialsFn =
    retrieveStudioGardenMaterials,

  requestPlannerFn =
    requestStudioLuna,

  requestGeneratorFn =
    requestStudioTerra,

  apiKeyProvider =
    () =>
      process.env
        .OPENAI_API_KEY
} = {}) {
  return async function handler(
    request
  ) {
    const state =
      await loadStateFn({
        db,
        request
      });

    if (!state.enabled) {
      return {
        ok: true,
        enabled: false,
        cached: false,

        decision:
          "silent",

        mode:
          "silent",

        question: null,
        suggestion: null,
        type: "",

        reason:
          "studio-gardener-disabled"
      };
    }

    const contextHash =
      studioGardenerContextHash(
        state.context
      );

    const cache =
      await readCacheFn({
        db,
        uid:
          state.uid,

        projectId:
          state.projectId,

        slotId:
          state.slotId
      });

    if (
      cache &&
      cache.contextHash ===
        contextHash
    ) {
      const cachedResponse =
        cachedStudioGardenerResponse(
          cache
        );

      if (cachedResponse) {
        return cachedResponse;
      }
    }

    const generate =
      request?.data?.generate ===
        true;

    if (!generate) {
      return {
        ok: true,
        enabled: true,
        cached: false,

        decision:
          "silent",

        mode:
          "silent",

        question: null,
        suggestion: null,
        type: "",

        reason:
          "not-cached"
      };
    }

    const preflight =
      studioGardenerPreflight(
        state.context
      );

    if (!preflight.eligible) {
      return {
        ok: true,
        enabled: true,
        cached: false,

        decision:
          "silent",

        mode:
          "silent",

        question: null,
        suggestion: null,
        type: "",

        reason:
          preflight.reason
      };
    }

    const apiKey =
      String(
        apiKeyProvider() || ""
      ).trim();

    if (!apiKey) {
      throw new HttpsError(
        "failed-precondition",
        "AI 연결 설정을 확인해주세요."
      );
    }

    const adapters =
      createRetrievalAdaptersFn({
        db,

        uid:
          state.uid,

        apiKey
      });

    const quota =
      await reserveQuotaFn({
        db,
        uid:
          state.uid
      });

    const result =
      await runStudioGardenerFullPipeline({
        context:
          state.context,

        retrieveMaterials:
          async (context) =>
            retrieveMaterialsFn({
              context,
              ...adapters
            }),

        callPlanner:
          async (
            plannerRequest
          ) =>
            requestPlannerFn({
              ...plannerRequest,
              apiKey
            }),

        callGenerator:
          async (
            generatorRequest
          ) =>
            requestGeneratorFn({
              ...generatorRequest,
              apiKey
            })
      });

    await writeRunFn({
      db,

      uid:
        state.uid,

      projectId:
        state.projectId,

      slotId:
        state.slotId,

      contextHash,

      dailyUsed:
        quota.used,

      result
    });

    return studioGardenerProductionResponse({
      result,

      dailyUsed:
        quota.used,

      dailyLimit:
        quota.limit
    });
  };
}

const studioGardenerQuestionV2 =
  onCall(
    {
      region:
        "us-central1",

      secrets: [
        "OPENAI_API_KEY"
      ],

      timeoutSeconds:
        120,

      memory:
        "256MiB",

      maxInstances:
        3
    },

    createStudioGardenerProductionHandler({
      db
    })
  );

module.exports = {
  STUDIO_GARDENER_BASE_DAILY_LIMIT,
  STUDIO_GARDENER_MAX_DAILY_LIMIT,
  STUDIO_GARDENER_PRODUCTION_VERSION,

  koreaDateKey,
  studioGardenerContextHash,
  studioGardenerCacheId,

  readStudioGardenerCache,
  reserveStudioGardenerQuotaV2,

  studioGardenerProductionOutcome,
  studioGardenerUsageDelta,
  studioGardenerProductionResponse,
  cachedStudioGardenerResponse,
  writeStudioGardenerRun,

  createStudioGardenerProductionHandler,
  studioGardenerQuestionV2
};

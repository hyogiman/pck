"use strict";

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
  getFirestore
} = require(
  "firebase-admin/firestore"
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

function createStudioGardenerFullPreviewHandler({
  db,

  loadStateFn =
    loadStudioPlanPreviewState,

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

        projectId:
          state.projectId,

        slotId:
          state.slotId,

        decision:
          "silent",

        mode:
          "silent",

        intervention: {
          decision:
            "silent",

          type: null,
          question: null,
          suggestion: null,

          reason:
            "studio-gardener-disabled"
        }
      };
    }

    const preflight =
      studioGardenerPreflight(
        state.context
      );

    if (!preflight.eligible) {
      const result =
        await runStudioGardenerFullPipeline({
          context:
            state.context
        });

      return {
        ...result,

        enabled: true,

        projectId:
          state.projectId,

        slotId:
          state.slotId
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
          async (plannerRequest) =>
            requestPlannerFn({
              ...plannerRequest,
              apiKey
            }),

        callGenerator:
          async (generatorRequest) =>
            requestGeneratorFn({
              ...generatorRequest,
              apiKey
            })
      });

    return {
      ...result,

      enabled: true,

      projectId:
        state.projectId,

      slotId:
        state.slotId
    };
  };
}

const studioGardenerFullPreviewV2 =
  onCall(
    {
      region:
        "us-central1",

      secrets: [
        "OPENAI_API_KEY"
      ],

      timeoutSeconds: 120,
      memory: "256MiB",
      maxInstances: 1
    },

    createStudioGardenerFullPreviewHandler({
      db
    })
  );

module.exports = {
  createStudioGardenerFullPreviewHandler,
  studioGardenerFullPreviewV2
};
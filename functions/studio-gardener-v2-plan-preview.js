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
  buildStudioRetrievalContext,
  loadThreadContext
} = require(
  "./studio-gardener-v2-retrieval-preview"
);

const {
  requestStudioLuna
} = require(
  "./studio-gardener-v2-luna-adapter"
);

const {
  studioGardenerPreflight,
  runStudioGardenerPipeline
} = require(
  "./studio-gardener-v2-orchestrator"
);

if (!getApps().length) {
  initializeApp();
}

const db =
  getFirestore();

function safeId(
  raw,
  label
) {
  const value =
    String(
      raw || ""
    ).trim();

  if (
    !value ||
    value.length > 200 ||
    value.includes("/")
  ) {
    throw new HttpsError(
      "invalid-argument",
      `${label} ID가 올바르지 않습니다.`
    );
  }

  return value;
}

function requireUser(
  request
) {
  const uid =
    String(
      request
        ?.auth
        ?.uid || ""
    ).trim();

  if (!uid) {
    throw new HttpsError(
      "unauthenticated",
      "Google 로그인 후 사용할 수 있습니다."
    );
  }

  const provider =
    String(
      request
        ?.auth
        ?.token
        ?.firebase
        ?.sign_in_provider ||
        ""
    );

  if (
    provider ===
    "anonymous"
  ) {
    throw new HttpsError(
      "permission-denied",
      "정식 로그인 상태에서만 사용할 수 있습니다."
    );
  }

  return uid;
}

async function loadStudioPlanPreviewState({
  db,
  request
} = {}) {
  if (
    !db ||
    typeof db.collection !==
      "function"
  ) {
    throw new TypeError(
      "Firestore db is required"
    );
  }

  const uid =
    requireUser(
      request
    );

  const projectId =
    safeId(
      request.data?.projectId,
      "Studio"
    );

  const slotId =
    safeId(
      request.data?.slotId,
      "Studio 칸"
    );

  const userRef =
    db
      .collection("users")
      .doc(uid);

  const settingsSnap =
    await userRef
      .collection("settings")
      .doc("private")
      .get();

  const enabled =
    settingsSnap.exists &&
    settingsSnap.data()
      ?.studioGardenerEnabled ===
        true;

  if (!enabled) {
    return {
      enabled: false,
      uid,
      projectId,
      slotId,
      context: null
    };
  }

  const projectSnap =
    await userRef
      .collection("projects")
      .doc(projectId)
      .get();

  if (!projectSnap.exists) {
    throw new HttpsError(
      "not-found",
      "Studio 프로젝트를 찾지 못했습니다."
    );
  }

  const project =
    projectSnap.data() || {};

  const slots =
    Array.isArray(
      project.slots
    )
      ? project.slots
      : [];

  const slotIndex =
    slots.findIndex(
      (slot) =>
        String(
          slot?.id || ""
        ) === slotId
    );

  if (slotIndex < 0) {
    throw new HttpsError(
      "not-found",
      "Studio 칸을 찾지 못했습니다."
    );
  }

  const thread =
    await loadThreadContext(
      userRef,
      project
    );

  const context =
    buildStudioRetrievalContext({
      project,
      slotIndex,

      threadTitle:
        thread.title,

      threadQuestion:
        thread.question,

      threadMaterialIds:
        thread.fragmentIds
    });

  return {
    enabled: true,
    uid,
    projectId,
    slotId,
    context
  };
}

function createStudioGardenerPlanPreviewHandler({
  db,

  loadStateFn =
    loadStudioPlanPreviewState,

  createRetrievalAdaptersFn =
    createStudioRetrievalAdapters,

  retrieveMaterialsFn =
    retrieveStudioGardenMaterials,

  requestPlannerFn =
    requestStudioLuna,

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

        reason:
          "studio-gardener-disabled"
      };
    }

    const preflight =
      studioGardenerPreflight(
        state.context
      );

    if (!preflight.eligible) {
      const result =
        await runStudioGardenerPipeline({
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
      await runStudioGardenerPipeline({
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

const studioGardenerPlanPreviewV2 =
  onCall(
    {
      region:
        "us-central1",

      secrets: [
        "OPENAI_API_KEY"
      ],

      timeoutSeconds: 90,
      memory: "256MiB",
      maxInstances: 1
    },

    createStudioGardenerPlanPreviewHandler({
      db
    })
  );

module.exports = {
  safeId,
  requireUser,
  loadStudioPlanPreviewState,
  createStudioGardenerPlanPreviewHandler,
  studioGardenerPlanPreviewV2
};
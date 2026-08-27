"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const {
  retrieveStudioGardenMaterials
} = require("./studio-gardener-v2-retrieval-service");

const {
  createStudioRetrievalAdapters
} = require("./studio-gardener-v2-retrieval-adapters");

if (!getApps().length) initializeApp();
const db = getFirestore();

const STUDIO_META = {
  blog: {
    hook: [
      "1. 여는 글",
      "독자가 멈춰 읽게 할 내 경험이나 질문은?"
    ],
    experience: [
      "2. 소제목 ① — 나의 경험",
      "내가 실제로 겪은 장면·실패·사건은?"
    ],
    outside: [
      "3. 소제목 ② — 외부의 시선",
      "책·미디어·누군가의 말 중 이 생각을 확장한 재료는?"
    ],
    meaning: [
      "4. 소제목 ③ — 나의 해석",
      "그래서 나는 이것을 어떻게 다르게 보게 되었나?"
    ],
    counter: [
      "5. 반론",
      "반대로 생각하는 사람은 뭐라고 말할까?"
    ],
    conclusion: [
      "6. 닫는 글",
      "지금 시점에서 내가 말하고 싶은 한 문장은?"
    ]
  },

  shorts: {
    hook: ["1. 3초 훅", "처음 3초에 무엇으로 시선을 붙잡을까?"],
    situation: ["2. 상황 설명", "필요한 맥락은 무엇인가?"],
    turn: ["3. 반전 · 전환", "예상과 다른 전환점은 무엇인가?"],
    point: ["4. 핵심 한 문장", "남길 핵심 메시지는 무엇인가?"],
    close: ["5. 마무리", "어떻게 여운을 남길까?"]
  },

  instagram: {
    cover: ["1. 표지 문구", "가장 선명한 한 문장은 무엇인가?"],
    body: ["2. 핵심 3줄", "핵심 내용을 어떻게 압축할까?"],
    quote: ["3. 인용 한 줄", "어떤 외부 문장이 생각을 넓히는가?"],
    caption: ["4. 캡션", "왜 이 생각을 남기는가?"],
    tags: ["5. 해시태그", "핵심 개념은 무엇인가?"]
  },

  podcast: {
    open: ["1. 오프닝 질문", "청취자에게 어떤 질문으로 시작할까?"],
    line: ["2. 책/미디어 한 줄", "어떤 외부 재료로 이야기를 열까?"],
    experience: ["3. 내 경험", "어떤 실제 경험이 맞닿아 있는가?"],
    counter: ["4. 반론", "어떤 반대 관점이 가능한가?"],
    meaning: ["5. 내 생각", "반론 뒤에도 남는 생각은 무엇인가?"],
    question: ["6. 청취자 질문", "어떤 열린 질문을 남길까?"]
  }
};

function safeId(raw, label) {
  const value = String(raw || "").trim();

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

function requireUser(request) {
  const uid = String(
    request?.auth?.uid || ""
  ).trim();

  if (!uid) {
    throw new HttpsError(
      "unauthenticated",
      "Google 로그인 후 사용할 수 있습니다."
    );
  }

  const provider = String(
    request?.auth?.token?.firebase?.sign_in_provider || ""
  );

  if (provider === "anonymous") {
    throw new HttpsError(
      "permission-denied",
      "정식 로그인 상태에서만 사용할 수 있습니다."
    );
  }

  return uid;
}

function slotMeta(format, slotId) {
  return (
    STUDIO_META?.[format]?.[slotId] ||
    [
      String(slotId || ""),
      "현재 Studio 문항을 더 잘 쓰기 위한 생각을 확장한다."
    ]
  );
}

function buildStudioRetrievalContext({
  project,
  slotIndex,
  threadTitle = "",
  threadQuestion = "",
  threadMaterialIds = []
} = {}) {
  const data =
    project && typeof project === "object"
      ? project
      : {};

  const slots =
    Array.isArray(data.slots)
      ? data.slots
      : [];

  const index = Number(slotIndex);

  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= slots.length
  ) {
    throw new TypeError(
      "valid Studio slot index is required"
    );
  }

  const targetSlot =
    slots[index] || {};

  const format =
    String(data.format || "blog");

  const meta =
    slotMeta(format, targetSlot.id);

  const previousSlots =
    slots
      .slice(0, index)
      .map((slot) => {
        const previousMeta =
          slotMeta(format, slot?.id);

        return {
          id: String(slot?.id || ""),
          title: previousMeta[0],
          text: String(
            slot?.text || ""
          ).trim(),
          gardenerQuestion: String(
            slot?.gardenerQuestion || ""
          ).trim()
        };
      });

  const attachedMaterialIds =
    Array.isArray(targetSlot.fragmentIds)
      ? [
          ...new Set(
            targetSlot.fragmentIds
              .map(String)
              .filter(Boolean)
          )
        ]
      : [];

  const startingMaterialIds =
    Array.isArray(data.startingFragmentIds)
      ? [
          ...new Set(
            data.startingFragmentIds
              .map(String)
              .filter(Boolean)
          )
        ]
      : [];

  return {
    projectTitle:
      String(data.title || "").trim(),

    format,

    currentDraft:
      String(targetSlot.text || "").trim(),

    targetSlotTitle:
      meta[0],

    targetSlotPurpose:
      meta[1],

    targetSlotGuide:
      meta[1],

    threadTitle:
      String(threadTitle || "").trim(),

    threadQuestion:
      String(threadQuestion || "").trim(),

    previousSlots,

    attachedMaterialIds,

    startingMaterialIds,

    threadMaterialIds:
      Array.isArray(threadMaterialIds)
        ? [
            ...new Set(
              threadMaterialIds
                .map(String)
                .filter(Boolean)
            )
          ]
        : []
  };
}

async function loadThreadContext(
  userRef,
  project
) {
  const threadId =
    String(project?.threadId || "").trim();

  if (!threadId) {
    return {
      title: "",
      question: "",
      fragmentIds: []
    };
  }

  let title = "";
  let question = "";

  const threadSnap =
    await userRef
      .collection("threads")
      .doc(threadId)
      .get();

  if (threadSnap.exists) {
    const thread =
      threadSnap.data() || {};

    title =
      String(thread.title || "").trim();

    question =
      String(thread.question || "").trim();
  }

  const fragSnap =
    await userRef
      .collection("fragments")
      .where(
        "threadIds",
        "array-contains",
        threadId
      )
      .get();

  const fragmentIds = [];

  fragSnap.forEach((doc) => {
    const data = doc.data() || {};

    if (data.deletedAt) return;

    fragmentIds.push(doc.id);
  });

  return {
    title,
    question,
    fragmentIds
  };
}

const studioGardenerRetrievalPreviewV2 =
  onCall(
    {
      region: "us-central1",
      secrets: ["OPENAI_API_KEY"],
      timeoutSeconds: 90,
      memory: "256MiB",
      maxInstances: 1
    },

    async (request) => {
      const uid =
        requireUser(request);

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
        db.collection("users").doc(uid);

      const settingsSnap =
        await userRef
          .collection("settings")
          .doc("private")
          .get();

      const enabled =
        settingsSnap.exists &&
        settingsSnap.data()
          ?.studioGardenerEnabled === true;

      if (!enabled) {
        return {
          ok: true,
          enabled: false,
          materials: []
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
        Array.isArray(project.slots)
          ? project.slots
          : [];

      const slotIndex =
        slots.findIndex(
          (slot) =>
            String(slot?.id || "") ===
            slotId
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
          threadTitle: thread.title,
          threadQuestion:
            thread.question,
          threadMaterialIds:
            thread.fragmentIds
        });

      const adapters =
        createStudioRetrievalAdapters({
          db,
          uid,
          apiKey:
            process.env.OPENAI_API_KEY
        });

      const retrieval =
        await retrieveStudioGardenMaterials({
          context,
          ...adapters
        });

      return {
        ok: true,
        enabled: true,
        projectId,
        slotId,

        retrievalVersion:
          retrieval.retrievalVersion,

        reason:
          retrieval.reason,

        queryChars:
          retrieval.queryChars,

        embeddingInputTokens:
          retrieval.embeddingInputTokens,

        candidateCount:
          retrieval.candidateCount,

        materials:
          retrieval.materials
      };
    }
  );

module.exports = {
  STUDIO_META,
  slotMeta,
  buildStudioRetrievalContext,
  loadThreadContext,
  studioGardenerRetrievalPreviewV2
};
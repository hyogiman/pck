"use strict";

/**
 * Thought Garden · Between Thoughts v2 product lifecycle.
 *
 * Product contract:
 * - same client actions as v1: load / next / new-batch
 * - same item/pendingCount response shape used by the existing UI
 * - V2 queue is isolated in aiBetweenThoughtsCurations/currentV2 while testing
 * - existing v1 aiBetweenThoughtsCurations/current is never mutated here
 * - discovery/index hints -> original-text verification -> Terra generation -> final Luna judge
 * - questions are generated one at a time; pending pairs stay queued without Terra calls
 */
const crypto = require("node:crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { MODEL_ROUTES } = require("./ai-v2-core");

const {
  normalizedUsage,
  usageHasTokens,
  mergeNormalizedUsage,
  routeUsagePatch
} = require("./ai-v2-feature-usage");
const { runScoutPipeline, emptyUsage, mergeUsage } = require("./between-v2-scout-pipeline");
const { verifyOriginalPairs } = require("./between-v2-original-pair-verifier");
const { betweenThoughtsPreviewV2 } = require("./between-v2-preview");
const {
  BETWEEN_V2_QUEUE_SCHEMA_VERSION,
  BETWEEN_V2_MAX_PENDING_PAIRS,
  pairKey,
  uniquePairKeys,
  normalizePendingPairs,
  normalizeActiveItem,
  itemFromPreview,
  queueResponse
} = require("./between-v2-queue-core");

if (!getApps().length) initializeApp();
const db = getFirestore();

const MAX_CANDIDATES = 18;
const CURATION_DAILY_LIMIT = 4;
const QUESTION_DAILY_LIMIT = 12;
const V2_QUEUE_DOC_ID = "currentV2";

function safeId(raw, label) {
  const value = String(raw || "").trim();
  if (!value || value.length > 200 || value.includes("/")) {
    throw new HttpsError("invalid-argument", `${label} ID가 올바르지 않습니다.`);
  }
  return value;
}

function requireNonAnonymousUser(request) {
  const uid = String(request?.auth?.uid || "").trim();
  if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");
  const provider = String(request?.auth?.token?.firebase?.sign_in_provider || "");
  if (provider === "anonymous") {
    throw new HttpsError("permission-denied", "정식 로그인 상태에서만 두 생각 사이를 사용할 수 있습니다.");
  }
  return uid;
}

async function featureEnabled(userRef) {
  const snap = await userRef.collection("settings").doc("private").get();
  return snap.exists && (snap.data() || {}).betweenThoughtsEnabled === true;
}

function koreaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function reserveDailyQuota(uid, field, limit, message) {
  const ref = db.collection("users").doc(uid).collection("aiUsage").doc(koreaDateKey());
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const used = Math.max(0, Number(data[field] || 0));
    if (used >= limit) throw new HttpsError("resource-exhausted", message);
    tx.set(ref, { [field]: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return used + 1;
  });
}

async function reserveCurationQuota(uid) {
  return reserveDailyQuota(
    uid,
    "betweenThoughtsV2CurationAttempts",
    CURATION_DAILY_LIMIT,
    "두 생각 사이의 새 후보 묶음은 오늘 여기까지예요. 준비된 조합은 계속 볼 수 있어요."
  );
}

async function reserveQuestionQuota(uid) {
  return reserveDailyQuota(
    uid,
    "betweenThoughtsV2QuestionAttempts",
    QUESTION_DAILY_LIMIT,
    "두 생각 사이의 질문 생성은 오늘 여기까지예요. 준비된 조합은 내일 이어볼 수 있어요."
  );
}

function usageOrEmpty(value) {
  return value && typeof value === "object" ? value : emptyUsage();
}

function trackedUsage(
  total,
  {
    luna = null,
    lunaCalls = 0,
    terra = null,
    terraCalls = 0
  } = {}
) {
  return {
    ...usageOrEmpty(total),

    __routes: {
      luna:
        normalizedUsage(luna),

      lunaCalls:
        Math.max(
          0,
          Number(lunaCalls || 0)
        ),

      terra:
        normalizedUsage(terra),

      terraCalls:
        Math.max(
          0,
          Number(terraCalls || 0)
        )
    }
  };
}

function mergeTrackedUsage(
  a,
  b
) {
  const total =
    mergeUsage(
      usageOrEmpty(a),
      usageOrEmpty(b)
    );

  const ar =
    a?.__routes || {};

  const br =
    b?.__routes || {};

  return trackedUsage(
    total,
    {
      luna:
        mergeNormalizedUsage(
          ar.luna,
          br.luna
        ),

      lunaCalls:
        Number(
          ar.lunaCalls || 0
        ) +
        Number(
          br.lunaCalls || 0
        ),

      terra:
        mergeNormalizedUsage(
          ar.terra,
          br.terra
        ),

      terraCalls:
        Number(
          ar.terraCalls || 0
        ) +
        Number(
          br.terraCalls || 0
        )
    }
  );
}

function trackedScoutUsage(
  scout
) {
  return trackedUsage(
    scout?.usage?.total,
    {
      luna:
        scout?.usage?.total,

      lunaCalls:
        Number(
          scout?.aiCalls || 0
        )
    }
  );
}

function trackedOriginalUsage(
  original
) {
  return trackedUsage(
    original?.usage,
    {
      luna:
        original?.usage,

      lunaCalls:
        Number(
          original?.aiCalls || 0
        )
    }
  );
}

function trackedQuestionUsage(
  preview
) {
  const luna =
    normalizedUsage(
      preview?.usage?.judge
    );

  const terra =
    normalizedUsage(
      preview?.usage?.generation
    );

  return trackedUsage(
    preview?.usage?.total,
    {
      luna,

      lunaCalls:
        usageHasTokens(luna)
          ? 1
          : 0,

      terra,

      terraCalls:
        usageHasTokens(terra)
          ? 1
          : 0
    }
  );
}

async function recordV2Usage(userRef, usage, { curationCompleted = false, questionCompleted = false } = {}) {
  const u = usageOrEmpty(usage);
  const routes = u.__routes || {};

  const patch = {
    betweenThoughtsV2InputTokens: FieldValue.increment(Number(u.inputTokens || 0)),
    betweenThoughtsV2CachedInputTokens: FieldValue.increment(Number(u.cachedInputTokens || 0)),
    betweenThoughtsV2OutputTokens: FieldValue.increment(Number(u.outputTokens || 0)),
    betweenThoughtsV2TotalTokens: FieldValue.increment(Number(u.totalTokens || 0)),

    // 과거 total 필드는 호환용으로 유지한다.
    betweenThoughtsV2Model: MODEL_ROUTES.speaking,

    ...routeUsagePatch({
      prefix: "betweenThoughtsV2",
      route: "Luna",
      usage: routes.luna,
      calls: routes.lunaCalls,
      model: MODEL_ROUTES.discovery
    }),

    ...routeUsagePatch({
      prefix: "betweenThoughtsV2",
      route: "Terra",
      usage: routes.terra,
      calls: routes.terraCalls,
      model: MODEL_ROUTES.speaking
    }),

    updatedAt: FieldValue.serverTimestamp()
  };

  if (curationCompleted) patch.betweenThoughtsV2Curations = FieldValue.increment(1);
  if (questionCompleted) patch.betweenThoughtsV2Questions = FieldValue.increment(1);

  await userRef
    .collection("aiUsage")
    .doc(koreaDateKey())
    .set(
      patch,
      { merge: true }
    );
}

function cachePairIds(cache) {
  const rows = [cache?.activeItem, ...(Array.isArray(cache?.pendingPairs) ? cache.pendingPairs : [])];
  return [...new Set(rows.flatMap((row) => Array.isArray(row?.fragmentIds) ? row.fragmentIds.map(String) : []))];
}

async function existingValidIds(userRef, ids) {
  const unique = [...new Set(ids.map(String).filter(Boolean))];
  const snaps = await Promise.all(unique.map((id) => userRef.collection("fragments").doc(id).get()));
  const valid = new Set();
  snaps.forEach((snap, index) => {
    if (snap.exists && !(snap.data() || {}).deletedAt) valid.add(unique[index]);
  });
  return valid;
}

function curationIdFor(uid, generatedAtMs, pairs) {
  const keys = (Array.isArray(pairs) ? pairs : []).map((pair) => pairKey(pair)).filter(Boolean).join(",");
  return crypto.createHash("sha256").update(`${uid}:${generatedAtMs}:${keys}`).digest("hex").slice(0, 40);
}

async function generateQuestion(request, pair) {
  const ids = Array.isArray(pair?.fragmentIds) ? pair.fragmentIds.map(String) : [];
  if (ids.length !== 2) return { ok: true, decision: "silent", reason: "invalid-pair", usage: { total: emptyUsage() } };
  return betweenThoughtsPreviewV2.run({
    ...request,
    data: {
      ...(request.data || {}),
      stage: "preview",
      candidateIds: ids,
      pairFragmentIds: ids
    }
  });
}

async function persistQueue(queueRef, state) {
  await queueRef.set({
    queueSchemaVersion: BETWEEN_V2_QUEUE_SCHEMA_VERSION,
    engineVersion: 2,
    curationId: String(state.curationId || ""),
    candidateIds: Array.isArray(state.candidateIds) ? state.candidateIds : [],
    activeItem: state.activeItem || null,
    readyItems: [],
    pendingPairs: Array.isArray(state.pendingPairs) ? state.pendingPairs : [],
    dismissedPairKeys: uniquePairKeys(state.dismissedPairKeys, 80),
    noPairReason: String(state.noPairReason || ""),
    model: MODEL_ROUTES.speaking,
    generatedAtMs: Number(state.generatedAtMs || 0),
    generatedAt: state.generatedAt ? state.generatedAt : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    items: [],
    lastAction: String(state.lastAction || "load"),
    lastUsage: state.lastUsage || null
  }, { merge: true });
}

function responseFromState(state, extras = {}) {
  return {
    ...queueResponse({
      activeItem: state.activeItem,
      pendingPairs: state.pendingPairs,
      curationId: state.curationId,
      model: MODEL_ROUTES.speaking,
      noPairReason: state.noPairReason,
      generatedAtMs: state.generatedAtMs,
      cached: extras.cached !== false,
      weakPairSkipped: extras.weakPairSkipped,
      errorMessage: extras.errorMessage
    }),
    queueDoc: V2_QUEUE_DOC_ID,
    ...extras.extra
  };
}

const betweenThoughtsCurateV2 = onCall({
  region: "us-central1",
  secrets: ["OPENAI_API_KEY"],
  timeoutSeconds: 540,
  memory: "256MiB",
  maxInstances: 2
}, async (request) => {
  const uid = requireNonAnonymousUser(request);
  const userRef = db.collection("users").doc(uid);
  if (!(await featureEnabled(userRef))) {
    return { ok: true, enabled: false, item: null, items: [], pendingCount: 0, queueSchemaVersion: BETWEEN_V2_QUEUE_SCHEMA_VERSION };
  }

  const requestedAction = String(request.data?.action || "").trim();
  const action = ["load", "next", "new-batch"].includes(requestedAction) ? requestedAction : "load";
  const rawIds = Array.isArray(request.data?.candidateIds) ? request.data.candidateIds : [];
  const candidateIds = [...new Set(rawIds.slice(0, MAX_CANDIDATES).map((id, index) => safeId(id, `생각 조각 ${index + 1}`)))];
  if (candidateIds.length < 2) {
    return { ok: true, enabled: true, item: null, items: [], pendingCount: 0, noPairReason: "not-enough-context", queueSchemaVersion: BETWEEN_V2_QUEUE_SCHEMA_VERSION };
  }

  const clientExcluded = uniquePairKeys(Array.isArray(request.data?.excludePairKeys) ? request.data.excludePairKeys : [], 60);
  const queueRef = userRef.collection("aiBetweenThoughtsCurations").doc(V2_QUEUE_DOC_ID);
  const queueSnap = await queueRef.get();
  const cache = queueSnap.exists ? queueSnap.data() || {} : {};

  const allNeededIds = [...new Set([...candidateIds, ...cachePairIds(cache)])].slice(0, 40);
  const validIds = await existingValidIds(userRef, allNeededIds);
  let dismissedPairKeys = uniquePairKeys([...(Array.isArray(cache.dismissedPairKeys) ? cache.dismissedPairKeys : []), ...clientExcluded], 80);
  let excluded = new Set(dismissedPairKeys);
  let activeItem = normalizeActiveItem(cache.activeItem, validIds, excluded);
  let pendingPairs = normalizePendingPairs(cache.pendingPairs, validIds, excluded, BETWEEN_V2_MAX_PENDING_PAIRS);
  let curationId = String(cache.curationId || "");
  let generatedAtMs = Number(cache.generatedAtMs || 0);
  let noPairReason = String(cache.noPairReason || "");

  const state = () => ({
    activeItem,
    pendingPairs,
    dismissedPairKeys,
    curationId,
    generatedAtMs,
    noPairReason,
    candidateIds,
    lastAction: action
  });

  logger.info("Between v2 lifecycle request", {
    uid,
    action,
    candidateCount: candidateIds.length,
    active: Boolean(activeItem),
    pendingCount: pendingPairs.length,
    queueExists: queueSnap.exists
  });

  if (action === "load") {
    if (activeItem || pendingPairs.length) {
      await persistQueue(queueRef, state());
      return responseFromState(state(), { cached: true });
    }
    // Once a V2 lifecycle exists, merely reopening the lounge never spends again.
    if (queueSnap.exists && (cache.engineVersion === 2 || cache.queueSchemaVersion === BETWEEN_V2_QUEUE_SCHEMA_VERSION || cache.curationId || cache.generatedAtMs)) {
      noPairReason = "";
      await persistQueue(queueRef, state());
      return responseFromState(state(), { cached: true });
    }
    // First-ever V2 use intentionally falls through to one new-batch generation.
  }

  if (action === "next") {
    if (activeItem) {
      const oldKey = pairKey(activeItem);
      if (oldKey) dismissedPairKeys = uniquePairKeys([...dismissedPairKeys, oldKey], 80);
      activeItem = null;
    }
    excluded = new Set(dismissedPairKeys);
    pendingPairs = normalizePendingPairs(pendingPairs, validIds, excluded, BETWEEN_V2_MAX_PENDING_PAIRS);
    noPairReason = "";

    if (!pendingPairs.length) {
      await persistQueue(queueRef, state());
      return responseFromState(state(), { cached: true });
    }

    const candidate = pendingPairs.shift();
    try {
      await reserveQuestionQuota(uid);
    } catch (error) {
      pendingPairs.unshift(candidate);
      await persistQueue(queueRef, state());
      return responseFromState(state(), { cached: true, errorMessage: error?.message || "다음 질문은 나중에 이어볼 수 있어요." });
    }

    let preview;
    try {
      preview = await generateQuestion(request, candidate);
    } catch (error) {
      pendingPairs.unshift(candidate);
      await persistQueue(queueRef, state());
      throw error;
    }

    const questionUsage = trackedQuestionUsage(preview);
    const item = itemFromPreview(preview, candidate);
    const weakPairSkipped = !item;
    if (item) {
      activeItem = item;
      noPairReason = "";
    } else {
      const key = pairKey(candidate);
      if (key) dismissedPairKeys = uniquePairKeys([...dismissedPairKeys, key], 80);
      noPairReason = pendingPairs.length ? "" : String(preview?.reason || "원문 질문 단계에서 말할 가치가 충분하지 않았습니다.");
    }

    await persistQueue(queueRef, { ...state(), lastUsage: questionUsage });
    await recordV2Usage(userRef, questionUsage, { questionCompleted: Boolean(item) });
    return responseFromState(state(), { cached: false, weakPairSkipped });
  }

  // new-batch, or first-ever load.
  const oldKeys = [activeItem, ...pendingPairs].map((pair) => pairKey(pair)).filter(Boolean);
  dismissedPairKeys = uniquePairKeys([...dismissedPairKeys, ...oldKeys, ...clientExcluded], 80);
  activeItem = null;
  pendingPairs = [];
  noPairReason = "";

  try {
    await reserveCurationQuota(uid);
  } catch (error) {
    await persistQueue(queueRef, state());
    return responseFromState(state(), { cached: true, errorMessage: error?.message || "새 후보 묶음은 나중에 다시 찾아볼 수 있어요." });
  }

  const scout = await runScoutPipeline(userRef, candidateIds);
  let accumulatedUsage = trackedScoutUsage(scout);
  if (!scout.ok) {
    await recordV2Usage(userRef, accumulatedUsage);
    await persistQueue(queueRef, { ...state(), lastUsage: accumulatedUsage });
    return responseFromState(state(), { cached: false, errorMessage: "후보를 찾는 중 잠시 멈췄어요." });
  }

  const dismissedSet = new Set(dismissedPairKeys);
  const scoutAccepted = (Array.isArray(scout.acceptedPairs) ? scout.acceptedPairs : [])
    .filter((pair) => {
      const key = pairKey(pair);
      return key && !dismissedSet.has(key);
    });

  const original = await verifyOriginalPairs(userRef, scoutAccepted);
  accumulatedUsage = mergeTrackedUsage(accumulatedUsage, trackedOriginalUsage(original));
  if (!original.ok) {
    await recordV2Usage(userRef, accumulatedUsage);
    await persistQueue(queueRef, { ...state(), lastUsage: accumulatedUsage });
    return responseFromState(state(), { cached: false, errorMessage: "원문 연결을 확인하는 중 잠시 멈췄어요." });
  }

  const verifiedPairs = (Array.isArray(original.acceptedPairs) ? original.acceptedPairs : [])
    .filter((pair) => {
      const key = pairKey(pair);
      return key && !dismissedSet.has(key);
    })
    .slice(0, BETWEEN_V2_MAX_PENDING_PAIRS);

  generatedAtMs = Date.now();
  curationId = curationIdFor(uid, generatedAtMs, verifiedPairs);

  if (!verifiedPairs.length) {
    noPairReason = "지금은 두 기록을 함께 봐야만 생기는 질문 후보를 찾지 못했습니다.";
    await persistQueue(queueRef, { ...state(), lastUsage: accumulatedUsage });
    await recordV2Usage(userRef, accumulatedUsage, { curationCompleted: true });
    return responseFromState(state(), { cached: false });
  }

  const firstCandidate = verifiedPairs[0];
  pendingPairs = verifiedPairs.slice(1);

  try {
    await reserveQuestionQuota(uid);
  } catch (error) {
    pendingPairs = verifiedPairs;
    await persistQueue(queueRef, { ...state(), lastUsage: accumulatedUsage });
    await recordV2Usage(userRef, accumulatedUsage, { curationCompleted: true });
    return responseFromState(state(), { cached: false, errorMessage: error?.message || "첫 질문은 다음에 만들 수 있어요." });
  }

  let preview;
  try {
    preview = await generateQuestion(request, firstCandidate);
  } catch (error) {
    pendingPairs = verifiedPairs;
    await persistQueue(queueRef, { ...state(), lastUsage: accumulatedUsage });
    await recordV2Usage(userRef, accumulatedUsage, { curationCompleted: true });
    throw error;
  }

  const questionUsage = trackedQuestionUsage(preview);
  accumulatedUsage = mergeTrackedUsage(accumulatedUsage, questionUsage);
  const item = itemFromPreview(preview, firstCandidate);
  const weakPairSkipped = !item;

  if (item) {
    activeItem = item;
    noPairReason = "";
  } else {
    const key = pairKey(firstCandidate);
    if (key) dismissedPairKeys = uniquePairKeys([...dismissedPairKeys, key], 80);
    noPairReason = pendingPairs.length ? "" : String(preview?.reason || "원문 질문 단계에서 말할 가치가 충분하지 않았습니다.");
  }

  await persistQueue(queueRef, { ...state(), lastUsage: accumulatedUsage });
  await recordV2Usage(userRef, accumulatedUsage, { curationCompleted: true, questionCompleted: Boolean(item) });

  logger.info("Between v2 lifecycle batch completed", {
    uid,
    curationId,
    candidateCount: candidateIds.length,
    scoutAcceptedCount: scoutAccepted.length,
    originalAcceptedCount: verifiedPairs.length,
    active: Boolean(activeItem),
    pendingCount: pendingPairs.length,
    totalTokens: accumulatedUsage.totalTokens
  });

  return responseFromState(state(), { cached: false, weakPairSkipped });
});

module.exports = {
  betweenThoughtsCurateV2,
  V2_QUEUE_DOC_ID,
  CURATION_DAILY_LIMIT,
  QUESTION_DAILY_LIMIT,
  koreaDateKey
};

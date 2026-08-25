"use strict";

/**
 * Thought Garden · Between Thoughts v2 actual-record preview pipeline.
 *
 * This composes the new accuracy-first scout pipeline with the already-verified
 * actual-record generator + final Luna judge in between-v2-preview.js.
 * During the test phase we deliberately keep the proven generator/judge intact.
 *
 * READ-ONLY BY DESIGN. No queue/cache/usage/fragment writes.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { MODEL_ROUTES } = require("./ai-v2-core");
const { betweenThoughtsPreviewV2 } = require("./between-v2-preview");
const {
  runScoutPipeline,
  emptyUsage,
  mergeUsage
} = require("./between-v2-scout-pipeline");

if (!getApps().length) initializeApp();
const db = getFirestore();

function requireNonAnonymousUser(request) {
  const uid = String(request?.auth?.uid || "").trim();
  if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");
  const provider = String(request?.auth?.token?.firebase?.sign_in_provider || "");
  if (provider === "anonymous") {
    throw new HttpsError("permission-denied", "정식 로그인 상태에서만 Between v2 preview를 사용할 수 있습니다.");
  }
  return uid;
}

async function featureEnabled(userRef) {
  const snap = await userRef.collection("settings").doc("private").get();
  const data = snap.exists ? snap.data() || {} : {};
  return data.betweenThoughtsEnabled === true;
}

function summarizeScout(scout) {
  return {
    aiCalls: Number(scout?.aiCalls || 0),
    candidateCount: Number(scout?.candidateCount || 0),
    indexedCandidateCount: Number(scout?.indexedCandidateCount || 0),
    discoveryReason: scout?.discoveryReason || "",
    evaluationReason: scout?.evaluationReason || "",
    discoveryPairCount: Array.isArray(scout?.discoveryPairs) ? scout.discoveryPairs.length : 0,
    acceptedPairs: Array.isArray(scout?.acceptedPairs) ? scout.acceptedPairs : [],
    rejectedPairs: Array.isArray(scout?.rejectedPairs) ? scout.rejectedPairs : []
  };
}

const betweenThoughtsPreviewPipelineV2 = onCall({
  region: "us-central1",
  secrets: ["OPENAI_API_KEY"],
  timeoutSeconds: 540,
  memory: "256MiB",
  maxInstances: 2
}, async (request) => {
  const stage = String(request.data?.stage || "inspect").toLowerCase() === "preview" ? "preview" : "inspect";

  // Keep the existing zero-AI inspect behavior exactly as-is.
  if (stage === "inspect") return betweenThoughtsPreviewV2.run(request);

  const uid = requireNonAnonymousUser(request);
  const userRef = db.collection("users").doc(uid);
  if (!(await featureEnabled(userRef))) {
    return { ok: true, enabled: false, readOnly: true, item: null };
  }

  const rawCandidateIds = Array.isArray(request.data?.candidateIds) ? request.data.candidateIds : [];

  // Manual pair remains a precise component test: skip the scout entirely.
  const manualPair = Array.isArray(request.data?.pairFragmentIds) ? request.data.pairFragmentIds : [];
  if (manualPair.length) return betweenThoughtsPreviewV2.run(request);

  const scout = await runScoutPipeline(userRef, rawCandidateIds);
  if (!scout.ok) {
    return {
      ok: false,
      dryRun: true,
      readOnly: true,
      writesPerformed: 0,
      stage: "preview",
      decision: "silent",
      reason: scout.reason || "scout-pipeline-failed",
      pair: null,
      scoutModel: MODEL_ROUTES.discovery,
      scoutPipeline: summarizeScout(scout),
      usage: {
        scout: scout.usage?.total || emptyUsage(),
        scoutDiscovery: scout.usage?.discovery || emptyUsage(),
        scoutEvaluation: scout.usage?.evaluation || emptyUsage(),
        generation: emptyUsage(),
        judge: emptyUsage(),
        total: scout.usage?.total || emptyUsage()
      }
    };
  }

  if (!scout.selectedPair) {
    return {
      ok: true,
      dryRun: true,
      readOnly: true,
      writesPerformed: 0,
      stage: "preview",
      decision: "silent",
      reason: scout.reason || "scout-pair-gate-rejected-all",
      pair: null,
      scoutModel: MODEL_ROUTES.discovery,
      scoutPipeline: summarizeScout(scout),
      usage: {
        scout: scout.usage?.total || emptyUsage(),
        scoutDiscovery: scout.usage?.discovery || emptyUsage(),
        scoutEvaluation: scout.usage?.evaluation || emptyUsage(),
        generation: emptyUsage(),
        judge: emptyUsage(),
        total: scout.usage?.total || emptyUsage()
      }
    };
  }

  const delegatedRequest = {
    ...request,
    data: {
      ...(request.data || {}),
      stage: "preview",
      pairFragmentIds: scout.selectedPair.fragmentIds
    }
  };

  const finalResult = await betweenThoughtsPreviewV2.run(delegatedRequest);
  const generationUsage = finalResult?.usage?.generation || emptyUsage();
  const judgeUsage = finalResult?.usage?.judge || emptyUsage();
  const finalModelUsage = mergeUsage(generationUsage, judgeUsage);
  const combinedUsage = mergeUsage(scout.usage?.total || emptyUsage(), finalModelUsage);

  const finalPair = finalResult?.pair ? {
    ...scout.selectedPair,
    reason: scout.selectedPair?.pairCheck?.reason || "scout-pair-gate-passed",
    scoutPairCheck: scout.selectedPair?.pairCheck || null,
    a: finalResult.pair.a,
    b: finalResult.pair.b
  } : null;

  return {
    ...finalResult,
    dryRun: true,
    readOnly: true,
    writesPerformed: 0,
    pair: finalPair,
    scoutModel: MODEL_ROUTES.discovery,
    scoutPipeline: summarizeScout(scout),
    usage: {
      scout: scout.usage?.total || emptyUsage(),
      scoutDiscovery: scout.usage?.discovery || emptyUsage(),
      scoutEvaluation: scout.usage?.evaluation || emptyUsage(),
      generation: generationUsage,
      judge: judgeUsage,
      total: combinedUsage
    }
  };
});

module.exports = { betweenThoughtsPreviewPipelineV2 };

"use strict";

/**
 * Isolated Firestore lifecycle test for Blooming v2.
 *
 * This callable intentionally does NOT touch the production
 * users/{uid}/aiArtifacts/blooming-v2 document and does not call OpenAI.
 * It exercises the transaction semantics on a disposable test document and
 * deletes that document before returning.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("node:crypto");
const { AI_V2_VERSION, QUESTION_GATE_VERSION } = require("./ai-v2-core");
const { __test: bloomHelpers } = require("./blooming-v2");

if (!getApps().length) initializeApp();
const db = getFirestore();

const TEST_DOC = "blooming-v2-lifecycle-test";
const READY_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CLAIM_TTL_MS = 10 * 60 * 1000;
const NEXT_PREPARE_MS = 48 * 60 * 60 * 1000;

function iso(ms = Date.now()) { return new Date(ms).toISOString(); }
function randomId() { return crypto.randomUUID(); }
function requireUid(request) {
  const uid = String(request?.auth?.uid || "").trim();
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  return uid;
}
function testRef(uid) {
  return db.collection("users").doc(uid).collection("aiArtifacts").doc(TEST_DOC);
}
function publicReady(ready) {
  if (!ready) return null;
  return {
    id: ready.id || "",
    sourceFragmentId: ready.sourceFragmentId || "",
    question: ready.question || "",
    preparedAt: ready.preparedAt || "",
    expiresAt: ready.expiresAt || "",
    hasClaimToken: !!ready.claimToken,
    claimExpiresAt: ready.claimExpiresAt || ""
  };
}

const bloomingInterviewLifecycleTestV2 = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "128MiB",
  maxInstances: 3
}, async (request) => {
  const uid = requireUid(request);
  const ref = testRef(uid);
  const startedAt = Date.now();
  let response = null;
  let cleanup = "not-run";

  // Remove any residue from an interrupted earlier run before starting.
  await ref.delete().catch(() => {});

  try {
    const artifactId = randomId();
    const ready = {
      id: artifactId,
      sourceFragmentId: "lifecycle-test-source",
      sourceDate: "",
      sourceHash: "lifecycle-test-hash",
      question: "Blooming V2 라이프사이클 테스트 질문",
      questionMode: "test",
      scores: {
        grounded: 5,
        novel: 5,
        specific: 5,
        clear: 5,
        naturalKorean: 5,
        insightPotential: 5,
        addsValue: 5,
        nonLeading: 5,
        relevantNow: 5
      },
      evidence: { primary: "lifecycle-test" },
      model: "lifecycle-test",
      reasoningEffort: "none",
      scoutModel: "lifecycle-test",
      scoutConfidence: 100,
      growthEdge: "",
      preparedAt: iso(startedAt),
      expiresAt: iso(startedAt + READY_TTL_MS),
      claimToken: "",
      claimExpiresAt: ""
    };

    // PREPARE: create the same ready-state shape used by production, but on the
    // isolated test document. AI generation itself is covered by preview tests.
    await ref.set({
      schemaVersion: 1,
      ready,
      shownHistory: [],
      lastShownAt: "",
      nextPrepareAfter: "",
      updatedAtServer: FieldValue.serverTimestamp()
    });
    const preparedSnap = await ref.get();
    const preparedState = preparedSnap.data() || {};
    const preparePassed = !!preparedState.ready
      && preparedState.ready.id === artifactId
      && !bloomHelpers.readyExpired(preparedState.ready, startedAt)
      && !bloomHelpers.activeClaim(preparedState.ready, startedAt);

    // CLAIM: first claimant receives a token.
    const claim = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const state = snap.data() || {};
      const current = state.ready || null;
      if (bloomHelpers.readyExpired(current) || current.id !== artifactId) return { status: "missing" };
      if (bloomHelpers.activeClaim(current)) return { status: "busy" };
      const claimToken = randomId();
      const claimed = { ...current, claimToken, claimExpiresAt: iso(Date.now() + CLAIM_TTL_MS) };
      tx.set(ref, { ready: claimed, updatedAtServer: FieldValue.serverTimestamp() }, { merge: true });
      return { status: "claimed", claimToken, ready: claimed };
    });

    // A second claimant must be rejected while the claim is active.
    const secondClaim = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const state = snap.data() || {};
      const current = state.ready || null;
      if (bloomHelpers.readyExpired(current) || current.id !== artifactId) return { status: "missing" };
      if (bloomHelpers.activeClaim(current)) return { status: "busy" };
      return { status: "unexpected-open" };
    });

    // Wrong token must not mark the artifact as shown.
    const wrongToken = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const state = snap.data() || {};
      const current = state.ready || null;
      if (!current || current.id !== artifactId || current.claimToken !== "definitely-wrong-token") {
        return { status: "missing" };
      }
      return { status: "unexpected-match" };
    });

    // SHOWN: valid claim consumes ready and appends history/cooldown.
    const shownAt = Date.now();
    const shown = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const state = snap.data() || {};
      const current = state.ready || null;
      if (!current || current.id !== artifactId || current.claimToken !== claim.claimToken) return { status: "missing" };
      const history = bloomHelpers.normalizeHistory(state.shownHistory);
      history.unshift({
        artifactId: current.id,
        sourceFragmentId: current.sourceFragmentId,
        sourceDate: current.sourceDate || "",
        shownAt: iso(shownAt),
        model: current.model || ""
      });
      tx.set(ref, {
        ready: null,
        shownHistory: history.slice(0, 40),
        lastShownAt: iso(shownAt),
        nextPrepareAfter: iso(shownAt + NEXT_PREPARE_MS),
        updatedAtServer: FieldValue.serverTimestamp()
      }, { merge: true });
      return { status: "shown" };
    });

    const finalSnap = await ref.get();
    const finalState = finalSnap.data() || {};
    const finalHistory = bloomHelpers.normalizeHistory(finalState.shownHistory);

    const checks = {
      prepareReady: preparePassed,
      firstClaimSucceeds: claim.status === "claimed" && !!claim.claimToken,
      secondClaimBlocked: secondClaim.status === "busy",
      wrongTokenBlocked: wrongToken.status === "missing",
      markShownSucceeds: shown.status === "shown",
      readyConsumed: finalState.ready == null,
      historyRecorded: finalHistory.length === 1 && finalHistory[0].artifactId === artifactId,
      cooldownRecorded: Date.parse(String(finalState.nextPrepareAfter || "")) > shownAt
    };

    response = {
      ok: true,
      dryRun: true,
      isolatedFirestoreWrite: true,
      version: AI_V2_VERSION,
      questionGateVersion: QUESTION_GATE_VERSION,
      testDocument: `users/{uid}/aiArtifacts/${TEST_DOC}`,
      allPassed: Object.values(checks).every(Boolean),
      checks,
      stages: {
        prepare: { status: preparePassed ? "ready" : "failed", ready: publicReady(preparedState.ready) },
        claim: { status: claim.status, ready: publicReady(claim.ready) },
        secondClaim: { status: secondClaim.status },
        wrongToken: { status: wrongToken.status },
        shown: { status: shown.status },
        final: {
          readyIsNull: finalState.ready == null,
          historyCount: finalHistory.length,
          lastShownAt: finalState.lastShownAt || "",
          nextPrepareAfter: finalState.nextPrepareAfter || ""
        }
      },
      note: "AI 호출 없이 상태 전이만 검사하며 production blooming-v2 문서는 건드리지 않습니다."
    };
  } finally {
    try {
      await ref.delete();
      const cleanupSnap = await ref.get();
      cleanup = cleanupSnap.exists ? "delete-failed" : "deleted";
    } catch (_) {
      cleanup = "delete-failed";
    }
  }

  return { ...response, cleanup, allPassed: !!response?.allPassed && cleanup === "deleted" };
});

module.exports = { bloomingInterviewLifecycleTestV2 };

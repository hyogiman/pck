"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("node:crypto");
const {
  AI_V2_VERSION,
  QUESTION_GATE_VERSION,
  MODEL_ROUTES,
  questionGenerationPrinciples,
  questionResultSchema,
  selectBestQuestion,
  cleanText
} = require("./ai-v2-core");

if (!getApps().length) initializeApp();
const db = getFirestore();

const ARTIFACT_DOC = "blooming-v2";
const ARTIFACT_SCHEMA_VERSION = 1;
const MIN_SOURCE_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_SOURCE_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const READY_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CLAIM_TTL_MS = 10 * 60 * 1000;
const PREPARE_LOCK_MS = 3 * 60 * 1000;
const NO_RESULT_RETRY_MS = 6 * 60 * 60 * 1000;
const ERROR_RETRY_MS = 60 * 60 * 1000;
const MAX_SHOWN_PER_7_DAYS = 3;
const RECENT_SOURCE_BLOCK_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FRAGMENT_SCAN = 180;
const MAX_SCOUT_CANDIDATES = 12;

function iso(ms = Date.now()) { return new Date(ms).toISOString(); }
function ms(value) {
  const n = Date.parse(String(value || ""));
  return Number.isFinite(n) ? n : 0;
}
function randomHours(min, max) { return min + Math.random() * (max - min); }
function randomId() { return crypto.randomUUID(); }
function sha256(value) { return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex"); }
function requireUid(request) {
  const uid = String(request?.auth?.uid || "").trim();
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  return uid;
}
function safeId(raw, label = "문서") {
  const value = String(raw || "").trim();
  if (!value || value.length > 220 || value.includes("/")) throw new HttpsError("invalid-argument", `${label} ID가 올바르지 않습니다.`);
  return value;
}
function artifactRef(uid) {
  return db.collection("users").doc(uid).collection("aiArtifacts").doc(ARTIFACT_DOC);
}
function fragmentRef(uid, fragmentId) {
  return db.collection("users").doc(uid).collection("fragments").doc(fragmentId);
}
function fragmentText(fragment) {
  return cleanText(fragment?.thought || fragment?.text, 14000);
}
function fragmentDateMs(fragment) {
  return ms(fragment?.createdAt) || ms(fragment?.date ? `${fragment.date}T12:00:00` : "") || ms(fragment?.updatedAt);
}
function activeClaim(ready, now = Date.now()) {
  return !!(ready?.claimToken && ms(ready?.claimExpiresAt) > now);
}
function readyExpired(ready, now = Date.now()) {
  return !ready || !ready.id || ms(ready.expiresAt) <= now;
}
function normalizeHistory(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((x) => x && typeof x === "object" && ms(x.shownAt))
    .sort((a, b) => ms(b.shownAt) - ms(a.shownAt))
    .slice(0, 40);
}
function recentShown(history, now = Date.now()) {
  return normalizeHistory(history).filter((x) => now - ms(x.shownAt) <= 7 * 24 * 60 * 60 * 1000);
}
function sourceBlocked(history, fragmentId, now = Date.now()) {
  return normalizeHistory(history).some((x) => x.sourceFragmentId === fragmentId && now - ms(x.shownAt) <= RECENT_SOURCE_BLOCK_MS);
}

function compactIndex(index) {
  if (!index || typeof index !== "object") return null;
  const x = {
    literal: index.literal || null,
    authorPerspective: index.authorPerspective || index.author_perspective || null,
    innerDynamics: index.innerDynamics || index.inner_dynamics || null,
    alternateReadings: index.alternateReadings || index.alternate_readings || null,
    uncertainty: index.uncertainty || null,
    sourceContext: index.sourceContext || index.source_context || null,
    growthEdges: index.growthEdges || index.growth_edges || null
  };
  const raw = JSON.stringify(x);
  if (raw.length <= 6500) return x;
  return {
    literal: x.literal,
    innerDynamics: x.innerDynamics,
    growthEdges: x.growthEdges,
    uncertainty: x.uncertainty
  };
}

function signalCount(fragment) {
  const idx = fragment?.aiIndex || {};
  const inner = idx.innerDynamics || idx.inner_dynamics || {};
  const author = idx.authorPerspective || idx.author_perspective || {};
  const alt = idx.alternateReadings || idx.alternate_readings || [];
  const growth = idx.growthEdges || idx.growth_edges || [];
  const arrays = [inner.openLoops || inner.open_loops, inner.tensions, inner.shifts, author.valuesOrNeeds || author.values_or_needs, alt, growth];
  return arrays.reduce((sum, arr) => sum + (Array.isArray(arr) ? Math.min(arr.length, 3) : 0), 0);
}

function candidateScore(fragment, now = Date.now()) {
  const created = fragmentDateMs(fragment);
  const ageDays = created ? (now - created) / 86400000 : 0;
  const text = fragmentText(fragment);
  let score = 0;
  score += Math.min(6, signalCount(fragment)) * 2;
  score += Math.min(5, text.length / 180);
  if (ageDays >= 1 && ageDays <= 45) score += 4;
  else if (ageDays <= 120) score += 3;
  else score += 1;
  if (fragment.starred) score += 2;
  if (fragment.externalText) score += 0.5;
  return score;
}

function eligibleFragment(fragment, history, now = Date.now()) {
  const text = fragmentText(fragment);
  if (text.length < 18) return false;
  if (fragment?.deletedAt || fragment?.deleted_at) return false;
  if (fragment?.bloomingInterviewQuestion || fragment?.bloomingInterviewSourceId) return false;
  const created = fragmentDateMs(fragment);
  if (!created) return false;
  const age = now - created;
  if (age < MIN_SOURCE_AGE_MS || age > MAX_SOURCE_AGE_MS) return false;
  if (sourceBlocked(history, fragment.id, now)) return false;
  return true;
}

function extractResponseText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type !== "message") continue;
    for (const part of Array.isArray(item.content) ? item.content : []) {
      if (part?.type === "output_text" && typeof part.text === "string" && part.text.trim()) return part.text.trim();
    }
  }
  return "";
}
function normalizeUsage(response) {
  const usage = response?.usage || {};
  return {
    inputTokens: Number(usage.input_tokens || 0),
    cachedInputTokens: Number(usage.input_tokens_details?.cached_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    reasoningTokens: Number(usage.output_tokens_details?.reasoning_tokens || 0),
    totalTokens: Number(usage.total_tokens || 0)
  };
}
async function callStructuredOpenAI({ model, reasoningEffort, systemPrompt, userPayload, schema, schemaName, maxOutputTokens = 2200 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpsError("failed-precondition", "AI 연결 설정을 확인해주세요.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) }
      ],
      reasoning: { effort: reasoningEffort },
      text: {
        verbosity: "low",
        format: { type: "json_schema", name: schemaName, strict: true, schema }
      },
      max_output_tokens: maxOutputTokens
    })
  });
  const raw = await response.text();
  let data = null;
  try { data = JSON.parse(raw); } catch (_) {}
  if (!response.ok) {
    logger.error("Blooming v2 OpenAI request failed", { status: response.status, model, message: data?.error?.message || raw.slice(0, 500) });
    throw new HttpsError("internal", "Blooming Interview를 준비하지 못했습니다.");
  }
  const text = extractResponseText(data);
  let parsed = null;
  try { if (text) parsed = JSON.parse(text); } catch (error) {
    logger.warn("Blooming v2 structured output parse failed", { model, error: error?.message || String(error) });
  }
  return { parsed, usage: normalizeUsage(data), responseId: data?.id || "" };
}

function scoutSchema() {
  return {
    type: "object",
    properties: {
      decision: { type: "string", enum: ["candidate", "none"] },
      chosenFragmentId: { type: "string" },
      reason: { type: "string" },
      growthEdge: { type: "string" },
      confidence: { type: "integer", minimum: 0, maximum: 100 }
    },
    required: ["decision", "chosenFragmentId", "reason", "growthEdge", "confidence"],
    additionalProperties: false
  };
}
function scoutPrompt() {
  return [
    "당신은 생각의 텃밭 Blooming Interview의 조용한 후보 선별자다.",
    "목표는 가장 감정적인 글이나 가장 긴 글을 고르는 것이 아니라, 시간이 조금 지난 지금 다시 물었을 때 새로운 생각이 자랄 가능성이 높은 기록 하나를 고르는 것이다.",
    "각 후보에는 원문 일부와 다층 aiIndex가 있다. aiIndex는 참고 가설이며 원문보다 우선하지 않는다.",
    "좋은 후보: 아직 닫히지 않은 질문, 선택/욕구/긴장, 관점의 변화, 구체화되지 않은 중요한 의미, 과거의 결론을 지금 다시 바라볼 여지가 실제 원문에 있는 글.",
    "나쁜 후보: 단순 사실 기록, 이미 이유와 결론이 충분히 닫힌 글, AI가 심리 추정을 많이 해야만 질문이 생기는 글, 자극적이기만 한 글.",
    "질문을 억지로 만들 필요가 없다. 후보가 약하면 none을 선택한다.",
    "growthEdge는 원문에서 아직 쓰이지 않은 탐색 방향을 짧고 구체적으로 적는다. 심리 진단을 하지 않는다.",
    "confidence 80 미만이면 원칙적으로 none을 선택한다."
  ].join("\n");
}
function finalPrompt() {
  return [
    "당신은 생각의 텃밭 Blooming Interview의 질문자다.",
    "이 질문은 사용자가 방금 쓴 글에 즉시 붙는 것이 아니다. 예전에 남겨둔 생각을 텃밭이 기억했다가 다시 꺼내어 대화를 이어가는 순간이다.",
    ...questionGenerationPrinciples("blooming"),
    "원문과 선별된 growthEdge를 읽되, growthEdge 역시 참고 가설일 뿐이다.",
    "사용자가 원문을 다시 읽었을 때 왜 이 질문이 나왔는지 자연스럽게 이해할 수 있어야 한다.",
    "과거 기록을 다시 꺼낸 보람이 있어야 한다. 당시 글을 요약시키거나 '왜 그렇게 생각했나요'처럼 되묻는 질문은 피한다.",
    "후보 질문을 최대 3개 만들고 서로 다른 탐색 방향을 시도한다.",
    "질문이 충분히 좋지 않으면 silent가 정답이다. 화면을 채우기 위해 질문하지 않는다."
  ].join("\n");
}

async function readExistingReady(uid, ready) {
  if (readyExpired(ready)) return null;
  const snap = await fragmentRef(uid, ready.sourceFragmentId).get();
  if (!snap.exists) return null;
  const fragment = { id: snap.id, ...(snap.data() || {}) };
  if (sha256(fragmentText(fragment)) !== ready.sourceHash) return null;
  return ready;
}

async function beginPreparation(uid) {
  const ref = artifactRef(uid);
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const state = snap.exists ? (snap.data() || {}) : {};
    const history = normalizeHistory(state.shownHistory);
    const ready = state.ready || null;
    if (!readyExpired(ready, now)) {
      if (activeClaim(ready, now)) return { action: "claimed", ready, history };
      return { action: "ready", ready, history };
    }
    const recent = recentShown(history, now);
    if (recent.length >= MAX_SHOWN_PER_7_DAYS) {
      const oldest = recent[recent.length - 1];
      return { action: "waiting", nextAt: iso(ms(oldest.shownAt) + 7 * 24 * 60 * 60 * 1000), history };
    }
    if (ms(state.nextPrepareAfter) > now) return { action: "waiting", nextAt: state.nextPrepareAfter, history };
    if (ms(state.prepareLockUntil) > now) return { action: "preparing", nextAt: state.prepareLockUntil, history };
    const token = randomId();
    tx.set(ref, {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      prepareLockToken: token,
      prepareLockUntil: iso(now + PREPARE_LOCK_MS),
      updatedAtServer: FieldValue.serverTimestamp()
    }, { merge: true });
    return { action: "prepare", token, history };
  });
}

async function finishNoResult(uid, token, reason, retryMs = NO_RESULT_RETRY_MS) {
  const ref = artifactRef(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const state = snap.exists ? (snap.data() || {}) : {};
    if (state.prepareLockToken !== token) return;
    tx.set(ref, {
      prepareLockToken: "",
      prepareLockUntil: "",
      nextPrepareAfter: iso(Date.now() + retryMs),
      lastPrepareResult: reason,
      updatedAtServer: FieldValue.serverTimestamp()
    }, { merge: true });
  });
}

async function saveReady(uid, token, ready) {
  const ref = artifactRef(uid);
  let saved = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const state = snap.exists ? (snap.data() || {}) : {};
    if (state.prepareLockToken !== token) return;
    tx.set(ref, {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      ready,
      prepareLockToken: "",
      prepareLockUntil: "",
      nextPrepareAfter: "",
      lastPrepareResult: "ready",
      updatedAtServer: FieldValue.serverTimestamp()
    }, { merge: true });
    saved = true;
  });
  return saved;
}

async function scanCandidates(uid, history) {
  const snap = await db.collection("users").doc(uid).collection("fragments")
    .orderBy("date", "desc").limit(MAX_FRAGMENT_SCAN).get();
  const now = Date.now();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((f) => eligibleFragment(f, history, now))
    .sort((a, b) => candidateScore(b, now) - candidateScore(a, now))
    .slice(0, MAX_SCOUT_CANDIDATES);
}

function scoutPayload(candidates) {
  return candidates.map((f) => ({
    id: f.id,
    date: cleanText(f.date, 20),
    thought: fragmentText(f).slice(0, 1600),
    context: cleanText(f.context, 500) || null,
    externalText: cleanText(f.externalText, 600) || null,
    starred: !!f.starred,
    aiIndex: compactIndex(f.aiIndex)
  }));
}

async function prepareNewQuestion(uid, token, history) {
  const candidates = await scanCandidates(uid, history);
  if (!candidates.length) {
    await finishNoResult(uid, token, "no-eligible-fragment");
    return { status: "none", reason: "no-eligible-fragment" };
  }

  const scout = await callStructuredOpenAI({
    model: MODEL_ROUTES.discovery,
    reasoningEffort: "low",
    systemPrompt: scoutPrompt(),
    userPayload: { mode: "blooming-v2-scout", candidates: scoutPayload(candidates) },
    schema: scoutSchema(),
    schemaName: "thought_garden_blooming_v2_scout",
    maxOutputTokens: 900
  });
  const pick = scout.parsed;
  if (!pick || pick.decision !== "candidate" || Number(pick.confidence || 0) < 80) {
    await finishNoResult(uid, token, "scout-found-no-strong-candidate");
    return { status: "none", reason: "scout-found-no-strong-candidate", scoutUsage: scout.usage };
  }
  const chosen = candidates.find((f) => f.id === String(pick.chosenFragmentId || ""));
  if (!chosen) {
    await finishNoResult(uid, token, "scout-returned-unknown-fragment");
    return { status: "none", reason: "scout-returned-unknown-fragment", scoutUsage: scout.usage };
  }

  const thought = fragmentText(chosen);
  const final = await callStructuredOpenAI({
    model: MODEL_ROUTES.speaking,
    reasoningEffort: MODEL_ROUTES.speakingReasoningEffort,
    systemPrompt: finalPrompt(),
    userPayload: {
      mode: "blooming-v2-final",
      thought,
      date: chosen.date || null,
      context: cleanText(chosen.context, 1400) || null,
      externalText: cleanText(chosen.externalText, 1800) || null,
      aiIndexReference: compactIndex(chosen.aiIndex),
      selectedGrowthEdge: cleanText(pick.growthEdge, 1000),
      scoutReason: cleanText(pick.reason, 1000)
    },
    schema: questionResultSchema("blooming"),
    schemaName: "thought_garden_blooming_v2_final",
    maxOutputTokens: 2400
  });
  const selected = selectBestQuestion(final.parsed, { mode: "blooming", sources: { primary: thought } });
  if (selected.decision !== "speak") {
    await finishNoResult(uid, token, "question-gate-rejected-all", 4 * 60 * 60 * 1000);
    return {
      status: "none",
      reason: "question-gate-rejected-all",
      rejected: selected.rejected || [],
      scoutUsage: scout.usage,
      finalUsage: final.usage
    };
  }

  const now = Date.now();
  const ready = {
    id: randomId(),
    sourceFragmentId: chosen.id,
    sourceDate: cleanText(chosen.date, 20),
    sourceHash: sha256(thought),
    question: selected.question,
    questionMode: selected.mode || "",
    scores: selected.scores,
    evidence: selected.evidence,
    model: MODEL_ROUTES.speaking,
    reasoningEffort: MODEL_ROUTES.speakingReasoningEffort,
    scoutModel: MODEL_ROUTES.discovery,
    scoutConfidence: Number(pick.confidence || 0),
    growthEdge: cleanText(pick.growthEdge, 1000),
    preparedAt: iso(now),
    expiresAt: iso(now + READY_TTL_MS),
    claimToken: "",
    claimExpiresAt: ""
  };
  const saved = await saveReady(uid, token, ready);
  if (!saved) return { status: "superseded", reason: "prepare-lock-changed" };
  return { status: "ready", ready, scoutUsage: scout.usage, finalUsage: final.usage };
}

const bloomingInterviewPrepareV2 = onCall({
  region: "us-central1",
  secrets: ["OPENAI_API_KEY"],
  timeoutSeconds: 90,
  memory: "256MiB",
  maxInstances: 5
}, async (request) => {
  const uid = requireUid(request);
  const gate = await beginPreparation(uid);

  if (gate.action === "ready") {
    const valid = await readExistingReady(uid, gate.ready);
    if (valid) return { ok: true, version: AI_V2_VERSION, status: "ready", ready: valid };
    await artifactRef(uid).set({ ready: null, nextPrepareAfter: "", updatedAtServer: FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true, version: AI_V2_VERSION, status: "stale-cleared" };
  }
  if (gate.action === "claimed") return { ok: true, version: AI_V2_VERSION, status: "claimed", claimExpiresAt: gate.ready?.claimExpiresAt || "" };
  if (gate.action === "waiting" || gate.action === "preparing") return { ok: true, version: AI_V2_VERSION, status: gate.action, nextAt: gate.nextAt || "" };

  try {
    const result = await prepareNewQuestion(uid, gate.token, gate.history);
    return { ok: true, version: AI_V2_VERSION, questionGateVersion: QUESTION_GATE_VERSION, ...result };
  } catch (error) {
    logger.error("Blooming v2 preparation failed", error);
    await finishNoResult(uid, gate.token, "prepare-error", ERROR_RETRY_MS).catch(() => {});
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Blooming Interview를 준비하지 못했습니다.");
  }
});

const bloomingInterviewClaimV2 = onCall({ region: "us-central1", timeoutSeconds: 15, memory: "256MiB" }, async (request) => {
  const uid = requireUid(request);
  const artifactId = safeId(request.data?.artifactId, "Blooming");
  const ref = artifactRef(uid);
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const state = snap.exists ? (snap.data() || {}) : {};
    const ready = state.ready || null;
    if (readyExpired(ready, now) || ready.id !== artifactId) return { ok: true, status: "missing" };
    if (activeClaim(ready, now)) return { ok: true, status: "busy", claimExpiresAt: ready.claimExpiresAt || "" };
    const claimToken = randomId();
    const claimed = { ...ready, claimToken, claimExpiresAt: iso(now + CLAIM_TTL_MS) };
    tx.set(ref, { ready: claimed, updatedAtServer: FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true, status: "claimed", claimToken, ready: claimed };
  });
});

const bloomingInterviewMarkShownV2 = onCall({ region: "us-central1", timeoutSeconds: 15, memory: "256MiB" }, async (request) => {
  const uid = requireUid(request);
  const artifactId = safeId(request.data?.artifactId, "Blooming");
  const claimToken = safeId(request.data?.claimToken, "예약");
  const ref = artifactRef(uid);
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const state = snap.exists ? (snap.data() || {}) : {};
    const ready = state.ready || null;
    if (!ready || ready.id !== artifactId || ready.claimToken !== claimToken) return { ok: true, status: "missing" };
    const history = normalizeHistory(state.shownHistory);
    history.unshift({
      artifactId: ready.id,
      sourceFragmentId: ready.sourceFragmentId,
      sourceDate: ready.sourceDate || "",
      shownAt: iso(now),
      model: ready.model || ""
    });
    tx.set(ref, {
      ready: null,
      shownHistory: history.slice(0, 40),
      lastShownAt: iso(now),
      nextPrepareAfter: iso(now + randomHours(36, 60) * 60 * 60 * 1000),
      updatedAtServer: FieldValue.serverTimestamp()
    }, { merge: true });
    return { ok: true, status: "shown" };
  });
});

module.exports = {
  bloomingInterviewPrepareV2,
  bloomingInterviewClaimV2,
  bloomingInterviewMarkShownV2,
  __test: {
    eligibleFragment,
    candidateScore,
    signalCount,
    normalizeHistory,
    recentShown,
    sourceBlocked,
    readyExpired,
    activeClaim
  }
};
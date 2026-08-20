"use strict";

/**
 * Read-only Blooming v2 quality preview.
 *
 * This file exists only so we can inspect the complete Blooming pipeline before
 * production rollout. It reads the user's own Fragments and AI history, calls
 * the same model classes / Question Gate, and returns the result to the signed-in
 * user. It does NOT write a ready artifact, claim a popup, or update cooldowns.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const {
  AI_V2_VERSION,
  QUESTION_GATE_VERSION,
  MODEL_ROUTES,
  questionGenerationPrinciples,
  questionResultSchema,
  selectBestQuestion,
  cleanText
} = require("./ai-v2-core");
const { __test: bloomHelpers } = require("./blooming-v2");

if (!getApps().length) initializeApp();
const db = getFirestore();

const MAX_FRAGMENT_SCAN = 180;
const MAX_SCOUT_CANDIDATES = 12;

function requireUid(request) {
  const uid = String(request?.auth?.uid || "").trim();
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  return uid;
}

function fragmentText(fragment) {
  return cleanText(fragment?.thought || fragment?.text, 14000);
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

async function callStructuredOpenAI({ model, reasoningEffort, systemPrompt, userPayload, schema, schemaName, maxOutputTokens }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpsError("failed-precondition", "AI 연결 설정을 확인해주세요.");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
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
    logger.error("Blooming v2 preview OpenAI request failed", {
      status: response.status,
      model,
      message: data?.error?.message || raw.slice(0, 500)
    });
    throw new HttpsError("internal", "Blooming V2 테스트를 실행하지 못했습니다.");
  }

  const outputText = extractResponseText(data);
  let parsed = null;
  try { if (outputText) parsed = JSON.parse(outputText); } catch (error) {
    logger.warn("Blooming v2 preview parse failed", { model, error: error?.message || String(error) });
  }
  return { parsed, usage: normalizeUsage(data) };
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
    "가장 감정적인 글이나 가장 긴 글이 아니라, 시간이 지난 지금 다시 물었을 때 새로운 생각이 자랄 가능성이 높은 기록 하나를 고른다.",
    "aiIndex는 참고 가설이며 원문보다 우선하지 않는다.",
    "좋은 후보는 아직 닫히지 않은 질문, 선택/욕구/긴장, 관점 변화, 구체화되지 않은 중요한 의미, 당시 결론을 지금 다시 볼 여지가 원문에 있는 글이다.",
    "단순 사실 기록, 이유와 결론이 충분히 닫힌 글, 심리 추정을 많이 해야만 질문이 생기는 글은 고르지 않는다.",
    "후보가 약하면 none을 선택한다. confidence 80 미만이면 원칙적으로 none이다.",
    "growthEdge는 원문에서 아직 쓰이지 않은 탐색 방향을 짧고 구체적으로 적고 심리 진단을 하지 않는다."
  ].join("\n");
}

function finalPrompt() {
  return [
    "당신은 생각의 텃밭 Blooming Interview의 질문자다.",
    "예전에 남겨둔 생각을 텃밭이 기억했다가 다시 꺼내 대화를 이어가는 순간이다.",
    ...questionGenerationPrinciples("blooming"),
    "원문과 growthEdge를 읽되 growthEdge 역시 참고 가설일 뿐이다.",
    "context, externalText, aiIndexReference, selectedGrowthEdge, scoutReason은 탐색 방향을 정하는 참고자료일 뿐이며 질문의 직접 근거를 대신할 수 없다.",
    "각 후보의 evidence.primary에는 반드시 user payload의 thought 필드에 실제로 존재하는 연속된 원문 구절을 짧게 그대로 복사한다. context, aiIndex, growthEdge, scoutReason의 문장이나 그것을 요약·의역한 문장을 evidence로 쓰면 안 된다.",
    "사용자가 원문을 다시 읽었을 때 왜 이 질문이 나왔는지 자연스럽게 이해할 수 있어야 한다.",
    "과거 기록을 다시 꺼낸 보람이 있어야 한다. 요약시키거나 단순히 '왜 그렇게 생각했나요'라고 되묻지 않는다.",
    "최대 3개의 서로 다른 질문 후보를 만들고, 충분히 좋은 질문이 없으면 silent를 선택한다."
  ].join("\n");
}

async function loadHistory(uid) {
  const snap = await db.collection("users").doc(uid).collection("aiArtifacts").doc("blooming-v2").get();
  return bloomHelpers.normalizeHistory(snap.exists ? snap.data()?.shownHistory : []);
}

async function scanCandidates(uid, history) {
  const snap = await db.collection("users").doc(uid).collection("fragments")
    .orderBy("date", "desc").limit(MAX_FRAGMENT_SCAN).get();
  const now = Date.now();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((fragment) => bloomHelpers.eligibleFragment(fragment, history, now))
    .sort((a, b) => bloomHelpers.candidateScore(b, now) - bloomHelpers.candidateScore(a, now))
    .slice(0, MAX_SCOUT_CANDIDATES);
}

function candidatePayload(fragment) {
  return {
    id: fragment.id,
    date: cleanText(fragment.date, 20),
    thought: fragmentText(fragment).slice(0, 1600),
    context: cleanText(fragment.context, 500) || null,
    externalText: cleanText(fragment.externalText, 600) || null,
    starred: !!fragment.starred,
    aiIndex: compactIndex(fragment.aiIndex)
  };
}

function finalDiagnostics(parsed) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  return {
    modelDecision: cleanText(source.decision, 80),
    modelReason: cleanText(source.reason, 1000),
    reopenValue: cleanText(source.reopenValue, 80),
    reopenReason: cleanText(source.reopenReason, 1000),
    observation: cleanText(source.observation, 1400),
    candidates: (Array.isArray(source.candidates) ? source.candidates : []).slice(0, 3).map((candidate, index) => ({
      index,
      mode: cleanText(candidate?.mode, 100),
      question: cleanText(candidate?.question, 500),
      scores: candidate?.scores || null,
      evidence: candidate?.evidence || null
    }))
  };
}

const bloomingInterviewAutoPreviewV2 = onCall({
  region: "us-central1",
  secrets: ["OPENAI_API_KEY"],
  timeoutSeconds: 90,
  memory: "256MiB",
  maxInstances: 3
}, async (request) => {
  const uid = requireUid(request);
  const history = await loadHistory(uid);
  const candidates = await scanCandidates(uid, history);
  const candidateSummary = candidates.map((f) => ({
    id: f.id,
    date: cleanText(f.date, 20),
    excerpt: fragmentText(f).slice(0, 180),
    heuristicScore: Math.round(bloomHelpers.candidateScore(f, Date.now()) * 10) / 10
  }));

  if (!candidates.length) {
    return {
      ok: true,
      dryRun: true,
      version: AI_V2_VERSION,
      status: "none",
      reason: "no-eligible-fragment",
      candidates: []
    };
  }

  const scout = await callStructuredOpenAI({
    model: MODEL_ROUTES.discovery,
    reasoningEffort: "low",
    systemPrompt: scoutPrompt(),
    userPayload: { mode: "blooming-v2-auto-preview-scout", candidates: candidates.map(candidatePayload) },
    schema: scoutSchema(),
    schemaName: "thought_garden_blooming_v2_auto_preview_scout",
    maxOutputTokens: 900
  });

  const pick = scout.parsed;
  if (!pick || pick.decision !== "candidate" || Number(pick.confidence || 0) < 80) {
    return {
      ok: true,
      dryRun: true,
      version: AI_V2_VERSION,
      status: "none",
      reason: "scout-found-no-strong-candidate",
      scout: pick || null,
      candidates: candidateSummary,
      scoutUsage: scout.usage
    };
  }

  const chosen = candidates.find((f) => f.id === String(pick.chosenFragmentId || ""));
  if (!chosen) {
    return {
      ok: true,
      dryRun: true,
      version: AI_V2_VERSION,
      status: "none",
      reason: "scout-returned-unknown-fragment",
      scout: pick,
      candidates: candidateSummary,
      scoutUsage: scout.usage
    };
  }

  const thought = fragmentText(chosen);
  const final = await callStructuredOpenAI({
    model: MODEL_ROUTES.speaking,
    reasoningEffort: MODEL_ROUTES.speakingReasoningEffort,
    systemPrompt: finalPrompt(),
    userPayload: {
      mode: "blooming-v2-auto-preview-final",
      thought,
      date: chosen.date || null,
      context: cleanText(chosen.context, 1400) || null,
      externalText: cleanText(chosen.externalText, 1800) || null,
      aiIndexReference: compactIndex(chosen.aiIndex),
      selectedGrowthEdge: cleanText(pick.growthEdge, 1000),
      scoutReason: cleanText(pick.reason, 1000)
    },
    schema: questionResultSchema("blooming"),
    schemaName: "thought_garden_blooming_v2_auto_preview_final",
    maxOutputTokens: 2400
  });

  const selected = selectBestQuestion(final.parsed, {
    mode: "blooming",
    sources: { primary: thought }
  });

  return {
    ok: true,
    dryRun: true,
    version: AI_V2_VERSION,
    questionGateVersion: QUESTION_GATE_VERSION,
    status: selected.decision === "speak" ? "speak" : "silent",
    reason: selected.reason || "",
    selectedFragment: {
      id: chosen.id,
      date: cleanText(chosen.date, 20),
      thought,
      context: cleanText(chosen.context, 1400),
      starred: !!chosen.starred
    },
    scout: {
      reason: cleanText(pick.reason, 1000),
      growthEdge: cleanText(pick.growthEdge, 1000),
      confidence: Number(pick.confidence || 0),
      model: MODEL_ROUTES.discovery
    },
    question: selected.question || null,
    mode: selected.mode || "",
    scores: selected.scores || null,
    evidence: selected.evidence || null,
    rejected: selected.rejected || [],
    diagnostics: finalDiagnostics(final.parsed),
    model: MODEL_ROUTES.speaking,
    reasoningEffort: MODEL_ROUTES.speakingReasoningEffort,
    candidates: candidateSummary,
    scoutUsage: scout.usage,
    finalUsage: final.usage
  };
});

module.exports = { bloomingInterviewAutoPreviewV2 };

"use strict";

// Keep every existing Cloud Function export intact, then add isolated AI v2
// preview endpoints. This lets us test v2 without replacing production paths.
const legacy = require("./index.js");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
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

function safeId(raw, label = "문서") {
  const value = String(raw || "").trim();
  if (!value || value.length > 200 || value.includes("/")) {
    throw new HttpsError("invalid-argument", `${label} ID가 올바르지 않습니다.`);
  }
  return value;
}

function requireUid(request) {
  const uid = String(request?.auth?.uid || "").trim();
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  return uid;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
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

function compactIndexForPrompt(rawIndex) {
  if (!rawIndex || typeof rawIndex !== "object") return null;
  // Existing aiIndex is a useful lens, but it is explicitly treated as a
  // hypothesis. We retain multiple analytical angles while clipping verbosity.
  const index = {
    literal: rawIndex.literal || null,
    authorPerspective: rawIndex.authorPerspective || rawIndex.author_perspective || null,
    innerDynamics: rawIndex.innerDynamics || rawIndex.inner_dynamics || null,
    alternateReadings: rawIndex.alternateReadings || rawIndex.alternate_readings || null,
    uncertainty: rawIndex.uncertainty || null,
    sourceContext: rawIndex.sourceContext || rawIndex.source_context || null,
    visualContext: rawIndex.visualContext || rawIndex.visual_context || null,
    growthEdges: rawIndex.growthEdges || rawIndex.growth_edges || null
  };
  const text = JSON.stringify(index);
  if (text.length <= 9000) return index;
  return { note: "색인이 길어 일부만 참고", literal: index.literal, innerDynamics: index.innerDynamics, growthEdges: index.growthEdges };
}

function previewDiagnostics(parsed) {
  const result = parsed && typeof parsed === "object" ? parsed : {};
  return {
    modelDecision: cleanText(result.decision, 40),
    modelReason: cleanText(result.reason, 700),
    reopenValue: cleanText(result.reopenValue, 80),
    reopenReason: cleanText(result.reopenReason, 700),
    observation: cleanText(result.observation, 1200),
    candidates: (Array.isArray(result.candidates) ? result.candidates : []).slice(0, 3).map((candidate, index) => ({
      index,
      mode: cleanText(candidate?.mode, 80),
      question: cleanText(candidate?.question, 500),
      scores: candidate?.scores && typeof candidate.scores === "object" ? candidate.scores : null,
      evidence: candidate?.evidence && typeof candidate.evidence === "object" ? candidate.evidence : null
    }))
  };
}

async function callStructuredOpenAI({ model, reasoningEffort, systemPrompt, userPayload, schema, schemaName }) {
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
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema
        }
      },
      max_output_tokens: 2600
    })
  });

  const raw = await response.text();
  let data = null;
  try { data = JSON.parse(raw); } catch (_) {}

  if (!response.ok) {
    logger.error("AI v2 OpenAI request failed", {
      status: response.status,
      model,
      message: data?.error?.message || raw.slice(0, 500)
    });
    throw new HttpsError("internal", "AI가 질문을 준비하지 못했습니다.");
  }

  const outputText = extractResponseText(data);
  if (!outputText) {
    logger.warn("AI v2 empty structured output", { model, responseId: data?.id || "" });
    return { parsed: null, usage: normalizeUsage(data), responseId: data?.id || "" };
  }

  let parsed = null;
  try { parsed = JSON.parse(outputText); } catch (error) {
    logger.warn("AI v2 structured output parse failed", { model, responseId: data?.id || "", error: error?.message || String(error) });
  }
  return { parsed, usage: normalizeUsage(data), responseId: data?.id || "" };
}

async function loadFragmentContext(uid, fragmentId) {
  const fragmentRef = db.collection("users").doc(uid).collection("fragments").doc(fragmentId);
  const fragmentSnap = await fragmentRef.get();
  if (!fragmentSnap.exists) throw new HttpsError("not-found", "생각을 찾지 못했습니다.");
  const fragment = fragmentSnap.data() || {};
  if (fragment.deletedAt) throw new HttpsError("failed-precondition", "지운 생각은 인터뷰할 수 없습니다.");

  const thought = cleanText(fragment.thought || fragment.text, 12000);
  if (thought.length < 4) return { fragment, thought, source: null };

  let source = null;
  const sourceId = String(fragment.sourceId || "").trim();
  if (sourceId && !sourceId.includes("/")) {
    const snap = await db.collection("users").doc(uid).collection("sources").doc(sourceId).get();
    if (snap.exists) {
      const raw = snap.data() || {};
      source = {
        title: cleanText(raw.title, 300),
        creator: cleanText(raw.creator, 200),
        type: cleanText(raw.type, 80)
      };
    }
  }
  return { fragment, thought, source };
}

function bloomingV2SystemPrompt() {
  return [
    "당신은 '생각의 텃밭'의 Blooming Interview 인터뷰어다.",
    "당신의 첫 임무는 질문을 만드는 것이 아니라, 지금 사용자를 멈춰 세울 만큼 가치 있는 질문이 실제로 있는지 판단하는 것이다.",
    ...questionGenerationPrinciples("blooming"),
    "사용자의 글이 단순한 기록이거나 이미 충분히 닫혀 있으면 silent를 선택한다.",
    "반대로 글 안에 아직 구체화되지 않은 선택, 모순, 바람, 두려움, 관점의 틈, 다음 단계, 중요한 의미가 있고 그것을 묻는 것이 새로운 자기이해를 만들 가능성이 높다면 speak를 고려한다.",
    "기존 aiIndex는 여러 각도에서 읽은 참고 가설이다. 원문보다 우선하지 말고, 색인의 추론을 사용자 사실로 확정하지 않는다.",
    "candidates에는 서로 다른 각도의 질문을 최대 3개 만든다. 같은 질문을 표현만 바꾸어 반복하지 않는다.",
    "질문은 길게 설명하지 말고 그 자체로 자연스러운 한 문장이어야 한다.",
    "scores는 후하게 주지 말고 실제 품질을 비판적으로 평가한다. 특히 insightPotential은 답했을 때 원문에 없던 생각이 생길 가능성을 뜻한다.",
    "decision='silent'라면 candidates는 빈 배열이어도 된다. 좋은 질문이 없는데 형식을 채우기 위해 질문을 만들지 않는다."
  ].join("\n");
}

/**
 * Preview-only Blooming v2 endpoint.
 * It does not replace the existing Blooming function and does not write any
 * interview decision/question back into the Fragment. This is deliberate so
 * we can compare v1 and v2 safely before rollout.
 */
const bloomingInterviewQuestionV2 = onCall(
  {
    region: "us-central1",
    secrets: ["OPENAI_API_KEY"],
    timeoutSeconds: 75,
    memory: "256MiB",
    maxInstances: 5
  },
  async (request) => {
    const uid = requireUid(request);
    const fragmentId = safeId(request.data?.fragmentId, "생각");
    const { fragment, thought, source } = await loadFragmentContext(uid, fragmentId);

    if (thought.length < 4) {
      return { ok: true, version: AI_V2_VERSION, shouldInterrupt: false, question: null, reason: "not-enough-context" };
    }

    const context = cleanText(fragment.context, 1800);
    const externalText = cleanText(fragment.externalText, 2200);
    const indexHint = compactIndexForPrompt(fragment.aiIndex);
    const sourceHash = sha256([thought, context, externalText, JSON.stringify(indexHint || null)].join("\n---\n"));

    const userPayload = {
      mode: "blooming-interview-v2-preview",
      sourceHash,
      thought,
      context: context || null,
      externalText: externalText || null,
      source,
      aiIndexReference: indexHint,
      instruction: "원문을 다시 읽고, 지금 실제로 질문할 가치가 있는지 먼저 판단하세요. 질문한다면 원문에서 아직 답하지 않은 지점을 여세요."
    };

    const generated = await callStructuredOpenAI({
      model: MODEL_ROUTES.speaking,
      reasoningEffort: MODEL_ROUTES.speakingReasoningEffort,
      systemPrompt: bloomingV2SystemPrompt(),
      userPayload,
      schema: questionResultSchema("blooming"),
      schemaName: "thought_garden_blooming_v2"
    });

    if (!generated.parsed) {
      return {
        ok: true,
        version: AI_V2_VERSION,
        questionGateVersion: QUESTION_GATE_VERSION,
        shouldInterrupt: false,
        question: null,
        reason: "empty-or-invalid-model-output",
        model: MODEL_ROUTES.speaking,
        usage: generated.usage
      };
    }

    const diagnostics = previewDiagnostics(generated.parsed);
    const selected = selectBestQuestion(generated.parsed, {
      mode: "blooming",
      sources: { primary: thought }
    });

    if (selected.decision !== "speak") {
      return {
        ok: true,
        version: AI_V2_VERSION,
        questionGateVersion: QUESTION_GATE_VERSION,
        shouldInterrupt: false,
        question: null,
        reason: selected.reason,
        rejected: selected.rejected || [],
        diagnostics,
        model: MODEL_ROUTES.speaking,
        usage: generated.usage
      };
    }

    return {
      ok: true,
      version: AI_V2_VERSION,
      questionGateVersion: QUESTION_GATE_VERSION,
      shouldInterrupt: true,
      question: selected.question,
      mode: selected.mode,
      scores: selected.scores,
      evidence: selected.evidence,
      diagnostics,
      model: MODEL_ROUTES.speaking,
      reasoningEffort: MODEL_ROUTES.speakingReasoningEffort,
      usage: generated.usage
    };
  }
);

module.exports = {
  ...legacy,
  bloomingInterviewQuestionV2
};

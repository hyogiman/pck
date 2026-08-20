"use strict";

/**
 * Synthetic Blooming v2 model evaluation.
 *
 * This endpoint never reads or writes the user's Thought Garden. It runs a
 * fixed set of fictional records through the same shared Question Gate and the
 * same Blooming product principles so we can catch obvious model/prompt
 * regressions before using real personal records.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const {
  AI_V2_VERSION,
  QUESTION_GATE_VERSION,
  MODEL_ROUTES,
  questionGenerationPrinciples,
  questionResultSchema,
  selectBestQuestion
} = require("./ai-v2-core");
const { casesForMode } = require("./blooming-v2-eval-cases");

function requireNonAnonymousUser(request) {
  const uid = String(request?.auth?.uid || "").trim();
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  const provider = String(request?.auth?.token?.firebase?.sign_in_provider || "");
  if (provider === "anonymous") throw new HttpsError("permission-denied", "정식 로그인 상태에서만 AI v2 평가를 실행할 수 있습니다.");
  return uid;
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

function sumUsage(items) {
  return items.reduce((total, item) => {
    const usage = item?.usage || {};
    for (const key of ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens", "totalTokens"]) {
      total[key] += Number(usage[key] || 0);
    }
    return total;
  }, { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 });
}

function bloomingEvalPrompt() {
  return [
    "당신은 생각의 텃밭 Blooming Interview의 질문자다.",
    "Blooming은 방금 저장한 글에 기계적으로 후속 질문을 붙이는 기능이 아니다. 시간이 지난 생각을 다시 꺼냈을 때 새로운 생각이 자랄 가치가 있을 때만 말한다.",
    ...questionGenerationPrinciples("blooming"),
    "이 평가는 일부러 매우 평범하고 이미 닫힌 기록도 섞어 둔다. 모든 기록에 질문하려고 하면 실패다.",
    "단순 사실·할 일·그 자체로 충분한 감사나 관찰·이유와 결론까지 이미 닫힌 기록은 silent를 적극적으로 선택한다.",
    "반대로 선택 기준이 비어 있거나, 스스로 발견한 반복 패턴·욕구와 비용·관점 변화·구체적 사건의 아직 정리되지 않은 의미가 있다면 speak를 고려한다.",
    "질문은 과거 기록을 다시 꺼낸 보람이 있어야 한다. '왜 그렇게 생각했나요?', '어떤 의미인가요?' 같은 범용 되묻기로 때우지 않는다.",
    "질문 후보는 최대 3개이며 서로 다른 각도여야 한다. 좋은 질문이 없으면 candidates를 비우고 silent를 선택한다."
  ].join("\n");
}

async function callCase(testCase) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpsError("failed-precondition", "AI 연결 설정을 확인해주세요.");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL_ROUTES.speaking,
      input: [
        { role: "system", content: bloomingEvalPrompt() },
        {
          role: "user",
          content: JSON.stringify({
            mode: "blooming-v2-synthetic-eval",
            thought: testCase.thought,
            instruction: "이 기록을 시간이 지난 뒤 다시 꺼낼 가치가 있는지 먼저 판단하고, 가치가 있을 때만 질문 후보를 만드세요."
          })
        }
      ],
      reasoning: { effort: MODEL_ROUTES.speakingReasoningEffort },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "thought_garden_blooming_v2_synthetic_eval",
          strict: true,
          schema: questionResultSchema("blooming")
        }
      },
      max_output_tokens: 2200
    })
  });

  const raw = await response.text();
  let data = null;
  try { data = JSON.parse(raw); } catch (_) {}
  if (!response.ok) {
    logger.error("Blooming synthetic eval OpenAI request failed", {
      caseId: testCase.id,
      status: response.status,
      message: data?.error?.message || raw.slice(0, 500)
    });
    return {
      id: testCase.id,
      label: testCase.label,
      expectedDecision: testCase.expectedDecision,
      actualDecision: "error",
      decisionPass: false,
      reason: "openai-request-failed",
      question: null,
      scores: null,
      evidence: null,
      usage: normalizeUsage(data)
    };
  }

  const text = extractResponseText(data);
  let parsed = null;
  try { if (text) parsed = JSON.parse(text); } catch (_) {}
  const selected = selectBestQuestion(parsed, {
    mode: "blooming",
    sources: { primary: testCase.thought }
  });
  const actualDecision = selected.decision === "speak" ? "speak" : "silent";

  return {
    id: testCase.id,
    group: testCase.group,
    label: testCase.label,
    expectedDecision: testCase.expectedDecision,
    actualDecision,
    decisionPass: actualDecision === testCase.expectedDecision,
    whyExpected: testCase.why,
    thought: testCase.thought,
    reason: selected.reason || "",
    question: selected.question || null,
    scores: selected.scores || null,
    evidence: selected.evidence || null,
    rejected: selected.rejected || [],
    usage: normalizeUsage(data)
  };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

const bloomingInterviewSyntheticEvalV2 = onCall({
  region: "us-central1",
  secrets: ["OPENAI_API_KEY"],
  timeoutSeconds: 180,
  memory: "256MiB",
  maxInstances: 2
}, async (request) => {
  requireNonAnonymousUser(request);
  const mode = String(request.data?.mode || "smoke").toLowerCase() === "full" ? "full" : "smoke";
  const cases = casesForMode(mode);
  const results = await mapWithConcurrency(cases, 2, callCase);
  const passCount = results.filter((item) => item.decisionPass).length;
  const speakCases = results.filter((item) => item.expectedDecision === "speak");
  const silentCases = results.filter((item) => item.expectedDecision === "silent");

  return {
    ok: true,
    dryRun: true,
    synthetic: true,
    version: AI_V2_VERSION,
    questionGateVersion: QUESTION_GATE_VERSION,
    model: MODEL_ROUTES.speaking,
    reasoningEffort: MODEL_ROUTES.speakingReasoningEffort,
    mode,
    summary: {
      total: results.length,
      pass: passCount,
      fail: results.length - passCount,
      decisionPassRate: results.length ? Math.round((passCount / results.length) * 100) : 0,
      speakPass: speakCases.filter((item) => item.decisionPass).length,
      speakTotal: speakCases.length,
      silentPass: silentCases.filter((item) => item.decisionPass).length,
      silentTotal: silentCases.length,
      allDecisionChecksPassed: passCount === results.length
    },
    usage: sumUsage(results),
    note: "자동 합격은 speak/silent 판단과 Question Gate 통과 여부만 본다. 실제 질문이 답하고 싶을 만큼 좋은지는 사람이 최종 검토해야 한다.",
    results
  };
});

module.exports = { bloomingInterviewSyntheticEvalV2 };

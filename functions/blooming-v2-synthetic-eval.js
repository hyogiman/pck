"use strict";

/**
 * Synthetic Blooming v2 model evaluation.
 *
 * This endpoint never reads or writes the user's Thought Garden. It runs fixed
 * fictional records through both halves of Blooming:
 *   1) Terra: should this old thought be reopened, and is there a good question?
 *   2) Luna: among mixed past records, is there a genuinely worthwhile source?
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
const { BLOOMING_SYNTHETIC_CASES, casesForMode } = require("./blooming-v2-eval-cases");

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

function emptyUsage() {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 };
}

function mergeUsage(target, usage) {
  const out = target || emptyUsage();
  const src = usage || {};
  for (const key of Object.keys(out)) out[key] += Number(src[key] || 0);
  return out;
}

function sumUsage(items, field = "usage") {
  return items.reduce((total, item) => mergeUsage(total, item?.[field]), emptyUsage());
}

async function requestStructured({ model, reasoningEffort, prompt, payload, schema, schemaName, maxOutputTokens, logLabel }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpsError("failed-precondition", "AI 연결 설정을 확인해주세요.");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: prompt },
        { role: "user", content: JSON.stringify(payload) }
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
  const usage = normalizeUsage(data);
  if (!response.ok) {
    logger.error(logLabel || "Blooming synthetic eval OpenAI request failed", {
      status: response.status,
      model,
      message: data?.error?.message || raw.slice(0, 500)
    });
    return { ok: false, parsed: null, usage };
  }

  const text = extractResponseText(data);
  let parsed = null;
  try { if (text) parsed = JSON.parse(text); } catch (_) {}
  return { ok: !!parsed, parsed, usage };
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

function scoutEvalPrompt() {
  return [
    "당신은 생각의 텃밭 Blooming Interview의 조용한 후보 선별자다.",
    "가장 감정적인 글이나 가장 긴 글이 아니라, 시간이 지난 지금 다시 물었을 때 새로운 생각이 자랄 가능성이 높은 기록 하나를 고른다.",
    "좋은 후보는 아직 닫히지 않은 질문, 선택/욕구/긴장, 관점 변화, 구체화되지 않은 중요한 의미, 당시 결론을 지금 다시 볼 여지가 원문에 있는 글이다.",
    "단순 사실 기록, 할 일 메모, 그 자체로 충분한 관찰, 이유와 결론이 이미 닫힌 글은 고르지 않는다.",
    "좋은 후보가 없다면 none이 정답이다. 화면을 채우기 위해 억지로 고르지 않는다.",
    "growthEdge는 원문에서 아직 쓰이지 않은 탐색 방향만 짧게 적는다. 심리 진단이나 원문 밖의 사실을 만들지 않는다.",
    "confidence 80 미만이면 원칙적으로 none을 선택한다."
  ].join("\n");
}

async function callCase(testCase) {
  const generated = await requestStructured({
    model: MODEL_ROUTES.speaking,
    reasoningEffort: MODEL_ROUTES.speakingReasoningEffort,
    prompt: bloomingEvalPrompt(),
    payload: {
      mode: "blooming-v2-synthetic-eval",
      thought: testCase.thought,
      instruction: "이 기록을 시간이 지난 뒤 다시 꺼낼 가치가 있는지 먼저 판단하고, 가치가 있을 때만 질문 후보를 만드세요."
    },
    schema: questionResultSchema("blooming"),
    schemaName: "thought_garden_blooming_v2_synthetic_eval",
    maxOutputTokens: 2200,
    logLabel: `Blooming synthetic question eval failed: ${testCase.id}`
  });

  if (!generated.ok) {
    return {
      id: testCase.id,
      label: testCase.label,
      expectedDecision: testCase.expectedDecision,
      actualDecision: "error",
      decisionPass: false,
      reason: "openai-request-or-parse-failed",
      question: null,
      scores: null,
      evidence: null,
      usage: generated.usage
    };
  }

  const selected = selectBestQuestion(generated.parsed, {
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
    usage: generated.usage
  };
}

function caseById(id) {
  return BLOOMING_SYNTHETIC_CASES.find((item) => item.id === id);
}

function scoutScenarios() {
  const mixedIds = [
    "silent-meal-log",
    "silent-task-note",
    "silent-closed-reasoning",
    "speak-choice-underneath",
    "silent-simple-gratitude",
    "speak-repeated-contradiction"
  ];
  const closedIds = [
    "silent-meal-log",
    "silent-task-note",
    "silent-closed-reasoning",
    "silent-simple-gratitude",
    "silent-answered-why",
    "silent-observation-no-gap"
  ];
  return [
    {
      id: "scout-mixed-pool",
      label: "좋은 후보가 섞인 기록 묶음",
      expected: "candidate",
      allowedIds: ["speak-choice-underneath", "speak-repeated-contradiction"],
      candidates: mixedIds.map(caseById)
    },
    {
      id: "scout-all-closed",
      label: "전부 닫힌 기록 묶음",
      expected: "none",
      allowedIds: [],
      candidates: closedIds.map(caseById)
    }
  ];
}

async function callScoutScenario(scenario) {
  const generated = await requestStructured({
    model: MODEL_ROUTES.discovery,
    reasoningEffort: "low",
    prompt: scoutEvalPrompt(),
    payload: {
      mode: "blooming-v2-synthetic-scout-eval",
      candidates: scenario.candidates.map((item) => ({ id: item.id, thought: item.thought }))
    },
    schema: scoutSchema(),
    schemaName: "thought_garden_blooming_v2_synthetic_scout",
    maxOutputTokens: 900,
    logLabel: `Blooming synthetic scout eval failed: ${scenario.id}`
  });

  if (!generated.ok) {
    return {
      id: scenario.id,
      label: scenario.label,
      expectedDecision: scenario.expected,
      actualDecision: "error",
      chosenFragmentId: "",
      pass: false,
      reason: "openai-request-or-parse-failed",
      growthEdge: "",
      confidence: 0,
      usage: generated.usage
    };
  }

  const result = generated.parsed || {};
  const decision = result.decision === "candidate" && Number(result.confidence || 0) >= 80 ? "candidate" : "none";
  const chosenId = String(result.chosenFragmentId || "");
  const pass = scenario.expected === "none"
    ? decision === "none"
    : decision === "candidate" && scenario.allowedIds.includes(chosenId);

  return {
    id: scenario.id,
    label: scenario.label,
    expectedDecision: scenario.expected,
    actualDecision: decision,
    allowedIds: scenario.allowedIds,
    chosenFragmentId: chosenId,
    pass,
    reason: String(result.reason || ""),
    growthEdge: String(result.growthEdge || ""),
    confidence: Number(result.confidence || 0),
    usage: generated.usage
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

  const [results, scoutResults] = await Promise.all([
    mapWithConcurrency(cases, 2, callCase),
    mapWithConcurrency(scoutScenarios(), 2, callScoutScenario)
  ]);

  const passCount = results.filter((item) => item.decisionPass).length;
  const speakCases = results.filter((item) => item.expectedDecision === "speak");
  const silentCases = results.filter((item) => item.expectedDecision === "silent");
  const scoutPassCount = scoutResults.filter((item) => item.pass).length;
  const questionUsage = sumUsage(results);
  const scoutUsage = sumUsage(scoutResults);
  const totalUsage = mergeUsage(mergeUsage(emptyUsage(), questionUsage), scoutUsage);
  const allQuestionDecisionsPassed = passCount === results.length;
  const allScoutChecksPassed = scoutPassCount === scoutResults.length;

  return {
    ok: true,
    dryRun: true,
    synthetic: true,
    version: AI_V2_VERSION,
    questionGateVersion: QUESTION_GATE_VERSION,
    model: MODEL_ROUTES.speaking,
    discoveryModel: MODEL_ROUTES.discovery,
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
      scoutPass: scoutPassCount,
      scoutTotal: scoutResults.length,
      allQuestionDecisionChecksPassed: allQuestionDecisionsPassed,
      allScoutChecksPassed,
      allDecisionChecksPassed: allQuestionDecisionsPassed && allScoutChecksPassed
    },
    usage: totalUsage,
    questionUsage,
    scoutUsage,
    note: "자동 합격은 speak/silent 판단, Luna 선별 방향, Question Gate 통과 여부를 본다. 실제 질문이 답하고 싶을 만큼 좋은지는 사람이 최종 검토해야 한다.",
    scoutResults,
    results
  };
});

module.exports = { bloomingInterviewSyntheticEvalV2 };

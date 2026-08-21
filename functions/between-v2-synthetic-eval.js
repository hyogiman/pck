"use strict";

/**
 * Synthetic Between Thoughts v2 evaluation.
 *
 * Fixed fictional pairs only. No personal Thought Garden data is read or
 * written. Terra generates questions; Luna independently performs an ablation
 * check to verify that A and B are both genuinely necessary.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { MODEL_ROUTES, AI_V2_VERSION, QUESTION_GATE_VERSION } = require("./ai-v2-core");
const {
  BETWEEN_PAIR_GATE_VERSION,
  betweenQuestionGenerationPrinciples,
  betweenQuestionResultSchema,
  selectBestBetweenQuestion
} = require("./between-v2-core");
const { betweenCasesForMode } = require("./between-v2-eval-cases");

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

function mergeUsage(target, source) {
  const out = target || emptyUsage();
  const src = source || {};
  for (const key of Object.keys(out)) out[key] += Number(src[key] || 0);
  return out;
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
    logger.error(logLabel || "Between v2 synthetic request failed", {
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

function generatorPrompt() {
  return [
    "당신은 생각의 텃밭 Between Thoughts의 질문자다.",
    "목표는 비슷한 두 글을 찾아 공통점을 말하는 것이 아니다. 두 기록을 함께 놓았을 때만 생기는 제3의 생각을 여는 것이다.",
    ...betweenQuestionGenerationPrinciples(),
    "A와 B가 주제만 비슷하거나 같은 결론을 반복한다면 silent가 정답이다.",
    "한 기록만으로 이미 충분히 좋은 질문이 만들어지고 다른 기록은 장식에 불과하면 silent를 선택한다.",
    "observation은 '함께 놓아본 이유'로 화면에 보일 수 있다. 두 원문에서 직접 확인되는 차이·대비·변화만 짧게 적고 심리적 결론을 단정하지 않는다.",
    "질문 후보는 최대 3개다. 각 후보의 evidence.a와 evidence.b는 각각 A와 B에서 연속된 원문 구절을 짧게 그대로 복사한다."
  ].join("\n");
}

function judgeItemSchema() {
  return {
    type: "object",
    properties: {
      index: { type: "integer", minimum: 0, maximum: 2 },
      requiresBoth: { type: "boolean" },
      worksFromAAlone: { type: "boolean" },
      worksFromBAlone: { type: "boolean" },
      createsThirdThought: { type: "boolean" },
      pairNecessity: { type: "integer", minimum: 0, maximum: 5 },
      thirdThoughtPotential: { type: "integer", minimum: 0, maximum: 5 },
      reason: { type: "string" }
    },
    required: [
      "index",
      "requiresBoth",
      "worksFromAAlone",
      "worksFromBAlone",
      "createsThirdThought",
      "pairNecessity",
      "thirdThoughtPotential",
      "reason"
    ],
    additionalProperties: false
  };
}

function judgeSchema() {
  return {
    type: "object",
    properties: {
      judgments: {
        type: "array",
        minItems: 0,
        maxItems: 3,
        items: judgeItemSchema()
      }
    },
    required: ["judgments"],
    additionalProperties: false
  };
}

function judgePrompt() {
  return [
    "당신은 Between Thoughts의 독립적인 Pair Necessity 심사자다. 질문을 새로 쓰지 말고 주어진 후보만 엄격하게 심사한다.",
    "각 후보마다 먼저 B를 완전히 가리고 A와 질문만 본다. 거의 같은 질문을 자연스럽게 물을 수 있으면 worksFromAAlone=true다.",
    "그다음 A를 완전히 가리고 B와 질문만 본다. 거의 같은 질문을 자연스럽게 물을 수 있으면 worksFromBAlone=true다.",
    "둘 중 하나라도 true라면 원칙적으로 requiresBoth=false다. 두 글의 단어를 질문에 같이 넣었다는 이유만으로 둘 다 필요한 것은 아니다.",
    "createsThirdThought=true는 질문이 A의 반복이나 B의 반복이 아니라, 두 기록의 관계에서만 보이는 새 기준·긴장·변화·통합을 열 때만 허용한다.",
    "pairNecessity와 thirdThoughtPotential은 후하게 주지 않는다. 4점은 명확히 통과할 때, 5점은 매우 강한 쌍일 때만 준다.",
    "원문에 없는 심리나 사실을 만들어 질문을 정당화하지 않는다."
  ].join("\n");
}

function pairJudgesFrom(parsed, candidateCount) {
  const rows = Array.isArray(parsed?.judgments) ? parsed.judgments : [];
  const map = {};
  for (let i = 0; i < candidateCount; i++) {
    const found = rows.find((row) => Number(row?.index) === i);
    // Missing judgment must fail closed instead of silently bypassing ablation.
    map[i] = found || {};
  }
  return map;
}

async function callCase(testCase) {
  const generation = await requestStructured({
    model: MODEL_ROUTES.speaking,
    reasoningEffort: MODEL_ROUTES.speakingReasoningEffort,
    prompt: generatorPrompt(),
    payload: {
      mode: "between-v2-synthetic-generator",
      a: testCase.a,
      b: testCase.b,
      instruction: "두 기록이 모두 필요한 연결인지 먼저 판단하고, 둘을 함께 볼 때만 생기는 질문이 있을 때만 speak를 선택하세요."
    },
    schema: betweenQuestionResultSchema(),
    schemaName: "thought_garden_between_v2_synthetic_generator",
    maxOutputTokens: 2600,
    logLabel: `Between synthetic generation failed: ${testCase.id}`
  });

  if (!generation.ok) {
    return {
      id: testCase.id,
      label: testCase.label,
      expectedDecision: testCase.expectedDecision,
      actualDecision: "error",
      decisionPass: false,
      reason: "generation-request-or-parse-failed",
      generationUsage: generation.usage,
      judgeUsage: emptyUsage()
    };
  }

  const sources = { a: testCase.a, b: testCase.b };
  const pre = selectBestBetweenQuestion(generation.parsed, { sources });
  if (pre.decision !== "speak") {
    const actualDecision = "silent";
    return {
      id: testCase.id,
      group: testCase.group,
      label: testCase.label,
      expectedDecision: testCase.expectedDecision,
      actualDecision,
      decisionPass: actualDecision === testCase.expectedDecision,
      whyExpected: testCase.why,
      a: testCase.a,
      b: testCase.b,
      reason: pre.reason || "",
      observation: pre.observation || generation.parsed?.observation || "",
      question: null,
      pairCheck: null,
      pairJudge: null,
      rejected: pre.rejected || [],
      generationUsage: generation.usage,
      judgeUsage: emptyUsage()
    };
  }

  const candidates = Array.isArray(generation.parsed?.candidates) ? generation.parsed.candidates.slice(0, 3) : [];
  const judge = await requestStructured({
    model: MODEL_ROUTES.discovery,
    reasoningEffort: "low",
    prompt: judgePrompt(),
    payload: {
      mode: "between-v2-synthetic-pair-ablation",
      a: testCase.a,
      b: testCase.b,
      candidates: candidates.map((candidate, index) => ({
        index,
        question: candidate.question,
        evidence: candidate.evidence,
        generatorPairCheck: candidate.pairCheck
      }))
    },
    schema: judgeSchema(),
    schemaName: "thought_garden_between_v2_synthetic_pair_judge",
    maxOutputTokens: 1500,
    logLabel: `Between synthetic pair judge failed: ${testCase.id}`
  });

  if (!judge.ok) {
    return {
      id: testCase.id,
      group: testCase.group,
      label: testCase.label,
      expectedDecision: testCase.expectedDecision,
      actualDecision: "error",
      decisionPass: false,
      whyExpected: testCase.why,
      a: testCase.a,
      b: testCase.b,
      reason: "judge-request-or-parse-failed",
      question: null,
      generationUsage: generation.usage,
      judgeUsage: judge.usage
    };
  }

  const pairJudges = pairJudgesFrom(judge.parsed, candidates.length);
  const selected = selectBestBetweenQuestion(generation.parsed, { sources, pairJudges });
  const actualDecision = selected.decision === "speak" ? "speak" : "silent";
  return {
    id: testCase.id,
    group: testCase.group,
    label: testCase.label,
    expectedDecision: testCase.expectedDecision,
    actualDecision,
    decisionPass: actualDecision === testCase.expectedDecision,
    whyExpected: testCase.why,
    a: testCase.a,
    b: testCase.b,
    reason: selected.reason || "",
    observation: selected.observation || generation.parsed?.observation || "",
    question: selected.question || null,
    scores: selected.scores || null,
    evidence: selected.evidence || null,
    pairCheck: selected.pairCheck || null,
    pairJudge: selected.pairJudge || null,
    rejected: selected.rejected || [],
    generatorCandidates: candidates,
    pairJudgments: judge.parsed?.judgments || [],
    generationUsage: generation.usage,
    judgeUsage: judge.usage
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

const betweenThoughtsSyntheticEvalV2 = onCall({
  region: "us-central1",
  secrets: ["OPENAI_API_KEY"],
  timeoutSeconds: 240,
  memory: "256MiB",
  maxInstances: 2
}, async (request) => {
  requireNonAnonymousUser(request);
  const mode = String(request.data?.mode || "smoke").toLowerCase() === "full" ? "full" : "smoke";
  const cases = betweenCasesForMode(mode);
  const results = await mapWithConcurrency(cases, 2, callCase);

  const pass = results.filter((row) => row.decisionPass).length;
  const speak = results.filter((row) => row.expectedDecision === "speak");
  const silent = results.filter((row) => row.expectedDecision === "silent");
  const generationUsage = results.reduce((total, row) => mergeUsage(total, row.generationUsage), emptyUsage());
  const judgeUsage = results.reduce((total, row) => mergeUsage(total, row.judgeUsage), emptyUsage());
  const usage = mergeUsage(mergeUsage(emptyUsage(), generationUsage), judgeUsage);

  return {
    ok: true,
    dryRun: true,
    synthetic: true,
    version: AI_V2_VERSION,
    questionGateVersion: QUESTION_GATE_VERSION,
    betweenPairGateVersion: BETWEEN_PAIR_GATE_VERSION,
    generatorModel: MODEL_ROUTES.speaking,
    judgeModel: MODEL_ROUTES.discovery,
    reasoningEffort: MODEL_ROUTES.speakingReasoningEffort,
    mode,
    summary: {
      total: results.length,
      pass,
      fail: results.length - pass,
      decisionPassRate: results.length ? Math.round((pass / results.length) * 100) : 0,
      speakPass: speak.filter((row) => row.decisionPass).length,
      speakTotal: speak.length,
      silentPass: silent.filter((row) => row.decisionPass).length,
      silentTotal: silent.length,
      allDecisionChecksPassed: pass === results.length
    },
    usage,
    generationUsage,
    judgeUsage,
    note: "Terra가 질문을 만든 뒤 Luna가 A-only/B-only ablation을 독립 심사한다. 양쪽 원문 evidence가 있다는 사실만으로는 통과하지 않는다.",
    results
  };
});

module.exports = { betweenThoughtsSyntheticEvalV2 };

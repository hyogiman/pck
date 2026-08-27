"use strict";

/**
 * Thought Garden · Between Thoughts v2 original-text pair verifier.
 *
 * Scout/index judgments are retrieval hints, not final truth. This layer rereads
 * the actual stored records for the scout's accepted shortlist and performs one
 * independent Luna A-only/B-only ablation before Terra is allowed to generate.
 *
 * READ-ONLY BY DESIGN. No Firestore writes, no Terra calls.
 */
const { HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { MODEL_ROUTES } = require("./ai-v2-core");

const MAX_ORIGINAL_PAIRS = 5;
const MAX_SOURCE_CHARS = 2200;
const MAX_THOUGHT_CHARS = 4200;
const MAX_CONTEXT_CHARS = 900;

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function stringRows(value, maxItems = 4, maxChars = 150) {
  return Array.isArray(value)
    ? value.slice(0, maxItems).map((item) => cleanText(item, maxChars)).filter(Boolean)
    : [];
}

function evidenceRows(value, maxItems = 3) {
  return Array.isArray(value)
    ? value.slice(0, maxItems).map((item) => ({
        value: cleanText(item?.value || item?.reading, 150),
        evidence: cleanText(item?.evidence, 180),
        confidence: cleanText(item?.confidence, 20)
      })).filter((item) => item.value && item.evidence)
    : [];
}

function promptContextFromFragment(data) {
  if (Number(data?.betweenThoughtsPromptContextVersion || 0) < 1) return null;
  const question = cleanText(data?.betweenThoughtsQuestion, 420);
  const connectionSummary = cleanText(data?.betweenThoughtsContextSummary || data?.betweenThoughtsBridge, 620);
  const sourceSummaries = stringRows(data?.betweenThoughtsSourceSummaries, 2, 260);
  if (!question && !connectionSummary && !sourceSummaries.length) return null;
  return {
    kind: "prior-between-ai-context",
    question,
    connectionSummary,
    sourceSummaries,
    note: "AI가 이전 질문을 만들 때 저장한 맥락이며 사용자의 현재 주장으로 취급하지 않는다."
  };
}

function fullRecord(id, data, source) {
  const promptContext = promptContextFromFragment(data);
  const visual = data?.aiIndex?.visualContext;
  return {
    id,
    date: cleanText(data?.date || "", 10),
    thought: cleanText(data?.thought || data?.text, MAX_THOUGHT_CHARS),
    context: promptContext ? "" : cleanText(data?.context, MAX_CONTEXT_CHARS),
    promptContext,
    sourceExcerpt: cleanText(data?.externalText, MAX_SOURCE_CHARS),
    locator: cleanText(data?.locator, 200),
    source: source ? {
      title: cleanText(source?.title, 260),
      creator: cleanText(source?.creator, 200),
      platform: cleanText(source?.platform, 140),
      publisher: cleanText(source?.publisher, 140),
      type: cleanText(source?.type, 40)
    } : null,
    visualContext: visual?.hasImages ? {
      relationToThought: cleanText(visual.relationToThought, 40),
      relationExplanation: cleanText(visual.relationExplanation, 260),
      visibleEvidence: stringRows(visual.visibleEvidence, 4, 140),
      attachmentIntents: evidenceRows(visual.attachmentIntents, 2),
      emotionalFunctions: evidenceRows(visual.emotionalFunctions, 2),
      latentContexts: evidenceRows(visual.latentContexts, 2),
      uncertaintyNotes: stringRows(visual.uncertaintyNotes, 2, 180)
    } : null
  };
}

function groundedSourceText(record) {
  return [record?.thought, record?.context, record?.sourceExcerpt]
    .map((value) => cleanText(value, 6000))
    .filter(Boolean)
    .join("\n");
}

function emptyUsage() {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 };
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

async function requestLunaStructured({ prompt, payload, schema, schemaName, maxOutputTokens, logLabel }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpsError("failed-precondition", "AI 연결 설정을 확인해주세요.");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL_ROUTES.discovery,
      input: [
        { role: "system", content: prompt },
        { role: "user", content: JSON.stringify(payload) }
      ],
      reasoning: { effort: "medium" },
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
    logger.error(logLabel, {
      status: response.status,
      model: MODEL_ROUTES.discovery,
      message: data?.error?.message || raw.slice(0, 400)
    });
    return { ok: false, parsed: null, usage };
  }

  const text = extractResponseText(data);
  let parsed = null;
  try { if (text) parsed = JSON.parse(text); } catch (_) {}
  return { ok: !!parsed, parsed, usage };
}

function pairCheckSchema() {
  return {
    type: "object",
    properties: {
      requiresBoth: { type: "boolean" },
      worksFromAAlone: { type: "boolean" },
      worksFromBAlone: { type: "boolean" },
      createsThirdThought: { type: "boolean" },
      pairNecessity: { type: "integer", minimum: 0, maximum: 5 },
      thirdThoughtPotential: { type: "integer", minimum: 0, maximum: 5 },
      reason: { type: "string" }
    },
    required: ["requiresBoth", "worksFromAAlone", "worksFromBAlone", "createsThirdThought", "pairNecessity", "thirdThoughtPotential", "reason"],
    additionalProperties: false
  };
}

function verificationSchema() {
  return {
    type: "object",
    properties: {
      reason: { type: "string" },
      evaluations: {
        type: "array",
        minItems: 0,
        maxItems: MAX_ORIGINAL_PAIRS,
        items: {
          type: "object",
          properties: {
            fragmentIds: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } },
            relation: { type: "string" },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            pairCheck: pairCheckSchema()
          },
          required: ["fragmentIds", "relation", "confidence", "pairCheck"],
          additionalProperties: false
        }
      }
    },
    required: ["reason", "evaluations"],
    additionalProperties: false
  };
}

function verificationPrompt() {
  return [
    "당신은 Thought Garden Between Thoughts v2의 원문 Pair Necessity 검증자다.",
    "앞 단계의 scout는 aiIndex만 보고 후보를 회수했다. scout의 confidence, relation, pairCheck는 정답이 아니며 반드시 무시하고 실제 기록을 기준으로 다시 판단한다.",
    "records의 thought와 context는 사용자의 실제 저장 기록이다. sourceExcerpt와 source는 외부 재료일 수 있으므로 사용자의 신념처럼 취급하지 않는다.",
    "promptContext는 과거 Between 질문에서 저장된 AI 맥락이므로 사용자의 주장·감정·사실로 취급하지 않는다.",
    "visualContext는 과거 이미지 분석 색인이지 지금 실제 이미지를 다시 보는 것이 아니므로 불확실성을 존중한다.",
    "각 후보마다 먼저 B를 완전히 가리고 A 원문만 읽는다. 거의 같은 중심의 질문이나 통찰이 A 하나만으로 자연스럽게 성립하면 worksFromAAlone=true다.",
    "그다음 A를 완전히 가리고 B 원문만 읽는다. 거의 같은 중심이 B 하나만으로 성립하면 worksFromBAlone=true다.",
    "둘 중 하나라도 true면 원칙적으로 requiresBoth=false이며 pairNecessity를 3 이하로 준다.",
    "createsThirdThought=true는 두 실제 기록의 관계에서만 보이는 새 기준·긴장·변화·통합이 생길 때만 허용한다.",
    "두 문서가 같은 주제라는 이유, 한 문서가 다른 문서의 예시·해결책·해석 렌즈가 된다는 이유만으로 통과시키지 않는다.",
    "원문에 없는 인과·공통 상황·같은 행동·새 목표·의무·성격 해석을 만들어 연결하지 않는다.",
    "relation도 scout 문장을 복사하지 말고 실제 원문이 지지하는 관계만 짧게 다시 적는다.",
    "pairNecessity와 thirdThoughtPotential 4점은 명확한 통과, 5점은 매우 강한 쌍에만 준다.",
    "입력된 모든 pair를 evaluations에 한 번씩 평가한다."
  ].join("\n");
}

function unorderedPairKey(a, b) {
  return [String(a), String(b)].sort().join("::");
}

function originalPairGateReasons(pair) {
  const check = pair?.originalPairCheck || pair?.pairCheck || {};
  const reasons = [];
  if (check.requiresBoth !== true) reasons.push("pair-not-required");
  if (check.worksFromAAlone === true) reasons.push("works-from-a-alone");
  if (check.worksFromBAlone === true) reasons.push("works-from-b-alone");
  if (check.createsThirdThought !== true) reasons.push("no-third-thought");
  if (Number(check.pairNecessity || 0) < 4) reasons.push("low-pair-necessity");
  if (Number(check.thirdThoughtPotential || 0) < 4) reasons.push("low-third-thought-potential");
  return reasons;
}

function passesOriginalPairGate(pair) {
  return originalPairGateReasons(pair).length === 0;
}

function rankOriginalPairs(pairs) {
  return pairs
    .filter(passesOriginalPairGate)
    .sort((a, b) =>
      (Number(b.originalPairCheck?.pairNecessity || 0) - Number(a.originalPairCheck?.pairNecessity || 0)) ||
      (Number(b.originalPairCheck?.thirdThoughtPotential || 0) - Number(a.originalPairCheck?.thirdThoughtPotential || 0)) ||
      (Number(b.originalConfidence || 0) - Number(a.originalConfidence || 0)) ||
      (Number(b.supportCount || 0) - Number(a.supportCount || 0)) ||
      (Number(b.discoveryConfidence || 0) - Number(a.discoveryConfidence || 0))
    );
}

async function loadOriginalRecords(userRef, pairs) {
  const ids = [...new Set(pairs.flatMap((pair) => Array.isArray(pair?.fragmentIds) ? pair.fragmentIds.map(String) : []))];
  const snaps = await Promise.all(ids.map((id) => userRef.collection("fragments").doc(id).get()));
  const fragmentMap = new Map();
  snaps.forEach((snap, index) => {
    if (snap.exists) {
      const data = snap.data() || {};
      if (!data.deletedAt) fragmentMap.set(ids[index], data);
    }
  });

  const sourceIds = [...new Set([...fragmentMap.values()].map((data) => String(data.sourceId || "")).filter(Boolean))];
  const sourceSnaps = await Promise.all(sourceIds.map((id) => userRef.collection("sources").doc(id).get()));
  const sourceMap = new Map();
  sourceSnaps.forEach((snap, index) => {
    if (snap.exists) sourceMap.set(sourceIds[index], snap.data() || {});
  });

  const records = new Map();
  for (const [id, data] of fragmentMap.entries()) {
    const record = fullRecord(id, data, sourceMap.get(String(data.sourceId || "")) || null);
    if (groundedSourceText(record).length >= 8 || record.visualContext) records.set(id, record);
  }
  return records;
}

async function verifyOriginalPairs(userRef, rawPairs) {
  const pairs = (Array.isArray(rawPairs) ? rawPairs : []).slice(0, MAX_ORIGINAL_PAIRS).filter((pair) => {
    const ids = Array.isArray(pair?.fragmentIds) ? pair.fragmentIds.map(String) : [];
    return ids.length === 2 && ids[0] !== ids[1];
  });
  if (!pairs.length) {
    return {
      ok: true,
      decision: "silent",
      reason: "no-scout-accepted-pairs",
      selectedPair: null,
      acceptedPairs: [],
      rejectedPairs: [],
      usage: emptyUsage(),
      aiCalls: 0
    };
  }

  const records = await loadOriginalRecords(userRef, pairs);
  const validPairs = pairs.filter((pair) => pair.fragmentIds.every((id) => records.has(String(id))));
  if (!validPairs.length) {
    return {
      ok: true,
      decision: "silent",
      reason: "no-complete-original-pairs",
      selectedPair: null,
      acceptedPairs: [],
      rejectedPairs: [],
      usage: emptyUsage(),
      aiCalls: 0
    };
  }

  const validKeys = new Map(validPairs.map((pair) => [unorderedPairKey(pair.fragmentIds[0], pair.fragmentIds[1]), pair]));
  const uniqueRecordIds = [...new Set(validPairs.flatMap((pair) => pair.fragmentIds.map(String)))];
  const payloadRecords = uniqueRecordIds.map((id) => records.get(id));
  const payloadPairs = validPairs.map((pair) => ({
    fragmentIds: pair.fragmentIds,
    scoutRelation: cleanText(pair.relation, 180),
    scoutPairCheck: pair.pairCheck || null
  }));

  const verification = await requestLunaStructured({
    prompt: verificationPrompt(),
    payload: { mode: "between-v2-original-pair-verification", records: payloadRecords, pairs: payloadPairs },
    schema: verificationSchema(),
    schemaName: "thought_garden_between_v2_original_pair_verification",
    maxOutputTokens: 4200,
    logLabel: "Between v2 original pair verification failed"
  });
  if (!verification.ok) {
    return {
      ok: false,
      decision: "silent",
      reason: "original-pair-verification-failed",
      selectedPair: null,
      acceptedPairs: [],
      rejectedPairs: [],
      usage: verification.usage,
      aiCalls: 1
    };
  }

  const seen = new Set();
  const evaluated = [];
  for (const raw of Array.isArray(verification.parsed?.evaluations) ? verification.parsed.evaluations : []) {
    const ids = Array.isArray(raw?.fragmentIds) ? raw.fragmentIds.map(String) : [];
    if (ids.length !== 2 || ids[0] === ids[1]) continue;
    const key = unorderedPairKey(ids[0], ids[1]);
    const scoutPair = validKeys.get(key);
    if (!scoutPair || seen.has(key)) continue;
    seen.add(key);
    const check = raw?.pairCheck || {};
    evaluated.push({
      ...scoutPair,
      scoutPairCheck: scoutPair.pairCheck || null,
      relation: cleanText(raw?.relation, 180) || scoutPair.relation,
      originalConfidence: Math.max(0, Math.min(100, Math.round(Number(raw?.confidence || 0)))),
      originalPairCheck: {
        requiresBoth: check.requiresBoth === true,
        worksFromAAlone: check.worksFromAAlone === true,
        worksFromBAlone: check.worksFromBAlone === true,
        createsThirdThought: check.createsThirdThought === true,
        pairNecessity: Math.max(0, Math.min(5, Math.round(Number(check?.pairNecessity || 0)))),
        thirdThoughtPotential: Math.max(0, Math.min(5, Math.round(Number(check?.thirdThoughtPotential || 0)))),
        reason: cleanText(check?.reason, 700)
      }
    });
  }

  const acceptedPairs = rankOriginalPairs(evaluated);
  const rejectedPairs = evaluated
    .filter((pair) => !passesOriginalPairGate(pair))
    .map((pair) => ({ ...pair, gateReasons: originalPairGateReasons(pair) }));
  const selectedPair = acceptedPairs[0] || null;

  return {
    ok: true,
    decision: selectedPair ? "pair" : "silent",
    reason: selectedPair ? "" : "original-pair-gate-rejected-all",
    verificationReason: cleanText(verification.parsed?.reason, 700),
    selectedPair,
    acceptedPairs,
    rejectedPairs,
    usage: verification.usage,
    aiCalls: 1
  };
}

module.exports = {
  MAX_ORIGINAL_PAIRS,
  originalPairGateReasons,
  passesOriginalPairGate,
  rankOriginalPairs,
  verifyOriginalPairs,
  emptyUsage
};
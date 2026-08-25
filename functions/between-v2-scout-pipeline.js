"use strict";

/**
 * Thought Garden · Between Thoughts v2 scout pipeline.
 *
 * Accuracy-first two-pass discovery for actual records:
 * 1) recall: for every anchor, surface up to two plausible counterparts
 * 2) evaluation: independently ablate A-only/B-only for every deduped pair
 * 3) deterministic server gate: only strong pair-necessary candidates survive
 *
 * READ-ONLY BY DESIGN. No Firestore writes, no Terra calls.
 */
const { HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { MODEL_ROUTES } = require("./ai-v2-core");

const MAX_CANDIDATES = 18;
const MAX_COUNTERPARTS_PER_ANCHOR = 2;
const MAX_DISCOVERY_PAIRS_FOR_EVALUATION = 24;
const MAX_ACCEPTED_PAIRS = 5;

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeId(raw, label) {
  const value = String(raw || "").trim();
  if (!value || value.length > 200 || value.includes("/")) {
    throw new HttpsError("invalid-argument", `${label} ID가 올바르지 않습니다.`);
  }
  return value;
}

function stringRows(value, maxItems, maxChars) {
  return Array.isArray(value)
    ? value.slice(0, maxItems).map((item) => cleanText(item, maxChars)).filter(Boolean)
    : [];
}

function evidenceRows(value, maxItems) {
  return Array.isArray(value)
    ? value.slice(0, maxItems).map((item) => ({
        value: cleanText(item?.value || item?.reading, 150),
        evidence: cleanText(item?.evidence, 180),
        confidence: cleanText(item?.confidence, 20)
      })).filter((item) => item.value && item.evidence)
    : [];
}

function compactProfile(id, data) {
  const index = data?.aiIndex;
  if (!index?.literal?.summary || !index?.authorPerspective || !index?.innerDynamics) return null;
  return {
    id,
    date: cleanText(data?.date || "", 10),
    summary: cleanText(index.literal.summary, 380),
    topics: stringRows(index.literal.topics, 5, 70),
    keyPhrases: stringRows(index.literal.keyPhrases, 4, 120),
    claims: stringRows(index.literal.claims, 4, 160),
    explicitIntents: stringRows(index.authorPerspective.explicitIntents, 3, 150),
    valuesOrNeeds: evidenceRows(index.authorPerspective.valuesOrNeeds, 4),
    tensions: evidenceRows(index.innerDynamics.tensions, 3),
    shifts: evidenceRows(index.innerDynamics.shifts, 2),
    openLoops: evidenceRows(index.innerDynamics.openLoops, 3),
    alternateReadings: evidenceRows(index.alternateReadings, 2),
    sourceContext: {
      relation: cleanText(index?.sourceContext?.relation, 40),
      anchor: cleanText(index?.sourceContext?.anchor, 220),
      contextKind: cleanText(index?.sourceContext?.contextKind, 60)
    },
    visualContext: index?.visualContext?.hasImages ? {
      relationToThought: cleanText(index.visualContext.relationToThought, 40),
      relationExplanation: cleanText(index.visualContext.relationExplanation, 220),
      visibleEvidence: stringRows(index.visualContext.visibleEvidence, 3, 120),
      latentContexts: evidenceRows(index.visualContext.latentContexts, 2)
    } : null,
    insufficientContext: Boolean(index?.uncertainty?.insufficientContext)
  };
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

function mergeUsage(a, b) {
  const out = emptyUsage();
  for (const key of Object.keys(out)) out[key] = Number(a?.[key] || 0) + Number(b?.[key] || 0);
  return out;
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

function discoverySchema() {
  return {
    type: "object",
    properties: {
      reason: { type: "string" },
      matches: {
        type: "array",
        minItems: 0,
        maxItems: MAX_CANDIDATES,
        items: {
          type: "object",
          properties: {
            anchorId: { type: "string" },
            counterparts: {
              type: "array",
              minItems: 0,
              maxItems: MAX_COUNTERPARTS_PER_ANCHOR,
              items: {
                type: "object",
                properties: {
                  counterpartId: { type: "string" },
                  relation: { type: "string" },
                  confidence: { type: "integer", minimum: 0, maximum: 100 },
                  reason: { type: "string" }
                },
                required: ["counterpartId", "relation", "confidence", "reason"],
                additionalProperties: false
              }
            }
          },
          required: ["anchorId", "counterparts"],
          additionalProperties: false
        }
      }
    },
    required: ["reason", "matches"],
    additionalProperties: false
  };
}

function discoveryPrompt() {
  return [
    "당신은 Thought Garden Between Thoughts v2의 후보 회수(recall) 탐색자다.",
    "지금 보는 것은 원문이 아니라 저장된 다층 생각 색인이다. 최종 질문을 만들거나 최종 순위를 매기지 않는다.",
    `전체에서 1등만 고르지 않는다. 각 profile을 anchor로 검토하고, 그 anchor와 함께 놓을 때 제3의 생각이 생길 가능성이 높은 counterpart를 최대 ${MAX_COUNTERPARTS_PER_ANCHOR}개까지 반환한다.`,
    "두 번째 counterpart는 첫 번째와 거의 같은 연결을 반복하지 말고, 실제로 다른 관계 중심이 있을 때만 반환한다.",
    "좋은 counterpart가 없으면 counterparts를 빈 배열로 둔다. 수를 채우기 위해 억지로 연결하지 않는다.",
    "같은 주제나 단어를 공유한다는 이유만으로 고르지 않는다.",
    "같은 대상이 서로 다른 효과를 만든 경우, 상황에 따라 선택 기준이 바뀌는 경우, 시간에 따라 가치 기준이 이동한 경우, 실제 장면 사이에 긴장이 생기는 경우를 적극적으로 살핀다.",
    "한 기록이 다른 기록의 단순 해결책·예시·설명에 그치는 조합보다 둘을 같이 봐야 관계 자체가 새로 보이는 조합을 우선한다.",
    "A 하나만으로도 거의 같은 질문이 생기거나 counterpart 하나만으로도 거의 같은 질문이 생길 것 같다면 confidence를 낮춘다.",
    "원문에 없는 인과·같은 날·같은 행동·새 목표·의무를 가정하지 않는다.",
    "valuesOrNeeds, alternateReadings, visualContext는 추론일 수 있으므로 literal, keyPhrases, claims와 evidence가 받쳐주는 범위에서만 사용한다.",
    "anchorId와 counterpartId는 입력 profile id를 그대로 사용한다. 같은 pair가 반대 방향 anchor에서 반복되는 것은 허용하며 서버가 dedupe한다."
  ].join("\n");
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

function evaluationSchema() {
  return {
    type: "object",
    properties: {
      reason: { type: "string" },
      evaluations: {
        type: "array",
        minItems: 0,
        maxItems: MAX_DISCOVERY_PAIRS_FOR_EVALUATION,
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

function evaluationPrompt() {
  return [
    "당신은 Thought Garden Between Thoughts v2의 독립 pair evaluator다.",
    "앞 단계가 회수를 위해 넓게 찾아낸 각 pair를 하나씩 심사한다. discovery confidence나 reason을 정답으로 믿지 않는다.",
    "입력된 각 후보마다 A-only/B-only ablation을 수행하고 evaluations에 평가를 남긴다. 강한 후보만 골라내는 작업이 아니라 각 후보의 실제 pair 필요성을 측정하는 작업이다.",
    "A만 남겨도 거의 같은 중심의 질문이 가능하면 worksFromAAlone=true다. B만 남겨도 가능하면 worksFromBAlone=true다.",
    "둘 중 하나라도 true라면 원칙적으로 requiresBoth=false이고 pairNecessity를 3 이하로 준다.",
    "createsThirdThought는 A의 반복도 B의 반복도 아닌 새 기준·긴장·변화·통합이 두 기록의 관계에서 생길 때만 true다.",
    "한 기록을 다른 기록의 해결책이나 해석 렌즈로 단순 적용하는 조합은 낮게 평가한다.",
    "같은 주제·같은 단어·같은 문제를 반복하는 것만으로는 강한 pair가 아니다.",
    "같은 대상의 상반된 효과, 상황에 따른 선택 기준 변화, 시간에 따른 가치 이동처럼 둘을 함께 봐야 차이가 드러나는 관계를 높게 평가한다.",
    "원문에 없는 인과·공통 상황·같은 행동·새 목표·의무를 가정하면 낮게 평가한다.",
    "pairNecessity와 thirdThoughtPotential 4점은 명확한 통과 후보, 5점은 매우 강한 후보에만 준다.",
    "confidence는 이 pair 평가 자체에 대한 확신도이며, pairCheck가 약한데 confidence만 높게 주지 않는다."
  ].join("\n");
}

function unorderedPairKey(a, b) {
  return [String(a), String(b)].sort().join("::");
}

function normalizeDiscovery(parsed, validIds) {
  const byKey = new Map();
  const matches = Array.isArray(parsed?.matches) ? parsed.matches : [];
  for (const row of matches) {
    const anchorId = String(row?.anchorId || "");
    if (!validIds.has(anchorId)) continue;
    const counterparts = Array.isArray(row?.counterparts) ? row.counterparts.slice(0, MAX_COUNTERPARTS_PER_ANCHOR) : [];
    for (const counterpart of counterparts) {
      const counterpartId = String(counterpart?.counterpartId || "");
      if (!validIds.has(counterpartId) || anchorId === counterpartId) continue;
      const key = unorderedPairKey(anchorId, counterpartId);
      const confidence = Math.max(0, Math.min(100, Math.round(Number(counterpart?.confidence || 0))));
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          fragmentIds: [anchorId, counterpartId],
          relation: cleanText(counterpart?.relation, 180),
          discoveryConfidence: confidence,
          supportCount: 1,
          reasons: [cleanText(counterpart?.reason, 500)].filter(Boolean)
        });
      } else {
        existing.supportCount += 1;
        existing.discoveryConfidence = Math.max(existing.discoveryConfidence, confidence);
        const reason = cleanText(counterpart?.reason, 500);
        if (reason && !existing.reasons.includes(reason)) existing.reasons.push(reason);
      }
    }
  }
  return [...byKey.values()]
    .sort((a, b) => (b.supportCount - a.supportCount) || (b.discoveryConfidence - a.discoveryConfidence))
    .slice(0, MAX_DISCOVERY_PAIRS_FOR_EVALUATION);
}

function normalizeEvaluation(raw, validIds, discoveryByKey) {
  const ids = Array.isArray(raw?.fragmentIds) ? raw.fragmentIds.map(String) : [];
  if (ids.length !== 2 || ids[0] === ids[1] || !ids.every((id) => validIds.has(id))) return null;
  const key = unorderedPairKey(ids[0], ids[1]);
  const discovery = discoveryByKey.get(key);
  if (!discovery) return null;
  const check = raw?.pairCheck || {};
  return {
    fragmentIds: ids,
    relation: cleanText(raw?.relation, 180) || discovery.relation,
    confidence: Math.max(0, Math.min(100, Math.round(Number(raw?.confidence || 0)))),
    discoveryConfidence: discovery.discoveryConfidence,
    supportCount: discovery.supportCount,
    discoveryReasons: discovery.reasons,
    pairCheck: {
      requiresBoth: check.requiresBoth === true,
      worksFromAAlone: check.worksFromAAlone === true,
      worksFromBAlone: check.worksFromBAlone === true,
      createsThirdThought: check.createsThirdThought === true,
      pairNecessity: Math.max(0, Math.min(5, Math.round(Number(check?.pairNecessity || 0)))),
      thirdThoughtPotential: Math.max(0, Math.min(5, Math.round(Number(check?.thirdThoughtPotential || 0)))),
      reason: cleanText(check?.reason, 700)
    }
  };
}

function scoutPairGateReasons(pair) {
  const check = pair?.pairCheck || {};
  const reasons = [];
  if (check.requiresBoth !== true) reasons.push("pair-not-required");
  if (check.worksFromAAlone === true) reasons.push("works-from-a-alone");
  if (check.worksFromBAlone === true) reasons.push("works-from-b-alone");
  if (check.createsThirdThought !== true) reasons.push("no-third-thought");
  if (Number(check.pairNecessity || 0) < 4) reasons.push("low-pair-necessity");
  if (Number(check.thirdThoughtPotential || 0) < 4) reasons.push("low-third-thought-potential");
  return reasons;
}

function passesScoutPairGate(pair) {
  return scoutPairGateReasons(pair).length === 0;
}

function rankAcceptedPairs(pairs) {
  return pairs
    .filter(passesScoutPairGate)
    .sort((a, b) =>
      (Number(b.pairCheck?.pairNecessity || 0) - Number(a.pairCheck?.pairNecessity || 0)) ||
      (Number(b.pairCheck?.thirdThoughtPotential || 0) - Number(a.pairCheck?.thirdThoughtPotential || 0)) ||
      (Number(b.supportCount || 0) - Number(a.supportCount || 0)) ||
      (Number(b.confidence || 0) - Number(a.confidence || 0)) ||
      (Number(b.discoveryConfidence || 0) - Number(a.discoveryConfidence || 0))
    )
    .slice(0, MAX_ACCEPTED_PAIRS);
}

async function loadExistingProfiles(userRef, rawCandidateIds) {
  const candidateIds = [...new Set((Array.isArray(rawCandidateIds) ? rawCandidateIds : [])
    .slice(0, MAX_CANDIDATES)
    .map((id, index) => safeId(id, `생각 조각 ${index + 1}`)))];
  if (candidateIds.length < 2) throw new HttpsError("invalid-argument", "scout에는 최소 두 개의 candidateIds가 필요합니다.");

  const snaps = await Promise.all(candidateIds.map((id) => userRef.collection("fragments").doc(id).get()));
  const rows = snaps.map((snap, index) => ({
    id: candidateIds[index],
    exists: snap.exists,
    data: snap.exists ? snap.data() || {} : {}
  })).filter((row) => row.exists && !row.data.deletedAt);
  const profiles = rows.map((row) => compactProfile(row.id, row.data)).filter(Boolean);
  return { candidateIds, rows, profiles };
}

async function runScoutPipeline(userRef, rawCandidateIds) {
  const { candidateIds, rows, profiles } = await loadExistingProfiles(userRef, rawCandidateIds);
  if (profiles.length < 2) {
    return {
      ok: true,
      decision: "silent",
      reason: "not-enough-existing-indexes",
      candidateCount: rows.length,
      indexedCandidateCount: profiles.length,
      selectedPair: null,
      discoveryPairs: [],
      acceptedPairs: [],
      rejectedPairs: [],
      usage: { discovery: emptyUsage(), evaluation: emptyUsage(), total: emptyUsage() },
      aiCalls: 0
    };
  }

  const validIds = new Set(profiles.map((profile) => profile.id));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  const discovery = await requestLunaStructured({
    prompt: discoveryPrompt(),
    payload: { mode: "between-v2-actual-scout-recall", profiles },
    schema: discoverySchema(),
    schemaName: "thought_garden_between_v2_actual_scout_recall",
    maxOutputTokens: 7000,
    logLabel: "Between v2 actual scout recall failed"
  });
  if (!discovery.ok) {
    return {
      ok: false,
      decision: "silent",
      reason: "scout-discovery-failed",
      candidateCount: rows.length,
      indexedCandidateCount: profiles.length,
      selectedPair: null,
      discoveryPairs: [],
      acceptedPairs: [],
      rejectedPairs: [],
      usage: { discovery: discovery.usage, evaluation: emptyUsage(), total: discovery.usage },
      aiCalls: 1
    };
  }

  const discoveryPairs = normalizeDiscovery(discovery.parsed, validIds);
  if (!discoveryPairs.length) {
    return {
      ok: true,
      decision: "silent",
      reason: cleanText(discovery.parsed?.reason, 700) || "no-discovery-pairs",
      candidateCount: rows.length,
      indexedCandidateCount: profiles.length,
      selectedPair: null,
      discoveryPairs: [],
      acceptedPairs: [],
      rejectedPairs: [],
      usage: { discovery: discovery.usage, evaluation: emptyUsage(), total: discovery.usage },
      aiCalls: 1
    };
  }

  const evaluationPayloadPairs = discoveryPairs.map((pair) => ({
    ...pair,
    a: profileById.get(pair.fragmentIds[0]),
    b: profileById.get(pair.fragmentIds[1])
  }));

  const evaluation = await requestLunaStructured({
    prompt: evaluationPrompt(),
    payload: { mode: "between-v2-actual-scout-pair-evaluation", pairs: evaluationPayloadPairs },
    schema: evaluationSchema(),
    schemaName: "thought_garden_between_v2_actual_scout_pair_evaluation",
    maxOutputTokens: 8500,
    logLabel: "Between v2 actual scout pair evaluation failed"
  });
  const totalUsage = mergeUsage(discovery.usage, evaluation.usage);
  if (!evaluation.ok) {
    return {
      ok: false,
      decision: "silent",
      reason: "scout-evaluation-failed",
      candidateCount: rows.length,
      indexedCandidateCount: profiles.length,
      selectedPair: null,
      discoveryPairs,
      acceptedPairs: [],
      rejectedPairs: [],
      usage: { discovery: discovery.usage, evaluation: evaluation.usage, total: totalUsage },
      aiCalls: 2
    };
  }

  const discoveryByKey = new Map(discoveryPairs.map((pair) => [unorderedPairKey(pair.fragmentIds[0], pair.fragmentIds[1]), pair]));
  const seen = new Set();
  const evaluated = [];
  for (const raw of Array.isArray(evaluation.parsed?.evaluations) ? evaluation.parsed.evaluations : []) {
    const pair = normalizeEvaluation(raw, validIds, discoveryByKey);
    if (!pair) continue;
    const key = unorderedPairKey(pair.fragmentIds[0], pair.fragmentIds[1]);
    if (seen.has(key)) continue;
    seen.add(key);
    evaluated.push(pair);
  }

  const acceptedPairs = rankAcceptedPairs(evaluated);
  const rejectedPairs = evaluated
    .filter((pair) => !passesScoutPairGate(pair))
    .map((pair) => ({ ...pair, gateReasons: scoutPairGateReasons(pair) }));
  const selectedPair = acceptedPairs[0] || null;

  return {
    ok: true,
    decision: selectedPair ? "pair" : "silent",
    reason: selectedPair ? "" : "scout-pair-gate-rejected-all",
    candidateCount: rows.length,
    indexedCandidateCount: profiles.length,
    discoveryReason: cleanText(discovery.parsed?.reason, 700),
    evaluationReason: cleanText(evaluation.parsed?.reason, 700),
    selectedPair,
    discoveryPairs,
    acceptedPairs,
    rejectedPairs,
    usage: { discovery: discovery.usage, evaluation: evaluation.usage, total: totalUsage },
    aiCalls: 2
  };
}

module.exports = {
  MAX_CANDIDATES,
  MAX_COUNTERPARTS_PER_ANCHOR,
  MAX_DISCOVERY_PAIRS_FOR_EVALUATION,
  normalizeDiscovery,
  scoutPairGateReasons,
  passesScoutPairGate,
  rankAcceptedPairs,
  runScoutPipeline,
  emptyUsage,
  mergeUsage
};

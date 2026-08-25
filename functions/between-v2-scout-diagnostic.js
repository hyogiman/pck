"use strict";

/**
 * Thought Garden · Between Thoughts v2 scout diagnostic.
 *
 * This diagnostic deliberately separates two questions:
 * 1) recall: can discovery surface a worthwhile counterpart for each anchor?
 * 2) ranking: among the surfaced pairs, which ones actually require both records?
 *
 * It uses Luna for both passes, never calls Terra, and never writes Firestore.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { MODEL_ROUTES } = require("./ai-v2-core");

if (!getApps().length) initializeApp();
const db = getFirestore();

const MAX_CANDIDATES = 18;
const MAX_RANKED_PAIRS = 5;
const MAX_DISCOVERY_PAIRS_FOR_RANKING = 18;

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

function requireNonAnonymousUser(request) {
  const uid = String(request?.auth?.uid || "").trim();
  if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");
  const provider = String(request?.auth?.token?.firebase?.sign_in_provider || "");
  if (provider === "anonymous") {
    throw new HttpsError("permission-denied", "정식 로그인 상태에서만 Between v2 diagnostic을 사용할 수 있습니다.");
  }
  return uid;
}

async function featureEnabled(userRef) {
  const snap = await userRef.collection("settings").doc("private").get();
  const data = snap.exists ? snap.data() || {} : {};
  return data.betweenThoughtsEnabled === true;
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

async function requestStructured({ prompt, payload, schema, schemaName, maxOutputTokens, logLabel }) {
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
            decision: { type: "string", enum: ["pair", "none"] },
            counterpartId: { type: "string" },
            relation: { type: "string" },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            reason: { type: "string" }
          },
          required: ["anchorId", "decision", "counterpartId", "relation", "confidence", "reason"],
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
    "중요: 전체에서 1등 한 쌍만 고르지 않는다. 각 profile을 anchor로 한 번씩 검토하여, 그 anchor와 함께 놓을 때 제3의 생각이 생길 가능성이 가장 높은 counterpart 하나를 찾는다.",
    "좋은 counterpart가 없으면 decision='none'을 선택한다. 수를 채우기 위해 억지로 연결하지 않는다.",
    "두 기록이 같은 주제나 단어를 공유한다는 이유만으로 고르지 않는다.",
    "같은 대상이 서로 다른 효과를 만든 경우, 상황에 따라 선택 기준이 바뀌는 경우, 시간에 따라 가치 기준이 이동한 경우, 실제 장면 사이에 긴장이 생기는 경우를 적극적으로 살핀다.",
    "특히 한 기록이 다른 기록의 단순 해결책·예시·설명에 그치는 조합보다, 둘을 같이 봐야 관계 자체가 새로 보이는 조합을 우선한다.",
    "A 하나만으로도 거의 같은 질문이 생기거나 counterpart 하나만으로도 거의 같은 질문이 생길 것 같다면 confidence를 낮추거나 none을 선택한다.",
    "원문에 없는 인과·같은 날·같은 행동·새 목표·의무를 가정하지 않는다.",
    "valuesOrNeeds, alternateReadings, visualContext는 추론일 수 있으므로 literal, keyPhrases, claims와 evidence가 받쳐주는 범위에서만 사용한다.",
    "anchorId는 입력 profile id를 그대로 사용한다. decision='none'이면 counterpartId와 relation은 빈 문자열로 둔다.",
    "같은 pair가 서로 반대 방향 anchor에서 반복되는 것은 허용한다. 서버가 나중에 dedupe한다."
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

function rankingSchema() {
  return {
    type: "object",
    properties: {
      reason: { type: "string" },
      pairs: {
        type: "array",
        minItems: 0,
        maxItems: MAX_RANKED_PAIRS,
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
    required: ["reason", "pairs"],
    additionalProperties: false
  };
}

function rankingPrompt() {
  return [
    "당신은 Thought Garden Between Thoughts v2의 독립 후보 랭커다.",
    "앞 단계가 여러 anchor에서 찾아낸 후보 pair를 서로 비교한다. discovery의 confidence나 reason을 정답으로 믿지 않는다.",
    `실제로 Between 질문 생성 단계로 올릴 가치가 높은 순서대로 최대 ${MAX_RANKED_PAIRS}쌍만 반환한다.`,
    "각 후보마다 A-only/B-only ablation을 수행한다.",
    "A만 남겨도 거의 같은 중심의 질문이 가능하면 worksFromAAlone=true다. B만 남겨도 가능하면 worksFromBAlone=true다.",
    "둘 중 하나라도 true라면 원칙적으로 requiresBoth=false이고 pairNecessity를 3 이하로 준다.",
    "createsThirdThought는 A의 반복도 B의 반복도 아닌 새 기준·긴장·변화·통합이 두 기록의 관계에서 생길 때만 true다.",
    "한 기록을 다른 기록의 해결책이나 해석 렌즈로 단순 적용하는 조합은 낮게 평가한다.",
    "같은 주제·같은 단어·같은 문제를 반복하는 것만으로는 강한 pair가 아니다.",
    "같은 대상이 상반된 효과를 만드는 관계, 상황에 따른 선택 기준의 변화, 시간에 따른 가치 이동처럼 둘을 함께 봐야만 차이가 드러나는 관계를 높게 평가한다.",
    "원문에 없는 인과·공통 상황·같은 행동·새 목표·의무를 가정하면 낮게 평가한다.",
    "pairNecessity와 thirdThoughtPotential의 4점은 명확한 통과 후보, 5점은 매우 강한 후보에만 준다.",
    "상위 5개를 채울 만큼 강한 pair가 없으면 더 적게 반환한다."
  ].join("\n");
}

function unorderedPairKey(a, b) {
  return [String(a), String(b)].sort().join("::");
}

function normalizeDiscovery(parsed, validIds) {
  const byKey = new Map();
  const matches = Array.isArray(parsed?.matches) ? parsed.matches : [];
  for (const row of matches) {
    if (row?.decision !== "pair") continue;
    const anchorId = String(row?.anchorId || "");
    const counterpartId = String(row?.counterpartId || "");
    if (!validIds.has(anchorId) || !validIds.has(counterpartId) || anchorId === counterpartId) continue;
    const key = unorderedPairKey(anchorId, counterpartId);
    const confidence = Math.max(0, Math.min(100, Math.round(Number(row?.confidence || 0))));
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        fragmentIds: [anchorId, counterpartId],
        relation: cleanText(row?.relation, 180),
        discoveryConfidence: confidence,
        supportCount: 1,
        reasons: [cleanText(row?.reason, 500)].filter(Boolean)
      });
    } else {
      existing.supportCount += 1;
      existing.discoveryConfidence = Math.max(existing.discoveryConfidence, confidence);
      const reason = cleanText(row?.reason, 500);
      if (reason && !existing.reasons.includes(reason)) existing.reasons.push(reason);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => (b.supportCount - a.supportCount) || (b.discoveryConfidence - a.discoveryConfidence))
    .slice(0, MAX_DISCOVERY_PAIRS_FOR_RANKING);
}

function normalizePair(raw, validIds) {
  const ids = Array.isArray(raw?.fragmentIds) ? raw.fragmentIds.map(String) : [];
  if (ids.length !== 2 || ids[0] === ids[1] || !ids.every((id) => validIds.has(id))) return null;
  const check = raw?.pairCheck || {};
  return {
    fragmentIds: ids,
    relation: cleanText(raw?.relation, 180),
    confidence: Math.max(0, Math.min(100, Math.round(Number(raw?.confidence || 0)))),
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

const betweenThoughtsScoutDiagnosticV2 = onCall({
  region: "us-central1",
  secrets: ["OPENAI_API_KEY"],
  timeoutSeconds: 300,
  memory: "256MiB",
  maxInstances: 2
}, async (request) => {
  const uid = requireNonAnonymousUser(request);
  const userRef = db.collection("users").doc(uid);
  if (!(await featureEnabled(userRef))) {
    return { ok: true, enabled: false, readOnly: true, pairs: [] };
  }

  const rawIds = Array.isArray(request.data?.candidateIds) ? request.data.candidateIds : [];
  const candidateIds = [...new Set(rawIds.slice(0, MAX_CANDIDATES).map((id, index) => safeId(id, `생각 조각 ${index + 1}`)))];
  if (candidateIds.length < 2) throw new HttpsError("invalid-argument", "diagnostic에는 최소 두 개의 candidateIds가 필요합니다.");

  const snaps = await Promise.all(candidateIds.map((id) => userRef.collection("fragments").doc(id).get()));
  const rows = snaps.map((snap, index) => ({
    id: candidateIds[index],
    exists: snap.exists,
    data: snap.exists ? snap.data() || {} : {}
  })).filter((row) => row.exists && !row.data.deletedAt);

  const profiles = rows.map((row) => compactProfile(row.id, row.data)).filter(Boolean);
  if (profiles.length < 2) {
    return {
      ok: true,
      dryRun: true,
      readOnly: true,
      writesPerformed: 0,
      aiCalls: 0,
      candidateCount: rows.length,
      indexedCandidateCount: profiles.length,
      discoveryPairs: [],
      pairs: [],
      reason: "not-enough-existing-indexes",
      usage: { discovery: emptyUsage(), ranking: emptyUsage(), total: emptyUsage() }
    };
  }

  const validIds = new Set(profiles.map((profile) => profile.id));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  const discovery = await requestStructured({
    prompt: discoveryPrompt(),
    payload: { mode: "between-v2-scout-recall-diagnostic", profiles },
    schema: discoverySchema(),
    schemaName: "thought_garden_between_v2_scout_recall_diagnostic",
    maxOutputTokens: 5200,
    logLabel: "Between v2 scout recall diagnostic failed"
  });
  if (!discovery.ok) {
    return {
      ok: false,
      dryRun: true,
      readOnly: true,
      writesPerformed: 0,
      aiCalls: 1,
      stage: "discovery-failed",
      usage: { discovery: discovery.usage, ranking: emptyUsage(), total: discovery.usage }
    };
  }

  const discoveryPairs = normalizeDiscovery(discovery.parsed, validIds);
  if (!discoveryPairs.length) {
    return {
      ok: true,
      dryRun: true,
      readOnly: true,
      writesPerformed: 0,
      aiCalls: 1,
      model: MODEL_ROUTES.discovery,
      candidateCount: rows.length,
      indexedCandidateCount: profiles.length,
      discoveryReason: cleanText(discovery.parsed?.reason, 700),
      discoveryPairs: [],
      rankingReason: "no-discovery-pairs",
      pairs: [],
      usage: { discovery: discovery.usage, ranking: emptyUsage(), total: discovery.usage }
    };
  }

  const rankingPayloadPairs = discoveryPairs.map((pair) => ({
    ...pair,
    a: profileById.get(pair.fragmentIds[0]),
    b: profileById.get(pair.fragmentIds[1])
  }));

  const ranking = await requestStructured({
    prompt: rankingPrompt(),
    payload: { mode: "between-v2-scout-ranking-diagnostic", pairs: rankingPayloadPairs },
    schema: rankingSchema(),
    schemaName: "thought_garden_between_v2_scout_ranking_diagnostic",
    maxOutputTokens: 4200,
    logLabel: "Between v2 scout ranking diagnostic failed"
  });
  const totalUsage = mergeUsage(discovery.usage, ranking.usage);
  if (!ranking.ok) {
    return {
      ok: false,
      dryRun: true,
      readOnly: true,
      writesPerformed: 0,
      aiCalls: 2,
      stage: "ranking-failed",
      discoveryReason: cleanText(discovery.parsed?.reason, 700),
      discoveryPairs,
      usage: { discovery: discovery.usage, ranking: ranking.usage, total: totalUsage }
    };
  }

  const normalized = (Array.isArray(ranking.parsed?.pairs) ? ranking.parsed.pairs : [])
    .map((row) => normalizePair(row, validIds))
    .filter(Boolean)
    .slice(0, MAX_RANKED_PAIRS);

  const enriched = normalized.map((pair, index) => ({
    rank: index + 1,
    ...pair,
    a: {
      id: pair.fragmentIds[0],
      date: profileById.get(pair.fragmentIds[0])?.date || "",
      summary: profileById.get(pair.fragmentIds[0])?.summary || ""
    },
    b: {
      id: pair.fragmentIds[1],
      date: profileById.get(pair.fragmentIds[1])?.date || "",
      summary: profileById.get(pair.fragmentIds[1])?.summary || ""
    }
  }));

  logger.info("Between v2 scout diagnostic completed", {
    uid,
    candidateCount: rows.length,
    indexedCandidateCount: profiles.length,
    discoveryPairCount: discoveryPairs.length,
    rankedPairCount: enriched.length,
    totalTokens: totalUsage.totalTokens
  });

  return {
    ok: true,
    dryRun: true,
    readOnly: true,
    writesPerformed: 0,
    aiCalls: 2,
    model: MODEL_ROUTES.discovery,
    candidateCount: rows.length,
    indexedCandidateCount: profiles.length,
    discoveryReason: cleanText(discovery.parsed?.reason, 700),
    discoveryPairs,
    rankingReason: cleanText(ranking.parsed?.reason, 700),
    pairs: enriched,
    usage: { discovery: discovery.usage, ranking: ranking.usage, total: totalUsage }
  };
});

module.exports = { betweenThoughtsScoutDiagnosticV2 };

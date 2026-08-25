"use strict";

/**
 * Thought Garden · Between Thoughts v2 scout diagnostic.
 *
 * Purpose:
 * - isolate candidate discovery from Terra generation and the final judge
 * - inspect the current scout's top-ranked pairs on real stored aiIndex data
 * - reveal pair-necessity self-checks instead of hiding all but rank #1
 *
 * READ-ONLY BY DESIGN. This function never writes Firestore, backfills indexes,
 * mutates fragments, queues results, or records usage documents.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { MODEL_ROUTES } = require("./ai-v2-core");

if (!getApps().length) initializeApp();
const db = getFirestore();

const MAX_CANDIDATES = 18;
const MAX_DIAGNOSTIC_PAIRS = 5;

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

// Deliberately mirrors the profile shape used by the actual-record preview.
// The diagnostic should observe the current scout before we change its diet.
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
    required: [
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

function diagnosticSchema() {
  return {
    type: "object",
    properties: {
      reason: { type: "string" },
      pairs: {
        type: "array",
        minItems: 0,
        maxItems: MAX_DIAGNOSTIC_PAIRS,
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

function diagnosticPrompt() {
  return [
    "당신은 Thought Garden Between Thoughts v2의 후보 탐색 진단자다.",
    "지금 보는 것은 원문이 아니라 이미 저장된 다층 생각 색인이다. 최종 질문을 만들지 않는다.",
    `전체 후보에서 '두 기록을 함께 놓아야만 새 질문의 중심이 생길 가능성'이 높은 순서대로 최대 ${MAX_DIAGNOSTIC_PAIRS}쌍을 반환한다.`,
    "이 요청은 진단용이다. 1위만 예쁘게 고르지 말고, 실제로 고려한 상위 후보들을 순서대로 보여준다. 약한 후보도 상위권이라면 숨기지 말고 낮은 점수를 그대로 준다.",
    "같은 단어·주제·출처·기록이라는 이유만으로 점수를 높이지 않는다.",
    "서로 다른 시점의 기준 변화, 같은 대상의 상반된 효과, 실제로 드러난 가치·선택·행동의 긴장, 두 기록 사이에서만 보이는 관계를 우선한다.",
    "각 쌍마다 pairCheck를 반드시 별도로 수행한다.",
    "A만 남기고 B를 가렸다고 생각한다. A 하나만으로도 거의 같은 중심의 질문을 만들 수 있으면 worksFromAAlone=true다.",
    "B만 남기고 A를 가렸다고 생각한다. B 하나만으로도 거의 같은 중심의 질문을 만들 수 있으면 worksFromBAlone=true다.",
    "둘 중 하나라도 true라면 requiresBoth는 원칙적으로 false이고 pairNecessity를 높게 주지 않는다.",
    "createsThirdThought는 A의 반복도 B의 반복도 아닌 새 기준·긴장·변화·통합이 두 기록의 관계에서 생길 때만 true다.",
    "A를 B의 해결책이나 해석 도구로 단순 적용하는 조합은 강한 Between 쌍이 아니다.",
    "원문에 없는 인과·공통 상황·같은 행동·새 목표·의무를 가정해야 이어지는 조합은 낮게 평가한다.",
    "색인의 inferredIntents, valuesOrNeeds, alternateReadings, visualContext는 추론일 수 있으므로 literal, keyPhrases, claims 및 evidence가 받쳐주는 경우에만 사용한다.",
    "pairNecessity와 thirdThoughtPotential의 4점은 명확한 통과 후보, 5점은 매우 강한 후보에만 준다.",
    "confidence는 이 쌍을 실제 원문 재검증 단계로 올릴 가치에 대한 확신도다. pairCheck가 약한데 confidence만 높게 주지 않는다.",
    "동일한 두 fragment 조합을 순서만 바꾸어 중복 반환하지 않는다."
  ].join("\n");
}

function normalizePair(raw, validIds) {
  const ids = Array.isArray(raw?.fragmentIds) ? raw.fragmentIds.map(String) : [];
  if (ids.length !== 2 || ids[0] === ids[1] || !ids.every((id) => validIds.has(id))) return null;
  const check = raw?.pairCheck || {};
  return {
    fragmentIds: ids,
    relation: cleanText(raw?.relation, 160),
    confidence: Math.max(0, Math.min(100, Math.round(Number(raw?.confidence || 0)))),
    pairCheck: {
      requiresBoth: check.requiresBoth === true,
      worksFromAAlone: check.worksFromAAlone === true,
      worksFromBAlone: check.worksFromBAlone === true,
      createsThirdThought: check.createsThirdThought === true,
      pairNecessity: Math.max(0, Math.min(5, Math.round(Number(check.pairNecessity || 0)))),
      thirdThoughtPotential: Math.max(0, Math.min(5, Math.round(Number(check.thirdThoughtPotential || 0)))),
      reason: cleanText(check?.reason, 700)
    }
  };
}

const betweenThoughtsScoutDiagnosticV2 = onCall({
  region: "us-central1",
  secrets: ["OPENAI_API_KEY"],
  timeoutSeconds: 180,
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
  if (candidateIds.length < 2) {
    throw new HttpsError("invalid-argument", "diagnostic에는 최소 두 개의 candidateIds가 필요합니다.");
  }

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
      readOnly: true,
      writesPerformed: 0,
      model: MODEL_ROUTES.discovery,
      candidateCount: rows.length,
      indexedCandidateCount: profiles.length,
      pairs: [],
      reason: "not-enough-existing-indexes"
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY || ""}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL_ROUTES.discovery,
      input: [
        { role: "system", content: diagnosticPrompt() },
        { role: "user", content: JSON.stringify({ mode: "between-v2-scout-diagnostic", profiles }) }
      ],
      reasoning: { effort: "medium" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "thought_garden_between_v2_scout_diagnostic",
          strict: true,
          schema: diagnosticSchema()
        }
      },
      max_output_tokens: 2800
    })
  });

  const raw = await response.text();
  let payload = null;
  try { payload = JSON.parse(raw); } catch (_) {}
  const usage = normalizeUsage(payload);
  if (!response.ok) {
    logger.error("Between v2 scout diagnostic request failed", {
      uid,
      status: response.status,
      model: MODEL_ROUTES.discovery,
      message: payload?.error?.message || raw.slice(0, 400)
    });
    throw new HttpsError("internal", "Between v2 scout diagnostic 호출에 실패했습니다.");
  }

  const text = extractResponseText(payload);
  let parsed = null;
  try { if (text) parsed = JSON.parse(text); } catch (_) {}
  if (!parsed) throw new HttpsError("internal", "Between v2 scout diagnostic 응답 형식이 올바르지 않습니다.");

  const validIds = new Set(profiles.map((profile) => profile.id));
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const seen = new Set();
  const pairs = [];
  for (const rawPair of Array.isArray(parsed?.pairs) ? parsed.pairs : []) {
    const pair = normalizePair(rawPair, validIds);
    if (!pair) continue;
    const key = pair.fragmentIds.slice().sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const a = profileMap.get(pair.fragmentIds[0]);
    const b = profileMap.get(pair.fragmentIds[1]);
    pairs.push({
      rank: pairs.length + 1,
      ...pair,
      a: { id: a.id, date: a.date, summary: a.summary },
      b: { id: b.id, date: b.date, summary: b.summary }
    });
    if (pairs.length >= MAX_DIAGNOSTIC_PAIRS) break;
  }

  logger.info("Between v2 scout diagnostic completed", {
    uid,
    candidateCount: candidateIds.length,
    indexedCandidateCount: profiles.length,
    pairCount: pairs.length,
    totalTokens: usage.totalTokens
  });

  return {
    ok: true,
    dryRun: true,
    readOnly: true,
    writesPerformed: 0,
    aiCalls: 1,
    model: MODEL_ROUTES.discovery,
    candidateCount: candidateIds.length,
    indexedCandidateCount: profiles.length,
    reason: cleanText(parsed?.reason, 600),
    pairs,
    usage
  };
});

module.exports = { betweenThoughtsScoutDiagnosticV2 };

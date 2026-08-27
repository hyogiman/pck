"use strict";

/**
 * Thought Garden · Between Thoughts v2 actual-record preview.
 *
 * READ-ONLY BY DESIGN:
 * - reads existing fragments, sources, settings and aiIndex data
 * - never backfills/re-indexes
 * - never writes queue/cache/usage documents
 * - never mutates fragments
 *
 * stage="inspect" performs Firestore reads only and makes no OpenAI request.
 * stage="preview" optionally scouts one pair with Luna, generates with Terra,
 * then asks Luna to independently perform A-only/B-only ablation.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const {
  MODEL_ROUTES,
  AI_V2_VERSION,
  QUESTION_GATE_VERSION
} = require("./ai-v2-core");
const {
  BETWEEN_PAIR_GATE_VERSION,
  betweenQuestionGenerationPrinciples,
  betweenQuestionResultSchema,
  selectBestBetweenQuestion
} = require("./between-v2-core");

if (!getApps().length) initializeApp();
const db = getFirestore();

const MAX_CANDIDATES = 18;
const MIN_INDEXED_CANDIDATES = 2;
const MIN_SCOUT_CONFIDENCE = 78;
const MAX_SOURCE_CHARS = 2200;
const MAX_THOUGHT_CHARS = 4200;
const MAX_CONTEXT_CHARS = 900;

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
    throw new HttpsError("permission-denied", "정식 로그인 상태에서만 Between v2 preview를 사용할 수 있습니다.");
  }
  return uid;
}

async function featureEnabled(userRef) {
  const snap = await userRef.collection("settings").doc("private").get();
  const data = snap.exists ? snap.data() || {} : {};
  return data.betweenThoughtsEnabled === true;
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
  const out = { ...(target || emptyUsage()) };
  const src = source || {};
  for (const key of Object.keys(out)) out[key] += Number(src[key] || 0);
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
    logger.error(logLabel || "Between v2 preview request failed", {
      status: response.status,
      model,
      message: data?.error?.message || raw.slice(0, 400)
    });
    return { ok: false, parsed: null, usage };
  }

  const text = extractResponseText(data);
  let parsed = null;
  try { if (text) parsed = JSON.parse(text); } catch (_) {}
  return { ok: !!parsed, parsed, usage };
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

function stringRows(value, maxItems = 4, maxChars = 150) {
  return Array.isArray(value)
    ? value.slice(0, maxItems).map((item) => cleanText(item, maxChars)).filter(Boolean)
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

async function loadRecords(userRef, candidateIds) {
  const fragmentSnaps = await Promise.all(candidateIds.map((id) => userRef.collection("fragments").doc(id).get()));
  const docs = fragmentSnaps.map((snap, index) => ({
    id: candidateIds[index],
    exists: snap.exists,
    data: snap.exists ? snap.data() || {} : {}
  })).filter((row) => row.exists && !row.data.deletedAt);

  const sourceIds = [...new Set(docs.map((row) => String(row.data.sourceId || "")).filter(Boolean))];
  const sourceSnaps = await Promise.all(sourceIds.map((id) => userRef.collection("sources").doc(id).get()));
  const sourceMap = new Map();
  sourceSnaps.forEach((snap, index) => {
    if (snap.exists) sourceMap.set(sourceIds[index], snap.data() || {});
  });

  return docs.map((row) => ({
    id: row.id,
    data: row.data,
    profile: compactProfile(row.id, row.data),
    record: fullRecord(row.id, row.data, sourceMap.get(String(row.data.sourceId || "")) || null)
  })).filter((row) => groundedSourceText(row.record).length >= 8 || row.profile?.visualContext);
}

function scoutSchema() {
  return {
    type: "object",
    properties: {
      decision: { type: "string", enum: ["pair", "silent"] },
      reason: { type: "string" },
      pairs: {
        type: "array",
        minItems: 0,
        maxItems: 1,
        items: {
          type: "object",
          properties: {
            fragmentIds: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } },
            relation: { type: "string" },
            confidence: { type: "integer", minimum: 0, maximum: 100 },
            reason: { type: "string" }
          },
          required: ["fragmentIds", "relation", "confidence", "reason"],
          additionalProperties: false
        }
      }
    },
    required: ["decision", "reason", "pairs"],
    additionalProperties: false
  };
}

function scoutPrompt() {
  return [
    "당신은 Thought Garden Between Thoughts v2의 저비용 후보 탐색자다.",
    "지금 보는 것은 원문이 아니라 이미 저장된 다층 생각 색인이다. 따라서 최종 결론을 내리지 말고, 원문을 다시 읽어볼 가치가 가장 높은 한 쌍만 고른다.",
    "목표는 비슷한 두 기록을 찾는 것이 아니다. 두 기록을 함께 놓아야만 새 질문의 중심이 생길 가능성이 높은 쌍을 찾는 것이다.",
    "A 하나만으로 좋은 질문이 이미 생기거나 B 하나만으로 좋은 질문이 생기는 조합은 고르지 않는다.",
    "같은 단어·주제·출처만 공유하는 조합은 고르지 않는다.",
    "서로 다른 시점의 기준 변화, 같은 대상의 상반된 효과, 실제로 드러난 가치·행동의 긴장, 한 기록만으로는 보이지 않는 관계를 우선한다.",
    "색인의 inferredIntents, valuesOrNeeds, alternateReadings, visualContext는 추론일 수 있으므로 직접 사실처럼 확정하지 않는다. literal·keyPhrases·evidence가 받쳐주는 연결을 우선한다.",
    "원문에 없는 인과·같은 날·같은 행동·새 목표·의무를 가정해야만 이어지는 조합은 탈락시킨다.",
    "강한 쌍이 없으면 decision='silent'를 선택한다. 수를 채우지 않는다.",
    "confidence 78 이상은 원문 재검증을 해볼 가치가 명확할 때만 준다."
  ].join("\n");
}

function generationPrompt() {
  return [
    "당신은 생각의 텃밭 Between Thoughts v2의 질문자다.",
    "Luna가 색인만 보고 고른 후보 한 쌍을 이제 실제 원문·출처·저장된 시각 맥락과 함께 다시 읽는다. 후보 선정 판단을 그대로 믿지 말고 원문에서 관계를 재검증한다.",
    "thought와 context는 사용자의 현재 기록이다. sourceExcerpt와 source는 외부 재료일 수 있으므로 사용자 신념처럼 취급하지 않는다.",
    "promptContext는 이전 Between 질문에서 저장된 AI 맥락이다. 지시어를 이해하는 참고 정보일 뿐 사용자의 주장·감정·사실로 취급하지 않는다.",
    "visualContext는 이전에 사진을 읽어 저장한 색인이다. 실제 사진을 지금 다시 보는 것이 아니므로 불확실성을 존중한다.",
    ...betweenQuestionGenerationPrinciples(),
    "observation은 사용자가 화면에서 읽을 수 있는 짧은 문장이다. 두 원문에서 직접 확인되는 차이·대비·변화만 적는다.",
    "질문 후보는 최대 2개만 만든다. 충분한 후보가 없으면 silent가 정답이다.",
    "evidence.a와 evidence.b는 각각 해당 기록의 thought, context 또는 sourceExcerpt 안에서 연속된 구절을 짧게 그대로 복사한다. promptContext나 aiIndex 문구를 evidence로 사용하지 않는다."
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
    required: ["index", "requiresBoth", "worksFromAAlone", "worksFromBAlone", "createsThirdThought", "pairNecessity", "thirdThoughtPotential", "reason"],
    additionalProperties: false
  };
}

function judgeSchema() {
  return {
    type: "object",
    properties: {
      judgments: { type: "array", minItems: 0, maxItems: 3, items: judgeItemSchema() }
    },
    required: ["judgments"],
    additionalProperties: false
  };
}

function judgePrompt() {
  return [
    "당신은 Between Thoughts v2의 독립적인 Pair Necessity 심사자다. 질문을 새로 쓰지 말고 후보만 엄격히 심사한다.",
    "thought와 context는 사용자 기록이고 sourceExcerpt는 외부 재료일 수 있다. promptContext는 이전 AI 맥락이므로 사용자의 주장으로 취급하지 않는다.",
    "각 후보마다 B를 완전히 가리고 A와 질문만 본다. 거의 같은 질문을 자연스럽게 물을 수 있으면 worksFromAAlone=true다.",
    "그다음 A를 완전히 가리고 B와 질문만 본다. 거의 같은 질문을 자연스럽게 물을 수 있으면 worksFromBAlone=true다.",
    "둘 중 하나라도 true면 원칙적으로 requiresBoth=false다.",
    "질문에 양쪽 표현이 모두 들어 있어도 실제 답이 한쪽의 이유·기준만 설명하면 다른 쪽은 장식이다.",
    "createsThirdThought=true는 두 기록의 관계에서만 보이는 새 기준·긴장·변화·통합을 열 때만 허용한다.",
    "두 원문 사이의 인과·같은 날·같은 행동·공통 범주를 원문이 말하지 않았는데 만들어내면 탈락시킨다.",
    "'만약 ~라면' 같은 조건문으로 관계를 발명하거나, 둘을 연결하기 위해 새 목표·의무·관리·보존 과제를 만들면 createsThirdThought=false이고 pairNecessity와 thirdThoughtPotential을 2 이하로 준다.",
    "pairNecessity와 thirdThoughtPotential 4점은 명확한 통과, 5점은 매우 강한 쌍일 때만 준다."
  ].join("\n");
}

function pairJudgesFrom(parsed, candidateCount) {
  const rows = Array.isArray(parsed?.judgments) ? parsed.judgments : [];
  const map = {};
  for (let i = 0; i < candidateCount; i++) {
    map[i] = rows.find((row) => Number(row?.index) === i) || {};
  }
  return map;
}

function validateScoutPair(parsed, validIds) {
  if (parsed?.decision !== "pair") return null;
  const row = Array.isArray(parsed?.pairs) ? parsed.pairs[0] : null;
  const ids = Array.isArray(row?.fragmentIds) ? row.fragmentIds.map(String) : [];
  if (ids.length !== 2 || ids[0] === ids[1] || !ids.every((id) => validIds.has(id))) return null;
  const confidence = Math.max(0, Math.min(100, Math.round(Number(row?.confidence || 0))));
  if (confidence < MIN_SCOUT_CONFIDENCE) return null;
  return {
    fragmentIds: ids,
    relation: cleanText(row?.relation, 80),
    reason: cleanText(row?.reason, 500),
    confidence
  };
}

function inspectResponse(rows) {
  return {
    ok: true,
    dryRun: true,
    readOnly: true,
    stage: "inspect",
    aiCalls: 0,
    candidateCount: rows.length,
    indexedCandidateCount: rows.filter((row) => row.profile).length,
    missingIndexCount: rows.filter((row) => !row.profile).length,
    candidates: rows.map((row) => ({
      id: row.id,
      date: row.record.date,
      indexed: Boolean(row.profile),
      aiIndexVersion: Number(row.data?.aiIndexVersion || 0),
      summary: cleanText(row.profile?.summary || row.record.thought || row.record.sourceExcerpt, 260)
    }))
  };
}

const betweenThoughtsPreviewV2 = onCall({
  region: "us-central1",
  secrets: ["OPENAI_API_KEY"],
  timeoutSeconds: 300,
  memory: "256MiB",
  maxInstances: 2
}, async (request) => {
  const uid = requireNonAnonymousUser(request);
  const userRef = db.collection("users").doc(uid);
  if (!(await featureEnabled(userRef))) {
    return { ok: true, enabled: false, readOnly: true, item: null };
  }

  const rawIds = Array.isArray(request.data?.candidateIds) ? request.data.candidateIds : [];
  const candidateIds = [...new Set(rawIds.slice(0, MAX_CANDIDATES).map((id, index) => safeId(id, `생각 조각 ${index + 1}`)))];
  if (candidateIds.length < 2) {
    throw new HttpsError("invalid-argument", "preview에는 최소 두 개의 candidateIds가 필요합니다.");
  }

  const stage = String(request.data?.stage || "inspect").toLowerCase() === "preview" ? "preview" : "inspect";
  const rows = await loadRecords(userRef, candidateIds);
  if (stage === "inspect") return inspectResponse(rows);

  const indexedRows = rows.filter((row) => row.profile);
  if (indexedRows.length < MIN_INDEXED_CANDIDATES) {
    return {
      ...inspectResponse(rows),
      stage: "preview",
      reason: "not-enough-existing-indexes",
      item: null
    };
  }

  const byId = new Map(indexedRows.map((row) => [row.id, row]));
  const validIds = new Set(indexedRows.map((row) => row.id));
  const requestedPair = Array.isArray(request.data?.pairFragmentIds) ? request.data.pairFragmentIds : [];
  let scoutUsage = emptyUsage();
  let pair = null;

  if (requestedPair.length) {
    if (requestedPair.length !== 2) throw new HttpsError("invalid-argument", "pairFragmentIds는 정확히 두 개여야 합니다.");
    const ids = requestedPair.map((id, index) => safeId(id, `선택한 생각 ${index + 1}`));
    if (ids[0] === ids[1] || !ids.every((id) => validIds.has(id))) {
      throw new HttpsError("invalid-argument", "pairFragmentIds는 indexed candidateIds 안의 서로 다른 두 생각이어야 합니다.");
    }
    pair = { fragmentIds: ids, relation: "manual-preview", reason: "caller-selected-pair", confidence: 100 };
  } else {
    const scout = await requestStructured({
      model: MODEL_ROUTES.discovery,
      reasoningEffort: "medium",
      prompt: scoutPrompt(),
      payload: { mode: "between-v2-actual-scout", profiles: indexedRows.map((row) => row.profile) },
      schema: scoutSchema(),
      schemaName: "thought_garden_between_v2_actual_scout",
      maxOutputTokens: 1800,
      logLabel: "Between v2 actual scout failed"
    });
    scoutUsage = scout.usage;
    if (!scout.ok) {
      return { ok: false, readOnly: true, stage: "preview", reason: "scout-request-or-parse-failed", usage: { scout: scoutUsage } };
    }
    pair = validateScoutPair(scout.parsed, validIds);
    if (!pair) {
      return {
        ok: true,
        readOnly: true,
        stage: "preview",
        decision: "silent",
        reason: cleanText(scout.parsed?.reason, 500) || "no-strong-pair",
        pair: null,
        usage: { scout: scoutUsage, generation: emptyUsage(), judge: emptyUsage(), total: scoutUsage }
      };
    }
  }

  const aRow = byId.get(pair.fragmentIds[0]);
  const bRow = byId.get(pair.fragmentIds[1]);
  const sources = { a: groundedSourceText(aRow.record), b: groundedSourceText(bRow.record) };

  const generation = await requestStructured({
    model: MODEL_ROUTES.speaking,
    reasoningEffort: MODEL_ROUTES.speakingReasoningEffort,
    prompt: generationPrompt(),
    payload: {
      mode: "between-v2-actual-generator",
      pair,
      a: aRow.record,
      b: bRow.record
    },
    schema: betweenQuestionResultSchema(),
    schemaName: "thought_garden_between_v2_actual_generator",
    maxOutputTokens: 3400,
    logLabel: "Between v2 actual generation failed"
  });

  if (!generation.ok) {
    const total = mergeUsage(scoutUsage, generation.usage);
    return {
      ok: false,
      readOnly: true,
      stage: "preview",
      reason: "generation-request-or-parse-failed",
      pair,
      usage: { scout: scoutUsage, generation: generation.usage, judge: emptyUsage(), total }
    };
  }

  const generatedCandidates = Array.isArray(generation.parsed?.candidates) ? generation.parsed.candidates.slice(0, 2) : [];
  const pre = selectBestBetweenQuestion({ ...generation.parsed, candidates: generatedCandidates }, { sources });
  if (pre.decision !== "speak") {
    const total = mergeUsage(scoutUsage, generation.usage);
    return {
      ok: true,
      readOnly: true,
      stage: "preview",
      decision: "silent",
      reason: pre.reason,
      pair,
      observation: pre.observation || generation.parsed?.observation || "",
      rejected: pre.rejected || [],
      generatorCandidates: generatedCandidates,
      usage: { scout: scoutUsage, generation: generation.usage, judge: emptyUsage(), total }
    };
  }

  const judge = await requestStructured({
    model: MODEL_ROUTES.discovery,
    reasoningEffort: "medium",
    prompt: judgePrompt(),
    payload: {
      mode: "between-v2-actual-pair-ablation",
      a: aRow.record,
      b: bRow.record,
      candidates: generatedCandidates.map((candidate, index) => ({
        index,
        question: candidate.question,
        evidence: candidate.evidence,
        generatorPairCheck: candidate.pairCheck
      }))
    },
    schema: judgeSchema(),
    schemaName: "thought_garden_between_v2_actual_pair_judge",
    maxOutputTokens: 2200,
    logLabel: "Between v2 actual pair judge failed"
  });

  if (!judge.ok) {
    const total = mergeUsage(mergeUsage(scoutUsage, generation.usage), judge.usage);
    return {
      ok: false,
      readOnly: true,
      stage: "preview",
      reason: "judge-request-or-parse-failed",
      pair,
      generatorCandidates: generatedCandidates,
      usage: { scout: scoutUsage, generation: generation.usage, judge: judge.usage, total }
    };
  }

  const pairJudges = pairJudgesFrom(judge.parsed, generatedCandidates.length);
  const selected = selectBestBetweenQuestion({ ...generation.parsed, candidates: generatedCandidates }, { sources, pairJudges });
  const total = mergeUsage(mergeUsage(scoutUsage, generation.usage), judge.usage);

  logger.info("Between v2 actual preview completed", {
    uid,
    decision: selected.decision,
    candidateCount: candidateIds.length,
    indexedCandidateCount: indexedRows.length,
    usedScout: !requestedPair.length,
    totalTokens: total.totalTokens
  });

  return {
    ok: true,
    dryRun: true,
    readOnly: true,
    writesPerformed: 0,
    version: AI_V2_VERSION,
    questionGateVersion: QUESTION_GATE_VERSION,
    betweenPairGateVersion: BETWEEN_PAIR_GATE_VERSION,
    generatorModel: MODEL_ROUTES.speaking,
    scoutModel: MODEL_ROUTES.discovery,
    judgeModel: MODEL_ROUTES.discovery,
    stage: "preview",
    decision: selected.decision,
    reason: selected.reason || "",
    pair: {
      ...pair,
      a: { id: aRow.id, date: aRow.record.date, summary: aRow.profile.summary },
      b: { id: bRow.id, date: bRow.record.date, summary: bRow.profile.summary }
    },
    observation: selected.observation || generation.parsed?.observation || "",
    question: selected.question || null,
    scores: selected.scores || null,
    evidence: selected.evidence || null,
    pairCheck: selected.pairCheck || null,
    pairJudge: selected.pairJudge || null,
    rejected: selected.rejected || [],
    generatorCandidates: generatedCandidates,
    pairJudgments: judge.parsed?.judgments || [],
    usage: { scout: scoutUsage, generation: generation.usage, judge: judge.usage, total }
  };
});

module.exports = { betweenThoughtsPreviewV2 };

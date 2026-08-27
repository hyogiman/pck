"use strict";

/**
 * Thought Garden · Between Thoughts v2 queue contract helpers.
 * Dependency-free so queue semantics can be regression-tested without Firebase.
 */

const BETWEEN_V2_QUEUE_SCHEMA_VERSION = 4;
const BETWEEN_V2_MAX_PENDING_PAIRS = 3;

function cleanText(value, max = 700) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function pairIds(value) {
  const ids = Array.isArray(value?.fragmentIds) ? value.fragmentIds.map(String).filter(Boolean) : [];
  return ids.length === 2 && ids[0] !== ids[1] ? ids : [];
}

function pairKey(value) {
  const ids = Array.isArray(value) ? value.map(String).filter(Boolean) : pairIds(value);
  return ids.length === 2 && ids[0] !== ids[1] ? [...ids].sort().join("|") : "";
}

function uniquePairKeys(values, max = 80) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => {
    if (Array.isArray(value)) return pairKey(value);
    if (value && typeof value === "object") return pairKey(value);
    return String(value || "").trim().slice(0, 180);
  }).filter(Boolean))].slice(-max);
}

function normalizePendingPair(raw, validIds = null, excludedKeys = null) {
  const ids = pairIds(raw);
  if (!ids.length) return null;
  if (validIds && !ids.every((id) => validIds.has(id))) return null;
  const key = pairKey(ids);
  if (excludedKeys && excludedKeys.has(key)) return null;
  return {
    ...raw,
    fragmentIds: ids,
    relation: cleanText(raw?.relation, 220),
    confidence: Math.max(0, Math.min(100, Math.round(Number(raw?.confidence || raw?.originalConfidence || 0)))),
    originalConfidence: Math.max(0, Math.min(100, Math.round(Number(raw?.originalConfidence || raw?.confidence || 0)))),
    supportCount: Math.max(0, Math.round(Number(raw?.supportCount || 0)))
  };
}

function normalizeActiveItem(raw, validIds = null, excludedKeys = null) {
  const item = normalizePendingPair(raw, validIds, excludedKeys);
  if (!item) return null;
  const question = cleanText(raw?.question, 420);
  if (!question) return null;
  return {
    ...item,
    bridgeType: cleanText(raw?.bridgeType, 40) || "meaning",
    bridge: cleanText(raw?.bridge, 620),
    reason: cleanText(raw?.reason, 700),
    question,
    sourceUsed: Boolean(raw?.sourceUsed)
  };
}

function normalizePendingPairs(values, validIds = null, excludedKeys = null, max = BETWEEN_V2_MAX_PENDING_PAIRS) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const pair = normalizePendingPair(raw, validIds, excludedKeys);
    if (!pair) continue;
    const key = pairKey(pair);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(pair);
    if (out.length >= max) break;
  }
  return out;
}

function itemFromPreview(preview, pair) {
  if (!preview?.ok || preview?.decision !== "speak" || !cleanText(preview?.question, 420)) return null;
  const ids = pairIds(pair);
  if (!ids.length) return null;
  return {
    fragmentIds: ids,
    bridgeType: "meaning",
    bridge: cleanText(preview?.observation || pair?.relation || pair?.originalPairCheck?.reason || pair?.pairCheck?.reason, 620),
    reason: cleanText(pair?.originalPairCheck?.reason || pair?.relation || preview?.reason, 700),
    question: cleanText(preview.question, 420),
    confidence: Math.max(0, Math.min(100, Math.round(Number(pair?.originalConfidence || pair?.confidence || 0)))),
    sourceUsed: Boolean(preview?.evidence?.a || preview?.evidence?.b),
    engineVersion: 2,
    questionGateVersion: Number(preview?.questionGateVersion || 0),
    betweenPairGateVersion: Number(preview?.betweenPairGateVersion || 0),
    scoutPairCheck: pair?.scoutPairCheck || pair?.pairCheck || null,
    originalPairCheck: pair?.originalPairCheck || null,
    generatorPairCheck: preview?.pairCheck || null,
    pairJudge: preview?.pairJudge || null
  };
}

function queueResponse({ activeItem = null, pendingPairs = [], curationId = "", model = "", noPairReason = "", generatedAtMs = 0, cached = true, weakPairSkipped = false, errorMessage = "" } = {}) {
  return {
    ok: true,
    enabled: true,
    cached: Boolean(cached),
    item: activeItem || null,
    items: activeItem ? [activeItem] : [],
    pendingCount: Math.max(0, Array.isArray(pendingPairs) ? pendingPairs.length : 0),
    curationId: String(curationId || ""),
    model: String(model || ""),
    noPairReason: String(noPairReason || ""),
    generatedAtMs: Number(generatedAtMs || 0),
    weakPairSkipped: Boolean(weakPairSkipped),
    errorMessage: String(errorMessage || ""),
    queueSchemaVersion: BETWEEN_V2_QUEUE_SCHEMA_VERSION,
    engineVersion: 2
  };
}

module.exports = {
  BETWEEN_V2_QUEUE_SCHEMA_VERSION,
  BETWEEN_V2_MAX_PENDING_PAIRS,
  pairIds,
  pairKey,
  uniquePairKeys,
  normalizePendingPair,
  normalizePendingPairs,
  normalizeActiveItem,
  itemFromPreview,
  queueResponse
};

"use strict";

const assert = require("node:assert/strict");
const {
  BETWEEN_V2_QUEUE_SCHEMA_VERSION,
  BETWEEN_V2_MAX_PENDING_PAIRS,
  pairKey,
  uniquePairKeys,
  normalizePendingPairs,
  normalizeActiveItem,
  itemFromPreview,
  queueResponse
} = require("./between-v2-queue-core");

assert.equal(BETWEEN_V2_QUEUE_SCHEMA_VERSION, 4);
assert.equal(BETWEEN_V2_MAX_PENDING_PAIRS, 3);
assert.equal(pairKey(["b", "a"]), "a|b");
assert.deepEqual(uniquePairKeys(["b|a", "a|b", ["d", "c"]]), ["b|a", "a|b", "c|d"]);

const validIds = new Set(["a", "b", "c", "d"]);
const excluded = new Set(["c|d"]);
const pending = normalizePendingPairs([
  { fragmentIds: ["a", "b"], relation: "first", originalConfidence: 88 },
  { fragmentIds: ["b", "a"], relation: "duplicate", originalConfidence: 90 },
  { fragmentIds: ["c", "d"], relation: "excluded", originalConfidence: 99 },
  { fragmentIds: ["a", "x"], relation: "missing", originalConfidence: 99 }
], validIds, excluded, 3);
assert.equal(pending.length, 1);
assert.equal(pairKey(pending[0]), "a|b");

assert.equal(normalizeActiveItem({ fragmentIds: ["a", "b"], question: "" }, validIds, new Set()), null);
const active = normalizeActiveItem({ fragmentIds: ["a", "b"], question: "두 기록을 같이 보면 무엇이 달라지나요?", bridge: "연결" }, validIds, new Set());
assert.equal(active.question, "두 기록을 같이 보면 무엇이 달라지나요?");

const item = itemFromPreview({
  ok: true,
  decision: "speak",
  question: "지금 기록은 어떤 자리를 차지하고 있나요?",
  observation: "과거에는 기록하고 싶었고 지금은 틈이 없다.",
  questionGateVersion: 4,
  betweenPairGateVersion: 1,
  pairCheck: { requiresBoth: true },
  pairJudge: { requiresBoth: true },
  evidence: { a: "A", b: "B" }
}, {
  fragmentIds: ["a", "b"],
  originalConfidence: 92,
  originalPairCheck: { requiresBoth: true },
  scoutPairCheck: { requiresBoth: true }
});
assert.equal(item.engineVersion, 2);
assert.equal(item.questionGateVersion, 4);
assert.equal(item.betweenPairGateVersion, 1);
assert.equal(item.confidence, 92);
assert.equal(item.fragmentIds.length, 2);

assert.equal(itemFromPreview({ ok: true, decision: "silent", question: null }, { fragmentIds: ["a", "b"] }), null);

const response = queueResponse({ activeItem: item, pendingPairs: pending, curationId: "cur", model: "terra", generatedAtMs: 123 });
assert.equal(response.item.question, item.question);
assert.equal(response.pendingCount, 1);
assert.equal(response.queueSchemaVersion, 4);
assert.equal(response.engineVersion, 2);

console.log("BETWEEN_V2_QUEUE_CORE_TEST_PASS");

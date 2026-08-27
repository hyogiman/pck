"use strict";

const assert = require("node:assert/strict");

const {
  buildStudioRetrievalQuery,
  collectExcludedFragmentIds,
  rankStudioRetrievalCandidates
} = require("./studio-gardener-v2-retrieval");

const context = {
  projectTitle: "자유롭게 일하는 삶",
  targetSlotTitle: "3. 나의 해석",
  targetSlotPurpose: "앞의 경험을 연결해 내가 무엇을 다르게 보게 됐는지 쓴다.",
  targetSlotGuide: "이미 적은 이유를 반복하지 않고 관점 변화를 찾는다.",
  threadTitle: "회사와 자유",
  threadQuestion: "나는 어떤 방식으로 일하고 싶은가?",
  currentDraft:
    "회사 일이 싫다기보다 내가 정하지 않은 일을 계속 처리해야 한다는 점에서 지친다.",
  previousSlots: [
    { id: "hook", title: "여는 글", text: "퇴근하면 아무것도 하기 싫다고 생각했다." },
    { id: "experience", title: "나의 경험", text: "그런데 집에 오면 개인 프로젝트는 다시 시작했다." }
  ],
  materials: [
    { id: "already-in-context" }
  ],
  attachedMaterialIds: ["attached-1"],
  startingMaterialIds: ["starting-1"],
  threadMaterialIds: ["thread-1"],
  excludedFragmentIds: ["manual-exclude"]
};

// 1. Retrieval query should center the user's current draft while preserving
// enough Studio structure to search meaningfully.
const query = buildStudioRetrievalQuery(context);

assert.ok(query.includes("내가 정하지 않은 일을 계속 처리해야 한다"));
assert.ok(query.includes("자유롭게 일하는 삶"));
assert.ok(query.includes("나는 어떤 방식으로 일하고 싶은가"));
assert.ok(query.includes("개인 프로젝트는 다시 시작했다"));

// 2. Everything already present in the Studio context must be excluded from
// cross-garden retrieval.
const excluded = collectExcludedFragmentIds(context);

for (const id of [
  "already-in-context",
  "attached-1",
  "starting-1",
  "thread-1",
  "manual-exclude"
]) {
  assert.equal(excluded.has(id), true, id);
}

// 3. Vector candidates are filtered by deletion, distance and current-context
// duplication, then ranked by semantic closeness.
const ranked = rankStudioRetrievalCandidates([
  { id: "far-away", distance: 0.81 },
  { id: "good-b", distance: 0.24 },
  { id: "good-a", distance: 0.12 },
  { id: "thread-1", distance: 0.01 },
  { id: "deleted-one", distance: 0.03, deletedAt: "2026-01-01" },
  { id: "invalid-distance", distance: "oops" }
], context);

assert.deepEqual(
  ranked.map((row) => row.id),
  ["good-a", "good-b"]
);

// 4. A direct continuation of a Fragment already in the Studio context should
// not be redundantly surfaced as a cross-garden discovery.
const lineageFiltered = rankStudioRetrievalCandidates([
  {
    id: "child-of-existing",
    distance: 0.05,
    continuedFrom: ["already-in-context"]
  },
  {
    id: "independent",
    distance: 0.20
  }
], context);

assert.deepEqual(
  lineageFiltered.map((row) => row.id),
  ["independent"]
);

// 5. Duplicate vector rows are collapsed.
const deduped = rankStudioRetrievalCandidates([
  { id: "same", distance: 0.30 },
  { id: "same", distance: 0.10 },
  { id: "other", distance: 0.25 }
], {});

assert.deepEqual(
  deduped.map((row) => row.id),
  ["other", "same"]
);

// 6. Result count is deliberately bounded before Luna sees the shortlist.
const many = Array.from({ length: 10 }, (_, i) => ({
  id: `f-${i}`,
  distance: 0.1 + i * 0.01
}));

const limited = rankStudioRetrievalCandidates(many, {});
assert.equal(limited.length, 6);

// 7. Empty Studio context should produce no fake retrieval query.
assert.equal(buildStudioRetrievalQuery({}), "");

console.log("STUDIO_GARDENER_V2_RETRIEVAL_TEST_PASS");
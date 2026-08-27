"use strict";

const { cleanText } = require("./ai-v2-core");

const STUDIO_RETRIEVAL_VERSION = 1;
const STUDIO_RETRIEVAL_MAX_DISTANCE = 0.65;
const STUDIO_RETRIEVAL_RESULT_LIMIT = 6;
const STUDIO_RETRIEVAL_QUERY_MAX_CHARS = 7000;

function clip(value, max) {
  return cleanText(value, max);
}

function buildStudioRetrievalQuery(context = {}) {
  const blocks = [];

  const add = (label, value, max) => {
    const text = clip(value, max);
    if (text) blocks.push(`${label}:\n${text}`);
  };

  // 현재 사용자가 쓰고 있는 초안이 검색의 중심이다.
  add("현재 작성 중인 내용", context.currentDraft, 3500);

  // 초안이 짧거나 비어 있을 때 구조적 맥락이 방향을 보완한다.
  add("프로젝트 제목", context.projectTitle, 500);
  add("현재 문항", context.targetSlotTitle, 300);
  add("현재 문항의 역할", context.targetSlotPurpose, 600);
  add("현재 문항 가이드", context.targetSlotGuide, 900);

  add("Thread 제목", context.threadTitle, 400);
  add("Thread 질문", context.threadQuestion, 700);

  const previous = Array.isArray(context.previousSlots)
    ? context.previousSlots.slice(-4)
    : [];

  previous.forEach((slot, index) => {
    const title = clip(slot?.title || slot?.id, 200);
    const text = clip(slot?.text, 1100);
    if (!text) return;
    blocks.push(
      `앞서 작성한 칸 ${index + 1}${title ? ` · ${title}` : ""}:\n${text}`
    );
  });

  return blocks.join("\n\n").slice(0, STUDIO_RETRIEVAL_QUERY_MAX_CHARS).trim();
}

function materialId(row) {
  return String(row?.id || row?.fragmentId || "").trim();
}

function collectExcludedFragmentIds(context = {}) {
  const ids = new Set();

  const add = (value) => {
    const id = String(value || "").trim();
    if (id) ids.add(id);
  };

  const addArray = (values) => {
    if (!Array.isArray(values)) return;
    values.forEach(add);
  };

  // 이미 Studio context 안에 들어온 재료는 cross-garden 검색에서 다시
  // 뽑지 않는다. 같은 Fragment를 두 경로로 반복 전달할 이유가 없다.
  if (Array.isArray(context.materials)) {
    context.materials.forEach((row) => add(materialId(row)));
  }

  addArray(context.attachedMaterialIds);
  addArray(context.startingMaterialIds);
  addArray(context.threadMaterialIds);
  addArray(context.excludedFragmentIds);

  return ids;
}

function normalizeRetrievalRow(row) {
  const id = materialId(row);
  const distance = Number(row?.distance ?? row?.vectorDistance);

  return {
    id,
    distance,
    deleted: row?.deleted === true || !!row?.deletedAt,
    sourceId: String(row?.sourceId || ""),
    threadIds: Array.isArray(row?.threadIds)
      ? row.threadIds.map(String).filter(Boolean)
      : [],
    continuedFrom: Array.isArray(row?.continuedFrom)
      ? row.continuedFrom.map(String).filter(Boolean)
      : []
  };
}

function rankStudioRetrievalCandidates(
  rows,
  context = {},
  options = {}
) {
  const maxDistance = Number.isFinite(Number(options.maxDistance))
    ? Number(options.maxDistance)
    : STUDIO_RETRIEVAL_MAX_DISTANCE;

  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Math.min(12, Math.floor(Number(options.limit))))
    : STUDIO_RETRIEVAL_RESULT_LIMIT;

  const excluded = collectExcludedFragmentIds(context);
  const seen = new Set();
  const accepted = [];

  for (const raw of Array.isArray(rows) ? rows : []) {
    const row = normalizeRetrievalRow(raw);

    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);

    if (row.deleted) continue;
    if (excluded.has(row.id)) continue;
    if (!Number.isFinite(row.distance)) continue;
    if (row.distance < 0 || row.distance > maxDistance) continue;

    // 이미 Studio에 들어온 Fragment의 직접 후속 기록이라면, 거의 같은
    // 맥락을 중복해서 끌어올 가능성이 높으므로 cross-garden 후보에서는 제외.
    if (row.continuedFrom.some((id) => excluded.has(id))) continue;

    accepted.push({
      id: row.id,
      distance: row.distance,
      score: Math.max(0, 1 - row.distance),
      sourceId: row.sourceId,
      threadIds: row.threadIds
    });
  }

  accepted.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id.localeCompare(b.id);
  });

  return accepted.slice(0, limit);
}

module.exports = {
  STUDIO_RETRIEVAL_VERSION,
  STUDIO_RETRIEVAL_MAX_DISTANCE,
  STUDIO_RETRIEVAL_RESULT_LIMIT,
  STUDIO_RETRIEVAL_QUERY_MAX_CHARS,
  buildStudioRetrievalQuery,
  collectExcludedFragmentIds,
  normalizeRetrievalRow,
  rankStudioRetrievalCandidates
};
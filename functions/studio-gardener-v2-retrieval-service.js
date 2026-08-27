"use strict";

const { cleanText } = require("./ai-v2-core");
const {
  STUDIO_RETRIEVAL_VERSION,
  STUDIO_RETRIEVAL_RESULT_LIMIT,
  buildStudioRetrievalQuery,
  rankStudioRetrievalCandidates
} = require("./studio-gardener-v2-retrieval");

function fragmentId(row) {
  return String(row?.id || row?.fragmentId || "").trim();
}

function validVector(value) {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every((n) => Number.isFinite(Number(n)));
}

function compactRetrievedFragment(row) {
  const id = fragmentId(row);
  if (!id || row?.deleted === true || row?.deletedAt) return null;

  const thought = cleanText(row?.thought || row?.text, 5200);
  const context = cleanText(row?.context, 1400);
  const sourceExcerpt = cleanText(row?.externalText || row?.sourceExcerpt, 2400);

  if (!thought && !context && !sourceExcerpt) return null;

  return {
    id,
    date: cleanText(row?.date || row?.createdAt, 80),
    thought,
    context,
    sourceExcerpt,
    locator: cleanText(row?.locator, 220),
    sourceId: cleanText(row?.sourceId, 220),
    threadIds: Array.isArray(row?.threadIds)
      ? row.threadIds.map(String).filter(Boolean).slice(0, 12)
      : [],
    continuedFrom: Array.isArray(row?.continuedFrom)
      ? row.continuedFrom.map(String).filter(Boolean).slice(0, 12)
      : []
  };
}

/**
 * Pure orchestration around cross-garden retrieval.
 *
 * External work is injected:
 * - embedQuery(query): returns { vector, inputTokens? }
 * - vectorSearch(vector, options): returns candidate rows with id + distance
 * - loadFragments(ids): returns actual Fragment rows
 *
 * This module itself knows nothing about Firebase or OpenAI.
 */
async function retrieveStudioGardenMaterials({
  context = {},
  embedQuery,
  vectorSearch,
  loadFragments,
  limit = STUDIO_RETRIEVAL_RESULT_LIMIT
} = {}) {
  if (typeof embedQuery !== "function") {
    throw new TypeError("embedQuery adapter is required");
  }
  if (typeof vectorSearch !== "function") {
    throw new TypeError("vectorSearch adapter is required");
  }
  if (typeof loadFragments !== "function") {
    throw new TypeError("loadFragments adapter is required");
  }

  const query = buildStudioRetrievalQuery(context);

  // No meaningful Studio context means no embedding call at all.
  if (!query) {
    return {
      ok: true,
      reason: "empty-query",
      retrievalVersion: STUDIO_RETRIEVAL_VERSION,
      queryChars: 0,
      embeddingInputTokens: 0,
      candidateCount: 0,
      materials: []
    };
  }

  const embeddingResult = await embedQuery(query);
  const vector = Array.isArray(embeddingResult)
    ? embeddingResult
    : embeddingResult?.vector;

  if (!validVector(vector)) {
    throw new Error("Studio retrieval embedding returned invalid vector");
  }

  const rawRows = await vectorSearch(vector.map(Number), {
    // Ask Firestore for a wider cheap vector shortlist; deterministic gates
    // below reduce it before any Luna planner sees it.
    limit: 18
  });

  const ranked = rankStudioRetrievalCandidates(
    rawRows,
    context,
    { limit }
  );

  if (!ranked.length) {
    return {
      ok: true,
      reason: "no-related-materials",
      retrievalVersion: STUDIO_RETRIEVAL_VERSION,
      queryChars: query.length,
      embeddingInputTokens: Number(embeddingResult?.inputTokens || 0),
      candidateCount: 0,
      materials: []
    };
  }

  const ids = ranked.map((row) => row.id);
  const loaded = await loadFragments(ids);
  const byId = new Map();

  for (const raw of Array.isArray(loaded) ? loaded : []) {
    const material = compactRetrievedFragment(raw);
    if (material) byId.set(material.id, material);
  }

  // Preserve semantic ranking after the full original records are loaded.
  const materials = ranked
    .map((rank) => {
      const material = byId.get(rank.id);
      if (!material) return null;

      return {
        ...material,
        retrieval: {
          distance: rank.distance,
          score: rank.score
        }
      };
    })
    .filter(Boolean);

  return {
    ok: true,
    reason: materials.length ? "related-materials-found" : "ranked-materials-unavailable",
    retrievalVersion: STUDIO_RETRIEVAL_VERSION,
    queryChars: query.length,
    embeddingInputTokens: Number(embeddingResult?.inputTokens || 0),
    candidateCount: ranked.length,
    materials
  };
}

module.exports = {
  validVector,
  compactRetrievedFragment,
  retrieveStudioGardenMaterials
};
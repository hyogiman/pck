"use strict";

const EMBEDDING_MODEL = "text-embedding-3-small";

function positiveLimit(value, fallback = 18) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

function createOpenAiEmbeddingAdapter({
  apiKey,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!String(apiKey || "").trim()) {
    throw new TypeError("OpenAI API key is required");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetch adapter is required");
  }

  return async function embedQuery(query) {
    const input = String(query || "").trim();
    if (!input) {
      throw new TypeError("embedding query is required");
    }

    const response = await fetchImpl(
      "https://api.openai.com/v1/embeddings",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: [input],
          encoding_format: "float"
        })
      }
    );

    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }

    if (!response.ok) {
      const error = new Error("OpenAI embedding request failed");
      error.status = Number(response.status || 0);
      error.code = payload?.error?.code || "";
      throw error;
    }

    const rows = Array.isArray(payload?.data)
      ? payload.data
      : [];

    if (rows.length !== 1) {
      throw new Error("OpenAI embedding response size mismatch");
    }

    const vector = rows[0]?.embedding;

    if (
      !Array.isArray(vector) ||
      !vector.length ||
      vector.some((value) => !Number.isFinite(Number(value)))
    ) {
      throw new Error("OpenAI embedding returned invalid vector");
    }

    return {
      vector: vector.map(Number),
      inputTokens: Number(payload?.usage?.total_tokens || 0),
      model: EMBEDDING_MODEL
    };
  };
}

function createFirestoreVectorSearchAdapter({
  db,
  uid
} = {}) {
  if (!db || typeof db.collection !== "function") {
    throw new TypeError("Firestore db is required");
  }

  const userId = String(uid || "").trim();
  if (!userId) {
    throw new TypeError("uid is required");
  }

  return async function vectorSearch(vector, options = {}) {
    if (
      !Array.isArray(vector) ||
      !vector.length ||
      vector.some((value) => !Number.isFinite(Number(value)))
    ) {
      throw new TypeError("valid query vector is required");
    }

    const limit = positiveLimit(options.limit, 18);

    const col = db
      .collection("users")
      .doc(userId)
      .collection("fragments");

    const snap = await col.findNearest({
      vectorField: "embedding",
      queryVector: vector.map(Number),
      limit,
      distanceMeasure: "COSINE",
      distanceResultField: "vectorDistance"
    }).get();

    const rows = [];

    snap.forEach((doc) => {
      const data = doc.data() || {};

      rows.push({
        id: doc.id,
        distance: Number(data.vectorDistance),
        deletedAt: data.deletedAt || null,
        sourceId: String(data.sourceId || ""),
        threadIds: Array.isArray(data.threadIds)
          ? data.threadIds.map(String).filter(Boolean)
          : [],
        continuedFrom: Array.isArray(data.continuedFrom)
          ? data.continuedFrom.map(String).filter(Boolean)
          : []
      });
    });

    return rows;
  };
}

function createFirestoreFragmentLoader({
  db,
  uid
} = {}) {
  if (!db || typeof db.collection !== "function") {
    throw new TypeError("Firestore db is required");
  }

  const userId = String(uid || "").trim();
  if (!userId) {
    throw new TypeError("uid is required");
  }

  return async function loadFragments(ids) {
    const unique = [
      ...new Set(
        (Array.isArray(ids) ? ids : [])
          .map(String)
          .map((id) => id.trim())
          .filter(Boolean)
      )
    ];

    if (!unique.length) return [];

    const col = db
      .collection("users")
      .doc(userId)
      .collection("fragments");

    const refs = unique.map((id) => col.doc(id));
    const docs = await db.getAll(...refs);

    const rows = [];

    docs.forEach((doc) => {
      if (!doc?.exists) return;

      rows.push({
        id: doc.id,
        ...(doc.data() || {})
      });
    });

    return rows;
  };
}

function createStudioRetrievalAdapters({
  db,
  uid,
  apiKey,
  fetchImpl = globalThis.fetch
} = {}) {
  return {
    embedQuery: createOpenAiEmbeddingAdapter({
      apiKey,
      fetchImpl
    }),
    vectorSearch: createFirestoreVectorSearchAdapter({
      db,
      uid
    }),
    loadFragments: createFirestoreFragmentLoader({
      db,
      uid
    })
  };
}

module.exports = {
  EMBEDDING_MODEL,
  positiveLimit,
  createOpenAiEmbeddingAdapter,
  createFirestoreVectorSearchAdapter,
  createFirestoreFragmentLoader,
  createStudioRetrievalAdapters
};
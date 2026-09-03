"use strict";

const assert = require("node:assert/strict");

const {
  EMBEDDING_MODEL,
  createOpenAiEmbeddingAdapter,
  createFirestoreVectorSearchAdapter,
  createFirestoreFragmentLoader,
  createStudioRetrievalAdapters
} = require("./studio-gardener-v2-retrieval-adapters");

(async () => {

  // 1. Embedding adapter builds the same request shape as the existing app.
  let fetchCalls = 0;

  const embed = createOpenAiEmbeddingAdapter({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      fetchCalls++;

      assert.equal(
        url,
        "https://api.openai.com/v1/embeddings"
      );

      assert.equal(options.method, "POST");

      const body = JSON.parse(options.body);

      assert.equal(
        body.model,
        "text-embedding-3-small"
      );

      assert.deepEqual(
        body.input,
        ["studio retrieval query"]
      );

      assert.equal(
        body.encoding_format,
        "float"
      );

      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              index: 0,
              embedding: [0.1, -0.2, 0.3]
            }
          ],
          usage: {
            total_tokens: 11
          }
        })
      };
    }
  });

  const embedded = await embed(
    "studio retrieval query"
  );

  assert.equal(fetchCalls, 1);

  assert.deepEqual(
    embedded.vector,
    [0.1, -0.2, 0.3]
  );

  assert.equal(
    embedded.inputTokens,
    11
  );

  assert.equal(
    embedded.model,
    EMBEDDING_MODEL
  );

  // 2. HTTP errors stop cleanly.
  const failingEmbed =
    createOpenAiEmbeddingAdapter({
      apiKey: "test-key",
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        json: async () => ({
          error: {
            code: "rate_limit"
          }
        })
      })
    });

  await assert.rejects(
    failingEmbed("query"),
    (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.code, "rate_limit");
      return true;
    }
  );

  // 3. Mock Firestore vector search.
  let nearestOptions = null;

  const fakeVectorDocs = [
    {
      id: "f-a",
      data: () => ({
        vectorDistance: 0.12,
        sourceId: "s-1",
        threadIds: ["t-1"]
      })
    },
    {
      id: "f-b",
      data: () => ({
        vectorDistance: 0.30,
        continuedFrom: ["old-1"]
      })
    }
  ];

  const fakeFragmentCollection = {
    findNearest: (options) => {
      nearestOptions = options;

      return {
        get: async () => ({
          forEach: (fn) => {
            fakeVectorDocs.forEach(fn);
          }
        })
      };
    },

    doc: (id) => ({
      id,
      path: `users/u-1/fragments/${id}`
    })
  };

  const fakeDb = {
    collection: (name) => {
      assert.equal(name, "users");

      return {
        doc: (uid) => {
          assert.equal(uid, "u-1");

          return {
            collection: (sub) => {
              assert.equal(
                sub,
                "fragments"
              );

              return fakeFragmentCollection;
            }
          };
        }
      };
    },

    getAll: async (...refs) => {
      return refs.map((ref) => ({
        exists: ref.id !== "missing",
        id: ref.id,
        data: () => ({
          thought: `thought-${ref.id}`,
          context: `context-${ref.id}`
        })
      }));
    }
  };

  const search =
    createFirestoreVectorSearchAdapter({
      db: fakeDb,
      uid: "u-1"
    });

  const searchRows = await search(
    [0.1, 0.2, 0.3],
    { limit: 18 }
  );

  assert.equal(
    nearestOptions.vectorField,
    "embedding"
  );

  assert.deepEqual(
    nearestOptions.queryVector,
    [0.1, 0.2, 0.3]
  );

  assert.equal(
    nearestOptions.limit,
    18
  );

  assert.equal(
    nearestOptions.distanceMeasure,
    "COSINE"
  );

  assert.equal(
    nearestOptions.distanceResultField,
    "vectorDistance"
  );

  assert.deepEqual(
    searchRows.map((row) => row.id),
    ["f-a", "f-b"]
  );

  assert.equal(
    searchRows[0].distance,
    0.12
  );

  assert.deepEqual(
    searchRows[1].continuedFrom,
    ["old-1"]
  );

  // 4. Loader uses getAll and skips missing documents.
  const load =
    createFirestoreFragmentLoader({
      db: fakeDb,
      uid: "u-1"
    });

  const loaded = await load([
    "f-a",
    "missing",
    "f-b",
    "f-a"
  ]);

  assert.deepEqual(
    loaded.map((row) => row.id),
    ["f-a", "f-b"]
  );

  assert.equal(
    loaded[0].thought,
    "thought-f-a"
  );

  // 5. Factory wires all three adapters without executing them.
  const adapters =
    createStudioRetrievalAdapters({
      db: fakeDb,
      uid: "u-1",
      apiKey: "test-key",
      fetchImpl: async () => {
        throw new Error(
          "factory test must not call fetch"
        );
      }
    });

  assert.equal(
    typeof adapters.embedQuery,
    "function"
  );

  assert.equal(
    typeof adapters.vectorSearch,
    "function"
  );

  assert.equal(
    typeof adapters.loadFragments,
    "function"
  );

  console.log(
    "STUDIO_GARDENER_V2_RETRIEVAL_ADAPTERS_TEST_PASS"
  );

})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
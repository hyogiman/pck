"use strict";

const assert = require("node:assert/strict");

const {
  validVector,
  compactRetrievedFragment,
  retrieveStudioGardenMaterials
} = require("./studio-gardener-v2-retrieval-service");

(async () => {

  // 1. Vector validation
  assert.equal(validVector([0.1, 0.2, -0.4]), true);
  assert.equal(validVector([]), false);
  assert.equal(validVector([0.1, "oops"]), false);

  // 2. Full Fragment fields stay separated.
  const compact = compactRetrievedFragment({
    id: "f-1",
    date: "2026-08-20",
    thought: "I want work that I can choose for myself.",
    context: "A thought after working on a personal project.",
    externalText: "Freedom includes responsibility.",
    sourceId: "book-1",
    threadIds: ["t-1"]
  });

  assert.equal(compact.id, "f-1");
  assert.ok(compact.thought.includes("choose for myself"));
  assert.equal(compact.sourceExcerpt, "Freedom includes responsibility.");
  assert.deepEqual(compact.threadIds, ["t-1"]);

  // 3. Empty context must not call embedding/search/load.
  let emptyEmbedCalls = 0;
  let emptySearchCalls = 0;
  let emptyLoadCalls = 0;

  const empty = await retrieveStudioGardenMaterials({
    context: {},
    embedQuery: async () => {
      emptyEmbedCalls++;
      return { vector: [1, 0] };
    },
    vectorSearch: async () => {
      emptySearchCalls++;
      return [];
    },
    loadFragments: async () => {
      emptyLoadCalls++;
      return [];
    }
  });

  assert.equal(empty.reason, "empty-query");
  assert.equal(emptyEmbedCalls, 0);
  assert.equal(emptySearchCalls, 0);
  assert.equal(emptyLoadCalls, 0);

  // 4. Normal path:
  // one embedding -> one vector search -> shortlist load.
  const calls = {
    embed: 0,
    search: 0,
    load: 0,
    loadedIds: null
  };

  const context = {
    projectTitle: "Work I can choose",
    currentDraft:
      "I am tired not because I hate work itself, but because I keep handling work I did not choose.",
    materials: [
      { id: "already-used" }
    ]
  };

  const result = await retrieveStudioGardenMaterials({
    context,

    embedQuery: async (query) => {
      calls.embed++;
      assert.ok(query.includes("work I did not choose"));

      return {
        vector: [0.12, -0.5, 0.88],
        inputTokens: 37
      };
    },

    vectorSearch: async (vector, options) => {
      calls.search++;

      assert.deepEqual(vector, [0.12, -0.5, 0.88]);
      assert.equal(options.limit, 18);

      return [
        { id: "already-used", distance: 0.01 },
        { id: "related-b", distance: 0.28 },
        { id: "related-a", distance: 0.11 },
        { id: "too-far", distance: 0.90 }
      ];
    },

    loadFragments: async (ids) => {
      calls.load++;
      calls.loadedIds = ids;

      // Opposite order on purpose.
      return [
        {
          id: "related-b",
          thought: "I feel better when I can decide where my time goes."
        },
        {
          id: "related-a",
          thought: "I once wrote that freedom means being able to choose."
        }
      ];
    }
  });

  assert.equal(calls.embed, 1);
  assert.equal(calls.search, 1);
  assert.equal(calls.load, 1);

  assert.deepEqual(
    calls.loadedIds,
    ["related-a", "related-b"]
  );

  assert.equal(result.ok, true);
  assert.equal(result.reason, "related-materials-found");
  assert.equal(result.embeddingInputTokens, 37);
  assert.equal(result.candidateCount, 2);

  assert.deepEqual(
    result.materials.map((row) => row.id),
    ["related-a", "related-b"]
  );

  assert.ok(
    result.materials[0].thought.includes("able to choose")
  );

  assert.equal(
    result.materials[0].retrieval.distance,
    0.11
  );

  // 5. Missing/deleted documents after vector search are omitted.
  const missing = await retrieveStudioGardenMaterials({
    context: {
      currentDraft: "This Studio draft has enough context for retrieval."
    },

    embedQuery: async () => ({
      vector: [0.3, 0.7],
      inputTokens: 5
    }),

    vectorSearch: async () => [
      { id: "gone", distance: 0.10 },
      { id: "deleted", distance: 0.20 },
      { id: "live", distance: 0.30 }
    ],

    loadFragments: async () => [
      {
        id: "deleted",
        deletedAt: "2026-08-01",
        thought: "Deleted record"
      },
      {
        id: "live",
        thought: "A real surviving past thought"
      }
    ]
  });

  assert.deepEqual(
    missing.materials.map((row) => row.id),
    ["live"]
  );

  // 6. No candidate means no full document load.
  let noCandidateLoads = 0;

  const none = await retrieveStudioGardenMaterials({
    context: {
      currentDraft: "Search for a related past thought."
    },

    embedQuery: async () => ({
      vector: [0.2, 0.4],
      inputTokens: 9
    }),

    vectorSearch: async () => [
      { id: "far", distance: 0.91 }
    ],

    loadFragments: async () => {
      noCandidateLoads++;
      return [];
    }
  });

  assert.equal(none.reason, "no-related-materials");
  assert.equal(noCandidateLoads, 0);

  // 7. Invalid embedding stops before vector search.
  let invalidSearchCalls = 0;

  await assert.rejects(
    retrieveStudioGardenMaterials({
      context: {
        currentDraft: "A Studio draft that can be searched."
      },

      embedQuery: async () => ({
        vector: [0.1, NaN]
      }),

      vectorSearch: async () => {
        invalidSearchCalls++;
        return [];
      },

      loadFragments: async () => []
    }),
    /invalid vector/
  );

  assert.equal(invalidSearchCalls, 0);

  console.log(
    "STUDIO_GARDENER_V2_RETRIEVAL_SERVICE_TEST_PASS"
  );

})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
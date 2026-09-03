"use strict";

const assert =
  require("node:assert/strict");

const {
  buildStudioRetrievalContext
} = require(
  "./studio-gardener-v2-retrieval-preview"
);

const project = {
  title: "Choosing my own work",
  format: "blog",
  threadId: "thread-1",

  startingFragmentIds: [
    "start-a",
    "start-b"
  ],

  slots: [
    {
      id: "hook",
      text:
        "I feel tired after company work.",
      gardenerQuestion:
        "When do you feel most tired?",
      thoughtFragmentId:
        "studio-hook"
    },

    {
      id: "experience",
      text:
        "But I still start personal projects.",
      fragmentIds: [
        "attached-a",
        "attached-a",
        "attached-b"
      ],
      thoughtFragmentId:
        "studio-experience"
    }
  ]
};

const context =
  buildStudioRetrievalContext({
    project,
    slotIndex: 1,

    threadTitle:
      "Work and autonomy",

    threadQuestion:
      "How do I want to work?",

    threadMaterialIds: [
      "thread-a",
      "thread-b"
    ]
  });

assert.equal(
  context.projectTitle,
  "Choosing my own work"
);

assert.equal(
  context.currentDraft,
  "But I still start personal projects."
);

assert.equal(
  context.previousSlots.length,
  1
);

assert.equal(
  context.previousSlots[0].id,
  "hook"
);

assert.deepEqual(
  context.attachedMaterialIds,
  [
    "attached-a",
    "attached-b"
  ]
);

assert.deepEqual(
  context.excludedFragmentIds,
  [
    "studio-hook",
    "studio-experience",
    "attached-a",
    "attached-b"
  ]
);

assert.deepEqual(
  context.startingMaterialIds,
  [
    "start-a",
    "start-b"
  ]
);

assert.deepEqual(
  context.threadMaterialIds,
  [
    "thread-a",
    "thread-b"
  ]
);

assert.equal(
  context.threadTitle,
  "Work and autonomy"
);

assert.equal(
  context.threadQuestion,
  "How do I want to work?"
);

assert.throws(
  () =>
    buildStudioRetrievalContext({
      project,
      slotIndex: 99
    }),
  /valid Studio slot index/
);

console.log(
  "STUDIO_GARDENER_V2_RETRIEVAL_PREVIEW_TEST_PASS"
);
"use strict";

// Final branch-only entry layer for the AI v2 test phase.
// It preserves every legacy + v2 runtime export and adds isolated test
// endpoints used by the private quality lab.
const runtime = require("./ai-v2-runtime-entry.js");
const { bloomingInterviewAutoPreviewV2 } = require("./blooming-v2-preview.js");
const { bloomingInterviewSyntheticEvalV2 } = require("./blooming-v2-synthetic-eval.js");
const { bloomingInterviewLifecycleTestV2 } = require("./blooming-v2-lifecycle-test.js");
const { betweenThoughtsSyntheticEvalV2 } = require("./between-v2-synthetic-eval.js");
const { betweenThoughtsPreviewV2 } = require("./between-v2-preview.js");

module.exports = {
  ...runtime,
  bloomingInterviewAutoPreviewV2,
  bloomingInterviewSyntheticEvalV2,
  bloomingInterviewLifecycleTestV2,
  betweenThoughtsSyntheticEvalV2,
  betweenThoughtsPreviewV2
};

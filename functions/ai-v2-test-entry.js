"use strict";

// Final branch-only entry layer for the AI v2 test phase.
// It preserves every legacy + v2 runtime export and adds read-only dry-run
// endpoints used by the mobile quality lab.
const runtime = require("./ai-v2-runtime-entry.js");
const { bloomingInterviewAutoPreviewV2 } = require("./blooming-v2-preview.js");
const { bloomingInterviewSyntheticEvalV2 } = require("./blooming-v2-synthetic-eval.js");

module.exports = {
  ...runtime,
  bloomingInterviewAutoPreviewV2,
  bloomingInterviewSyntheticEvalV2
};

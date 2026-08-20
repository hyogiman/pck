"use strict";

// Final branch-only entry layer for the AI v2 test phase.
// It preserves every legacy + v2 runtime export and adds one read-only dry-run
// endpoint used by the mobile quality lab.
const runtime = require("./ai-v2-runtime-entry.js");
const { bloomingInterviewAutoPreviewV2 } = require("./blooming-v2-preview.js");

module.exports = {
  ...runtime,
  bloomingInterviewAutoPreviewV2
};

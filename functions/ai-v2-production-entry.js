"use strict";

// Production entry for Thought Garden AI v2.
// Preserve every legacy Cloud Function and expose only the v2 functions
// required by the released product.
const legacy = require("./index.js");

const {
  bloomingInterviewPrepareV2,
  bloomingInterviewClaimV2,
  bloomingInterviewMarkShownV2
} = require("./blooming-v2-metered.js");

const {
  betweenThoughtsCurateV2
} = require("./between-v2-curation.js");

const {
  studioGardenerQuestionV2
} = require("./studio-gardener-v2-production.js");

const {
  studioGardenerUsageV2
} = require("./ai-v2-usage-overview.js");

module.exports = {
  ...legacy,
  bloomingInterviewPrepareV2,
  bloomingInterviewClaimV2,
  bloomingInterviewMarkShownV2,
  betweenThoughtsCurateV2,

  // Keep the public callable names unchanged while replacing
  // their V2 implementations behind the existing frontend contract.
  studioGardenerQuestion:
    studioGardenerQuestionV2,

  studioGardenerUsage:
    studioGardenerUsageV2
};

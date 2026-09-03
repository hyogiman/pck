"use strict";

// Production entry for Thought Garden AI v2.
// Preserve every legacy Cloud Function and expose only the v2 functions
// required by the released product.
const legacy = require("./index.js");

const {
  bloomingInterviewPrepareV2,
  bloomingInterviewClaimV2,
  bloomingInterviewMarkShownV2
} = require("./blooming-v2.js");

const {
  betweenThoughtsCurateV2
} = require("./between-v2-curation.js");

const {
  studioGardenerQuestionV2
} = require("./studio-gardener-v2-production.js");

module.exports = {
  ...legacy,
  bloomingInterviewPrepareV2,
  bloomingInterviewClaimV2,
  bloomingInterviewMarkShownV2,
  betweenThoughtsCurateV2,

  // Keep the public callable name unchanged while replacing
  // only the internal Studio Gardener AI engine.
  studioGardenerQuestion:
    studioGardenerQuestionV2
};

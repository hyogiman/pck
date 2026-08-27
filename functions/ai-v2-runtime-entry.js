"use strict";

// Layer the asynchronous Blooming v2 experiment on top of every existing
// production export plus the first v2 preview endpoint. Keeping this as a
// separate entry file lets the branch test new functions without rewriting the
// large legacy functions file.
const base = require("./ai-v2-entry.js");
const {
  bloomingInterviewPrepareV2,
  bloomingInterviewClaimV2,
  bloomingInterviewMarkShownV2
} = require("./blooming-v2.js");

module.exports = {
  ...base,
  bloomingInterviewPrepareV2,
  bloomingInterviewClaimV2,
  bloomingInterviewMarkShownV2
};

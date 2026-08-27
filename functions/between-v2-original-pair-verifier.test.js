"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");

// Unit-test pure gate/ranking helpers without installing Firebase modules in CI.
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "firebase-functions/v2/https") {
    return { HttpsError: class HttpsError extends Error {} };
  }
  if (request === "firebase-functions") {
    return { logger: { error() {} } };
  }
  if (request === "./ai-v2-core") {
    return { MODEL_ROUTES: { discovery: "gpt-5.6-luna" } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  MAX_ORIGINAL_PAIRS,
  originalPairGateReasons,
  passesOriginalPairGate,
  rankOriginalPairs
} = require("./between-v2-original-pair-verifier");
Module._load = originalLoad;

assert.equal(MAX_ORIGINAL_PAIRS, 5);

const strong = {
  fragmentIds: ["a", "b"],
  originalConfidence: 82,
  supportCount: 1,
  discoveryConfidence: 80,
  originalPairCheck: {
    requiresBoth: true,
    worksFromAAlone: false,
    worksFromBAlone: false,
    createsThirdThought: true,
    pairNecessity: 5,
    thirdThoughtPotential: 5
  }
};
assert.equal(passesOriginalPairGate(strong), true);
assert.deepEqual(originalPairGateReasons(strong), []);

// Actual-record regression: an index-level scout may like a pair, but if the
// original text shows A alone can support the same center, it must not reach Terra.
const falsePositive = {
  fragmentIds: ["c", "d"],
  originalConfidence: 99,
  supportCount: 2,
  discoveryConfidence: 99,
  originalPairCheck: {
    requiresBoth: false,
    worksFromAAlone: true,
    worksFromBAlone: false,
    createsThirdThought: false,
    pairNecessity: 2,
    thirdThoughtPotential: 2
  }
};
assert.equal(passesOriginalPairGate(falsePositive), false);
assert.deepEqual(originalPairGateReasons(falsePositive), [
  "pair-not-required",
  "works-from-a-alone",
  "no-third-thought",
  "low-pair-necessity",
  "low-third-thought-potential"
]);

const secondStrong = {
  fragmentIds: ["a", "e"],
  originalConfidence: 98,
  supportCount: 3,
  discoveryConfidence: 98,
  originalPairCheck: {
    requiresBoth: true,
    worksFromAAlone: false,
    worksFromBAlone: false,
    createsThirdThought: true,
    pairNecessity: 4,
    thirdThoughtPotential: 5
  }
};

const ranked = rankOriginalPairs([falsePositive, secondStrong, strong]);
assert.equal(ranked.length, 2);
assert.equal(ranked[0], strong, "original pairNecessity 5 must outrank raw confidence");
assert.equal(ranked[1], secondStrong);

console.log("BETWEEN_V2_ORIGINAL_PAIR_VERIFIER_TEST_PASS");
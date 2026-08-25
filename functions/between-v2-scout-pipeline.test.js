"use strict";

const assert = require("node:assert/strict");
const {
  MAX_COUNTERPARTS_PER_ANCHOR,
  normalizeDiscovery,
  scoutPairGateReasons,
  passesScoutPairGate,
  rankAcceptedPairs
} = require("./between-v2-scout-pipeline");

assert.equal(MAX_COUNTERPARTS_PER_ANCHOR, 2);

const validIds = new Set(["a", "b", "c", "d"]);
const discovery = normalizeDiscovery({
  matches: [
    {
      anchorId: "a",
      counterparts: [
        { counterpartId: "b", relation: "a-b", confidence: 90, reason: "ab from a" },
        { counterpartId: "c", relation: "a-c", confidence: 80, reason: "ac from a" }
      ]
    },
    {
      anchorId: "b",
      counterparts: [
        { counterpartId: "a", relation: "b-a", confidence: 92, reason: "ab from b" }
      ]
    }
  ]
}, validIds);

assert.equal(discovery.length, 2);
assert.deepEqual(new Set(discovery.map((p) => p.fragmentIds.slice().sort().join("::"))), new Set(["a::b", "a::c"]));
const ab = discovery.find((p) => p.fragmentIds.includes("a") && p.fragmentIds.includes("b"));
assert.equal(ab.supportCount, 2);
assert.equal(ab.discoveryConfidence, 92);

const strong = {
  fragmentIds: ["a", "b"],
  confidence: 86,
  discoveryConfidence: 90,
  supportCount: 1,
  pairCheck: {
    requiresBoth: true,
    worksFromAAlone: false,
    worksFromBAlone: false,
    createsThirdThought: true,
    pairNecessity: 5,
    thirdThoughtPotential: 5
  }
};
assert.equal(passesScoutPairGate(strong), true);
assert.deepEqual(scoutPairGateReasons(strong), []);

// Regression from the actual-record diagnostic: a pair must not rank merely
// because the model likes its relation when either side can support the same question alone.
const bothAlone = {
  fragmentIds: ["b", "c"],
  confidence: 93,
  discoveryConfidence: 95,
  supportCount: 2,
  pairCheck: {
    requiresBoth: true,
    worksFromAAlone: true,
    worksFromBAlone: true,
    createsThirdThought: true,
    pairNecessity: 2,
    thirdThoughtPotential: 4
  }
};
assert.equal(passesScoutPairGate(bothAlone), false);
assert.deepEqual(scoutPairGateReasons(bothAlone), ["works-from-a-alone", "works-from-b-alone", "low-pair-necessity"]);

const weakNecessity = {
  fragmentIds: ["c", "d"],
  confidence: 99,
  discoveryConfidence: 99,
  supportCount: 3,
  pairCheck: {
    requiresBoth: true,
    worksFromAAlone: false,
    worksFromBAlone: false,
    createsThirdThought: true,
    pairNecessity: 3,
    thirdThoughtPotential: 5
  }
};
assert.equal(passesScoutPairGate(weakNecessity), false);

const secondStrong = {
  fragmentIds: ["a", "d"],
  confidence: 97,
  discoveryConfidence: 97,
  supportCount: 2,
  pairCheck: {
    requiresBoth: true,
    worksFromAAlone: false,
    worksFromBAlone: false,
    createsThirdThought: true,
    pairNecessity: 4,
    thirdThoughtPotential: 5
  }
};

const ranked = rankAcceptedPairs([bothAlone, secondStrong, weakNecessity, strong]);
assert.equal(ranked.length, 2);
assert.equal(ranked[0], strong, "pairNecessity 5 must outrank 4 even when raw confidence is lower");
assert.equal(ranked[1], secondStrong);

console.log("BETWEEN_V2_SCOUT_PIPELINE_TEST_PASS");

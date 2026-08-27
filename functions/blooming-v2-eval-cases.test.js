"use strict";
const assert = require("node:assert/strict");
const { BLOOMING_SYNTHETIC_CASES, casesForMode } = require("./blooming-v2-eval-cases");

assert.equal(BLOOMING_SYNTHETIC_CASES.length, 12, "full eval must keep 12 cases unless intentionally versioned");
const ids = BLOOMING_SYNTHETIC_CASES.map((item) => item.id);
assert.equal(new Set(ids).size, ids.length, "synthetic eval IDs must be unique");
assert.ok(BLOOMING_SYNTHETIC_CASES.every((item) => ["speak", "silent"].includes(item.expectedDecision)));
assert.ok(BLOOMING_SYNTHETIC_CASES.every((item) => String(item.thought || "").trim().length >= 20));
assert.ok(BLOOMING_SYNTHETIC_CASES.every((item) => String(item.why || "").trim().length >= 10));

const smoke = casesForMode("smoke");
assert.equal(smoke.length, 6);
assert.equal(smoke.filter((item) => item.expectedDecision === "speak").length, 3);
assert.equal(smoke.filter((item) => item.expectedDecision === "silent").length, 3);

const full = casesForMode("full");
assert.equal(full.length, 12);
assert.equal(full.filter((item) => item.expectedDecision === "speak").length, 6);
assert.equal(full.filter((item) => item.expectedDecision === "silent").length, 6);

console.log("BLOOMING_V2_EVAL_CASES_TEST_PASS");

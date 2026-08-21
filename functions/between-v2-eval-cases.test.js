"use strict";

const assert = require("node:assert/strict");
const { BETWEEN_V2_SYNTHETIC_CASES, betweenCasesForMode } = require("./between-v2-eval-cases");

assert.equal(BETWEEN_V2_SYNTHETIC_CASES.length, 12, "full Between eval must keep 12 cases unless intentionally versioned");
const ids = BETWEEN_V2_SYNTHETIC_CASES.map((item) => item.id);
assert.equal(new Set(ids).size, ids.length, "Between synthetic IDs must be unique");
assert.ok(BETWEEN_V2_SYNTHETIC_CASES.every((item) => ["speak", "silent"].includes(item.expectedDecision)));
assert.ok(BETWEEN_V2_SYNTHETIC_CASES.every((item) => String(item.a || "").trim().length >= 12));
assert.ok(BETWEEN_V2_SYNTHETIC_CASES.every((item) => String(item.b || "").trim().length >= 12));
assert.ok(BETWEEN_V2_SYNTHETIC_CASES.every((item) => String(item.why || "").trim().length >= 10));

const full = betweenCasesForMode("full");
assert.equal(full.length, 12);
assert.equal(full.filter((item) => item.expectedDecision === "speak").length, 6);
assert.equal(full.filter((item) => item.expectedDecision === "silent").length, 6);

const smoke = betweenCasesForMode("smoke");
assert.equal(smoke.length, 6);
assert.equal(smoke.filter((item) => item.expectedDecision === "speak").length, 3);
assert.equal(smoke.filter((item) => item.expectedDecision === "silent").length, 3);

console.log("BETWEEN_V2_EVAL_CASES_TEST_PASS");

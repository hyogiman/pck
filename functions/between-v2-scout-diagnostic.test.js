"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "between-v2-scout-diagnostic.js"), "utf8");

assert.match(source, /const betweenThoughtsScoutDiagnosticV2 = onCall/);
assert.match(source, /MAX_DIAGNOSTIC_PAIRS = 5/);
assert.match(source, /worksFromAAlone/);
assert.match(source, /worksFromBAlone/);
assert.match(source, /pairNecessity/);
assert.match(source, /thirdThoughtPotential/);
assert.match(source, /writesPerformed: 0/);
assert.match(source, /readOnly: true/);
assert.match(source, /aiCalls: 1/);

const forbiddenWritePatterns = [
  /\bFieldValue\b/,
  /\bdb\.batch\s*\(/,
  /\brunTransaction\s*\(/,
  /\.doc\([^\n]*\)\.set\s*\(/,
  /\.doc\([^\n]*\)\.update\s*\(/,
  /\.doc\([^\n]*\)\.delete\s*\(/
];
for (const pattern of forbiddenWritePatterns) {
  assert.equal(pattern.test(source), false, `read-only scout diagnostic must not contain Firestore write pattern: ${pattern}`);
}

console.log("BETWEEN_V2_SCOUT_DIAGNOSTIC_READ_ONLY_TEST_PASS");

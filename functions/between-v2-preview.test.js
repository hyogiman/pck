"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "between-v2-preview.js"), "utf8");

assert.match(source, /const betweenThoughtsPreviewV2 = onCall/);
assert.match(source, /stage: "inspect"/);
assert.match(source, /aiCalls: 0/);
assert.match(source, /writesPerformed: 0/);
assert.match(source, /readOnly: true/);

const forbiddenWritePatterns = [
  /\bFieldValue\b/,
  /\bdb\.batch\s*\(/,
  /\brunTransaction\s*\(/,
  /\.doc\([^\n]*\)\.set\s*\(/,
  /\.doc\([^\n]*\)\.update\s*\(/,
  /\.doc\([^\n]*\)\.delete\s*\(/
];
for (const pattern of forbiddenWritePatterns) {
  assert.equal(pattern.test(source), false, `read-only preview must not contain Firestore write pattern: ${pattern}`);
}

console.log("BETWEEN_V2_PREVIEW_READ_ONLY_TEST_PASS");

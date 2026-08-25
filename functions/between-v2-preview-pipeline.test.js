"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "between-v2-preview-pipeline.js"), "utf8");
const scoutSource = fs.readFileSync(path.join(__dirname, "between-v2-scout-pipeline.js"), "utf8");

assert.match(source, /const betweenThoughtsPreviewPipelineV2 = onCall/);
assert.match(source, /runScoutPipeline/);
assert.match(source, /betweenThoughtsPreviewV2\.run/);
assert.match(source, /writesPerformed: 0/);
assert.match(source, /readOnly: true/);
assert.match(source, /scoutDiscovery/);
assert.match(source, /scoutEvaluation/);
assert.match(scoutSource, /MAX_COUNTERPARTS_PER_ANCHOR = 2/);
assert.match(scoutSource, /passesScoutPairGate/);
assert.match(scoutSource, /worksFromAAlone/);
assert.match(scoutSource, /worksFromBAlone/);
assert.match(scoutSource, /pairNecessity/);
assert.match(scoutSource, /thirdThoughtPotential/);

const forbiddenWritePatterns = [
  /\bFieldValue\b/,
  /\bdb\.batch\s*\(/,
  /\brunTransaction\s*\(/,
  /\.doc\([^\n]*\)\.set\s*\(/,
  /\.doc\([^\n]*\)\.update\s*\(/,
  /\.doc\([^\n]*\)\.delete\s*\(/
];
for (const pattern of forbiddenWritePatterns) {
  assert.equal(pattern.test(source), false, `read-only preview pipeline must not contain Firestore write pattern: ${pattern}`);
  assert.equal(pattern.test(scoutSource), false, `read-only scout pipeline must not contain Firestore write pattern: ${pattern}`);
}

console.log("BETWEEN_V2_PREVIEW_PIPELINE_READ_ONLY_TEST_PASS");

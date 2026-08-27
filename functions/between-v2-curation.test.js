"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "between-v2-curation.js"), "utf8");

assert.match(source, /const betweenThoughtsCurateV2 = onCall/);
assert.match(source, /V2_QUEUE_DOC_ID = "currentV2"/);
assert.doesNotMatch(source, /\.doc\("current"\)/, "V2 lifecycle must not mutate the legacy current queue");
assert.match(source, /runScoutPipeline/);
assert.match(source, /verifyOriginalPairs/);
assert.match(source, /betweenThoughtsPreviewV2\.run/);
assert.match(source, /CURATION_DAILY_LIMIT = 4/);
assert.match(source, /QUESTION_DAILY_LIMIT = 12/);
assert.match(source, /betweenThoughtsV2CurationAttempts/);
assert.match(source, /betweenThoughtsV2QuestionAttempts/);
assert.match(source, /action === "load"/);
assert.match(source, /action === "next"/);
assert.match(source, /new-batch/);
assert.match(source, /readyItems: \[\]/);
assert.match(source, /pendingPairs/);
assert.match(source, /weakPairSkipped/);
assert.match(source, /queueSchemaVersion: BETWEEN_V2_QUEUE_SCHEMA_VERSION/);

console.log("BETWEEN_V2_CURATION_LIFECYCLE_TEST_PASS");

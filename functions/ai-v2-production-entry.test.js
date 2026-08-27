"use strict";

const legacy = require("./index.js");
const production = require("./");

const requiredV2 = [
  "bloomingInterviewPrepareV2",
  "bloomingInterviewClaimV2",
  "bloomingInterviewMarkShownV2",
  "betweenThoughtsCurateV2"
];

const forbiddenTestExports = [
  "bloomingInterviewQuestionV2",
  "bloomingInterviewAutoPreviewV2",
  "bloomingInterviewSyntheticEvalV2",
  "bloomingInterviewLifecycleTestV2",
  "betweenThoughtsSyntheticEvalV2",
  "betweenThoughtsPreviewV2",
  "betweenThoughtsScoutDiagnosticV2",
  "betweenThoughtsPreviewPipelineV2"
];

const legacyNames = Object.keys(legacy);
const productionNames = Object.keys(production);

const missingLegacy = legacyNames.filter((name) => !productionNames.includes(name));
const missingV2 = requiredV2.filter((name) => !productionNames.includes(name));
const leakedTestExports = forbiddenTestExports.filter((name) => productionNames.includes(name));
const added = productionNames.filter((name) => !legacyNames.includes(name));
const unexpectedAdded = added.filter((name) => !requiredV2.includes(name));

console.log("PACKAGE_MAIN:", require("./package.json").main);
console.log("LEGACY_EXPORTS:", legacyNames.length);
console.log("PRODUCTION_EXPORTS:", productionNames.length);
console.log("ADDED_V2:", added);
console.log("MISSING_LEGACY:", missingLegacy);
console.log("MISSING_REQUIRED_V2:", missingV2);
console.log("LEAKED_TEST_EXPORTS:", leakedTestExports);
console.log("UNEXPECTED_ADDED_EXPORTS:", unexpectedAdded);

if (
  require("./package.json").main !== "ai-v2-production-entry.js" ||
  missingLegacy.length ||
  missingV2.length ||
  leakedTestExports.length ||
  unexpectedAdded.length
) {
  console.error("AI_V2_PRODUCTION_ENTRY_TEST_FAIL");
  process.exit(1);
}

console.log("AI_V2_PRODUCTION_ENTRY_TEST_PASS");

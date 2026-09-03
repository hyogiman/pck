"use strict";

const assert =
  require(
    "node:assert/strict"
  );

const {
  QUESTION_SCORE_FIELDS
} = require("./ai-v2-core");

const {
  STUDIO_EDIT_SCORE_FIELDS
} = require("./studio-gardener-v2-core");

const {
  studioQuestionGenerationSchema,
  studioEditGenerationSchema,
  studioGeneratorPrompt,
  buildStudioGeneratorInput
} = require("./studio-gardener-v2-generator");

function testQuestionSchema() {
  const schema =
    studioQuestionGenerationSchema();

  assert.equal(
    schema.additionalProperties,
    false
  );

  const candidate =
    schema.properties
      .candidates.items;

  assert.deepEqual(
    candidate.properties
      .scores.required,
    QUESTION_SCORE_FIELDS
  );

  assert.deepEqual(
    candidate.properties
      .evidence.required,
    [
      "primary",
      "materialId",
      "material"
    ]
  );
}

function testEditSchema() {
  const schema =
    studioEditGenerationSchema();

  assert.deepEqual(
    schema.properties
      .candidates.items
      .properties
      .scores.required,
    STUDIO_EDIT_SCORE_FIELDS
  );

  assert.equal(
    schema.additionalProperties,
    false
  );
}

function testPrompts() {
  const connect =
    studioGeneratorPrompt(
      "connect"
    );

  const deepen =
    studioGeneratorPrompt(
      "deepen"
    );

  const challenge =
    studioGeneratorPrompt(
      "challenge"
    );

  const edit =
    studioGeneratorPrompt(
      "edit"
    );

  assert.match(
    connect,
    /selectedMaterial/
  );

  assert.match(
    deepen,
    /덜 탐색/
  );

  assert.match(
    challenge,
    /억지 반대/
  );

  assert.match(
    edit,
    /목소리/
  );

  assert.match(
    connect,
    /다시 행동을 선택하거나 재판단하지 않는다/
  );
}

function testInput() {
  const context = {
    projectTitle:
      "기록에 대한 생각",

    format: "blog",

    targetSlotTitle:
      "외부의 시선",

    targetSlotPurpose:
      "연결한다",

    targetSlotGuide:
      "확장한다",

    currentDraft:
      "기록을 통해 만들어 내는 다양한 결과물들을 보면서 기록을 계속해야겠다는 생각이 들었다.",

    previousSlots: [
      {
        id: "a",
        title: "A",
        text: "A text",
        gardenerQuestion:
          "예전 질문?"
      }
    ],

    materials: [
      {
        id: "m1",
        thought:
          "과정+경험+깨달은 점"
      },

      {
        id: "m2",
        thought:
          "다른 재료"
      }
    ]
  };

  const input =
    buildStudioGeneratorInput({
      context,

      plan: {
        mode: "connect",
        materialId: "m1",
        primaryEvidence:
          "기록을 통해",
        materialEvidence:
          "과정+경험+깨달은 점"
      }
    });

  assert.equal(
    input.action,
    "connect"
  );

  assert.equal(
    input.selectedMaterial.id,
    "m1"
  );

  assert.equal(
    input.selectedMaterial.thought,
    "과정+경험+깨달은 점"
  );

  assert.deepEqual(
    input.previousQuestions,
    [
      "예전 질문?"
    ]
  );

  assert.equal(
    Object.prototype
      .hasOwnProperty.call(
        input,
        "materials"
      ),
    false
  );
}

function main() {
  testQuestionSchema();
  testEditSchema();
  testPrompts();
  testInput();

  console.log(
    "STUDIO_GARDENER_V2_GENERATOR_TEST_PASS"
  );
}

main();
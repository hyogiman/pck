"use strict";

const {
  MODEL_ROUTES,
  QUESTION_SCORE_FIELDS,
  cleanText,
  questionGenerationPrinciples
} = require("./ai-v2-core");

const {
  STUDIO_EDIT_SCORE_FIELDS
} = require("./studio-gardener-v2-core");

const STUDIO_TERRA_SCHEMA_NAME =
  "studio_gardener_v2_generation";

function scoreProperties(fields) {
  return Object.fromEntries(
    fields.map((key) => [
      key,
      {
        type: "integer",
        minimum: 0,
        maximum: 5
      }
    ])
  );
}

function studioQuestionGenerationSchema() {
  return {
    type: "object",

    properties: {
      decision: {
        type: "string",
        enum: [
          "speak",
          "silent"
        ]
      },

      reason: {
        type: "string"
      },

      candidates: {
        type: "array",
        minItems: 0,
        maxItems: 3,

        items: {
          type: "object",

          properties: {
            question: {
              type: "string"
            },

            evidence: {
              type: "object",

              properties: {
                primary: {
                  type: "string"
                },

                materialId: {
                  type: "string"
                },

                material: {
                  type: "string"
                }
              },

              required: [
                "primary",
                "materialId",
                "material"
              ],

              additionalProperties:
                false
            },

            scores: {
              type: "object",

              properties:
                scoreProperties(
                  QUESTION_SCORE_FIELDS
                ),

              required:
                QUESTION_SCORE_FIELDS,

              additionalProperties:
                false
            }
          },

          required: [
            "question",
            "evidence",
            "scores"
          ],

          additionalProperties:
            false
        }
      }
    },

    required: [
      "decision",
      "reason",
      "candidates"
    ],

    additionalProperties:
      false
  };
}

function studioEditGenerationSchema() {
  return {
    type: "object",

    properties: {
      decision: {
        type: "string",
        enum: [
          "speak",
          "silent"
        ]
      },

      reason: {
        type: "string"
      },

      candidates: {
        type: "array",
        minItems: 0,
        maxItems: 3,

        items: {
          type: "object",

          properties: {
            suggestion: {
              type: "string"
            },

            evidence: {
              type: "object",

              properties: {
                primary: {
                  type: "string"
                }
              },

              required: [
                "primary"
              ],

              additionalProperties:
                false
            },

            scores: {
              type: "object",

              properties:
                scoreProperties(
                  STUDIO_EDIT_SCORE_FIELDS
                ),

              required:
                STUDIO_EDIT_SCORE_FIELDS,

              additionalProperties:
                false
            }
          },

          required: [
            "suggestion",
            "evidence",
            "scores"
          ],

          additionalProperties:
            false
        }
      }
    },

    required: [
      "decision",
      "reason",
      "candidates"
    ],

    additionalProperties:
      false
  };
}

function studioGeneratorPrompt(
  mode
) {
  const base = [
    "당신은 생각의 텃밭 Studio Gardener의 Terra다.",
    "Luna가 이미 개입 여부와 행동 종류를 결정했다.",
    "당신은 다시 행동을 선택하거나 재판단하지 않는다.",
    "당신의 역할은 Luna의 계획에 따라 사용자가 실제로 보게 될 한 번의 개입을 만드는 것이다.",
    "사용자가 쓰지 않은 사실, 감정, 동기, 사건을 만들어내지 않는다.",
    "근거 문구는 입력 원문에 실제 존재하는 연속된 짧은 표현을 그대로 사용한다.",
    "최대 3개 후보를 만들고 품질을 냉정하게 점수화한다.",
    "좋은 후보를 만들 수 없다면 decision='silent'로 하고 candidates는 비운다."
  ];

  if (
    [
      "connect",
      "deepen",
      "challenge"
    ].includes(mode)
  ) {
    base.push(
      ...questionGenerationPrinciples(
        "gardener"
      ),

      "질문은 하나의 중심만 가진 자연스러운 한국어 한 문장이어야 한다.",

      "evidence.primary는 현재 Studio 글 또는 이전 Studio 글에서 실제 문구를 복사한다.",

      mode === "connect"
        ? "connect에서는 반드시 Luna가 고른 selectedMaterial 하나만 사용한다. 단순히 같은 주제라는 이유로 연결하지 말고, 두 생각을 함께 볼 때 새로운 생각이 생기는 질문을 만든다."
        : "",

      mode === "connect"
        ? "connect의 evidence.materialId는 selectedMaterial.id와 정확히 같아야 하고 evidence.material은 selectedMaterial 실제 문구여야 한다."
        : "",

      mode !== "connect"
        ? "connect가 아니면 evidence.materialId와 evidence.material은 빈 문자열로 둔다."
        : "",

      mode === "deepen"
        ? "deepen은 사용자가 이미 답한 내용을 다시 묻지 말고 아직 덜 탐색된 이유, 기준, 관계, 긴장, 경험 중 중요한 한 지점을 연다."
        : "",

      mode === "challenge"
        ? "challenge는 실제 글에 드러난 가정, 모순, 예외 가능성을 존중하며 시험한다. 억지 반대나 공격적인 반론을 만들지 않는다."
        : ""
    );
  }

  if (mode === "edit") {
    base.push(
      "edit은 새 생각을 대신 써주는 기능이 아니다.",
      "사용자가 이미 충분히 생각한 내용을 더 선명하고 자연스럽게 표현하도록 짧게 제안한다.",
      "사용자의 목소리와 의미를 보존한다.",
      "원문에 없는 사실이나 결론을 추가하지 않는다.",
      "suggestion은 12~220자의 실제로 적용 가능한 짧은 문장 또는 편집 제안이어야 한다.",
      "evidence.primary는 편집 근거가 된 실제 Studio 원문 문구다."
    );
  }

  return base
    .filter(Boolean)
    .join("\n");
}

function compactGeneratorMaterial(
  material
) {
  if (
    !material ||
    typeof material !==
      "object"
  ) {
    return null;
  }

  const id =
    cleanText(
      material.id ||
      material.fragmentId,
      220
    );

  if (!id) return null;

  return {
    id,

    date:
      cleanText(
        material.date,
        80
      ),

    thought:
      cleanText(
        material.thought ||
        material.text,
        5000
      ),

    context:
      cleanText(
        material.context,
        1200
      ),

    sourceExcerpt:
      cleanText(
        material.sourceExcerpt ||
        material.excerpt,
        1600
      )
  };
}

function selectedMaterialForPlan(
  context,
  plan
) {
  const wanted =
    cleanText(
      plan?.materialId,
      220
    );

  if (!wanted) return null;

  const material =
    (
      Array.isArray(
        context?.materials
      )
        ? context.materials
        : []
    ).find(
      (row) =>
        cleanText(
          row?.id ||
          row?.fragmentId,
          220
        ) === wanted
    );

  return compactGeneratorMaterial(
    material
  );
}

function buildStudioGeneratorInput({
  context = {},
  plan = {}
} = {}) {
  const previousSlots =
    (
      Array.isArray(
        context.previousSlots
      )
        ? context.previousSlots
        : []
    )
      .slice(-4)
      .map((slot) => ({
        id:
          cleanText(
            slot?.id,
            120
          ),

        title:
          cleanText(
            slot?.title,
            220
          ),

        text:
          cleanText(
            slot?.text,
            2400
          ),

        gardenerQuestion:
          cleanText(
            slot?.gardenerQuestion,
            500
          )
      }));

  const previousQuestions = [
    ...(
      Array.isArray(
        context.previousGardenerQuestions
      )
        ? context.previousGardenerQuestions
        : []
    ),

    ...previousSlots.map(
      (slot) =>
        slot.gardenerQuestion
    )
  ]
    .map(
      (value) =>
        cleanText(
          value,
          500
        )
    )
    .filter(Boolean)
    .slice(-8);

  return {
    model:
      MODEL_ROUTES.speaking,

    action:
      cleanText(
        plan.mode,
        40
      ),

    plan: {
      reason:
        cleanText(
          plan.reason,
          800
        ),

      primaryEvidence:
        cleanText(
          plan.primaryEvidence,
          800
        ),

      materialId:
        cleanText(
          plan.materialId,
          220
        ),

      materialEvidence:
        cleanText(
          plan.materialEvidence,
          800
        )
    },

    projectTitle:
      cleanText(
        context.projectTitle,
        600
      ),

    format:
      cleanText(
        context.format,
        80
      ),

    targetSlot: {
      title:
        cleanText(
          context.targetSlotTitle,
          220
        ),

      purpose:
        cleanText(
          context.targetSlotPurpose,
          800
        ),

      guide:
        cleanText(
          context.targetSlotGuide,
          800
        )
    },

    currentDraft:
      cleanText(
        context.currentDraft,
        6000
      ),

    previousSlots,

    previousQuestions,

    selectedMaterial:
      selectedMaterialForPlan(
        context,
        plan
      )
  };
}

module.exports = {
  STUDIO_TERRA_SCHEMA_NAME,
  studioQuestionGenerationSchema,
  studioEditGenerationSchema,
  studioGeneratorPrompt,
  compactGeneratorMaterial,
  selectedMaterialForPlan,
  buildStudioGeneratorInput
};
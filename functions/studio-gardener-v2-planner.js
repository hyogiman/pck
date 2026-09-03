"use strict";

const {
  cleanText
} = require("./ai-v2-core");

const {
  STUDIO_ACTION_MODES,
  STUDIO_PLAN_SCORE_FIELDS
} = require("./studio-gardener-v2-core");

function studioPlanSchema() {
  return {
    type: "object",
    properties: {
      decision: {
        type: "string",
        enum: ["silent", "act"]
      },

      mode: {
        type: "string",
        enum: [
          "silent",
          ...STUDIO_ACTION_MODES
        ]
      },

      reason: {
        type: "string"
      },

      primaryEvidence: {
        type: "string"
      },

      materialId: {
        type: "string"
      },

      materialEvidence: {
        type: "string"
      },

      scores: {
        type: "object",
        properties:
          Object.fromEntries(
            STUDIO_PLAN_SCORE_FIELDS.map(
              (field) => [
                field,
                {
                  type: "integer",
                  minimum: 0,
                  maximum: 5
                }
              ]
            )
          ),
        required: [
          ...STUDIO_PLAN_SCORE_FIELDS
        ],
        additionalProperties: false
      }
    },

    required: [
      "decision",
      "mode",
      "reason",
      "primaryEvidence",
      "materialId",
      "materialEvidence",
      "scores"
    ],

    additionalProperties: false
  };
}

function studioPlannerPrompt() {
  return [
    "당신은 생각의 텃밭 Studio Gardener의 Luna planner다.",

    "당신의 역할은 사용자에게 직접 말하는 것이 아니다.",
    "현재 글의 상태를 판단해 silent, connect, deepen, challenge, edit 중 하나를 고르는 것이다.",

    "가장 중요한 원칙은 '무엇이라도 말하는 것'보다 침묵이 낫다는 것이다.",
    "개입이 지금 글쓰기에 분명한 가치를 더하지 못하면 silent를 선택한다.",

    "silent:",
    "- 사용자가 스스로 생각을 잘 이어가고 있다.",
    "- 새 질문이나 개입이 흐름을 끊을 가능성이 높다.",
    "- 근거가 약하거나 새로움이 부족하다.",

    "connect:",
    "- retrieved material 중 현재 글과 실제로 의미 있는 과거 생각이 있다.",
    "- 단순히 주제가 비슷한 정도가 아니라 지금 생각을 새 방향으로 확장해야 한다.",
    "- 반드시 현재 글의 실제 evidence와 retrieved material의 실제 evidence가 모두 있어야 한다.",

    "deepen:",
    "- 현재 글 안에 아직 충분히 탐색되지 않은 중요한 생각, 구체적 경험, 이유, 긴장이 있다.",
    "- 현재 내용을 다시 말하게 하는 질문은 만들지 않는다.",

    "challenge:",
    "- 사용자의 현재 결론에 실제로 검토할 가치가 있는 전제, 모순, 반대 관점이 있다.",
    "- 반론을 위한 반론이나 공격적인 태도는 금지한다.",

    "edit:",
    "- 생각 자체가 충분히 전개된 뒤 표현이나 구조를 다듬는 것이 지금 가장 가치 있을 때만 선택한다.",
    "- 생각이 아직 자라는 중이면 edit하지 않는다.",

    "primaryEvidence는 반드시 사용자가 작성한 Studio 문맥에서 실제로 존재하는 짧은 구절이어야 한다.",
    "startingPath는 사용자가 Studio를 시작할 때 고른 출발 갈래다. 완성된 결론으로 취급하지 않는다.",
    "referenceMaterials는 사용자가 이미 현재 Studio에 붙였거나, Studio의 출발점 또는 Thread 안에 이미 존재하는 기존 재료다.",
    "referenceMaterials는 현재 맥락을 이해하고 이미 나온 내용을 반복하지 않기 위한 배경으로 읽는다.",
    "referenceMaterials를 새로 발견한 연결인 것처럼 connect의 materialId로 선택하지 않는다.",
    "previousGardenerQuestions에 이미 보여준 질문이 있으면 같은 질문이나 같은 사고 축을 반복하지 않는다.",
    "connect를 선택할 경우 materialId는 materials에 제공된 새 retrieved material의 실제 ID여야 한다.",
    "materialEvidence 역시 그 retrieved material에 실제로 존재하는 짧은 구절이어야 한다.",

    "scores는 각 항목을 0~5로 평가한다.",
    "점수를 통과시키기 위해 후하게 평가하지 않는다.",
    "grounded, novel, addsValue, contextFit 중 하나라도 4 미만이라면 act를 주장하지 않는 편이 낫다.",

    "thinkingDeveloped는 사용자의 생각이 얼마나 충분히 전개되었는지를 뜻한다.",
    "edit는 thinkingDeveloped가 4 이상이라고 판단할 때만 고려한다.",

    "reason은 내부 판단 이유를 짧고 구체적으로 적는다.",
    "사용자에게 직접 질문이나 문장을 작성하지 않는다."
  ].join("\n");
}

function compactPlannerMaterial(material) {
  if (!material || typeof material !== "object") {
    return null;
  }

  const id =
    cleanText(
      material.id || material.fragmentId,
      220
    );

  if (!id) {
    return null;
  }

  return {
    id,

    role:
      cleanText(
        material.role,
        40
      ),

    date:
      cleanText(
        material.date,
        80
      ),

    thought:
      cleanText(
        material.thought || material.text,
        3200
      ),

    context:
      cleanText(
        material.context,
        900
      ),

    sourceExcerpt:
      cleanText(
        material.sourceExcerpt,
        1200
      ),

    retrieval: {
      distance:
        Number.isFinite(
          Number(material?.retrieval?.distance)
        )
          ? Number(material.retrieval.distance)
          : null,

      score:
        Number.isFinite(
          Number(material?.retrieval?.score)
        )
          ? Number(material.retrieval.score)
          : null
    }
  };
}

function buildStudioPlannerInput(
  context = {}
) {
  const previousSlots =
    (
      Array.isArray(context.previousSlots)
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
            2200
          ),

        gardenerQuestion:
          cleanText(
            slot?.gardenerQuestion,
            500
          )
      }));

  const materials =
    (
      Array.isArray(context.materials)
        ? context.materials
        : []
    )
      .slice(0, 6)
      .map(compactPlannerMaterial)
      .filter(Boolean);

  const referenceMaterials =
    (
      Array.isArray(
        context.referenceMaterials
      )
        ? context.referenceMaterials
        : []
    )
      .slice(0, 6)
      .map(compactPlannerMaterial)
      .filter(Boolean);

  const previousGardenerQuestions =
    (
      Array.isArray(
        context.previousGardenerQuestions
      )
        ? context.previousGardenerQuestions
        : []
    )
      .map(
        (value) =>
          cleanText(
            value,
            500
          )
      )
      .filter(Boolean)
      .slice(-8);

  const startingPath =
    context.startingPath &&
    typeof context.startingPath ===
      "object"
      ? {
          title:
            cleanText(
              context.startingPath.title,
              260
            ),

          summary:
            cleanText(
              context.startingPath.summary,
              700
            ),

          guidingQuestion:
            cleanText(
              context
                .startingPath
                .guidingQuestion,
              500
            ),

          shape:
            cleanText(
              context.startingPath.shape,
              40
            )
        }
      : null;

  return {
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

    startingPath,

    thread: {
      title:
        cleanText(
          context.threadTitle,
          400
        ),

      question:
        cleanText(
          context.threadQuestion,
          800
        )
    },

    previousSlots,

    previousGardenerQuestions,

    referenceMaterials,

    materials
  };
}

module.exports = {
  studioPlanSchema,
  studioPlannerPrompt,
  compactPlannerMaterial,
  buildStudioPlannerInput
};
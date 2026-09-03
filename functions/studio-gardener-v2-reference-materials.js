"use strict";

const {
  cleanText
} = require("./ai-v2-core");

const STUDIO_GARDENER_GUIDE = {
  blog: {
    hook:
      "독자가 글에 들어오게 만드는 구체적 장면·긴장·문제의식을 연다. 뒤 문항에서 다룰 원인 분석이나 결론을 미리 반복하지 않는다.",

    experience:
      "사용자가 실제로 겪은 사건·행동·감정·장면을 구체화한다. 이미 말한 추상적 이유를 다른 표현으로 다시 묻지 않는다.",

    outside:
      "책·미디어·타인의 말 같은 외부 재료가 사용자의 생각을 어떻게 흔들거나 넓혔는지 묻는다. 앞선 개인 경험을 재진술하게 만들지 않는다.",

    meaning:
      "앞의 경험과 외부 시선을 연결해 사용자의 관점 변화·해석·의미를 꺼낸다. 앞서 나열한 원인이나 사건을 또 수집하지 않는다.",

    counter:
      "지금까지 세운 주장에 실제로 동의하지 않는 합리적인 독자의 관점을 연다. 반대 주장, 반례, 예외·경계조건, 대가·트레이드오프, 의도치 않은 결과, 대안적 해석 중 아직 다루지 않은 방향을 택한다. 앞에서 이미 다룬 원인·어려움·감정을 다시 묻지 않는다.",

    conclusion:
      "새 논점을 더 벌리기보다 지금까지의 탐색 뒤에 남은 생각·변화·선택·열린 질문을 묻는다. 본문에서 이미 한 말을 요약하게만 만들지 않는다."
  },

  shorts: {
    hook:
      "첫 3초에 시청자의 주의를 붙잡을 갈등·의외성·구체성을 찾는다.",

    situation:
      "훅을 반복하지 말고 필요한 맥락만 짧게 보충한다.",

    turn:
      "앞에서 예상 가능한 흐름과 다른 전환점·모순·새 관점을 찾는다.",

    point:
      "앞선 내용에서 아직 명료하게 말하지 않은 핵심 메시지를 한 축으로 좁힌다.",

    close:
      "핵심을 반복 설명하지 말고 여운·행동·질문 중 하나로 닫는다."
  },

  instagram: {
    cover:
      "내용 전체의 가장 선명한 긴장이나 메시지를 찾는다.",

    body:
      "표지 문구를 반복하지 말고 근거·맥락·변화를 보충한다.",

    quote:
      "본문과 다른 외부 목소리나 장면으로 의미를 확장한다.",

    caption:
      "카드 내용을 복사하지 말고 왜 이 생각을 남기는지 개인 맥락을 연다.",

    tags:
      "내용을 반복 설명하지 않고 발견 가능성을 높일 핵심 개념을 고른다."
  },

  podcast: {
    open:
      "청취자가 자신의 경험을 떠올릴 수 있는 입구를 연다.",

    line:
      "오프닝 질문을 반복하지 않고 이야기를 흔들 외부 재료를 찾는다.",

    experience:
      "외부 재료와 맞닿는 실제 개인 경험을 구체화한다.",

    counter:
      "앞선 주장에 대한 반대 주장·반례·대가·예외 중 아직 다루지 않은 관점을 연다. 이미 말한 이유를 더 찾게 하지 않는다.",

    meaning:
      "반론을 통과한 뒤에도 남는 관점의 변화나 핵심을 묻는다.",

    question:
      "방송 내용을 다시 요약시키지 말고 청취자에게 남길 열린 질문을 만든다."
  }
};

function studioSlotGuide(
  format,
  slotId
) {
  return (
    STUDIO_GARDENER_GUIDE
      ?.[String(format || "blog")]
      ?.[String(slotId || "")] ||
    "앞에서 이미 다룬 내용을 반복하지 말고, 현재 문항의 고유한 역할에서 아직 탐색하지 않은 방향을 연다."
  );
}

function compactStudioReferenceMaterial(
  raw,
  {
    id = "",
    role = "thread"
  } = {}
) {
  const source =
    raw &&
    typeof raw === "object"
      ? raw
      : {};

  if (source.deletedAt) {
    return null;
  }

  const materialId =
    cleanText(
      id ||
      source.id ||
      source.fragmentId,
      220
    );

  if (!materialId) {
    return null;
  }

  const thought =
    cleanText(
      source.thought ||
      source.text,
      2200
    );

  const context =
    cleanText(
      source.context,
      600
    );

  const sourceExcerpt =
    cleanText(
      source.sourceExcerpt ||
      source.externalText ||
      source.excerpt,
      800
    );

  if (
    !thought &&
    !context &&
    !sourceExcerpt
  ) {
    return null;
  }

  return {
    id:
      materialId,

    role:
      ["attached", "starting", "thread"]
        .includes(role)
        ? role
        : "thread",

    date:
      cleanText(
        source.date ||
        source.createdAt,
        80
      ),

    thought,
    context,
    sourceExcerpt
  };
}

function uniqueIds(
  values,
  limit = 6
) {
  return [
    ...new Set(
      (
        Array.isArray(values)
          ? values
          : []
      )
        .map(String)
        .map(
          (value) =>
            value.trim()
        )
        .filter(Boolean)
    )
  ].slice(
    0,
    Math.max(
      0,
      Number(limit || 0)
    )
  );
}

function normalizedStartingPath(
  project
) {
  const raw =
    project?.startingPath;

  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return null;
  }

  const result = {
    title:
      cleanText(
        raw.title,
        260
      ),

    summary:
      cleanText(
        raw.summary,
        700
      ),

    guidingQuestion:
      cleanText(
        raw.guidingQuestion,
        500
      ),

    shape:
      cleanText(
        raw.shape,
        40
      )
  };

  return (
    result.title ||
    result.summary ||
    result.guidingQuestion ||
    result.shape
  )
    ? result
    : null;
}

function materialSortKey(
  raw
) {
  const value =
    raw?.createdAt ||
    raw?.date ||
    "";

  if (
    typeof value === "string"
  ) {
    return value;
  }

  if (
    value &&
    typeof value.toDate ===
      "function"
  ) {
    try {
      return value
        .toDate()
        .toISOString();
    } catch (_) {
      return "";
    }
  }

  const seconds =
    Number(
      value?._seconds ??
      value?.seconds
    );

  if (
    Number.isFinite(seconds)
  ) {
    return String(seconds)
      .padStart(20, "0");
  }

  return "";
}

async function enrichStudioGardenerContext({
  db,
  userRef,
  project,
  slotIndex,
  context,
  threadMaterials = [],
  maxReferenceMaterials = 6
} = {}) {
  if (
    !db ||
    typeof db.getAll !==
      "function"
  ) {
    throw new TypeError(
      "Firestore db is required"
    );
  }

  if (
    !userRef ||
    typeof userRef.collection !==
      "function"
  ) {
    throw new TypeError(
      "Firestore userRef is required"
    );
  }

  const data =
    project &&
    typeof project === "object"
      ? project
      : {};

  const slots =
    Array.isArray(data.slots)
      ? data.slots
      : [];

  const index =
    Number(slotIndex);

  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= slots.length
  ) {
    throw new TypeError(
      "valid Studio slot index is required"
    );
  }

  const targetSlot =
    slots[index] || {};

  const base =
    context &&
    typeof context === "object"
      ? context
      : {};

  const limit =
    Math.max(
      1,
      Math.min(
        12,
        Number(
          maxReferenceMaterials ||
          6
        )
      )
    );

  const attachedIds =
    uniqueIds(
      base.attachedMaterialIds,
      6
    );

  const startingIds =
    uniqueIds(
      base.startingMaterialIds,
      6
    );

  const roleById =
    new Map();

  attachedIds.forEach(
    (id) =>
      roleById.set(
        id,
        "attached"
      )
  );

  startingIds.forEach(
    (id) => {
      if (
        !roleById.has(id)
      ) {
        roleById.set(
          id,
          "starting"
        );
      }
    }
  );

  const references = [];
  const seen = new Set();

  const directIds =
    [
      ...roleById.keys()
    ];

  if (directIds.length) {
    const col =
      userRef.collection(
        "fragments"
      );

    const refs =
      directIds.map(
        (id) =>
          col.doc(id)
      );

    const docs =
      await db.getAll(
        ...refs
      );

    docs.forEach(
      (doc) => {
        if (
          references.length >=
          limit
        ) {
          return;
        }

        if (!doc?.exists) {
          return;
        }

        const material =
          compactStudioReferenceMaterial(
            doc.data() || {},
            {
              id:
                doc.id,

              role:
                roleById.get(
                  doc.id
                ) ||
                "starting"
            }
          );

        if (!material) {
          return;
        }

        seen.add(
          material.id
        );

        references.push(
          material
        );
      }
    );
  }

  const excluded =
    new Set(
      (
        Array.isArray(
          base.excludedFragmentIds
        )
          ? base.excludedFragmentIds
          : []
      )
        .map(String)
        .filter(Boolean)
    );

  const threadRows =
    (
      Array.isArray(
        threadMaterials
      )
        ? threadMaterials
        : []
    )
      .filter(
        (raw) =>
          raw &&
          typeof raw === "object"
      )
      .map(
        (raw) => ({
          raw,

          at:
            materialSortKey(
              raw
            )
        })
      )
      .sort(
        (a, b) =>
          a.at.localeCompare(
            b.at
          )
      );

  for (
    const row of threadRows
  ) {
    if (
      references.length >=
      limit
    ) {
      break;
    }

    const material =
      compactStudioReferenceMaterial(
        row.raw,
        {
          id:
            row.raw.id ||
            row.raw.fragmentId,

          role:
            "thread"
        }
      );

    if (!material) {
      continue;
    }

    if (
      seen.has(
        material.id
      ) ||
      excluded.has(
        material.id
      )
    ) {
      continue;
    }

    seen.add(
      material.id
    );

    references.push(
      material
    );
  }

  const previousGardenerQuestion =
    cleanText(
      targetSlot
        ?.gardenerQuestion,
      500
    );

  return {
    ...base,

    targetSlotGuide:
      studioSlotGuide(
        data.format,
        targetSlot.id
      ),

    startingPath:
      normalizedStartingPath(
        data
      ),

    previousGardenerQuestions:
      previousGardenerQuestion
        ? [
            previousGardenerQuestion
          ]
        : [],

    referenceMaterials:
      references
  };
}

module.exports = {
  STUDIO_GARDENER_GUIDE,
  studioSlotGuide,
  compactStudioReferenceMaterial,
  uniqueIds,
  normalizedStartingPath,
  enrichStudioGardenerContext
};

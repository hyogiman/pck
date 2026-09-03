"use strict";

const assert =
  require(
    "node:assert/strict"
  );

const {
  compactStudioReferenceMaterial,
  enrichStudioGardenerContext
} = require(
  "./studio-gardener-v2-reference-materials"
);

function fakeDoc(
  id,
  data,
  exists = true
) {
  return {
    id,
    exists,

    data:
      () =>
        data
  };
}

function testCompaction() {
  const result =
    compactStudioReferenceMaterial(
      {
        thought:
          "a".repeat(2600),

        context:
          "b".repeat(900),

        externalText:
          "c".repeat(1100)
      },
      {
        id:
          "fragment-1",

        role:
          "attached"
      }
    );

  assert.equal(
    result.id,
    "fragment-1"
  );

  assert.equal(
    result.role,
    "attached"
  );

  assert.equal(
    result.thought.length,
    2200
  );

  assert.equal(
    result.context.length,
    600
  );

  assert.equal(
    result.sourceExcerpt.length,
    800
  );
}

async function testContextEnrichment() {
  const directRows =
    new Map([
      [
        "attached-a",
        {
          thought:
            "현재 문항에 직접 붙인 과거 생각"
        }
      ],

      [
        "start-a",
        {
          thought:
            "Studio를 시작하게 한 생각",

          externalText:
            "출발점이 된 외부 문장"
        }
      ]
    ]);

  const db = {
    getAll:
      async (
        ...refs
      ) =>
        refs.map(
          (ref) => {
            const data =
              directRows.get(
                ref.id
              );

            return fakeDoc(
              ref.id,
              data || {},
              Boolean(data)
            );
          }
        )
  };

  const userRef = {
    collection:
      () => ({
        doc:
          (id) => ({
            id
          })
      })
  };

  const project = {
    format:
      "blog",

    startingPath: {
      title:
        "기록과 자유",

      summary:
        "기록이 선택권과 어떻게 연결되는지 살펴본다.",

      guidingQuestion:
        "나는 왜 기록하려는가?",

      shape:
        "meaning"
    },

    slots: [
      {
        id:
          "hook",

        text:
          "앞 문항"
      },

      {
        id:
          "experience",

        text:
          "현재 글",

        gardenerQuestion:
          "전에 이 칸에서 받은 질문"
      }
    ]
  };

  const context = {
    targetSlotGuide:
      "old-guide",

    attachedMaterialIds: [
      "attached-a"
    ],

    startingMaterialIds: [
      "start-a"
    ],

    excludedFragmentIds: [
      "studio-current"
    ]
  };

  const result =
    await enrichStudioGardenerContext({
      db,
      userRef,
      project,
      slotIndex: 1,
      context,

      threadMaterials: [
        {
          id:
            "studio-current",

          thought:
            "현재 Studio에서 내보낸 생각",

          date:
            "2026-09-01"
        },

        {
          id:
            "thread-old",

          thought:
            "Thread에 있던 예전 생각",

          date:
            "2026-08-01"
        },

        {
          id:
            "attached-a",

          thought:
            "중복되어서는 안 되는 생각",

          date:
            "2026-08-20"
        },

        {
          id:
            "thread-new",

          thought:
            "Thread의 다른 최근 생각",

          date:
            "2026-09-02"
        }
      ]
    });

  assert.deepEqual(
    result.referenceMaterials.map(
      (item) =>
        item.id
    ),
    [
      "attached-a",
      "start-a",
      "thread-old",
      "thread-new"
    ]
  );

  assert.deepEqual(
    result.referenceMaterials.map(
      (item) =>
        item.role
    ),
    [
      "attached",
      "starting",
      "thread",
      "thread"
    ]
  );

  assert.deepEqual(
    result.previousGardenerQuestions,
    [
      "전에 이 칸에서 받은 질문"
    ]
  );

  assert.equal(
    result.startingPath.title,
    "기록과 자유"
  );

  assert.equal(
    result.startingPath.guidingQuestion,
    "나는 왜 기록하려는가?"
  );

  assert.match(
    result.targetSlotGuide,
    /실제로 겪은 사건/
  );

  assert.equal(
    result.referenceMaterials.some(
      (item) =>
        item.id ===
        "studio-current"
    ),
    false
  );
}

async function main() {
  testCompaction();

  await testContextEnrichment();

  console.log(
    "STUDIO_GARDENER_V2_REFERENCE_MATERIALS_TEST_PASS"
  );
}

main().catch(
  (error) => {
    console.error(error);
    process.exitCode = 1;
  }
);

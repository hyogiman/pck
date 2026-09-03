"use strict";

const {
  onCall
} = require(
  "firebase-functions/v2/https"
);

const {
  logger
} = require(
  "firebase-functions"
);

const {
  getApps,
  initializeApp
} = require(
  "firebase-admin/app"
);

const {
  getFirestore,
  FieldValue
} = require(
  "firebase-admin/firestore"
);

const {
  MODEL_ROUTES
} = require(
  "./ai-v2-core"
);

const {
  bloomingInterviewPrepareV2,
  bloomingInterviewClaimV2,
  bloomingInterviewMarkShownV2
} = require(
  "./blooming-v2"
);

const {
  koreaDateKey,
  normalizedUsage,
  usageHasTokens,
  routeUsagePatch
} = require(
  "./ai-v2-feature-usage"
);

if (!getApps().length) {
  initializeApp();
}

const db =
  getFirestore();

async function recordBloomingV2Usage(
  uid,
  result
) {
  const luna =
    normalizedUsage(
      result?.scoutUsage
    );

  const terra =
    normalizedUsage(
      result?.finalUsage
    );

  const lunaCalled =
    usageHasTokens(luna);

  const terraCalled =
    usageHasTokens(terra);

  if (
    !lunaCalled &&
    !terraCalled
  ) {
    return;
  }

  const patch = {
    ...routeUsagePatch({
      prefix:
        "bloomingV2",

      route:
        "Luna",

      usage:
        luna,

      calls:
        lunaCalled
          ? 1
          : 0,

      model:
        MODEL_ROUTES.discovery
    }),

    ...routeUsagePatch({
      prefix:
        "bloomingV2",

      route:
        "Terra",

      usage:
        terra,

      calls:
        terraCalled
          ? 1
          : 0,

      model:
        MODEL_ROUTES.speaking
    }),

    updatedAt:
      FieldValue
        .serverTimestamp()
  };

  if (lunaCalled) {
    patch.bloomingV2Runs =
      FieldValue.increment(1);
  }

  if (
    result?.status ===
      "ready" &&
    terraCalled
  ) {
    patch.bloomingV2PreparedQuestions =
      FieldValue.increment(1);
  }

  await db
    .collection("users")
    .doc(uid)
    .collection("aiUsage")
    .doc(
      koreaDateKey()
    )
    .set(
      patch,
      {
        merge: true
      }
    );
}

const bloomingInterviewPrepareV2Metered =
  onCall(
    {
      region:
        "us-central1",

      secrets: [
        "OPENAI_API_KEY"
      ],

      timeoutSeconds:
        90,

      memory:
        "256MiB",

      maxInstances:
        5
    },

    async (request) => {
      const result =
        await bloomingInterviewPrepareV2
          .run(request);

      const uid =
        String(
          request?.auth?.uid ||
          ""
        ).trim();

      if (uid) {
        try {
          await recordBloomingV2Usage(
            uid,
            result
          );
        } catch (error) {
          // 사용량 화면 기록 실패가 실제 Blooming 질문을
          // 막아서는 안 된다.
          logger.warn(
            "Blooming V2 usage metering skipped",
            {
              uid,
              message:
                error?.message ||
                String(error)
            }
          );
        }
      }

      return result;
    }
  );

module.exports = {
  recordBloomingV2Usage,

  bloomingInterviewPrepareV2:
    bloomingInterviewPrepareV2Metered,

  bloomingInterviewClaimV2,
  bloomingInterviewMarkShownV2
};

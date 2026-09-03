"use strict";

const {
  onCall,
  HttpsError
} = require(
  "firebase-functions/v2/https"
);

const {
  getApps,
  initializeApp
} = require(
  "firebase-admin/app"
);

const {
  getFirestore
} = require(
  "firebase-admin/firestore"
);

const legacy =
  require(
    "./index"
  );

const {
  koreaDateKey,
  nonnegative,
  summarizeLunaTerra
} = require(
  "./ai-v2-feature-usage"
);

if (!getApps().length) {
  initializeApp();
}

const db =
  getFirestore();

function bloomingV2Summary(
  data
) {
  return {
    runs:
      nonnegative(
        data?.bloomingV2Runs
      ),

    preparedQuestions:
      nonnegative(
        data
          ?.bloomingV2PreparedQuestions
      ),

    ...summarizeLunaTerra(
      data,
      "bloomingV2"
    )
  };
}

function betweenThoughtsV2Summary(
  data
) {
  const routed =
    summarizeLunaTerra(
      data,
      "betweenThoughtsV2"
    );

  const aggregateTotalTokens =
    nonnegative(
      data
        ?.betweenThoughtsV2TotalTokens
    );

  return {
    curationAttempts:
      nonnegative(
        data
          ?.betweenThoughtsV2CurationAttempts
      ),

    questionAttempts:
      nonnegative(
        data
          ?.betweenThoughtsV2QuestionAttempts
      ),

    curations:
      nonnegative(
        data
          ?.betweenThoughtsV2Curations
      ),

    questions:
      nonnegative(
        data
          ?.betweenThoughtsV2Questions
      ),

    aggregateInputTokens:
      nonnegative(
        data
          ?.betweenThoughtsV2InputTokens
      ),

    aggregateCachedInputTokens:
      nonnegative(
        data
          ?.betweenThoughtsV2CachedInputTokens
      ),

    aggregateOutputTokens:
      nonnegative(
        data
          ?.betweenThoughtsV2OutputTokens
      ),

    aggregateTotalTokens,

    // V2 초기 운영 중에는 Luna/Terra를 분리하지 않고
    // total만 저장했다. 그 과거분은 버리지 않고 별도로 표시한다.
    unclassifiedTotalTokens:
      Math.max(
        0,
        aggregateTotalTokens -
        routed.totalTokens
      ),

    ...routed
  };
}

function buildV2UsageOverview(
  base,
  data
) {
  const bloomingV2 =
    bloomingV2Summary(
      data
    );

  const betweenThoughtsV2 =
    betweenThoughtsV2Summary(
      data
    );

  const baseTotal =
    nonnegative(
      base?.totalEstimatedCostUsd
    );

  const v2Extra =
    bloomingV2
      .totalEstimatedCostUsd +
    betweenThoughtsV2
      .totalEstimatedCostUsd;

  return {
    ...base,

    bloomingV2,
    betweenThoughtsV2,

    totalEstimatedCostUsd:
      Number(
        (
          baseTotal +
          v2Extra
        ).toFixed(8)
      )
  };
}

async function usageOverviewHandler(
  request
) {
  const uid =
    String(
      request?.auth?.uid ||
      ""
    ).trim();

  if (!uid) {
    throw new HttpsError(
      "unauthenticated",
      "Google 로그인 후 확인할 수 있습니다."
    );
  }

  const base =
    await legacy
      .studioGardenerUsage
      .run(request);

  const snap =
    await db
      .collection("users")
      .doc(uid)
      .collection("aiUsage")
      .doc(
        koreaDateKey()
      )
      .get();

  const data =
    snap.exists
      ? snap.data() || {}
      : {};

  return buildV2UsageOverview(
    base,
    data
  );
}

const studioGardenerUsageV2 =
  onCall(
    {
      region:
        "us-central1",

      timeoutSeconds:
        60,

      memory:
        "256MiB",

      maxInstances:
        3
    },

    usageOverviewHandler
  );

module.exports = {
  bloomingV2Summary,
  betweenThoughtsV2Summary,
  buildV2UsageOverview,
  usageOverviewHandler,
  studioGardenerUsageV2
};

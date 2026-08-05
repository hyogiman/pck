// Thought Garden v63 · Existing Between Thoughts answer context backfill
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("node:crypto");

const adminApp = getApps().length ? getApps()[0] : initializeApp();
const db = getFirestore();

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_VERSION = 1;
const MAX_EMBEDDING_TEXT_CHARS = 12000;
const THOUGHT_INDEX_MODEL = "gpt-5.4-mini";
const THOUGHT_INDEX_VERSION = 2;
const THOUGHT_INDEX_MAX_BATCH = 8;
const THOUGHT_INDEX_IMAGE_DETAIL = "high";
const THOUGHT_INDEX_MAX_IMAGES_PER_FRAGMENT = 6;
const THOUGHT_INDEX_VISION_VERSION = 2;
const BETWEEN_THOUGHTS_PROMPT_CONTEXT_VERSION = 1;

const STUDIO_GARDENER_MODEL = "gpt-5.4-mini";
const BLOOMING_INTERVIEW_MODEL = STUDIO_GARDENER_MODEL;
const BLOOMING_INTERVIEW_DAILY_LIMIT = 6;
const BETWEEN_THOUGHTS_MODEL = STUDIO_GARDENER_MODEL;
const BETWEEN_THOUGHTS_DAILY_LIMIT = 12;
const BETWEEN_THOUGHTS_CURATION_DAILY_LIMIT = 4;
const BETWEEN_THOUGHTS_CURATION_MAX_CANDIDATES = 18;
const BETWEEN_THOUGHTS_SCOUT_PAIR_COUNT = 3;
const BETWEEN_THOUGHTS_CURATION_PAIR_COUNT = 1;
const BETWEEN_THOUGHTS_QUEUE_SCHEMA_VERSION = 3;
const STUDIO_PATH_MAX_THREAD_FRAGMENTS = 36;
const STUDIO_PATH_SCOUT_COUNT = 5;
const STUDIO_PATH_RESULT_COUNT = 3;
const STUDIO_GARDENER_BASE_DAILY_LIMIT = 30;
const STUDIO_GARDENER_LIMIT_STEP = 10;
const STUDIO_GARDENER_MAX_DAILY_LIMIT = 100;

// 2026-07 기준 GPT-5.4 mini 표준 API 가격.
// 실제 청구액이 아니라 OpenAI 응답의 실제 usage token에 이 단가를 곱한 "추정값"에만 사용한다.
const STUDIO_GARDENER_INPUT_USD_PER_M = 0.75;
const STUDIO_GARDENER_CACHED_INPUT_USD_PER_M = 0.075;
const STUDIO_GARDENER_OUTPUT_USD_PER_M = 4.50;
// 2026-07 OpenAI 공식 모델 문서 기준 text-embedding-3-small 표준 가격.
const EMBEDDING_INPUT_USD_PER_M = 0.02;
const STUDIO_GARDENER_MIN_CHARS = 40;
const STUDIO_GARDENER_COOLDOWN_MS = 60 * 1000;

const STUDIO_META = {
  blog: {
    hook: ["1. 여는 글", "독자가 멈춰 읽게 할 내 경험이나 질문은?"],
    experience: ["2. 소제목 ① — 나의 경험", "내가 실제로 겪은 장면·실패·사건은?"],
    outside: ["3. 소제목 ② — 외부의 시선", "책·미디어·누군가의 말 중 이 생각을 확장한 재료는?"],
    meaning: ["4. 소제목 ③ — 나의 해석", "그래서 나는 이것을 어떻게 다르게 보게 되었나?"],
    counter: ["5. 반론", "반대로 생각하는 사람은 뭐라고 말할까? 내가 합리화하고 있는 건 없나?"],
    conclusion: ["6. 닫는 글", "지금 시점에서 내가 말하고 싶은 한 문장은?"],
  },
  shorts: {
    hook: ["1. 3초 훅 (첫 대사)", "스크롤을 멈추게 할 첫 마디는? 말하듯 짧게."],
    situation: ["2. 상황 설명", "맥락을 두세 문장으로. 실제 내뱉을 말투로."],
    turn: ["3. 반전 · 전환", "'그런데' 이후에 올 예상 밖의 생각은?"],
    point: ["4. 핵심 한 문장", "이 영상이 남길 단 하나의 메시지는?"],
    close: ["5. 마무리 · 클로징", "끝맺는 말과 남길 질문은?"],
  },
  instagram: {
    cover: ["1. 표지 문구", "한 장에 박힐 굵은 한 문장은? (12자 안팎)"],
    body: ["2. 핵심 3줄", "내용을 딱 세 줄로 압축한다면?"],
    quote: ["3. 인용 한 줄", "카드에 얹을 책·영상 속 문장은?"],
    caption: ["4. 캡션", "짧은 소개 글. 왜 이 생각을 남겼는지."],
    tags: ["5. 해시태그", "이 글을 찾을 사람들이 검색할 말은?"],
  },
  podcast: {
    open: ["1. 오프닝 질문", "오늘 청취자에게 던질 질문은?"],
    line: ["2. 책/미디어 한 줄", "오늘 이야기를 여는 외부의 한 줄은?"],
    experience: ["3. 내 경험", "그 한 줄과 맞닿는 내 실제 이야기는?"],
    counter: ["4. 반론", "이 생각에 가장 날카롭게 반박한다면?"],
    meaning: ["5. 내 생각", "반론을 지나고도 남는 내 생각은?"],
    question: ["6. 청취자 질문", "듣는 사람에게 어떤 질문을 남길까?"],
  },
};

// 정원사는 '문항 이름'만 보고 질문하지 않고,
// 글 전체에서 이 문항이 맡아야 할 고유한 사고 역할을 참고한다.
const STUDIO_GARDENER_GUIDE = {
  blog: {
    hook: "독자가 글에 들어오게 만드는 구체적 장면·긴장·문제의식을 연다. 뒤 문항에서 다룰 원인 분석이나 결론을 미리 반복하지 않는다.",
    experience: "사용자가 실제로 겪은 사건·행동·감정·장면을 구체화한다. 이미 말한 추상적 이유를 다른 표현으로 다시 묻지 않는다.",
    outside: "책·미디어·타인의 말 같은 외부 재료가 사용자의 생각을 어떻게 흔들거나 넓혔는지 묻는다. 앞선 개인 경험을 재진술하게 만들지 않는다.",
    meaning: "앞의 경험과 외부 시선을 연결해 사용자의 관점 변화·해석·의미를 꺼낸다. 앞서 나열한 원인이나 사건을 또 수집하지 않는다.",
    counter: "지금까지 세운 주장에 실제로 동의하지 않는 합리적인 독자의 관점을 연다. 반대 주장, 반례, 예외·경계조건, 대가·트레이드오프, 의도치 않은 결과, 대안적 해석 중 아직 다루지 않은 방향을 택한다. 앞에서 이미 다룬 원인·어려움·감정을 '다른 이유가 더 있나', '빠뜨린 이유가 있나' 식으로 다시 묻지 않는다.",
    conclusion: "새 논점을 더 벌리기보다 지금까지의 탐색 뒤에 남은 생각·변화·선택·열린 질문을 묻는다. 본문에서 이미 한 말을 요약하게만 만들지 않는다.",
  },
  shorts: {
    hook: "첫 3초에 시청자의 주의를 붙잡을 갈등·의외성·구체성을 찾는다.",
    situation: "훅을 반복하지 말고 필요한 맥락만 짧게 보충한다.",
    turn: "앞에서 예상 가능한 흐름과 다른 전환점·모순·새 관점을 찾는다.",
    point: "앞선 내용에서 아직 명료하게 말하지 않은 핵심 메시지를 한 축으로 좁힌다.",
    close: "핵심을 반복 설명하지 말고 여운·행동·질문 중 하나로 닫는다.",
  },
  instagram: {
    cover: "내용 전체의 가장 선명한 긴장이나 메시지를 찾는다.",
    body: "표지 문구를 반복하지 말고 근거·맥락·변화를 보충한다.",
    quote: "본문과 다른 외부 목소리나 장면으로 의미를 확장한다.",
    caption: "카드 내용을 복사하지 말고 왜 이 생각을 남기는지 개인 맥락을 연다.",
    tags: "내용을 반복 설명하지 않고 발견 가능성을 높일 핵심 개념을 고른다.",
  },
  podcast: {
    open: "청취자가 자신의 경험을 떠올릴 수 있는 입구를 연다.",
    line: "오프닝 질문을 반복하지 않고 이야기를 흔들 외부 재료를 찾는다.",
    experience: "외부 재료와 맞닿는 실제 개인 경험을 구체화한다.",
    counter: "앞선 주장에 대한 반대 주장·반례·대가·예외 중 아직 다루지 않은 관점을 연다. 이미 말한 이유를 더 찾게 하지 않는다.",
    meaning: "반론을 통과한 뒤에도 남는 관점의 변화나 핵심을 묻는다.",
    question: "방송 내용을 다시 요약시키지 말고 청취자에게 남길 열린 질문을 만든다.",
  },
};

exports.bookSearch = onRequest(
  {
    region: "us-central1",
    cors: ["https://hyogiman.github.io"],
    secrets: ["ALADIN_TTB_KEY"],
    timeoutSeconds: 30,
    maxInstances: 2,
  },
  async (req, res) => {
    const query = String(req.query.q || "").trim();
    if (!query) {
      res.status(400).json({ ok: false, error: "검색어가 없습니다." });
      return;
    }

    const key = process.env.ALADIN_TTB_KEY;
    if (!key) {
      res.status(500).json({ ok: false, error: "서버에 ALADIN_TTB_KEY Secret이 설정되지 않았습니다." });
      return;
    }

    const url = new URL("http://www.aladin.co.kr/ttb/api/ItemSearch.aspx");
    url.searchParams.set("TTBKey", key);
    url.searchParams.set("Query", query);
    url.searchParams.set("QueryType", "Keyword");
    url.searchParams.set("MaxResults", "20");
    url.searchParams.set("start", "1");
    url.searchParams.set("SearchTarget", "Book");
    url.searchParams.set("Cover", "Big");
    url.searchParams.set("Output", "JS");
    url.searchParams.set("Version", "20131101");

    try {
      const upstream = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "Accept": "application/json,text/plain,*/*",
          "User-Agent": "ThoughtGarden/1.0",
        },
      });

      const raw = await upstream.text();

      if (!upstream.ok) {
        logger.error("Aladin HTTP error", upstream.status, raw.slice(0, 500));
        res.status(502).json({
          ok: false,
          error: `알라딘 API HTTP ${upstream.status}: ${raw.replace(/\s+/g, " ").slice(0, 180)}`,
        });
        return;
      }

      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        logger.error("Aladin non-JSON response", raw.slice(0, 1000));
        res.status(502).json({
          ok: false,
          error: `알라딘이 JSON이 아닌 응답을 반환했습니다: ${raw.replace(/\s+/g, " ").slice(0, 180)}`,
        });
        return;
      }

      if (data?.errorCode || data?.errorMessage) {
        res.status(502).json({
          ok: false,
          error: `알라딘 API 오류: ${data.errorMessage || data.errorCode}`,
        });
        return;
      }

      res.status(200).json({
        ok: true,
        totalResults: Number(data?.totalResults || 0),
        items: Array.isArray(data?.item) ? data.item : [],
      });
    } catch (error) {
      logger.error("Aladin request failed", error);
      res.status(502).json({
        ok: false,
        error: `알라딘 서버 연결 실패: ${error?.message || "unknown error"}`,
      });
    }
  }
);

function safeId(raw, label) {
  const value = String(raw || "").trim();
  if (!value || value.length > 200 || value.includes("/")) {
    throw new HttpsError("invalid-argument", `${label} ID가 올바르지 않습니다.`);
  }
  return value;
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// 두 생각 사이에서 나온 새 생각은 원문 두 개를 다시 보내지 않는다.
// 질문을 만들 때 이미 생성된 연결 메모와 기존 다층 색인의 짧은 요약만
// "사고를 촉발한 맥락"으로 재사용한다. 이 정보는 사용자의 주장과 구분된다.
function thoughtPromptContext(fragment) {
  if (Number(fragment?.betweenThoughtsPromptContextVersion || 0) < BETWEEN_THOUGHTS_PROMPT_CONTEXT_VERSION) return null;
  const question = balancedText(fragment?.betweenThoughtsQuestion, 420);
  const connectionSummary = balancedText(
    fragment?.betweenThoughtsContextSummary || fragment?.betweenThoughtsBridge,
    620
  );
  const sourceSummaries = (Array.isArray(fragment?.betweenThoughtsSourceSummaries)
    ? fragment.betweenThoughtsSourceSummaries
    : [])
    .map((value) => balancedText(value, 260))
    .filter(Boolean)
    .slice(0, 2);
  if (!question && !connectionSummary && !sourceSummaries.length) return null;
  return {
    kind: "between_thoughts",
    provenance: "ai_generated_prompt",
    question,
    connectionSummary,
    sourceSummaries,
  };
}

function buildEmbeddingText(fragment) {
  const parts = [];
  const thought = typeof fragment?.thought === "string" ? fragment.thought.trim() : "";
  const externalText = typeof fragment?.externalText === "string" ? fragment.externalText.trim() : "";
  const context = typeof fragment?.context === "string" ? fragment.context.trim() : "";
  const promptContext = thoughtPromptContext(fragment);

  if (thought) parts.push(`내 생각:\n${thought}`);
  if (externalText) parts.push(`함께 남긴 문장·장면:\n${externalText}`);
  // AI 질문이 따로 구조화되어 있으면 화면 표시용 context를 중복 전송하지 않는다.
  if (context && !promptContext) parts.push(`기록 맥락:\n${context}`);
  if (promptContext) {
    const promptLines = [
      promptContext.question ? `AI가 제시한 질문: ${promptContext.question}` : "",
      promptContext.connectionSummary ? `두 생각을 연결한 압축 맥락: ${promptContext.connectionSummary}` : "",
      promptContext.sourceSummaries.length ? `출발 생각의 짧은 요약: ${promptContext.sourceSummaries.join(" / ")}` : "",
    ].filter(Boolean);
    if (promptLines.length) {
      parts.push(`생각을 촉발한 맥락(사용자의 새 주장 아님):\n${promptLines.join("\n")}`);
    }
  }

  // 임베딩 모델은 이미지를 직접 받지 않으므로, 고화질 사진 분석에서 얻은
  // 시각 색인을 짧은 텍스트로 합쳐 사진의 의미도 관련 생각 검색에 반영한다.
  const visual = normalizeThoughtIndex(fragment?.aiIndex)?.visualContext;
  if (visual?.hasImages) {
    const visualLines = [
      visual.visibleEvidence.length ? `사진에서 확인된 맥락: ${visual.visibleEvidence.join(" / ")}` : "",
      visual.visibleText.length ? `사진 속 문자: ${visual.visibleText.join(" / ")}` : "",
      visual.attachmentIntents.length ? `사진을 붙인 의도 후보: ${visual.attachmentIntents.map((x) => x.value).join(" / ")}` : "",
      visual.emotionalFunctions.length ? `사진의 정서적 기능: ${visual.emotionalFunctions.map((x) => x.value).join(" / ")}` : "",
      visual.relationExplanation ? `글과 사진의 관계: ${visual.relationExplanation}` : "",
      visual.latentContexts.length ? `사진이 더한 말하지 않은 맥락: ${visual.latentContexts.map((x) => x.value).join(" / ")}` : "",
    ].filter(Boolean);
    if (visualLines.length) parts.push(`첨부 사진 색인:\n${visualLines.join("\n")}`);
  }

  return parts.join("\n\n").slice(0, MAX_EMBEDDING_TEXT_CHARS);
}

async function requestEmbeddings(inputs) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.error("OPENAI_API_KEY secret is unavailable");
    throw new HttpsError("failed-precondition", "AI 연결 설정을 확인해주세요.");
  }

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: inputs,
        encoding_format: "float",
      }),
    });
  } catch (error) {
    logger.error("OpenAI embedding network failure", {
      name: error?.name,
      message: error?.message,
    });
    throw new HttpsError("unavailable", "AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }

  if (!response.ok) {
    logger.error("OpenAI embedding HTTP error", {
      status: response.status,
      code: payload?.error?.code || null,
      type: payload?.error?.type || null,
    });
    throw new HttpsError("internal", "AI 의미 분석에 실패했습니다.");
  }

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  if (rows.length !== inputs.length) {
    logger.error("OpenAI embedding response size mismatch", {
      expected: inputs.length,
      actual: rows.length,
    });
    throw new HttpsError("internal", "AI 의미 분석 결과 개수가 맞지 않습니다.");
  }

  const vectors = rows
    .sort((a, b) => Number(a.index) - Number(b.index))
    .map((row) => row.embedding);

  if (vectors.some((v) => !Array.isArray(v) || !v.length || v.some((n) => !Number.isFinite(n)))) {
    logger.error("OpenAI embedding response had invalid vector");
    throw new HttpsError("internal", "AI 의미 분석 결과가 올바르지 않습니다.");
  }

  return {
    vectors,
    totalTokens: Number(payload?.usage?.total_tokens || 0),
  };
}

async function ensureFragmentEmbedding(uid, fragmentRef, fragment) {
  const text = buildEmbeddingText(fragment);
  if (!text) return { ok: true, skipped: true, reason: "no-text", inputTokens: 0 };

  const textHash = sha256(text);
  const current =
    fragment.embedding &&
    fragment.embeddingModel === EMBEDDING_MODEL &&
    fragment.embeddingVersion === EMBEDDING_VERSION &&
    fragment.embeddingTextHash === textHash;

  if (current) {
    return { ok: true, skipped: true, reason: "already-current", model: EMBEDDING_MODEL, inputTokens: 0 };
  }

  const result = await requestEmbeddings([text]);
  const vector = result.vectors[0];
  const usageRef = db.collection("users").doc(uid).collection("aiUsage").doc(koreaDateKey());
  const batch = db.batch();
  batch.set(fragmentRef, {
    embedding: FieldValue.vector(vector),
    embeddingModel: EMBEDDING_MODEL,
    embeddingVersion: EMBEDDING_VERSION,
    embeddingTextHash: textHash,
    embeddingDimensions: vector.length,
    embeddingInputTokens: result.totalTokens,
    embeddingUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(usageRef, {
    fragmentEmbeddingTokens: FieldValue.increment(result.totalTokens),
    fragmentEmbeddingCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  return {
    ok: true, skipped: false, model: EMBEDDING_MODEL, dimensions: vector.length,
    inputTokens: result.totalTokens,
  };
}

exports.embedFragment = onCall(
  {
    region: "us-central1",
    secrets: ["OPENAI_API_KEY"],
    timeoutSeconds: 30,
    memory: "256MiB",
    maxInstances: 3,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");

    const fragmentId = safeId(request.data?.fragmentId, "생각 조각");
    const fragmentRef = db.collection("users").doc(uid).collection("fragments").doc(fragmentId);
    const fragmentSnap = await fragmentRef.get();
    if (!fragmentSnap.exists) throw new HttpsError("not-found", "생각 조각을 찾지 못했습니다.");
    const fragment = fragmentSnap.data() || {};
    if (fragment.deletedAt) throw new HttpsError("failed-precondition", "휴지통의 생각 조각은 분석하지 않습니다.");
    return ensureFragmentEmbedding(uid, fragmentRef, fragment);
  }
);

/**
 * 기존 Fragment에 임베딩이 없거나 현재 텍스트와 해시가 다른 것만 묶어서 변환한다.
 * 한 호출당 최대 25개. 클라이언트가 remaining=0이 될 때까지 반복 호출한다.
 */
exports.backfillEmbeddings = onCall(
  {
    region: "us-central1",
    secrets: ["OPENAI_API_KEY"],
    timeoutSeconds: 60,
    memory: "512MiB",
    maxInstances: 1,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");

    const requested = Number(request.data?.limit || 25);
    const limit = Math.max(1, Math.min(25, Number.isFinite(requested) ? Math.floor(requested) : 25));

    const col = db.collection("users").doc(uid).collection("fragments");
    const snap = await col.get();
    const pending = [];
    let liveCount = 0;

    snap.forEach((doc) => {
      const data = doc.data() || {};
      if (data.deletedAt) return;
      liveCount++;

      const text = buildEmbeddingText(data);
      if (!text) return;
      const textHash = sha256(text);

      const current =
        data.embedding &&
        data.embeddingModel === EMBEDDING_MODEL &&
        data.embeddingVersion === EMBEDDING_VERSION &&
        data.embeddingTextHash === textHash;

      if (!current) pending.push({ ref: doc.ref, text, textHash });
    });

    const batchItems = pending.slice(0, limit);
    if (!batchItems.length) {
      return { ok: true, processed: 0, remaining: 0, liveCount };
    }

    const result = await requestEmbeddings(batchItems.map((x) => x.text));
    const batch = db.batch();

    batchItems.forEach((item, i) => {
      const vector = result.vectors[i];
      batch.set(
        item.ref,
        {
          embedding: FieldValue.vector(vector),
          embeddingModel: EMBEDDING_MODEL,
          embeddingVersion: EMBEDDING_VERSION,
          embeddingTextHash: item.textHash,
          embeddingDimensions: vector.length,
          embeddingUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    const usageRef = db.collection("users").doc(uid).collection("aiUsage").doc(koreaDateKey());
    batch.set(
      usageRef,
      {
        fragmentEmbeddingTokens: FieldValue.increment(result.totalTokens),
        fragmentEmbeddingCount: FieldValue.increment(batchItems.length),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await batch.commit();

    return {
      ok: true,
      processed: batchItems.length,
      remaining: Math.max(0, pending.length - batchItems.length),
      liveCount,
      batchInputTokens: result.totalTokens,
    };
  }
);

/**
 * 현재 Fragment의 벡터와 가까운 과거 생각을 찾는다.
 * 사용자에게는 embedding 자체를 반환하지 않는다.
 */
exports.findRelatedFragments = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
    maxInstances: 10,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");

    const fragmentId = safeId(request.data?.fragmentId, "생각 조각");
    const col = db.collection("users").doc(uid).collection("fragments");
    const currentSnap = await col.doc(fragmentId).get();

    if (!currentSnap.exists) throw new HttpsError("not-found", "생각 조각을 찾지 못했습니다.");

    const current = currentSnap.data() || {};
    if (current.deletedAt) return { ok: true, items: [], reason: "deleted" };

    const vectorValue = current.embedding;
    const queryVector =
      vectorValue && typeof vectorValue.toArray === "function" ? vectorValue.toArray() : null;

    if (!Array.isArray(queryVector) || !queryVector.length) {
      return { ok: true, items: [], reason: "no-embedding" };
    }

    let vectorSnap;
    try {
      vectorSnap = await col.findNearest({
        vectorField: "embedding",
        queryVector,
        limit: 12,
        distanceMeasure: "COSINE",
        distanceResultField: "vectorDistance",
      }).get();
    } catch (error) {
      logger.error("Firestore vector search failed", {
        code: error?.code || null,
        message: error?.message || null,
      });
      throw new HttpsError("internal", "의미 기반 관련 생각 검색에 실패했습니다.");
    }

    const currentThreads = new Set(Array.isArray(current.threadIds) ? current.threadIds : []);
    const excluded = new Set(Array.isArray(current.continuedFrom) ? current.continuedFrom : []);
    const items = [];

    vectorSnap.forEach((doc) => {
      if (doc.id === fragmentId) return;

      const data = doc.data() || {};
      if (data.deletedAt) return;
      if (excluded.has(doc.id)) return;
      if (Array.isArray(data.continuedFrom) && data.continuedFrom.includes(fragmentId)) return;

      const distance = Number(data.vectorDistance);
      if (!Number.isFinite(distance) || distance > 0.65) return;

      let score = Math.max(0, 1 - distance);
      if (current.sourceId && current.sourceId === data.sourceId) score += 0.05;
      if (
        Array.isArray(data.threadIds) &&
        data.threadIds.some((threadId) => currentThreads.has(threadId))
      ) {
        score += 0.03;
      }

      items.push({
        id: doc.id,
        distance,
        score,
      });
    });

    items.sort((a, b) => b.score - a.score);

    return {
      ok: true,
      items: items.slice(0, 3),
      model: current.embeddingModel || EMBEDDING_MODEL,
    };
  }
);

function koreaDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function reserveStudioGardenerQuota(uid) {
  const ref = db.collection("users").doc(uid).collection("aiUsage").doc(koreaDateKey());

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const used = Number(data.studioQuestions || 0);
    const limit = Math.max(
      STUDIO_GARDENER_BASE_DAILY_LIMIT,
      Math.min(
        STUDIO_GARDENER_MAX_DAILY_LIMIT,
        Number(data.studioDailyLimit || STUDIO_GARDENER_BASE_DAILY_LIMIT)
      )
    );

    if (used >= limit) {
      throw new HttpsError(
        "resource-exhausted",
        `Studio 정원사는 오늘 ${limit}번까지 새 질문을 만듭니다. 설정에서 10회씩 한도를 늘릴 수 있습니다.`
      );
    }

    tx.set(
      ref,
      {
        studioQuestions: used + 1,
        studioDailyLimit: limit,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { used: used + 1, limit };
  });
}

async function requestStudioQuestion(context) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.error("OPENAI_API_KEY secret is unavailable");
    throw new HttpsError("failed-precondition", "AI 연결 설정을 확인해주세요.");
  }

  const systemPrompt = [
    "당신은 '생각의 텃밭' Studio의 정원사다.",
    "사용자가 자신의 글을 직접 쓰도록 돕되, 절대로 글의 답이나 문장을 대신 작성하지 않는다.",
    "프로젝트 제목, Thread의 생각 조각, 앞서 작성한 모든 칸, 현재 문항의 초안을 함께 보고 '현재 선택한 문항'에 질문 하나만 건넨다.",
    "attachedMaterials와 글의 출발 재료에는 original이 들어올 수 있다. original.thought/context는 사용자의 실제 기록이고 original.sourceExcerpt는 외부 문장일 수 있으므로 반드시 구분해서 읽는다.",
    "original이 있는 핵심 재료는 색인보다 우선한다. 질문의 구체적 근거와 사용자의 의도 판단은 원문에서 찾고, index는 어떤 부분을 살펴볼지 알려주는 지도와 배경 정보로만 쓴다.",
    "긴 원문 안의 줄바꿈된 '…'는 가운데 일부가 길이 때문에 생략됐다는 표시다. 생략된 내용을 추정해 채우지 않는다.",
    "index의 inferredIntents, valuesOrNeeds, emotions, tensions, alternateReadings는 근거와 confidence가 붙은 가설이다. 원문이 뒷받침하지 않으면 사실처럼 전제하거나 질문 속에 선언하지 않는다.",
    "index의 visualAttachmentIntents·visualEmotionalFunctions·visualLatentContexts는 사용자가 사진을 비언어적 문장처럼 붙였다고 보고 만든 해석 후보다. 사진의 단순 사물 정보보다 글에 더해진 상황·대비·정서를 보되, confidence가 낮거나 원문과 어긋나면 질문의 전제로 쓰지 않는다.",
    "Thread의 넓은 배경 재료는 index만 들어올 수 있다. 이 경우 후보 방향을 참고할 수는 있지만, 색인만으로 사용자의 숨은 의도나 감정을 단정하지 않는다.",
    "가장 중요한 원칙은 중복 회피다. 질문을 만들기 전에 previousSlots와 currentDraft에서 이미 다룬 주장·원인·사례·감정·결론을 내부적으로 파악한다.",
    "이미 답이 적혀 있는 내용, 또는 앞선 문항에서 충분히 다룬 내용을 표현만 바꿔 다시 묻지 않는다.",
    "먼저 '앞에서 이미 간 방향'과 '현재 문항만이 할 수 있는 고유한 역할'을 구분한 뒤, 아직 가지 않은 사고 방향 하나를 고른다. 이 내부 분석은 출력하지 않는다.",
    "targetSlotGuide가 있으면 문항 제목보다 그 가이드를 우선해 질문의 방향을 정한다.",
    "현재 문항에 초안이 있다면 그 초안에서 아직 말하지 않은 구체성·긴장·예외·의미를 파고들되, 이미 명시된 내용을 다시 확인시키지 않는다.",
    "특히 반론(counter) 문항에서는 '또 다른 원인/빠뜨린 이유'를 찾는 질문보다 반대 주장, 반례, 예외·경계조건, 대가·트레이드오프, 의도치 않은 결과, 대안적 해석을 우선한다.",
    "previousGardenerQuestion이 있으면 같은 질문이나 같은 사고 축을 반복하지 말고 다른 유효한 각도를 선택한다.",
    "질문은 targetSlotTitle/targetSlotPurpose에 실제로 도움이 되어야 하지만, 문항 이름을 기계적으로 바꿔 말한 질문이어서는 안 된다.",
    "칭찬, 요약, 평가, 교훈, 진단, 처방, 결론 제시는 하지 않는다.",
    "사용자가 제공하지 않은 사실을 만들지 않는다.",
    "질문은 한 번 읽고 바로 뜻이 잡히는 일상적인 한국어로 쓴다.",
    "한 질문에는 한 가지만 묻는다. 두 질문을 '그리고', '또는', 쉼표로 이어 붙이지 않는다.",
    "은유적 표현, 시적인 문장, 추상적인 명사 나열, 개념을 작은따옴표로 감싸 새로 정의하는 방식을 피한다.",
    "'어떤 긴장 속에서 드러나는가', '무엇을 붙잡고 싶은가', '어떤 의미로 남는가'처럼 바로 답하기 어려운 문어체를 쓰지 않는다.",
    "가능하면 '언제였어?', '무슨 일이 있었어?', '그때 무엇을 했어?', '왜 그렇게 생각했어?'처럼 실제 장면이나 행동이 떠오르는 질문으로 쓴다.",
    "사용자가 쓴 단어를 우선 사용하고, 질문은 60자 안팎이며 최대 90자를 넘지 않는다.",
    "같은 종류의 '왜?' 질문만 반복하지 말고 concrete, why, counter, emotion, change, implication 중 가장 유용한 한 유형을 고른다.",
    "내용이 심하게 불안하거나 위험한 상황을 암시하면 위험한 사고를 더 파고들게 하지 말고, 지금의 안전·도움·지지로 시선을 돌리는 부드러운 질문을 고른다.",
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: STUDIO_GARDENER_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(context) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "studio_gardener_question",
          strict: true,
          schema: {
            type: "object",
            properties: {
              question: { type: "string" },
              type: {
                type: "string",
                enum: ["concrete", "why", "counter", "emotion", "change", "implication"],
              },
            },
            required: ["question", "type"],
            additionalProperties: false,
          },
        },
      },
      max_completion_tokens: 180,
    }),
  });

  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }

  if (!response.ok) {
    logger.error("OpenAI Studio gardener HTTP error", {
      status: response.status,
      code: payload?.error?.code || null,
      type: payload?.error?.type || null,
    });
    throw new HttpsError("internal", "Studio 정원사 질문을 만들지 못했습니다.");
  }

  const raw = payload?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) {
    logger.error("Studio gardener returned empty content");
    throw new HttpsError("internal", "Studio 정원사 질문이 비어 있습니다.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    logger.error("Studio gardener returned invalid JSON");
    throw new HttpsError("internal", "Studio 정원사 질문 형식이 올바르지 않습니다.");
  }

  const question = String(parsed?.question || "").trim().slice(0, 110);
  const type = String(parsed?.type || "").trim();

  if (!question) {
    throw new HttpsError("internal", "Studio 정원사 질문이 비어 있습니다.");
  }

  return {
    question,
    type,
    model: STUDIO_GARDENER_MODEL,
    inputTokens: Number(payload?.usage?.prompt_tokens || 0),
    cachedInputTokens: Number(payload?.usage?.prompt_tokens_details?.cached_tokens || 0),
    outputTokens: Number(payload?.usage?.completion_tokens || 0),
  };
}

function balancedText(value, maxChars) {
  const text = String(value || "").trim();
  const limit = Math.max(80, Number(maxChars || 0));
  if (!text || text.length <= limit) return text;
  const separator = "\n…\n";
  const bodyLimit = Math.max(20, limit - separator.length);
  const head = Math.ceil(bodyLimit * 0.58);
  const tail = bodyLimit - head;
  return text.slice(0, head).trimEnd() + separator + text.slice(-tail).trimStart();
}

function studioOriginalRecord(data, maxChars = 6200) {
  let remaining = Math.max(800, Number(maxChars || 6200));
  const take = (value, limit) => {
    const text = String(value || "").trim();
    if (!text || remaining <= 0) return "";
    const out = balancedText(text, Math.min(limit, remaining));
    remaining -= out.length;
    return out;
  };
  // 작성자의 생각과 맥락을 외부 인용보다 먼저 보존한다.
  const thought = take(data?.thought || data?.text, 4200);
  const context = take(data?.context, 900);
  const sourceExcerpt = take(data?.externalText, 2200);
  return {
    thought,
    context,
    sourceExcerpt,
    locator: String(data?.locator || "").trim().slice(0, 180),
  };
}

function studioMaterialCharCount(material) {
  const original = material?.original || {};
  return String(original.thought || "").length + String(original.context || "").length + String(original.sourceExcerpt || "").length;
}

function compactStudioMaterial(data, options = {}) {
  const includeOriginal = options.includeOriginal === true;
  const excerptLimit = Math.max(240, Math.min(900, Number(options.excerptLimit || 650)));
  const originalLimit = Math.max(800, Math.min(7200, Number(options.originalLimit || 6200)));
  const raw = [data?.context, data?.thought || data?.text, data?.externalText].filter(Boolean).join("\n").trim();
  if (!raw) return null;

  const normalized = normalizeThoughtIndex(data?.aiIndex);
  const compact = normalized ? compactBetweenThoughtProfile(String(options.fragmentId || ""), normalized, data?.date || data?.createdAt) : null;
  let index = null;
  if (compact?.core) {
    const { id, date, ...rest } = compact;
    index = rest;
  }

  if (includeOriginal) {
    return {
      fragmentId: String(options.fragmentId || ""),
      index,
      original: studioOriginalRecord(data, originalLimit),
    };
  }

  if (index) return { fragmentId: String(options.fragmentId || ""), index };
  return { fragmentId: String(options.fragmentId || ""), excerpt: raw.slice(0, excerptLimit) };
}

/**
 * Studio의 '현재 선택한 문항'을 더 잘 쓰게 하는 질문 하나를 만든다.
 *
 * generate=false: 현재 맥락과 정확히 맞는 캐시 질문만 조회 (OpenAI 호출 없음)
 * generate=true : 제목 + Thread 재료 + 앞서 쓴 모든 칸 + 현재 문항의 역할/초안/기존 정원사 질문을 종합해 중복되지 않는 질문 생성.
 *
 * 이 함수는 사용자가 직접 선택한 target slot 하나만 대상으로 한다.
 * 빈 문항이면 시작 질문, 초안이 있으면 같은 문항을 더 깊게 만드는 질문을 만든다.
 */
exports.studioGardenerQuestion = onCall(
  {
    region: "us-central1",
    secrets: ["OPENAI_API_KEY"],
    timeoutSeconds: 60,
    memory: "512MiB",
    maxInstances: 3,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");

    const projectId = safeId(request.data?.projectId, "Studio");
    const slotId = safeId(request.data?.slotId, "Studio 칸");
    const generate = request.data?.generate === true;

    const userRef = db.collection("users").doc(uid);
    const settingsSnap = await userRef.collection("settings").doc("private").get();
    const enabled = settingsSnap.exists && settingsSnap.data()?.studioGardenerEnabled === true;

    if (!enabled) return { ok: true, enabled: false, question: null };

    const projectSnap = await userRef.collection("projects").doc(projectId).get();
    if (!projectSnap.exists) throw new HttpsError("not-found", "Studio 프로젝트를 찾지 못했습니다.");

    const project = projectSnap.data() || {};
    const slots = Array.isArray(project.slots) ? project.slots : [];
    const slotIndex = slots.findIndex((s) => s?.id === slotId);
    if (slotIndex < 0) throw new HttpsError("not-found", "Studio 칸을 찾지 못했습니다.");

    const targetSlot = slots[slotIndex] || {};
    const targetText = String(targetSlot.text || "").trim();

    const meta =
      STUDIO_META[project.format]?.[slotId] ||
      [slotId, "이 칸을 시작할 수 있도록 생각을 꺼내는 질문"];

    // 앞서 작성한 내용은 전부 참고하되, 각 칸은 길이를 제한한다.
    const previousSlots = slots
      .slice(0, slotIndex)
      .map((s) => ({
        id: String(s.id || ""),
        title: STUDIO_META[project.format]?.[s.id]?.[0] || String(s.id || ""),
        purpose: STUDIO_META[project.format]?.[s.id]?.[1] || "",
        text: balancedText(s.text, 1800),
      }))
      .filter((s) => s.text);

    // 사용자가 직접 붙였거나 글의 출발점으로 고른 생각은 원문을 우선한다.
    // 비용과 컨텍스트 폭주를 막기 위해 핵심 원문 전체 합계만 제한하고,
    // 예산을 넘긴 나머지는 다층 색인으로 배경을 남긴다.
    const primarySeen = new Set();
    let primaryOriginalBudget = 30000;
    const addPrimaryMaterial = (target, doc) => {
      if (!doc?.exists || primarySeen.has(doc.id)) return;
      const data = doc.data() || {};
      if (data.deletedAt) return;
      primarySeen.add(doc.id);
      const includeOriginal = primaryOriginalBudget >= 800;
      const material = compactStudioMaterial(data, {
        fragmentId: doc.id,
        includeOriginal,
        originalLimit: Math.min(6200, primaryOriginalBudget),
      });
      if (!material) return;
      if (includeOriginal) primaryOriginalBudget = Math.max(0, primaryOriginalBudget - studioMaterialCharCount(material));
      target.push(material);
    };

    const attachedIds = Array.isArray(targetSlot.fragmentIds)
      ? [...new Set(targetSlot.fragmentIds.map(String).filter(Boolean))].slice(0, 6)
      : [];
    const attachedMaterials = [];
    if (attachedIds.length) {
      const refs = attachedIds.map((id) => userRef.collection("fragments").doc(id));
      const docs = await db.getAll(...refs);
      docs.forEach((doc) => addPrimaryMaterial(attachedMaterials, doc));
    }

    // Studio가 Thread에서 시작됐다면 Thread 제목과 출발 재료를 본다.
    // 출발 재료는 원문, Thread 전체의 나머지는 색인 위주의 배경으로 전달한다.
    let threadTitle = "";
    let threadQuestion = "";
    const startingMaterials = [];
    const threadMaterials = [];
    const startingPath = project.startingPath && typeof project.startingPath === "object"
      ? {
          title: String(project.startingPath.title || "").slice(0, 260),
          summary: String(project.startingPath.summary || "").slice(0, 700),
          guidingQuestion: String(project.startingPath.guidingQuestion || "").slice(0, 500),
          shape: String(project.startingPath.shape || "").slice(0, 40),
        }
      : null;
    const startingIds = Array.isArray(project.startingFragmentIds)
      ? [...new Set(project.startingFragmentIds.map(String).filter(Boolean))].slice(0, 6)
      : [];

    if (project.threadId) {
      const threadId = String(project.threadId);
      const threadSnap = await userRef.collection("threads").doc(threadId).get();
      if (threadSnap.exists) {
        threadTitle = String(threadSnap.data()?.title || "").slice(0, 250);
        threadQuestion = String(threadSnap.data()?.question || "").slice(0, 500);
      }

      if (startingIds.length) {
        const refs = startingIds.map((id) => userRef.collection("fragments").doc(id));
        const docs = await db.getAll(...refs);
        docs.forEach((doc) => addPrimaryMaterial(startingMaterials, doc));
      }

      const fragSnap = await userRef
        .collection("fragments")
        .where("threadIds", "array-contains", threadId)
        .get();

      const threadRows = [];
      fragSnap.forEach((doc) => {
        const data = doc.data() || {};
        if (data.deletedAt) return;
        threadRows.push({ id: doc.id, at: String(data.createdAt || data.date || ""), data });
      });
      threadRows.sort((a, b) => a.at.localeCompare(b.at));

      // 별도로 고른 출발 갈래가 없는 일반 Thread 프로젝트도 색인만 보지 않는다.
      // 부모·자식 구조, 시간대, 임베딩 다양성을 이용해 핵심 원문 최대 6개를 먼저 읽힌다.
      if (!startingIds.length) {
        selectStudioPathRows(threadRows, 6).forEach((row) => addPrimaryMaterial(startingMaterials, {
          exists: true,
          id: row.id,
          data: () => row.data,
        }));
      }

      threadRows.forEach((row) => {
        if (primarySeen.has(row.id)) return;
        const material = compactStudioMaterial(row.data, { fragmentId: row.id, includeOriginal: false, excerptLimit: 520 });
        if (!material) return;
        threadMaterials.push({ at: row.at, material });
      });
      threadMaterials.sort((a, b) => a.at.localeCompare(b.at));
      const background = threadMaterials.slice(-20).map((row) => row.material);
      threadMaterials.length = 0;
      background.forEach((material) => threadMaterials.push(material));
    }

    const context = {
      task: "현재 선택한 Studio 문항을 더 잘 써나가게 하는 질문 한 개 만들기",
      projectTitle: String(project.title || "").slice(0, 350),
      format: String(project.format || "blog"),
      threadTitle,
      threadQuestion,
      startingPath,
      startingMaterials,
      threadMaterials,
      previousSlots,
      targetSlotTitle: meta[0],
      targetSlotPurpose: meta[1],
      targetSlotGuide:
        STUDIO_GARDENER_GUIDE[project.format]?.[slotId] ||
        "앞에서 이미 다룬 내용을 반복하지 말고, 현재 문항의 고유한 역할에서 아직 탐색하지 않은 방향을 연다.",
      previousGardenerQuestion: String(targetSlot.gardenerQuestion || "").trim().slice(0, 500),
      currentDraft: balancedText(targetText, 3500),
      attachedMaterials,
    };

    const hasContext =
      context.projectTitle ||
      context.threadTitle ||
      context.startingMaterials.length ||
      context.threadMaterials.length ||
      context.previousSlots.length ||
      context.attachedMaterials.length;

    if (!hasContext) {
      return { ok: true, enabled: true, question: null, reason: "not-enough-context" };
    }

    const contextHash = sha256(JSON.stringify(context));
    const cacheId = `${projectId}__${slotId}`;
    const cacheRef = userRef.collection("aiStudioQuestions").doc(cacheId);
    const cacheSnap = await cacheRef.get();
    const cache = cacheSnap.exists ? cacheSnap.data() || {} : {};

    if (cache.contextHash === contextHash && cache.question) {
      return {
        ok: true,
        enabled: true,
        cached: true,
        question: String(cache.question),
        type: String(cache.type || ""),
        model: String(cache.model || STUDIO_GARDENER_MODEL),
      };
    }

    if (!generate) {
      return { ok: true, enabled: true, question: null, reason: "not-cached" };
    }

    const quota = await reserveStudioGardenerQuota(uid);
    const dailyUsed = quota.used;
    const dailyLimit = quota.limit;

    // 기존 requestStudioQuestion()의 질문 철학은 유지하되,
    // user context에 "아직 쓰지 않은 target slot"을 명확히 전달한다.
    const result = await requestStudioQuestion({
      ...context,
      instruction: [
        "previousSlots를 먼저 읽고 이미 다룬 핵심 논점을 반복하지 않는다. 같은 의미를 표현만 바꿔 재질문하는 것도 중복으로 본다.",
        "targetSlotGuide를 우선해 현재 문항의 고유한 사고 역할을 지킨다.",
        "currentDraft가 비어 있으면 앞선 흐름에서 아직 나오지 않은 방향으로 이 문항을 시작하게 한다.",
        "currentDraft가 있다면 같은 문항 안에서 아직 말하지 않은 구체성·반례·긴장·의미를 묻는다. 이미 적힌 문장을 확인시키는 질문은 하지 않는다.",
        "반론 문항이라면 앞에서 원인·어려움을 이미 다뤘을 때 '다른 이유가 더 있나/빠뜨린 이유가 있나'를 묻지 않는다. 대신 반대 주장·반례·예외·대가·대안 해석 중 하나를 연다.",
        "previousGardenerQuestion이 있으면 그 질문과 같은 축을 반복하지 않는다.",
        "어려운 개념어보다 사용자가 실제로 쓴 표현을 사용한다. 질문을 읽자마자 어떤 경험을 떠올려 답해야 하는지 알 수 있어야 한다.",
        "질문 하나만 반환한다.",
      ],
    });

    // 질문 캐시와 오늘의 실제 OpenAI usage token 누적을 한 번에 기록한다.
    // 같은 질문을 캐시에서 다시 읽을 때는 이 블록이 실행되지 않으므로 횟수/토큰이 추가되지 않는다.
    const usageRef = userRef.collection("aiUsage").doc(koreaDateKey());
    const writeBatch = db.batch();

    writeBatch.set(
      cacheRef,
      {
        projectId,
        slotId,
        contextHash,
        question: result.question,
        type: result.type,
        model: result.model,
        inputTokens: result.inputTokens,
        cachedInputTokens: result.cachedInputTokens,
        outputTokens: result.outputTokens,
        dailyUsed,
        generatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    writeBatch.set(
      usageRef,
      {
        studioInputTokens: FieldValue.increment(result.inputTokens),
        studioCachedInputTokens: FieldValue.increment(result.cachedInputTokens),
        studioOutputTokens: FieldValue.increment(result.outputTokens),
        studioModel: STUDIO_GARDENER_MODEL,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await writeBatch.commit();

    return {
      ok: true,
      enabled: true,
      cached: false,
      question: result.question,
      type: result.type,
      model: result.model,
      inputTokens: result.inputTokens,
      cachedInputTokens: result.cachedInputTokens,
      outputTokens: result.outputTokens,
      dailyUsed,
      dailyLimit,
    };
  }
);


async function reserveBloomingInterviewQuota(uid) {
  const ref = db.collection("users").doc(uid).collection("aiUsage").doc(koreaDateKey());
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const used = Math.max(0, Number(data.bloomingInterviewQuestions || 0));
    if (used >= BLOOMING_INTERVIEW_DAILY_LIMIT) {
      throw new HttpsError("resource-exhausted", "Blooming Interview 질문 생성은 오늘 여기까지예요. 내일 다시 만나요.");
    }
    tx.set(
      ref,
      {
        bloomingInterviewQuestions: used + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return used + 1;
  });
}

async function requestBloomingInterviewQuestion(fragmentText) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.error("OPENAI_API_KEY secret is unavailable");
    throw new HttpsError("failed-precondition", "AI 연결 설정을 확인해주세요.");
  }

  const systemPrompt = [
    "당신은 '생각의 텃밭'의 Blooming Interview 인터뷰어다.",
    "사용자가 방금 저장한 생각 하나를 읽고, 그 생각을 한 걸음 확장할 질문 딱 하나만 만든다.",
    "답을 대신 쓰지 말고, 조언·평가·칭찬·요약·진단·교훈을 하지 않는다.",
    "사용자가 이미 fragment 안에서 직접 답한 내용을 표현만 바꿔 다시 묻지 않는다.",
    "질문을 만들기 전에 fragment에 이미 포함된 주장·이유·감정·결론을 내부적으로 파악하고, 아직 쓰이지 않은 사고 방향 하나를 고른다. 이 분석은 출력하지 않는다.",
    "내부적으로는 숨은 전제, 반대 가능성, 반례·예외, 구체적 장면, 욕망·두려움, 선택의 대가, 경계, 미래의 결과, 다른 해석, 제3의 가능성 같은 렌즈를 써도 되지만 그 전문용어를 질문에 드러내지 않는다.",
    "질문은 인터뷰어가 실제 사람에게 말하듯 쉽고 구어체인 한국어여야 한다. 한 번 읽고 바로 뜻이 이해되어야 한다.",
    "'최소한의 이유나 조건', '전제', '경계조건', '대안적 해석', '제3의 가능성'처럼 추상적인 표현을 그대로 사용자에게 묻지 않는다.",
    "fragment에 이유가 이미 여러 개 적혀 있다면 '또 다른 이유'를 요구하지 않는다. 대신 그래도 행동하게 만드는 힘, 가장 마음에 걸리는 한 지점, 무엇이 달라지면 선택이 바뀌는지처럼 아직 남은 긴장을 자연스럽게 묻는다.",
    "사용자가 쓴 단어나 장면을 적절히 되받아 질문을 구체적으로 만들되, 사용자의 말을 길게 반복하거나 요약하지 않는다.",
    "나쁜 예: '그 선택을 유지하게 하는 최소한의 이유나 조건은 무엇인가요?' 좋은 예: '마음이 내키지 않는데도 결국 그 선택을 하게 만드는 건 무엇인가요?'",
    "나쁜 예: '그 감정이 달라지는 경계조건은 무엇인가요?' 좋은 예: '어느 순간부터는 괜찮지 않다고 느끼나요?'",
    "무조건 '왜?'라고 묻지 말고, 사용자의 문장에 가장 잘 맞는 질문을 고른다.",
    "질문은 한 문장으로, 가능하면 35~75자 정도로 쓴다. 어렵게 압축하기보다 자연스럽게 말한다.",
    "사용자가 제공하지 않은 사실을 만들지 않는다.",
    "내용이 심하게 불안하거나 위험한 상황을 암시하면 위험한 생각을 더 파고들게 하지 말고 현재의 안전·도움·지지로 시선을 돌리는 부드러운 질문을 한다.",
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: BLOOMING_INTERVIEW_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify({ fragment: fragmentText }) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "blooming_interview_question",
          strict: true,
          schema: {
            type: "object",
            properties: {
              question: { type: "string" },
              lens: {
                type: "string",
                enum: ["assumption", "counter", "exception", "concrete", "desire", "tradeoff", "boundary", "future", "reinterpretation", "third_option", "support"],
              },
            },
            required: ["question", "lens"],
            additionalProperties: false,
          },
        },
      },
      max_completion_tokens: 160,
    }),
  });

  let payload;
  try { payload = await response.json(); } catch (_) { payload = null; }
  if (!response.ok) {
    logger.error("OpenAI Blooming Interview HTTP error", {
      status: response.status,
      code: payload?.error?.code || null,
      type: payload?.error?.type || null,
    });
    throw new HttpsError("internal", "Blooming Interview 질문을 만들지 못했습니다.");
  }

  const raw = payload?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new HttpsError("internal", "Blooming Interview 질문이 비어 있습니다.");
  }

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (_) { throw new HttpsError("internal", "Blooming Interview 질문 형식이 올바르지 않습니다."); }

  const question = String(parsed?.question || "").trim().slice(0, 220);
  const lens = String(parsed?.lens || "").trim();
  if (!question) throw new HttpsError("internal", "Blooming Interview 질문이 비어 있습니다.");

  return {
    question,
    lens,
    model: BLOOMING_INTERVIEW_MODEL,
    inputTokens: Number(payload?.usage?.prompt_tokens || 0),
    cachedInputTokens: Number(payload?.usage?.prompt_tokens_details?.cached_tokens || 0),
    outputTokens: Number(payload?.usage?.completion_tokens || 0),
  };
}

/**
 * 방금 저장한 Fragment 하나를 바탕으로 Blooming Interview 질문 하나를 만든다.
 * 팝업 자체에는 OpenAI를 쓰지 않고, 사용자가 인터뷰에 응한 뒤에만 이 함수가 호출된다.
 * 같은 Fragment의 내용이 바뀌지 않았다면 캐시 질문을 재사용해 중복 과금을 막는다.
 */
exports.bloomingInterviewQuestion = onCall(
  {
    region: "us-central1",
    secrets: ["OPENAI_API_KEY"],
    timeoutSeconds: 45,
    memory: "256MiB",
    maxInstances: 3,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");

    const fragmentId = safeId(request.data?.fragmentId, "생각 조각");
    const userRef = db.collection("users").doc(uid);
    const settingsSnap = await userRef.collection("settings").doc("private").get();
    if (settingsSnap.exists && settingsSnap.data()?.bloomingInterviewEnabled === false) {
      return { ok: true, enabled: false, question: null };
    }

    const fragmentSnap = await userRef.collection("fragments").doc(fragmentId).get();
    if (!fragmentSnap.exists) throw new HttpsError("not-found", "생각 조각을 찾지 못했습니다.");
    const fragment = fragmentSnap.data() || {};
    if (fragment.deletedAt) throw new HttpsError("failed-precondition", "지운 생각에는 인터뷰를 시작할 수 없습니다.");

    const fragmentText = String(fragment.thought || fragment.text || "").trim().slice(0, 6000);
    if (fragmentText.length < 4) {
      return { ok: true, enabled: true, question: null, reason: "not-enough-context" };
    }

    const sourceHash = sha256(fragmentText);
    const cacheRef = userRef.collection("aiBloomingInterviews").doc(fragmentId);
    const cacheSnap = await cacheRef.get();
    const cache = cacheSnap.exists ? cacheSnap.data() || {} : {};
    if (cache.sourceHash === sourceHash && cache.question) {
      return {
        ok: true,
        enabled: true,
        cached: true,
        question: String(cache.question),
        lens: String(cache.lens || ""),
        model: String(cache.model || BLOOMING_INTERVIEW_MODEL),
      };
    }

    await reserveBloomingInterviewQuota(uid);
    const result = await requestBloomingInterviewQuestion(fragmentText);
    const usageRef = userRef.collection("aiUsage").doc(koreaDateKey());
    const batch = db.batch();
    batch.set(
      cacheRef,
      {
        fragmentId,
        sourceHash,
        question: result.question,
        lens: result.lens,
        model: result.model,
        inputTokens: result.inputTokens,
        cachedInputTokens: result.cachedInputTokens,
        outputTokens: result.outputTokens,
        generatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    batch.set(
      usageRef,
      {
        bloomingInterviewInputTokens: FieldValue.increment(result.inputTokens),
        bloomingInterviewCachedInputTokens: FieldValue.increment(result.cachedInputTokens),
        bloomingInterviewOutputTokens: FieldValue.increment(result.outputTokens),
        bloomingInterviewModel: BLOOMING_INTERVIEW_MODEL,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await batch.commit();

    return {
      ok: true,
      enabled: true,
      cached: false,
      question: result.question,
      lens: result.lens,
      model: result.model,
      inputTokens: result.inputTokens,
      cachedInputTokens: result.cachedInputTokens,
      outputTokens: result.outputTokens,
    };
  }
);

async function reserveBetweenThoughtsQuota(uid) {
  const ref = db.collection("users").doc(uid).collection("aiUsage").doc(koreaDateKey());
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const used = Math.max(0, Number(data.betweenThoughtsQuestions || 0));
    if (used >= BETWEEN_THOUGHTS_DAILY_LIMIT) {
      throw new HttpsError("resource-exhausted", "두 생각 사이의 질문은 오늘 여기까지예요. 내일 다시 이어봐요.");
    }
    tx.set(
      ref,
      {
        betweenThoughtsQuestions: used + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return used + 1;
  });
}

async function requestBetweenThoughtsQuestion(fragmentA, fragmentB) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.error("OPENAI_API_KEY secret is unavailable");
    throw new HttpsError("failed-precondition", "AI 연결 설정을 확인해주세요.");
  }

  const systemPrompt = [
    "당신은 '생각의 텃밭'에서 서로 다른 두 생각 사이를 비추는 인터뷰어다.",
    "사용자가 과거에 직접 남긴 생각 A와 생각 B를 함께 읽고, 둘 사이에서 사용자가 새로운 생각을 발견하도록 돕는 질문 딱 하나만 만든다.",
    "각 생각의 visualContext가 있으면 사진을 비언어적 문장으로 보고, 보이는 근거와 함께 첨부 의도·정서적 기능·글에 쓰지 않은 맥락을 확신도별로 저장한 색인이다. 실제 사진을 다시 보는 것은 아니므로 해석 후보를 사실처럼 단정하지 않되, 글과 사진의 관계가 충분히 뒷받침되면 질문에 자연스럽게 반영한다.",
    "두 생각의 관계를 정답처럼 선언하거나 요약하지 않는다. 질문 자체가 사용자가 관계를 발견하게 해야 한다.",
    "답을 대신 쓰지 말고, 조언·평가·칭찬·진단·교훈을 하지 않는다.",
    "두 생각이 비슷하면 반복되는 가치·욕구·두려움·선택·긴장·패턴을 살펴볼 수 있고, 다르면 무엇이 달라졌는지·충돌하는지·함께 놓았을 때 무엇이 보이는지를 물을 수 있다.",
    "억지로 공통점을 만들지 않는다. 실제로 연결이 약하면 '두 생각을 함께 놓고 보면 무엇이 가장 다르게 느껴지는가'처럼 대비를 열어도 된다.",
    "사용자가 제공하지 않은 사실이나 감정을 만들어내지 않는다.",
    "'공통분모', '메타인지', '내재적 욕구', '인지적 불일치' 같은 분석 용어를 쓰지 않는다.",
    "실제 사람이 말로 물어도 자연스러운 쉬운 한국어를 쓴다. 한 번 읽고 바로 이해되어야 한다.",
    "가능하면 두 생각의 구체적인 단어나 장면을 짧게 되받아 질문을 구체화하되, 원문을 길게 반복하지 않는다.",
    "질문은 한 문장으로, 가능하면 35~90자 정도로 쓴다.",
    "질문 외의 설명, 제목, 서론, 요약은 출력하지 않는다.",
    "내용이 심하게 불안하거나 위험한 상황을 암시하면 위험한 생각을 더 파고들게 하지 말고 현재의 안전·도움·지지로 시선을 돌리는 부드러운 질문을 한다.",
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: BETWEEN_THOUGHTS_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify({ thoughtA: fragmentA, thoughtB: fragmentB }) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "between_thoughts_question",
          strict: true,
          schema: {
            type: "object",
            properties: {
              question: { type: "string" },
              lens: {
                type: "string",
                enum: ["connection", "contrast", "value", "need", "tension", "change", "choice", "meaning", "support"],
              },
            },
            required: ["question", "lens"],
            additionalProperties: false,
          },
        },
      },
      max_completion_tokens: 180,
    }),
  });

  let payload;
  try { payload = await response.json(); } catch (_) { payload = null; }
  if (!response.ok) {
    logger.error("OpenAI Between Thoughts HTTP error", {
      status: response.status,
      code: payload?.error?.code || null,
      type: payload?.error?.type || null,
    });
    throw new HttpsError("internal", "두 생각 사이의 질문을 만들지 못했습니다.");
  }

  const raw = payload?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new HttpsError("internal", "두 생각 사이의 질문이 비어 있습니다.");
  }

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (_) { throw new HttpsError("internal", "두 생각 사이의 질문 형식이 올바르지 않습니다."); }

  const question = String(parsed?.question || "").trim().slice(0, 260);
  const lens = String(parsed?.lens || "").trim();
  if (!question) throw new HttpsError("internal", "두 생각 사이의 질문이 비어 있습니다.");

  return {
    question,
    lens,
    model: BETWEEN_THOUGHTS_MODEL,
    inputTokens: Number(payload?.usage?.prompt_tokens || 0),
    cachedInputTokens: Number(payload?.usage?.prompt_tokens_details?.cached_tokens || 0),
    outputTokens: Number(payload?.usage?.completion_tokens || 0),
  };
}

/**
 * Home 라운지에서 선택된 두 Fragment 사이를 탐색할 질문 하나를 만든다.
 * 두 생각을 고르는 단계는 기존 embedding/vector search를 재사용하므로 OpenAI GPT 호출이 없다.
 * 사용자가 '질문 받기'를 눌렀을 때만 이 함수가 GPT를 호출한다.
 */
exports.betweenThoughtsQuestion = onCall(
  {
    region: "us-central1",
    secrets: ["OPENAI_API_KEY"],
    timeoutSeconds: 45,
    memory: "256MiB",
    maxInstances: 3,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");

    const rawIds = Array.isArray(request.data?.fragmentIds) ? request.data.fragmentIds : [];
    if (rawIds.length !== 2) throw new HttpsError("invalid-argument", "두 개의 생각 조각이 필요합니다.");
    const ids = rawIds.map((id, i) => safeId(id, `생각 조각 ${i + 1}`));
    if (ids[0] === ids[1]) throw new HttpsError("invalid-argument", "서로 다른 두 생각이 필요합니다.");

    const userRef = db.collection("users").doc(uid);
    const col = userRef.collection("fragments");
    const snaps = await Promise.all(ids.map((id) => col.doc(id).get()));
    if (snaps.some((snap) => !snap.exists)) throw new HttpsError("not-found", "생각 조각을 찾지 못했습니다.");

    const docs = snaps.map((snap) => snap.data() || {});
    if (docs.some((data) => data.deletedAt)) throw new HttpsError("failed-precondition", "지운 생각은 함께 볼 수 없습니다.");
    const thoughtInputs = docs.map((data) => {
      const text = String(data.thought || data.text || data.externalText || "").trim().slice(0, 6000);
      const visualContext = normalizeThoughtIndex(data.aiIndex)?.visualContext || null;
      return { text, visualContext: visualContext?.hasImages ? visualContext : null };
    });
    if (thoughtInputs.some((item) => item.text.length < 4 && !item.visualContext?.visibleEvidence?.length)) {
      return { ok: true, question: null, reason: "not-enough-context" };
    }

    const canonicalIds = ids.slice().sort();
    const cacheId = sha256(canonicalIds.join("|")).slice(0, 40);
    const hasVisualContext = thoughtInputs.some((item) => item.visualContext);
    const sourceHash = hasVisualContext
      ? sha256(canonicalIds.map((id) => {
          const item = thoughtInputs[ids.indexOf(id)];
          return `${id}:${item.text}:${JSON.stringify(item.visualContext || null)}`;
        }).join("|"))
      : sha256(canonicalIds.map((id) => `${id}:${thoughtInputs[ids.indexOf(id)].text}`).join("|"));
    const cacheRef = userRef.collection("aiBetweenThoughts").doc(cacheId);
    const cacheSnap = await cacheRef.get();
    const cache = cacheSnap.exists ? cacheSnap.data() || {} : {};
    if (cache.sourceHash === sourceHash && cache.question) {
      return {
        ok: true,
        cached: true,
        question: String(cache.question),
        lens: String(cache.lens || ""),
        model: String(cache.model || BETWEEN_THOUGHTS_MODEL),
      };
    }

    await reserveBetweenThoughtsQuota(uid);
    const result = await requestBetweenThoughtsQuestion(thoughtInputs[0], thoughtInputs[1]);
    const usageRef = userRef.collection("aiUsage").doc(koreaDateKey());
    const batch = db.batch();
    batch.set(
      cacheRef,
      {
        fragmentIds: canonicalIds,
        sourceHash,
        question: result.question,
        lens: result.lens,
        model: result.model,
        inputTokens: result.inputTokens,
        cachedInputTokens: result.cachedInputTokens,
        outputTokens: result.outputTokens,
        generatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    batch.set(
      usageRef,
      {
        betweenThoughtsInputTokens: FieldValue.increment(result.inputTokens),
        betweenThoughtsCachedInputTokens: FieldValue.increment(result.cachedInputTokens),
        betweenThoughtsOutputTokens: FieldValue.increment(result.outputTokens),
        betweenThoughtsModel: BETWEEN_THOUGHTS_MODEL,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await batch.commit();

    return {
      ok: true,
      cached: false,
      question: result.question,
      lens: result.lens,
      model: result.model,
      inputTokens: result.inputTokens,
      cachedInputTokens: result.cachedInputTokens,
      outputTokens: result.outputTokens,
    };
  }
);

function studioEstimatedCostUsd(inputTokens, cachedInputTokens, outputTokens) {
  const input = Math.max(0, Number(inputTokens || 0));
  const cached = Math.min(input, Math.max(0, Number(cachedInputTokens || 0)));
  const uncached = Math.max(0, input - cached);
  const output = Math.max(0, Number(outputTokens || 0));

  return (
    (uncached / 1_000_000) * STUDIO_GARDENER_INPUT_USD_PER_M +
    (cached / 1_000_000) * STUDIO_GARDENER_CACHED_INPUT_USD_PER_M +
    (output / 1_000_000) * STUDIO_GARDENER_OUTPUT_USD_PER_M
  );
}

/**
 * 설정 화면에서 오늘의 AI 사용량을 확인한다.
 * Studio 정원사 GPT 토큰과 embedding 토큰을 모델별로 분리해서 보여준다.
 * OpenAI Billing API가 아니라 서버에 기록한 실제 usage token × 공식 단가의 추정값이다.
 */

async function reserveBetweenThoughtsCurationQuota(uid) {
  const ref = db.collection("users").doc(uid).collection("aiUsage").doc(koreaDateKey());
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    // 이전 버전은 성공 여부와 무관하게 betweenThoughtsCurations를 먼저 올렸다.
    // v59부터는 시도 횟수로 한도를 예약하고, 완료 횟수는 실제 처리가 끝난 뒤 기록한다.
    const used = Math.max(0, Number(data.betweenThoughtsCurationAttempts ?? data.betweenThoughtsCurations ?? 0));
    if (used >= BETWEEN_THOUGHTS_CURATION_DAILY_LIMIT) {
      throw new HttpsError("resource-exhausted", "두 생각 사이의 새 큐레이션은 오늘 여기까지예요. 준비된 조합은 계속 볼 수 있어요.");
    }
    tx.set(ref, {
      betweenThoughtsCurationAttempts: used + 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return used + 1;
  });
}

async function reserveBetweenThoughtsQuestionAttemptQuota(uid) {
  const ref = db.collection("users").doc(uid).collection("aiUsage").doc(koreaDateKey());
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const used = Math.max(0, Number(data.betweenThoughtsQuestionAttempts ?? data.betweenThoughtsQuestions ?? 0));
    if (used >= BETWEEN_THOUGHTS_DAILY_LIMIT) {
      throw new HttpsError("resource-exhausted", "두 생각 사이의 질문은 오늘 여기까지예요. 준비된 후보는 내일 이어볼 수 있어요.");
    }
    tx.set(ref, { betweenThoughtsQuestionAttempts: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return used + 1;
  });
}


function thoughtImageAttachments(data) {
  return (Array.isArray(data?.attachments) ? data.attachments : [])
    .filter((item) => String(item?.type || "").toLowerCase().startsWith("image/"))
    .map((item, index) => ({
      index: index + 1,
      name: String(item?.name || `사진 ${index + 1}`).trim().slice(0, 180),
      type: String(item?.type || "image/jpeg").trim().slice(0, 80),
      path: String(item?.path || "").trim().slice(0, 900),
      url: String(item?.url || "").trim().slice(0, 2400),
    }))
    .filter((item) => /^https:\/\//i.test(item.url))
    .slice(0, THOUGHT_INDEX_MAX_IMAGES_PER_FRAGMENT);
}

function betweenThoughtFullRecord(id, data, source) {
  const images = thoughtImageAttachments(data);
  const promptContext = thoughtPromptContext(data);
  const totalImageCount = (Array.isArray(data?.attachments) ? data.attachments : [])
    .filter((item) => String(item?.type || "").toLowerCase().startsWith("image/"))
    .length;
  return {
    id,
    date: String(data.date || data.createdAt || "").slice(0, 10),
    thought: balancedText(data.thought || data.text, 4200),
    // promptContext가 있으면 context는 화면 표시용 AI 질문이므로 중복 입력하지 않는다.
    context: promptContext ? "" : balancedText(data.context, 900),
    promptContext,
    sourceExcerpt: balancedText(data.externalText, 2200),
    locator: String(data.locator || "").trim().slice(0, 200),
    sourceId: String(data.sourceId || ""),
    source: source ? {
      title: String(source.title || "").trim().slice(0, 260),
      creator: String(source.creator || "").trim().slice(0, 200),
      platform: String(source.platform || "").trim().slice(0, 140),
      publisher: String(source.publisher || "").trim().slice(0, 140),
      type: String(source.type || "").trim().slice(0, 40),
    } : null,
    images,
    totalImageCount,
  };
}

function betweenThoughtProfileFingerprint(record) {
  const base = {
    thought: record.thought,
    context: record.context,
    sourceExcerpt: record.sourceExcerpt,
    locator: record.locator,
    sourceId: record.sourceId,
    source: record.source,
  };
  // 기존 생각은 이전 fingerprint를 그대로 유지한다. v62 이후 새 답변처럼
  // 압축 질문 맥락이 실제로 저장된 생각만 fingerprint에 추가한다.
  if (record.promptContext) base.promptContext = record.promptContext;
  const images = Array.isArray(record.images) ? record.images : [];
  // 기존 텍스트 전용 생각은 v52 fingerprint를 그대로 유지해 불필요한 재색인을 막는다.
  if (!images.length && !Number(record.totalImageCount || 0)) return sha256(JSON.stringify(base));
  return sha256(JSON.stringify({
    ...base,
    images: images.map((image) => ({
      key: image.path || image.url,
      type: image.type,
      name: image.name,
    })),
    totalImageCount: Number(record.totalImageCount || 0),
    imageDetail: THOUGHT_INDEX_IMAGE_DETAIL,
  }));
}

function isThoughtIndexCurrentForRecord(data, record, fingerprint) {
  const baseCurrent = data?.aiIndexVersion === THOUGHT_INDEX_VERSION &&
    data?.aiIndexFingerprint === fingerprint &&
    Boolean(normalizeThoughtIndex(data?.aiIndex));
  if (!baseCurrent) return false;
  const hasImages = Array.isArray(record?.images) && record.images.length > 0;
  return !hasImages || Number(data?.aiIndexVisionVersion || 0) >= THOUGHT_INDEX_VISION_VERSION;
}

function normalizeStringList(value, maxItems, maxChars) {
  return Array.isArray(value)
    ? value.map((x) => String(x || "").trim().slice(0, maxChars)).filter(Boolean).slice(0, maxItems)
    : [];
}

function normalizeConfidence(value) {
  const raw = String(value || "medium").toLowerCase();
  return ["low", "medium", "high"].includes(raw) ? raw : "medium";
}

function normalizeEvidenceList(value, maxItems, valueChars = 130, evidenceChars = 180) {
  return Array.isArray(value)
    ? value.map((item) => ({
        value: String(item?.value || item?.reading || "").trim().slice(0, valueChars),
        evidence: String(item?.evidence || "").trim().slice(0, evidenceChars),
        confidence: normalizeConfidence(item?.confidence),
      })).filter((item) => item.value && item.evidence).slice(0, maxItems)
    : [];
}

function isThoughtIndexV2(index) {
  return Boolean(index?.literal?.summary && index?.authorPerspective && index?.innerDynamics && index?.uncertainty);
}

function normalizeThoughtIndex(index) {
  if (!isThoughtIndexV2(index)) return null;
  const rawVisual = index.visualContext || {};
  const relation = String(rawVisual.relationToThought || "");
  const relationToThought = [
    "none", "supports", "expands", "contrasts", "contextualizes", "complements",
    "symbolizes", "documents", "unclear",
  ].includes(relation) ? relation : "none";

  // v56의 사실 중심 시각 색인도 읽을 수 있게 유지한다. v57 재색인 뒤에는
  // visibleEvidence·attachmentIntents·emotionalFunctions·latentContexts가 채워진다.
  const legacyVisibleEvidence = [
    String(rawVisual.sceneSummary || "").trim(),
    ...normalizeStringList(rawVisual.observedElements, 4, 120),
  ].filter(Boolean).slice(0, 5);
  const legacyRelationEvidence = String(rawVisual.relationEvidence || "").trim();

  return {
    literal: {
      summary: String(index.literal?.summary || "").trim().slice(0, 380),
      topics: normalizeStringList(index.literal?.topics, 5, 70),
      events: normalizeStringList(index.literal?.events, 3, 150),
      claims: normalizeStringList(index.literal?.claims, 4, 160),
      keyPhrases: normalizeStringList(index.literal?.keyPhrases, 4, 120),
    },
    authorPerspective: {
      explicitIntents: normalizeStringList(index.authorPerspective?.explicitIntents, 3, 150),
      inferredIntents: normalizeEvidenceList(index.authorPerspective?.inferredIntents, 2, 150, 180),
      valuesOrNeeds: normalizeEvidenceList(index.authorPerspective?.valuesOrNeeds, 4, 120, 180),
    },
    innerDynamics: {
      emotions: normalizeEvidenceList(index.innerDynamics?.emotions, 3, 90, 160),
      tensions: normalizeEvidenceList(index.innerDynamics?.tensions, 3, 150, 180),
      shifts: normalizeEvidenceList(index.innerDynamics?.shifts, 2, 170, 190),
      openLoops: normalizeEvidenceList(index.innerDynamics?.openLoops, 3, 170, 190),
    },
    alternateReadings: normalizeEvidenceList(index.alternateReadings, 2, 170, 190),
    uncertainty: {
      insufficientContext: Boolean(index.uncertainty?.insufficientContext),
      notes: normalizeStringList(index.uncertainty?.notes, 3, 180),
    },
    sourceContext: {
      relation: ["none", "resonates", "challenges", "applies", "questions", "extends"].includes(String(index.sourceContext?.relation || ""))
        ? String(index.sourceContext.relation)
        : "none",
      anchor: String(index.sourceContext?.anchor || "").trim().slice(0, 220),
      contextKind: ["personal_experience", "reflection", "decision", "desire", "source_response", "mixed", "other"].includes(String(index.sourceContext?.contextKind || ""))
        ? String(index.sourceContext.contextKind)
        : "other",
    },
    visualContext: {
      hasImages: Boolean(rawVisual.hasImages),
      visibleEvidence: normalizeStringList(rawVisual.visibleEvidence, 5, 170).length
        ? normalizeStringList(rawVisual.visibleEvidence, 5, 170)
        : legacyVisibleEvidence,
      visibleText: normalizeStringList(rawVisual.visibleText, 4, 160),
      attachmentIntents: normalizeEvidenceList(
        rawVisual.attachmentIntents,
        2,
        180,
        220
      ).length
        ? normalizeEvidenceList(rawVisual.attachmentIntents, 2, 180, 220)
        : (legacyRelationEvidence ? [{ value: legacyRelationEvidence.slice(0, 180), evidence: "이전 시각 색인의 글·사진 관계", confidence: "low" }] : []),
      emotionalFunctions: normalizeEvidenceList(rawVisual.emotionalFunctions, 2, 160, 220),
      relationToThought,
      relationExplanation: String(rawVisual.relationExplanation || rawVisual.relationEvidence || "").trim().slice(0, 280),
      latentContexts: normalizeEvidenceList(rawVisual.latentContexts, 2, 180, 220),
      alternativeReadings: normalizeEvidenceList(rawVisual.alternativeReadings, 2, 180, 220),
      uncertaintyNotes: normalizeStringList(rawVisual.uncertaintyNotes, 3, 180),
    },
  };
}

function compactEvidenceItems(items, maxItems = 3) {
  return (Array.isArray(items) ? items : []).slice(0, maxItems).map((item) => ({
    value: String(item?.value || "").slice(0, 150),
    evidence: String(item?.evidence || "").slice(0, 180),
    confidence: normalizeConfidence(item?.confidence),
  })).filter((item) => item.value && item.evidence);
}

function compactBetweenThoughtProfile(id, profile, date) {
  const index = normalizeThoughtIndex(profile);
  if (!index) return {
    id,
    date: String(date || "").slice(0, 10),
    core: String(profile?.core || "").trim().slice(0, 320),
    themes: normalizeStringList(profile?.themes, 5, 80),
    keyPhrases: [],
    explicitIntents: [],
    inferredIntents: [],
    valuesOrNeeds: normalizeStringList(profile?.valuesOrNeeds, 4, 90).map((value) => ({ value, evidence: "이전 색인", confidence: "low" })),
    patternsOrTensions: normalizeStringList(profile?.patternsOrTensions, 4, 110),
    tensions: [],
    shifts: [],
    emotions: normalizeStringList(profile?.emotions, 3, 50).map((value) => ({ value, evidence: "이전 색인", confidence: "low" })),
    openLoops: String(profile?.unfinished || "").trim() ? [{ value: String(profile.unfinished).trim().slice(0, 170), evidence: "이전 색인", confidence: "low" }] : [],
    alternateReadings: [],
    uncertaintyNotes: ["이전 버전 색인"],
    insufficientContext: false,
    unfinished: String(profile?.unfinished || "").trim().slice(0, 240),
    sourceRelation: String(profile?.sourceRelation || "none"),
    sourceAnchor: String(profile?.sourceAnchor || "").trim().slice(0, 220),
    contextKind: String(profile?.contextKind || "other"),
  };

  const tensions = compactEvidenceItems(index.innerDynamics.tensions, 3);
  const shifts = compactEvidenceItems(index.innerDynamics.shifts, 2);
  const openLoops = compactEvidenceItems(index.innerDynamics.openLoops, 3);
  return {
    id,
    date: String(date || "").slice(0, 10),
    core: index.literal.summary,
    themes: index.literal.topics,
    keyPhrases: index.literal.keyPhrases,
    events: index.literal.events,
    claims: index.literal.claims,
    explicitIntents: index.authorPerspective.explicitIntents,
    inferredIntents: compactEvidenceItems(index.authorPerspective.inferredIntents, 2),
    valuesOrNeeds: compactEvidenceItems(index.authorPerspective.valuesOrNeeds, 4),
    patternsOrTensions: [...tensions.map((x) => x.value), ...shifts.map((x) => x.value)].slice(0, 5),
    tensions,
    shifts,
    emotions: compactEvidenceItems(index.innerDynamics.emotions, 3),
    openLoops,
    alternateReadings: compactEvidenceItems(index.alternateReadings, 2),
    uncertaintyNotes: index.uncertainty.notes,
    insufficientContext: index.uncertainty.insufficientContext,
    unfinished: openLoops.map((x) => x.value).join(" / ").slice(0, 280),
    sourceRelation: index.sourceContext.relation,
    sourceAnchor: index.sourceContext.anchor,
    contextKind: index.sourceContext.contextKind,
    visualEvidence: index.visualContext.visibleEvidence,
    visibleText: index.visualContext.visibleText,
    visualAttachmentIntents: compactEvidenceItems(index.visualContext.attachmentIntents, 2),
    visualEmotionalFunctions: compactEvidenceItems(index.visualContext.emotionalFunctions, 2),
    visualRelation: index.visualContext.relationToThought,
    visualRelationExplanation: index.visualContext.relationExplanation,
    visualLatentContexts: compactEvidenceItems(index.visualContext.latentContexts, 2),
    visualAlternativeReadings: compactEvidenceItems(index.visualContext.alternativeReadings, 2),
    visualUncertaintyNotes: index.visualContext.uncertaintyNotes,
  };
}

async function requestThoughtIndexes(records) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpsError("failed-precondition", "AI 연결 설정을 확인해주세요.");

  const systemPrompt = [
    "당신은 '생각의 텃밭'에서 사용자가 남긴 글과 첨부 사진을 함께 읽고, 여러 기능이 재사용할 수 있는 다층 색인으로 정리한다.",
    "이 색인은 원문과 사진을 대체하거나 사용자를 진단하는 결과가 아니다. 나중에 관련 생각을 찾고, 원문과 사진을 다시 검토할 후보를 고르기 위한 지도다.",
    "thought는 사용자가 직접 쓴 현재의 생각이다. context는 사용자가 직접 덧붙인 맥락일 수 있다. promptContext는 AI가 만든 질문과 그 질문의 압축 배경이므로 사용자의 주장·감정·신념으로 취급하지 않는다.",
    "promptContext가 있으면 질문과 연결 요약은 답변의 지시어와 배경을 이해하는 데만 사용한다. 색인의 중심은 thought에서 새로 드러난 의미이며, 출발 생각 요약을 사용자의 현재 주장으로 복사하지 않는다.",
    "sourceExcerpt와 source는 외부의 책·영상·대화·타인의 말일 수 있으므로 사용자 생각과 절대 섞지 않는다.",
    "각 FRAGMENT 표식 뒤에 이어지는 이미지는 바로 그 fragment의 첨부 사진이다. 사진과 다른 fragment를 섞지 않는다.",
    "사진은 high detail로 제공된다. 사진은 단순한 첨부 자료가 아니라 사용자가 이 생각 옆에 의도적으로 놓은 비언어적 문장으로 다룬다.",
    "먼저 사진에서 직접 확인되는 최소한의 사실을 visibleEvidence에 짧게 적고, 분석의 중심은 왜 이 사진을 이 글에 붙였는지, 사진이 글에 쓰지 않은 현재 상황·대비·상징·정서적 온도를 어떻게 더하는지에 둔다.",
    "사진 속 사람의 신원, 정확한 나이, 관계, 직업, 건강 상태, 민감한 특성은 추정하지 않는다. 표정만으로 감정을 단정하지 않는다. 다만 글과 사진을 함께 볼 때 드러나는 상황적·심리적 맥락은 evidence와 confidence를 붙여 해석 후보로 남길 수 있다.",
    "글과 사진은 하나의 표현으로 읽되, 글에 직접 드러난 내용과 사진을 통해 추정한 첨부 의도를 구분한다. 사진은 글을 지지·확장·대조·맥락화·보완·상징화하거나 현재 상황을 기록할 수 있으며, 관계가 불명확하면 unclear로 둔다.",
    "긴 텍스트 안의 줄바꿈된 '…'는 가운데 일부가 길이 때문에 생략됐다는 표시다. 생략된 내용을 상상해 채우지 않는다.",
    "literal에는 글에서 직접 확인되는 내용만 적는다. summary는 글의 핵심을 1~2문장으로, topics는 표면 주제와 개념을, events와 claims는 실제 사건·판단을, keyPhrases는 작성자의 의미와 말투가 잘 남는 짧은 원문 표현을 적는다. 글이 없고 사진만 있으면 summary는 '사진으로 남긴 생각'처럼 중립적으로 적고, 사진의 사실과 해석은 visualContext에 둔다.",
    "authorPerspective의 explicitIntents는 사용자가 직접 밝힌 목적만 적는다. inferredIntents와 valuesOrNeeds는 추론일 수 있으므로 반드시 글 속 근거 표현과 confidence를 함께 적는다. 사진만으로 작성자의 내면을 추정하지 않는다.",
    "innerDynamics는 감정, 충돌하는 마음, 글 안의 관점 변화, 아직 닫히지 않은 문제를 다룬다. 근거가 없으면 빈 배열로 두고, 모순을 억지로 하나로 정리하지 않는다.",
    "alternateReadings에는 지배적인 해석과 다른 읽기가 실제 글이나 사진에 의해 가능할 때만 최대 2개를 적는다. 단순한 상상이나 심리 추측은 넣지 않는다.",
    "글 분석의 evidence는 사용자가 쓴 짧은 표현 또는 그 표현에 아주 가까운 구체적 근거여야 한다. visualContext의 evidence는 글의 표현과 사진에서 직접 보이는 사실을 함께 짚어야 하며, 사진만으로 작성자의 마음을 확정하지 않는다.",
    "원문이 짧거나 애매해 의도와 감정을 판단하기 어렵다면 uncertainty.insufficientContext를 true로 하고 notes에 무엇을 단정할 수 없는지 적는다.",
    "질병, 성격 유형, 애착 유형 같은 진단을 하지 않는다. 사용자의 독특한 표현을 모두 일반적인 심리 용어로 바꾸지 않는다.",
    "sourceContext는 외부 재료와 사용자의 생각이 실제로 어떤 관계인지 기록한다. 외부 문장 자체를 사용자 신념처럼 취급하지 않는다.",
    "visualContext에서 visibleEvidence는 해석의 근거가 되는 장면만 최대 5개로 짧게 적는다. 사물 목록을 길게 만들지 않는다. attachmentIntents는 작성자가 왜 이 사진을 붙였을지, emotionalFunctions는 사진이 글의 정서와 의미를 어떻게 강화하는지, latentContexts는 글에 직접 쓰지 않은 현재 상황이나 심리적 배경을 각각 evidence와 confidence를 붙여 기록한다. alternativeReadings에는 한 방향으로 굳히지 않기 위한 다른 가능성을 적는다.",
    "사진이 단지 정보·증거·기록을 전달하는 경우에는 심리 해석을 억지로 만들지 않는다. attachedImageCount가 providedImageCount보다 크면 제공되지 않은 사진은 분석하지 않았음을 uncertaintyNotes에 적는다. 사진이 없으면 hasImages=false이고 나머지는 빈 값으로 둔다.",
    "각 항목은 짧고 평이한 한국어로 쓴다. 수를 채우기 위해 약한 항목을 만들지 않는다.",
  ].join("\n");

  const evidenceItem = {
    type: "object",
    properties: {
      value: { type: "string" },
      evidence: { type: "string" },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
    },
    required: ["value", "evidence", "confidence"],
    additionalProperties: false,
  };

  const userContent = [];
  for (const record of records) {
    const images = Array.isArray(record.images) ? record.images : [];
    userContent.push({
      type: "text",
      text: `FRAGMENT ${record.id}\n${JSON.stringify({
        id: record.id,
        date: record.date,
        thought: record.thought,
        context: record.context,
        ...(record.promptContext ? { promptContext: record.promptContext } : {}),
        sourceExcerpt: record.sourceExcerpt,
        locator: record.locator,
        source: record.source,
        attachedImageCount: Number(record.totalImageCount || images.length),
        providedImageCount: images.length,
      })}`,
    });
    images.forEach((image, index) => {
      userContent.push({ type: "text", text: `FRAGMENT ${record.id} 첨부 사진 ${index + 1}/${images.length}: ${image.name || "사진"}` });
      userContent.push({
        type: "image_url",
        image_url: { url: image.url, detail: THOUGHT_INDEX_IMAGE_DETAIL },
      });
    });
  }
  userContent.push({ type: "text", text: "위 FRAGMENT들을 각각 독립적으로 분석해 indexes 배열로 반환하세요." });

  const hasImageInput = records.some((record) => Array.isArray(record.images) && record.images.length > 0);
  // v57에서 사진 생각 한 건의 출력 한도가 1,100토큰으로 너무 작아,
  // 내용이 풍부한 생각은 구조화 JSON이 끝나기 전에 잘릴 수 있었다.
  // 사진 생각은 필수 필드가 많으므로 여유 있게 잡고, 텍스트 묶음은 기존 배치 기준을 유지한다.
  const completionTokenLimit = hasImageInput
    ? Math.min(7600, Math.max(2600, records.length * 1400))
    : Math.min(7600, Math.max(1100, records.length * 760));

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: THOUGHT_INDEX_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "thought_indexes_v2_expressive_photos",
          strict: true,
          schema: {
            type: "object",
            properties: {
              indexes: {
                type: "array",
                minItems: 1,
                maxItems: THOUGHT_INDEX_MAX_BATCH,
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    literal: {
                      type: "object",
                      properties: {
                        summary: { type: "string" },
                        topics: { type: "array", minItems: 0, maxItems: 5, items: { type: "string" } },
                        events: { type: "array", minItems: 0, maxItems: 3, items: { type: "string" } },
                        claims: { type: "array", minItems: 0, maxItems: 4, items: { type: "string" } },
                        keyPhrases: { type: "array", minItems: 0, maxItems: 4, items: { type: "string" } },
                      },
                      required: ["summary", "topics", "events", "claims", "keyPhrases"],
                      additionalProperties: false,
                    },
                    authorPerspective: {
                      type: "object",
                      properties: {
                        explicitIntents: { type: "array", minItems: 0, maxItems: 3, items: { type: "string" } },
                        inferredIntents: { type: "array", minItems: 0, maxItems: 2, items: evidenceItem },
                        valuesOrNeeds: { type: "array", minItems: 0, maxItems: 4, items: evidenceItem },
                      },
                      required: ["explicitIntents", "inferredIntents", "valuesOrNeeds"],
                      additionalProperties: false,
                    },
                    innerDynamics: {
                      type: "object",
                      properties: {
                        emotions: { type: "array", minItems: 0, maxItems: 3, items: evidenceItem },
                        tensions: { type: "array", minItems: 0, maxItems: 3, items: evidenceItem },
                        shifts: { type: "array", minItems: 0, maxItems: 2, items: evidenceItem },
                        openLoops: { type: "array", minItems: 0, maxItems: 3, items: evidenceItem },
                      },
                      required: ["emotions", "tensions", "shifts", "openLoops"],
                      additionalProperties: false,
                    },
                    alternateReadings: { type: "array", minItems: 0, maxItems: 2, items: evidenceItem },
                    uncertainty: {
                      type: "object",
                      properties: {
                        insufficientContext: { type: "boolean" },
                        notes: { type: "array", minItems: 0, maxItems: 3, items: { type: "string" } },
                      },
                      required: ["insufficientContext", "notes"],
                      additionalProperties: false,
                    },
                    sourceContext: {
                      type: "object",
                      properties: {
                        relation: { type: "string", enum: ["none", "resonates", "challenges", "applies", "questions", "extends"] },
                        anchor: { type: "string" },
                        contextKind: { type: "string", enum: ["personal_experience", "reflection", "decision", "desire", "source_response", "mixed", "other"] },
                      },
                      required: ["relation", "anchor", "contextKind"],
                      additionalProperties: false,
                    },
                    visualContext: {
                      type: "object",
                      properties: {
                        hasImages: { type: "boolean" },
                        visibleEvidence: { type: "array", minItems: 0, maxItems: 5, items: { type: "string" } },
                        visibleText: { type: "array", minItems: 0, maxItems: 4, items: { type: "string" } },
                        attachmentIntents: { type: "array", minItems: 0, maxItems: 2, items: evidenceItem },
                        emotionalFunctions: { type: "array", minItems: 0, maxItems: 2, items: evidenceItem },
                        relationToThought: { type: "string", enum: ["none", "supports", "expands", "contrasts", "contextualizes", "complements", "symbolizes", "documents", "unclear"] },
                        relationExplanation: { type: "string" },
                        latentContexts: { type: "array", minItems: 0, maxItems: 2, items: evidenceItem },
                        alternativeReadings: { type: "array", minItems: 0, maxItems: 2, items: evidenceItem },
                        uncertaintyNotes: { type: "array", minItems: 0, maxItems: 3, items: { type: "string" } },
                      },
                      required: ["hasImages", "visibleEvidence", "visibleText", "attachmentIntents", "emotionalFunctions", "relationToThought", "relationExplanation", "latentContexts", "alternativeReadings", "uncertaintyNotes"],
                      additionalProperties: false,
                    },
                  },
                  required: ["id", "literal", "authorPerspective", "innerDynamics", "alternateReadings", "uncertainty", "sourceContext", "visualContext"],
                  additionalProperties: false,
                },
              },
            },
            required: ["indexes"],
            additionalProperties: false,
          },
        },
      },
      max_completion_tokens: completionTokenLimit,
    }),
  });

  let payload;
  try { payload = await response.json(); } catch (_) { payload = null; }
  if (!response.ok) {
    logger.error("OpenAI thought index HTTP error", { status: response.status, code: payload?.error?.code || null, type: payload?.error?.type || null });
    throw new HttpsError("internal", "글과 사진의 생각 색인을 만들지 못했습니다.");
  }
  const finishReason = String(payload?.choices?.[0]?.finish_reason || "");
  if (finishReason === "length") {
    logger.warn("OpenAI thought index output truncated", {
      recordIds: records.map((record) => record.id),
      maxCompletionTokens: completionTokenLimit,
      inputTokens: Number(payload?.usage?.prompt_tokens || 0),
      outputTokens: Number(payload?.usage?.completion_tokens || 0),
    });
    const truncatedError = new Error("생각 색인 응답이 길이 한도에서 잘렸습니다.");
    truncatedError.code = "output-truncated";
    throw truncatedError;
  }
  const raw = payload?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) throw new HttpsError("internal", "생각 색인 결과가 비어 있습니다.");
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { throw new HttpsError("internal", "생각 색인 형식이 올바르지 않습니다."); }
  const validIds = new Set(records.map((x) => x.id));
  const indexes = (Array.isArray(parsed?.indexes) ? parsed.indexes : [])
    .filter((item) => validIds.has(String(item?.id || "")))
    .map((item) => ({ id: String(item.id), index: normalizeThoughtIndex(item) }))
    .filter((item) => item.index?.literal?.summary);
  return {
    indexes,
    profiles: indexes.map((item) => ({ id: item.id, ...item.index })),
    model: THOUGHT_INDEX_MODEL,
    inputTokens: Number(payload?.usage?.prompt_tokens || 0),
    cachedInputTokens: Number(payload?.usage?.prompt_tokens_details?.cached_tokens || 0),
    outputTokens: Number(payload?.usage?.completion_tokens || 0),
  };
}

async function ensureThoughtIndexes(uid, userRef, records) {
  const fragmentRefs = records.map((r) => userRef.collection("fragments").doc(r.id));
  const fragmentSnaps = fragmentRefs.length ? await db.getAll(...fragmentRefs) : [];
  const resultMap = new Map();
  const stale = [];

  records.forEach((record, i) => {
    const fingerprint = betweenThoughtProfileFingerprint(record);
    const fragmentData = fragmentSnaps[i]?.exists ? fragmentSnaps[i].data() || {} : {};
    const currentIndex = normalizeThoughtIndex(fragmentData.aiIndex);
    if (currentIndex && isThoughtIndexCurrentForRecord(fragmentData, record, fingerprint)) {
      resultMap.set(record.id, currentIndex);
      return;
    }
    stale.push({ record, fingerprint, ref: fragmentRefs[i] });
  });

  let usage = { count: 0, migrated: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  if (!stale.length) return { profiles: resultMap, indexes: resultMap, usage };

  // 사진이 들어간 생각은 비용·오류 범위를 분리하기 위해 한 건씩 처리하고,
  // 텍스트 전용 생각만 기존처럼 묶어서 처리한다.
  const chunks = [];
  let textChunk = [];
  const flushTextChunk = () => {
    if (textChunk.length) chunks.push(textChunk);
    textChunk = [];
  };
  for (const item of stale) {
    if (Array.isArray(item.record.images) && item.record.images.length) {
      flushTextChunk();
      chunks.push([item]);
    } else {
      textChunk.push(item);
      if (textChunk.length >= THOUGHT_INDEX_MAX_BATCH) flushTextChunk();
    }
  }
  flushTextChunk();

  // 사진 요청을 둘씩 동시에 보내면 한 건의 오류가 Promise.all 전체를 무너뜨려
  // 성공한 응답까지 저장하지 못하고 다시 호출할 수 있다. 비용 중복을 막기 위해
  // 각 chunk를 독립적으로 순차 처리한다. 텍스트 전용 생각은 chunk 안에서 계속 묶인다.
  for (const chunk of chunks) {
    const generated = await requestThoughtIndexes(chunk.map((item) => item.record));
    const generatedMap = new Map(generated.indexes.map((item) => [item.id, item.index]));
    const batch = db.batch();
    let count = 0;
    const divisor = Math.max(1, generated.indexes.length);
    for (const item of chunk) {
      const index = generatedMap.get(item.record.id);
      if (!index) continue;
      resultMap.set(item.record.id, index);
      batch.set(item.ref, {
        aiIndex: index,
        aiIndexVersion: THOUGHT_INDEX_VERSION,
        aiIndexModel: generated.model,
        aiIndexFingerprint: item.fingerprint,
        aiIndexInputTokens: Math.round(generated.inputTokens / divisor),
        aiIndexCachedInputTokens: Math.round(generated.cachedInputTokens / divisor),
        aiIndexOutputTokens: Math.round(generated.outputTokens / divisor),
        aiIndexImageCount: Array.isArray(item.record.images) ? item.record.images.length : 0,
        aiIndexTotalImageCount: Number(item.record.totalImageCount || 0),
        aiIndexImageDetail: Array.isArray(item.record.images) && item.record.images.length ? THOUGHT_INDEX_IMAGE_DETAIL : "none",
        aiIndexVisionVersion: THOUGHT_INDEX_VISION_VERSION,
        aiIndexPromptContextVersion: item.record.promptContext ? BETWEEN_THOUGHTS_PROMPT_CONTEXT_VERSION : 0,
        aiIndexUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      count++;
    }
    if (count) {
      batch.set(userRef.collection("aiUsage").doc(koreaDateKey()), {
        thoughtIndexGenerations: FieldValue.increment(count),
        thoughtIndexInputTokens: FieldValue.increment(generated.inputTokens),
        thoughtIndexCachedInputTokens: FieldValue.increment(generated.cachedInputTokens),
        thoughtIndexOutputTokens: FieldValue.increment(generated.outputTokens),
        thoughtIndexModel: THOUGHT_INDEX_MODEL,
        thoughtIndexVersion: THOUGHT_INDEX_VERSION,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      await batch.commit();
      usage.count += count;
      usage.inputTokens += generated.inputTokens;
      usage.cachedInputTokens += generated.cachedInputTokens;
      usage.outputTokens += generated.outputTokens;
    }
  }
  return { profiles: resultMap, indexes: resultMap, usage };
}

// 이전 함수명은 호출부 호환을 위해 유지하되 실제로는 다층 색인과 최신 사진 표현 색인을 보장한다.
async function ensureBetweenThoughtProfiles(uid, userRef, records) {
  return ensureThoughtIndexes(uid, userRef, records);
}

async function ensureUnifiedThoughtIndex(uid, fragmentId, options = {}) {
  const includeEmbedding = options.includeEmbedding !== false;
  const includeStructured = options.includeStructured !== false;
  const userRef = db.collection("users").doc(uid);
  const fragmentRef = userRef.collection("fragments").doc(fragmentId);
  const snap = await fragmentRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "생각 조각을 찾지 못했습니다.");
  const data = snap.data() || {};
  if (data.deletedAt) return { ok: true, skipped: true, reason: "deleted" };

  const sourceId = String(data.sourceId || "");
  const sourceSnap = sourceId ? await userRef.collection("sources").doc(sourceId).get() : null;
  const record = betweenThoughtFullRecord(fragmentId, data, sourceSnap?.exists ? sourceSnap.data() || {} : null);
  const canStructure = includeStructured && (
    (record.thought || record.sourceExcerpt).trim().length >= 8 ||
    (Array.isArray(record.images) && record.images.length > 0)
  );

  const emptyStructured = () => Promise.resolve({
    profiles: new Map(), indexes: new Map(),
    usage: { count: 0, migrated: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
  });
  let embedding;
  let structured;

  if (Array.isArray(record.images) && record.images.length && canStructure) {
    // 사진 의미를 임베딩에도 반영하려면 먼저 고화질 시각 색인을 만든 뒤,
    // 그 시각 요약을 글과 합쳐 text embedding을 생성해야 한다.
    structured = await ensureThoughtIndexes(uid, userRef, [record]);
    const freshIndex = structured.indexes.get(fragmentId) || data.aiIndex;
    embedding = includeEmbedding
      ? await ensureFragmentEmbedding(uid, fragmentRef, { ...data, aiIndex: freshIndex })
      : { ok: true, skipped: true, reason: "not-requested", inputTokens: 0 };
  } else {
    [embedding, structured] = await Promise.all([
      includeEmbedding
        ? ensureFragmentEmbedding(uid, fragmentRef, data)
        : Promise.resolve({ ok: true, skipped: true, reason: "not-requested", inputTokens: 0 }),
      canStructure ? ensureThoughtIndexes(uid, userRef, [record]) : emptyStructured(),
    ]);
  }

  const index = structured.indexes.get(fragmentId);
  const promptContextCompleted = Boolean(
    record.promptContext &&
    (!canStructure || index) &&
    (!includeEmbedding || embedding?.ok)
  );
  if (promptContextCompleted) {
    await fragmentRef.set({
      betweenThoughtsPromptContextIndexedVersion: BETWEEN_THOUGHTS_PROMPT_CONTEXT_VERSION,
      betweenThoughtsPromptContextIndexedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  return {
    ok: true,
    skipped: Boolean(embedding.skipped && !structured.usage.count),
    embedding,
    indexed: Boolean(index),
    indexGenerated: structured.usage.count > 0,
    indexMigrated: false,
    promptContextUsed: Boolean(record.promptContext),
    aiIndexVersion: THOUGHT_INDEX_VERSION,
    model: THOUGHT_INDEX_MODEL,
  };
}

async function requestBetweenThoughtsScout(profileCandidates, excludePairKeys) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpsError("failed-precondition", "AI 연결 설정을 확인해주세요.");
  const systemPrompt = [
    "당신은 '생각의 텃밭'의 1차 큐레이터다. 지금 보는 것은 각 생각의 원문이 아니라 여러 관점과 근거를 분리해 둔 다층 생각 색인이다.",
    "core/themes/events/claims/keyPhrases는 원문에 직접 나타난 내용에 가깝다. inferredIntents, valuesOrNeeds, emotions, tensions, shifts, openLoops, alternateReadings는 evidence와 confidence가 붙은 해석 후보이므로 사실처럼 단정하지 않는다.",
    "visualAttachmentIntents·visualEmotionalFunctions·visualLatentContexts는 사진을 비언어적 문장으로 읽은 해석 후보다. 보이는 근거와 confidence를 함께 보고, 단순 사물 목록보다 글에 더해진 상황·대비·정서를 연결 후보에 반영한다.",
    "한 항목의 summary만 따라가지 말고 직접 진술, 의도, 가치, 긴장, 변화, 미완의 질문, 대안 해석을 서로 다른 렌즈로 살핀다. uncertainty가 크면 후보 점수를 낮춘다.",
    `최대 ${BETWEEN_THOUGHTS_SCOUT_PAIR_COUNT}개의 조합만 원문 정밀 검토 대상으로 고른다. 이 단계에서는 질문을 만들지 않는다.`,
    "가장 비슷한 두 생각을 찾는 것이 목표가 아니다. 함께 놓았을 때 새로운 자기 이해가 생길 가능성이 있는 두 생각을 찾는다.",
    "좋은 후보 유형은 세 가지다: (1) 직접 연결 — 같은 주제를 더 깊게 이어가는 관계, (2) 반복 패턴 — 소재는 다르지만 가치·욕구·감정·행동·긴장이 구체적으로 반복되는 관계, (3) 뜻밖의 연결 — 표면 주제는 다르지만 사용자가 실제로 적은 내용에서 선명한 공통 축이나 모순이 보이는 관계.",
    "특히 반복 패턴과 뜻밖의 연결은 단순히 '둘 다 어렵다', '둘 다 고민이다', '둘 다 해야 한다' 정도의 추상적 공통점이면 탈락시킨다.",
    "같은 책·같은 영상·같은 출처의 두 기록은 자동으로 높은 점수를 주지 않는다. 같은 작품이라는 이유뿐이면 탈락시킨다. 사용자의 받아들임이 달라졌거나, 같은 문장을 서로 다른 삶의 장면에 적용했거나, 실제 긴장·변화가 있을 때만 고른다.",
    "반대로 출처가 다른 생각과 개인 경험이 연결될 때 sourceRelation/sourceAnchor가 실제 연결을 강화하면 좋은 후보가 될 수 있다.",
    "가능하다면 한 번의 shortlist가 같은 소재끼리만 채워지지 않게 다양성을 준다. 하지만 다양성을 위해 약한 연결을 억지로 넣지는 않는다.",
    "excludePairKeys에 있는 조합은 다시 고르지 않는다. 같은 Fragment를 여러 후보에 반복 사용하는 것도 가급적 피한다.",
    "reason은 왜 원문까지 다시 읽어볼 가치가 있는지 구체적으로 한 문장으로 쓴다. 사용자가 적지 않은 심리나 사실을 추측하지 않는다.",
    "confidence는 프로필만 보았을 때 원문 정밀 검토 가치가 얼마나 있는지 0~100으로 평가한다. 70 미만은 반환하지 않는다.",
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: BETWEEN_THOUGHTS_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify({ profiles: profileCandidates, excludePairKeys }) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "between_thoughts_scout",
          strict: true,
          schema: {
            type: "object",
            properties: {
              shortlist: {
                type: "array",
                minItems: 0,
                maxItems: BETWEEN_THOUGHTS_SCOUT_PAIR_COUNT,
                items: {
                  type: "object",
                  properties: {
                    fragmentIds: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } },
                    bridgeType: { type: "string", enum: ["direct", "pattern", "value", "need", "tension", "contrast", "change", "source_personal", "surprising", "meaning"] },
                    reason: { type: "string" },
                    confidence: { type: "integer", minimum: 0, maximum: 100 },
                  },
                  required: ["fragmentIds", "bridgeType", "reason", "confidence"],
                  additionalProperties: false,
                },
              },
            },
            required: ["shortlist"],
            additionalProperties: false,
          },
        },
      },
      max_completion_tokens: 1000,
    }),
  });
  let payload;
  try { payload = await response.json(); } catch (_) { payload = null; }
  const requestId = String(response.headers.get("x-request-id") || "");
  const finishReason = String(payload?.choices?.[0]?.finish_reason || "");
  if (!response.ok) {
    logger.error("OpenAI Between Thoughts scout HTTP error", {
      status: response.status,
      requestId: requestId || null,
      code: payload?.error?.code || null,
      type: payload?.error?.type || null,
      message: payload?.error?.message || null,
    });
    throw new HttpsError("internal", "두 생각 사이의 후보를 고르지 못했습니다.");
  }
  const raw = payload?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) {
    logger.error("OpenAI Between Thoughts scout empty response", {
      requestId: requestId || null,
      finishReason: finishReason || null,
      inputTokens: Number(payload?.usage?.prompt_tokens || 0),
      outputTokens: Number(payload?.usage?.completion_tokens || 0),
    });
    throw new HttpsError("internal", "두 생각 사이 후보 결과가 비어 있습니다.");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logger.error("OpenAI Between Thoughts scout JSON parse failed", {
      requestId: requestId || null,
      finishReason: finishReason || null,
      inputTokens: Number(payload?.usage?.prompt_tokens || 0),
      outputTokens: Number(payload?.usage?.completion_tokens || 0),
      message: error?.message || null,
    });
    throw new HttpsError("internal", "두 생각 사이 후보 형식이 올바르지 않습니다.");
  }
  const validIds = new Set(profileCandidates.map((x) => x.id));
  const excluded = new Set(excludePairKeys || []);
  const seenPairs = new Set();
  const shortlist = [];
  for (const rawItem of Array.isArray(parsed?.shortlist) ? parsed.shortlist : []) {
    const ids = Array.isArray(rawItem?.fragmentIds) ? rawItem.fragmentIds.map(String) : [];
    if (ids.length !== 2 || ids[0] === ids[1] || !ids.every((id) => validIds.has(id))) continue;
    const pairKey = ids.slice().sort().join("|");
    if (excluded.has(pairKey) || seenPairs.has(pairKey)) continue;
    const confidence = Math.max(0, Math.min(100, Number(rawItem.confidence || 0)));
    const reason = String(rawItem.reason || "").trim().slice(0, 420);
    if (confidence < 70 || !reason) continue;
    seenPairs.add(pairKey);
    shortlist.push({ fragmentIds: ids, bridgeType: String(rawItem.bridgeType || "meaning"), reason, confidence: Math.round(confidence) });
    if (shortlist.length >= BETWEEN_THOUGHTS_SCOUT_PAIR_COUNT) break;
  }
  return {
    shortlist,
    requestId,
    finishReason,
    inputTokens: Number(payload?.usage?.prompt_tokens || 0),
    cachedInputTokens: Number(payload?.usage?.prompt_tokens_details?.cached_tokens || 0),
    outputTokens: Number(payload?.usage?.completion_tokens || 0),
  };
}

async function requestBetweenThoughtsDeepCuration(shortlist, recordMap) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpsError("failed-precondition", "AI 연결 설정을 확인해주세요.");
  const neededIds = [...new Set(shortlist.flatMap((x) => x.fragmentIds))];
  const fragments = neededIds.map((id) => recordMap.get(id)).filter(Boolean).map((r) => ({
    id: r.id,
    date: r.date,
    thought: r.thought,
    context: r.context,
    ...(r.promptContext ? { promptContext: r.promptContext } : {}),
    sourceExcerpt: r.sourceExcerpt,
    locator: r.locator,
    source: r.source,
    visualContext: r.visualContext || null,
  }));
  const systemPrompt = [
    "당신은 '생각의 텃밭'의 최종 큐레이터이자 인터뷰어다.",
    "1차 큐레이터가 생각 프로필만 보고 고른 후보 조합을 이제 실제 원문, 출처, 인용과 함께 다시 읽는다. 1차 판단을 그대로 믿지 말고 반드시 재검증한다.",
    "visualContext가 있으면 첨부 사진을 고화질로 한 번 읽어 저장한 시각 색인이다. 실제 사진을 다시 보는 것은 아니므로 시각 색인의 불확실성을 존중하고, 글에 없는 작성자 의도를 사진만으로 확정하지 않는다.",
    "원문 안의 줄바꿈된 '…'는 긴 글의 가운데 일부가 생략됐다는 표시다. 생략된 내용을 추정하지 않는다.",
    `최종적으로 사용자가 함께 바라볼 가치가 분명한 조합만 최대 ${BETWEEN_THOUGHTS_CURATION_PAIR_COUNT}개 남기고, 각 조합에 질문 하나를 만든다.`,
    "가장 중요한 기준은 사용자가 두 카드를 보는 순간 '왜 이 둘을 같이 보여줬는지 알 것 같다'고 느낄 가능성이다. 설명을 길게 해야만 연결되는 조합은 탈락시킨다.",
    "같은 책·같은 영상·같은 출처라는 이유만으로는 연결 근거가 되지 않는다. 두 기록에서 사용자가 붙잡은 생각의 변화·긴장·적용 방식이 실제로 이어져야 한다.",
    "sourceExcerpt는 외부의 문장·장면이고 thought는 사용자의 생각이다. promptContext는 이전 AI 질문의 압축 배경이며 사용자의 주장으로 취급하지 않는다. 외부 저자의 말이나 이전 질문의 전제를 사용자 신념처럼 취급하지 않는다.",
    "직접 연결도 좋지만, 소재가 다른데 반복되는 가치·욕구·행동 패턴이 실제 문장에 드러나는 조합은 더 깊은 자기 이해를 만들 수 있다. 단, 추상적인 공통점만으로 묶지 않는다.",
    "질문은 'A는 이렇고 B는 저런데 왜 다른가요?', '공통점은 무엇인가요?', '차이는 무엇인가요?' 같은 비교 시험문제를 피한다.",
    "질문은 두 기록을 발판으로 아직 쓰지 않은 세 번째 생각을 떠올리게 해야 한다. 사용자가 자기 경험을 떠올리며 바로 답할 수 있는 자연스러운 한국어 한 문장이어야 한다.",
    "질문은 두 생각의 관계를 정답처럼 먼저 선언하지 않는다. 조언·평가·진단·칭찬·교훈도 하지 않는다.",
    "bridge는 사용자에게 보여주지 않는 내부 메모다. 실제 원문에서 확인되는 연결 근거를 구체적으로 한 문장으로 적는다.",
    "confidence는 원문까지 읽은 뒤 사용자가 연결을 납득할 가능성을 0~100으로 평가한다. 78 미만은 반환하지 않는다.",
    "이 요청에는 후보 한 조합만 들어온다. 원문에서 연결 가치가 충분하지 않으면 억지로 질문을 만들지 말고 items를 비운다.",
  ].join("\n");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: BETWEEN_THOUGHTS_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify({ shortlist, fragments }) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "between_thoughts_deep_curation",
          strict: true,
          schema: {
            type: "object",
            properties: {
              items: {
                type: "array",
                minItems: 0,
                maxItems: BETWEEN_THOUGHTS_CURATION_PAIR_COUNT,
                items: {
                  type: "object",
                  properties: {
                    fragmentIds: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } },
                    bridgeType: { type: "string", enum: ["direct", "pattern", "value", "need", "tension", "contrast", "change", "source_personal", "surprising", "meaning"] },
                    bridge: { type: "string" },
                    question: { type: "string" },
                    confidence: { type: "integer", minimum: 0, maximum: 100 },
                    sourceUsed: { type: "boolean" },
                  },
                  required: ["fragmentIds", "bridgeType", "bridge", "question", "confidence", "sourceUsed"],
                  additionalProperties: false,
                },
              },
              noPairReason: { type: "string" },
            },
            required: ["items", "noPairReason"],
            additionalProperties: false,
          },
        },
      },
      max_completion_tokens: 1000,
    }),
  });
  let payload;
  try { payload = await response.json(); } catch (_) { payload = null; }
  const requestId = String(response.headers.get("x-request-id") || "");
  const finishReason = String(payload?.choices?.[0]?.finish_reason || "");
  if (!response.ok) {
    logger.error("OpenAI Between Thoughts deep curation HTTP error", {
      status: response.status,
      requestId: requestId || null,
      code: payload?.error?.code || null,
      type: payload?.error?.type || null,
      message: payload?.error?.message || null,
    });
    throw new HttpsError("internal", "두 생각 사이를 깊게 살펴보지 못했습니다.");
  }
  const raw = payload?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) {
    logger.error("OpenAI Between Thoughts deep curation empty response", {
      requestId: requestId || null,
      finishReason: finishReason || null,
      inputTokens: Number(payload?.usage?.prompt_tokens || 0),
      outputTokens: Number(payload?.usage?.completion_tokens || 0),
    });
    throw new HttpsError("internal", "두 생각 사이 최종 결과가 비어 있습니다.");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logger.error("OpenAI Between Thoughts deep curation JSON parse failed", {
      requestId: requestId || null,
      finishReason: finishReason || null,
      inputTokens: Number(payload?.usage?.prompt_tokens || 0),
      outputTokens: Number(payload?.usage?.completion_tokens || 0),
      message: error?.message || null,
    });
    throw new HttpsError("internal", "두 생각 사이 최종 형식이 올바르지 않습니다.");
  }
  const allowedPairs = new Set(shortlist.map((x) => x.fragmentIds.slice().sort().join("|")));
  const seenIds = new Set();
  const seenPairs = new Set();
  const items = [];
  for (const rawItem of Array.isArray(parsed?.items) ? parsed.items : []) {
    const ids = Array.isArray(rawItem?.fragmentIds) ? rawItem.fragmentIds.map(String) : [];
    if (ids.length !== 2 || ids[0] === ids[1]) continue;
    const pairKey = ids.slice().sort().join("|");
    if (!allowedPairs.has(pairKey) || seenPairs.has(pairKey)) continue;
    const confidence = Math.max(0, Math.min(100, Number(rawItem.confidence || 0)));
    const question = String(rawItem.question || "").trim().slice(0, 340);
    const bridge = String(rawItem.bridge || "").trim().slice(0, 460);
    if (confidence < 78 || !question || !bridge) continue;
    if (shortlist.length >= 5 && ids.some((id) => seenIds.has(id))) continue;
    ids.forEach((id) => seenIds.add(id));
    seenPairs.add(pairKey);
    items.push({
      fragmentIds: ids,
      bridgeType: String(rawItem.bridgeType || "meaning"),
      bridge,
      question,
      confidence: Math.round(confidence),
      sourceUsed: Boolean(rawItem.sourceUsed),
    });
    if (items.length >= BETWEEN_THOUGHTS_CURATION_PAIR_COUNT) break;
  }
  return {
    items,
    noPairReason: String(parsed?.noPairReason || "").trim().slice(0, 320),
    requestId,
    finishReason,
    inputTokens: Number(payload?.usage?.prompt_tokens || 0),
    cachedInputTokens: Number(payload?.usage?.prompt_tokens_details?.cached_tokens || 0),
    outputTokens: Number(payload?.usage?.completion_tokens || 0),
  };
}

/**
 * 이전 클라이언트 호환용 이름. 실제로는 Fragment의 v2 다층 생각 색인을 갱신한다.
 */
exports.betweenThoughtsProfile = onCall(
  {
    region: "us-central1",
    secrets: ["OPENAI_API_KEY"],
    timeoutSeconds: 90,
    memory: "512MiB",
    maxInstances: 3,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "로그인 후 사용할 수 있습니다.");
    const fragmentId = safeId(request.data?.fragmentId, "생각 조각");
    return ensureUnifiedThoughtIndex(uid, fragmentId, { includeEmbedding: false });
  }
);

/**
 * 새 생각 저장 뒤 한 번만 호출하는 통합 색인 함수.
 * - 의미 검색용 text embedding
 * - 글과 고화질 첨부 사진을 함께 읽는 다층 AI 색인
 * - 두 생각 사이 / 글의 갈래 / Studio 질문이 공유하는 공통 지도
 * 두 결과를 같은 Fragment 문서에 저장하고, 원문이 바뀌지 않으면 다시 호출하지 않는다.
 * 색인은 원문을 대체하지 않으며 최종 질문과 갈래 판단은 선택된 원문을 다시 읽는다.
 */
exports.thoughtIndexFragment = onCall(
  {
    region: "us-central1",
    secrets: ["OPENAI_API_KEY"],
    timeoutSeconds: 90,
    memory: "512MiB",
    maxInstances: 3,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");
    const fragmentId = safeId(request.data?.fragmentId, "생각 조각");
    const isAnonymous = request.auth?.token?.firebase?.sign_in_provider === "anonymous";
    const runId = crypto.randomUUID();
    logger.info("Thought index request started", { uid, fragmentId, runId, structured: !isAnonymous });
    try {
      const result = await ensureUnifiedThoughtIndex(uid, fragmentId, { includeEmbedding: true, includeStructured: !isAnonymous });
      logger.info("Thought index request completed", {
        uid, fragmentId, runId,
        skipped: Boolean(result?.skipped),
        indexGenerated: Boolean(result?.indexGenerated),
        promptContextUsed: Boolean(result?.promptContextUsed),
        embeddingSkipped: Boolean(result?.embedding?.skipped),
        embeddingInputTokens: Number(result?.embedding?.inputTokens || 0),
      });
      return result;
    } catch (error) {
      logger.error("Thought index request failed", {
        uid, fragmentId, runId,
        code: error?.code || null,
        message: error?.message || null,
      });
      throw error;
    }
  }
);

/**
 * 기존 생각의 embedding과 공통 AI 색인을 함께 보완한다.
 * 글 전용 v2 색인은 유지하고, 사진이 있는 생각만 최신 사진 표현 색인 버전이 아닐 때 다시 호출한다.
 */
exports.backfillThoughtIndexes = onCall(
  {
    region: "us-central1",
    secrets: ["OPENAI_API_KEY"],
    timeoutSeconds: 180,
    memory: "512MiB",
    maxInstances: 1,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");
    const requested = Number(request.data?.limit || THOUGHT_INDEX_MAX_BATCH);
    const limit = Math.max(1, Math.min(THOUGHT_INDEX_MAX_BATCH, Number.isFinite(requested) ? Math.floor(requested) : THOUGHT_INDEX_MAX_BATCH));
    const excludeIds = new Set(
      (Array.isArray(request.data?.excludeIds) ? request.data.excludeIds : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
        .slice(0, 120)
    );
    const onlyIds = new Set(
      (Array.isArray(request.data?.onlyIds) ? request.data.onlyIds : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean)
        .slice(0, 120)
    );
    const job = String(request.data?.job || "general").trim().slice(0, 80) || "general";
    const runId = crypto.randomUUID();
    logger.info("Thought-index backfill started", {
      uid, runId, job, limit, onlyCount: onlyIds.size, excludeCount: excludeIds.size,
    });

    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.collection("fragments").get();
    const rows = [];
    snap.forEach((doc) => {
      const data = doc.data() || {};
      if (!data.deletedAt) rows.push({ id: doc.id, ref: doc.ref, data });
    });

    const sourceIds = [...new Set(rows.map((x) => String(x.data.sourceId || "")).filter(Boolean))];
    const sourceSnaps = sourceIds.length ? await db.getAll(...sourceIds.map((id) => userRef.collection("sources").doc(id))) : [];
    const sourceMap = new Map();
    sourceSnaps.forEach((sourceSnap, i) => { if (sourceSnap.exists) sourceMap.set(sourceIds[i], sourceSnap.data() || {}); });

    const pending = [];
    for (const row of rows) {
      if (onlyIds.size && !onlyIds.has(row.id)) continue;
      const embeddingText = buildEmbeddingText(row.data);
      const embeddingHash = embeddingText ? sha256(embeddingText) : "";
      const embeddingCurrent = !embeddingText || (
        row.data.embedding &&
        row.data.embeddingModel === EMBEDDING_MODEL &&
        row.data.embeddingVersion === EMBEDDING_VERSION &&
        row.data.embeddingTextHash === embeddingHash
      );
      const record = betweenThoughtFullRecord(row.id, row.data, sourceMap.get(String(row.data.sourceId || "")) || null);
      const fingerprint = betweenThoughtProfileFingerprint(record);
      const canStructure = (record.thought || record.sourceExcerpt).trim().length >= 8 ||
        (Array.isArray(record.images) && record.images.length > 0);
      const indexCurrent = !canStructure || isThoughtIndexCurrentForRecord(row.data, record, fingerprint);
      if (!embeddingCurrent || !indexCurrent) pending.push({ ...row, record, embeddingText, embeddingHash, embeddingCurrent, indexCurrent });
    }

    const eligible = pending.filter((item) => !excludeIds.has(item.id));
    const items = eligible.slice(0, limit);
    if (!items.length) {
      logger.info("Thought-index backfill completed", {
        uid, runId, job, attempted: 0, processed: 0, remaining: 0, onlyCount: onlyIds.size,
      });
      return {
        ok: true,
        runId,
        job,
        attempted: 0,
        processed: 0,
        remaining: 0,
        liveCount: rows.length,
        targetCount: onlyIds.size || rows.length,
        indexedNow: 0,
        embeddedNow: 0,
        failedIds: [],
        excludedPending: pending.filter((item) => excludeIds.has(item.id)).length,
      };
    }

    const structuredSuccess = new Set(items.filter((x) => x.indexCurrent).map((x) => x.id));
    const embeddingSuccess = new Set(items.filter((x) => x.embeddingCurrent || !x.embeddingText).map((x) => x.id));
    const failureCodes = new Map();
    let indexedNow = 0;
    let migratedNow = 0;
    let embeddedNow = 0;
    let embeddingTokens = 0;
    const structuredIndexById = new Map();

    // 임베딩은 먼저 묶어서 처리하되, 사진 색인이 새로 필요한 생각은
    // 시각 색인 생성 뒤에 글+사진 의미를 합쳐 임베딩한다.
    const embeddingItems = items.filter((x) =>
      !x.embeddingCurrent &&
      x.embeddingText &&
      !(Array.isArray(x.record.images) && x.record.images.length && !x.indexCurrent)
    );
    if (embeddingItems.length) {
      try {
        const result = await requestEmbeddings(embeddingItems.map((x) => x.embeddingText));
        const batch = db.batch();
        const perItemTokens = Math.round(result.totalTokens / Math.max(1, embeddingItems.length));
        embeddingItems.forEach((item, i) => {
          const vector = result.vectors[i];
          batch.set(item.ref, {
            embedding: FieldValue.vector(vector),
            embeddingModel: EMBEDDING_MODEL,
            embeddingVersion: EMBEDDING_VERSION,
            embeddingTextHash: item.embeddingHash,
            embeddingDimensions: vector.length,
            embeddingInputTokens: perItemTokens,
            embeddingUpdatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        });
        batch.set(userRef.collection("aiUsage").doc(koreaDateKey()), {
          fragmentEmbeddingTokens: FieldValue.increment(result.totalTokens),
          fragmentEmbeddingCount: FieldValue.increment(embeddingItems.length),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        await batch.commit();
        embeddingItems.forEach((item) => embeddingSuccess.add(item.id));
        embeddedNow += embeddingItems.length;
        embeddingTokens += result.totalTokens;
      } catch (error) {
        logger.warn("Thought-index backfill embedding batch failed; retrying one by one", {
          uid,
          count: embeddingItems.length,
          code: error?.code || null,
          message: error?.message || null,
        });
        for (const item of embeddingItems) {
          try {
            const result = await ensureFragmentEmbedding(uid, item.ref, item.data);
            embeddingSuccess.add(item.id);
            if (!result.skipped) embeddedNow += 1;
            embeddingTokens += Number(result.inputTokens || 0);
          } catch (singleError) {
            failureCodes.set(item.id, String(singleError?.code || "embedding-failed"));
            logger.warn("Thought-index backfill single embedding failed", {
              uid,
              fragmentId: item.id,
              code: singleError?.code || null,
              message: singleError?.message || null,
            });
          }
        }
      }
    }

    // 다층 색인도 묶음을 우선 사용하되, 한 조각 때문에 전체가 멈추지 않도록 개별 재시도한다.
    const structureItems = items.filter((x) => !x.indexCurrent);
    if (structureItems.length) {
      let missing = structureItems;
      try {
        const structured = await ensureBetweenThoughtProfiles(uid, userRef, structureItems.map((x) => x.record));
        indexedNow += Number(structured.usage?.count || 0);
        migratedNow += Number(structured.usage?.migrated || 0);
        structureItems.forEach((item) => {
          if (structured.indexes?.has(item.id)) {
            structuredSuccess.add(item.id);
            structuredIndexById.set(item.id, structured.indexes.get(item.id));
          }
        });
        missing = structureItems.filter((item) => !structuredSuccess.has(item.id));
      } catch (error) {
        logger.warn("Thought-index backfill structured batch failed; retrying one by one", {
          uid,
          count: structureItems.length,
          code: error?.code || null,
          message: error?.message || null,
        });
      }

      for (const item of missing) {
        try {
          const single = await ensureBetweenThoughtProfiles(uid, userRef, [item.record]);
          if (single.indexes?.has(item.id)) {
            structuredSuccess.add(item.id);
            structuredIndexById.set(item.id, single.indexes.get(item.id));
            indexedNow += Number(single.usage?.count || 0);
            migratedNow += Number(single.usage?.migrated || 0);
          } else {
            failureCodes.set(item.id, "index-empty");
          }
        } catch (singleError) {
          failureCodes.set(item.id, String(singleError?.code || "index-failed"));
          logger.warn("Thought-index backfill single structured index failed", {
            uid,
            fragmentId: item.id,
            code: singleError?.code || null,
            message: singleError?.message || null,
          });
        }
      }
    }

    // 사진이 있는 생각은 새 시각 색인을 짧은 텍스트로 변환해 임베딩에도 포함한다.
    // text-embedding 모델 자체는 이미지를 직접 받지 않지만, 이 단계로 사진 의미가
    // 닮은 생각·Thread 추천 후보 검색에도 반영된다.
    const visualEmbeddingItems = items.filter((item) =>
      Array.isArray(item.record.images) &&
      item.record.images.length &&
      structuredSuccess.has(item.id)
    );
    for (const item of visualEmbeddingItems) {
      try {
        const freshIndex = structuredIndexById.get(item.id) || normalizeThoughtIndex(item.data.aiIndex);
        const result = await ensureFragmentEmbedding(uid, item.ref, { ...item.data, aiIndex: freshIndex });
        embeddingSuccess.add(item.id);
        if (!result.skipped) embeddedNow += 1;
        embeddingTokens += Number(result.inputTokens || 0);
      } catch (visualEmbeddingError) {
        embeddingSuccess.delete(item.id);
        failureCodes.set(item.id, String(visualEmbeddingError?.code || "visual-embedding-failed"));
        logger.warn("Thought-index backfill visual embedding failed", {
          uid,
          fragmentId: item.id,
          code: visualEmbeddingError?.code || null,
          message: visualEmbeddingError?.message || null,
        });
      }
    }

    const completedIds = items
      .filter((item) => structuredSuccess.has(item.id) && embeddingSuccess.has(item.id))
      .map((item) => item.id);
    const completedSet = new Set(completedIds);
    const failedIds = items.filter((item) => !completedSet.has(item.id)).map((item) => item.id);

    const promptContextCompletedItems = items.filter((item) =>
      completedSet.has(item.id) && Boolean(item.record.promptContext)
    );
    if (promptContextCompletedItems.length) {
      const completionBatch = db.batch();
      promptContextCompletedItems.forEach((item) => {
        completionBatch.set(item.ref, {
          betweenThoughtsPromptContextIndexedVersion: BETWEEN_THOUGHTS_PROMPT_CONTEXT_VERSION,
          betweenThoughtsPromptContextIndexedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
      await completionBatch.commit();
    }

    const remaining = Math.max(0, eligible.length - items.length);
    logger.info("Thought-index backfill completed", {
      uid, runId, job,
      attempted: items.length,
      processed: completedIds.length,
      remaining,
      indexedNow,
      embeddedNow,
      failedCount: failedIds.length,
      failureCodes: Object.fromEntries(failedIds.map((id) => [id, failureCodes.get(id) || "incomplete"])),
    });
    return {
      ok: true,
      runId,
      job,
      attempted: items.length,
      processed: completedIds.length,
      remaining,
      liveCount: rows.length,
      targetCount: onlyIds.size || rows.length,
      indexedNow,
      migratedNow,
      embeddedNow,
      embeddingTokens,
      failedIds,
      failureCodes: Object.fromEntries(failedIds.map((id) => [id, failureCodes.get(id) || "incomplete"])),
    };
  }
);

/**
 * Home 라운지의 '두 생각 사이' 큐레이터.
 * - 다층 색인만 읽는 scout 호출은 최대 후보 3개를 대기열에 저장한다.
 * - 원문을 다시 읽는 deep 호출은 한 요청에 후보 하나만 처리한다.
 * - 앱을 다시 열면 저장된 active/대기열을 먼저 반환하며, 다음 질문은 사용자가 요청할 때만 만든다.
 * - 설정에서 기능을 끄면 캐시 조회 외의 AI 호출을 시작하지 않는다.
 */
function betweenThoughtsPairKey(ids) {
  return Array.isArray(ids) && ids.length === 2 ? ids.map(String).sort().join("|") : "";
}

function cachePairIds(cache) {
  const rows = [cache?.activeItem, ...(Array.isArray(cache?.readyItems) ? cache.readyItems : []),
    ...(Array.isArray(cache?.pendingPairs) ? cache.pendingPairs : []), ...(Array.isArray(cache?.items) ? cache.items : [])];
  return [...new Set(rows.flatMap((item) => Array.isArray(item?.fragmentIds) ? item.fragmentIds.map(String) : []))];
}

function normalizeQueuedCandidate(item, validIds, excluded) {
  const ids = Array.isArray(item?.fragmentIds) ? item.fragmentIds.map(String) : [];
  const key = betweenThoughtsPairKey(ids);
  if (!key || ids[0] === ids[1] || !ids.every((id) => validIds.has(id)) || excluded.has(key)) return null;
  const reason = String(item?.reason || item?.bridge || "").trim().slice(0, 460);
  const confidence = Math.max(0, Math.min(100, Number(item?.confidence || 0)));
  return {
    fragmentIds: ids,
    bridgeType: String(item?.bridgeType || "meaning"),
    reason,
    confidence: Math.round(confidence),
  };
}

function normalizeReadyBetweenItem(item, validIds, excluded) {
  const ids = Array.isArray(item?.fragmentIds) ? item.fragmentIds.map(String) : [];
  const key = betweenThoughtsPairKey(ids);
  const question = String(item?.question || "").trim().slice(0, 340);
  if (!key || ids[0] === ids[1] || !ids.every((id) => validIds.has(id)) || excluded.has(key) || !question) return null;
  return {
    fragmentIds: ids,
    bridgeType: String(item?.bridgeType || "meaning"),
    bridge: String(item?.bridge || "").trim().slice(0, 460),
    question,
    confidence: Math.max(0, Math.min(100, Math.round(Number(item?.confidence || 0)))),
    sourceUsed: Boolean(item?.sourceUsed),
  };
}

async function betweenThoughtsFeatureEnabled(userRef) {
  const snap = await userRef.collection("settings").doc("private").get();
  const data = snap.exists ? snap.data() || {} : {};
  return data.betweenThoughtsEnabled === true;
}

function betweenThoughtsQueueResponse({ activeItem, readyItems, pendingPairs, curationId, model, noPairReason, generatedAtMs, cached = true, weakPairSkipped = false }) {
  return {
    ok: true,
    enabled: true,
    cached,
    item: activeItem || null,
    items: activeItem ? [activeItem] : [],
    pendingCount: Math.max(0, (readyItems?.length || 0) + (pendingPairs?.length || 0)),
    curationId: String(curationId || ""),
    model: String(model || BETWEEN_THOUGHTS_MODEL),
    noPairReason: String(noPairReason || ""),
    generatedAtMs: Number(generatedAtMs || 0),
    weakPairSkipped: Boolean(weakPairSkipped),
  };
}

exports.betweenThoughtsCurate = onCall(
  {
    region: "us-central1",
    secrets: ["OPENAI_API_KEY"],
    timeoutSeconds: 180,
    memory: "512MiB",
    maxInstances: 3,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");
    const userRef = db.collection("users").doc(uid);
    if (!(await betweenThoughtsFeatureEnabled(userRef))) {
      logger.info("Between Thoughts stopped by user setting", { uid });
      return { ok: true, enabled: false, items: [], item: null, pendingCount: 0 };
    }

    const requestedAction = String(request.data?.action || "").trim();
    const action = ["load", "next", "new-batch"].includes(requestedAction)
      ? requestedAction
      : (request.data?.forceRefresh ? "new-batch" : "load");
    const rawIds = Array.isArray(request.data?.candidateIds) ? request.data.candidateIds : [];
    const candidateIds = [...new Set(rawIds.slice(0, BETWEEN_THOUGHTS_CURATION_MAX_CANDIDATES).map((id, i) => safeId(id, `생각 조각 ${i + 1}`)))];
    const clientExcluded = [...new Set((Array.isArray(request.data?.excludePairKeys) ? request.data.excludePairKeys : [])
      .map((x) => String(x).slice(0, 180)).filter(Boolean))].slice(-60);
    const runId = crypto.randomUUID();
    const currentRef = userRef.collection("aiBetweenThoughtsCurations").doc("current");
    const cacheSnap = await currentRef.get();
    const cache = cacheSnap.exists ? cacheSnap.data() || {} : {};

    logger.info("Between Thoughts request started", {
      uid, runId, action, candidateCount: candidateIds.length, clientExcludedCount: clientExcluded.length,
      queueSchemaVersion: Number(cache.queueSchemaVersion || 0),
    });

    // 기존 대기열의 생각은 현재 18개 후보 밖에 있어도 버리지 않는다.
    const fetchIds = [...new Set([...candidateIds, ...cachePairIds(cache)])].slice(0, 36);
    const col = userRef.collection("fragments");
    const snaps = await Promise.all(fetchIds.map((id) => col.doc(id).get()));
    const docs = snaps.map((snap, i) => ({ id: fetchIds[i], exists: snap.exists, data: snap.exists ? snap.data() || {} : {} }))
      .filter((x) => x.exists && !x.data.deletedAt);
    const sourceIds = [...new Set(docs.map((x) => String(x.data.sourceId || "")).filter(Boolean))];
    const sourceSnaps = await Promise.all(sourceIds.map((id) => userRef.collection("sources").doc(id).get()));
    const sourceMap = new Map();
    sourceSnaps.forEach((snap, i) => { if (snap.exists) sourceMap.set(sourceIds[i], snap.data() || {}); });
    const records = docs.map((x) => betweenThoughtFullRecord(x.id, x.data, sourceMap.get(String(x.data.sourceId || "")) || null))
      .filter((x) => (x.thought || x.sourceExcerpt).length >= 8 || (Array.isArray(x.images) && x.images.length > 0));
    const recordMap = new Map(records.map((x) => [x.id, x]));
    const validIds = new Set(records.map((x) => x.id));

    const persistedDismissed = Array.isArray(cache.dismissedPairKeys) ? cache.dismissedPairKeys.map(String).filter(Boolean).slice(-80) : [];
    const excluded = new Set([...persistedDismissed, ...clientExcluded]);
    let activeItem = normalizeReadyBetweenItem(cache.activeItem, validIds, excluded);
    const legacyItems = Array.isArray(cache.items) ? cache.items : [];
    let readyItems = [...(Array.isArray(cache.readyItems) ? cache.readyItems : []), ...legacyItems]
      .map((item) => normalizeReadyBetweenItem(item, validIds, excluded)).filter(Boolean);
    let pendingPairs = (Array.isArray(cache.pendingPairs) ? cache.pendingPairs : [])
      .map((item) => normalizeQueuedCandidate(item, validIds, excluded)).filter(Boolean);
    const seen = new Set();
    if (activeItem) seen.add(betweenThoughtsPairKey(activeItem.fragmentIds));
    readyItems = readyItems.filter((item) => { const key = betweenThoughtsPairKey(item.fragmentIds); if (seen.has(key)) return false; seen.add(key); return true; });
    pendingPairs = pendingPairs.filter((item) => { const key = betweenThoughtsPairKey(item.fragmentIds); if (seen.has(key)) return false; seen.add(key); return true; });
    let dismissedPairKeys = [...new Set(persistedDismissed)];

    // 이미 답했거나 현재 세션에서 넘긴 active는 제거한다. 이미 질문이 생성된 ready는 비용 없이 승격한다.
    const cachedActiveKey = betweenThoughtsPairKey(cache.activeItem?.fragmentIds || []);
    if (!activeItem && cachedActiveKey && excluded.has(cachedActiveKey)) dismissedPairKeys.push(cachedActiveKey);
    if (!activeItem && readyItems.length) activeItem = readyItems.shift();
    dismissedPairKeys = [...new Set(dismissedPairKeys)].slice(-80);

    const persistQueueOnly = async (extra = {}) => {
      await currentRef.set({
        queueSchemaVersion: BETWEEN_THOUGHTS_QUEUE_SCHEMA_VERSION,
        activeItem: activeItem || null,
        readyItems,
        pendingPairs,
        dismissedPairKeys,
        model: String(cache.model || BETWEEN_THOUGHTS_MODEL),
        curationId: String(cache.curationId || ""),
        noPairReason: String(extra.noPairReason ?? cache.noPairReason ?? ""),
        thoughtIndexVersion: THOUGHT_INDEX_VERSION,
        thoughtIndexVisionVersion: THOUGHT_INDEX_VISION_VERSION,
        generatedAtMs: Number(cache.generatedAtMs || 0),
        updatedAt: FieldValue.serverTimestamp(),
        ...extra,
      }, { merge: true });
    };

    if (action === "load") {
      if (activeItem || readyItems.length || pendingPairs.length) {
        await persistQueueOnly();
        logger.info("Between Thoughts queue cache returned", { uid, runId, active: Boolean(activeItem), readyCount: readyItems.length, pendingCount: pendingPairs.length });
        return betweenThoughtsQueueResponse({ activeItem, readyItems, pendingPairs, curationId: cache.curationId, model: cache.model, noPairReason: cache.noPairReason, generatedAtMs: cache.generatedAtMs });
      }
      // 한 번이라도 후보 묶음을 만든 뒤 모두 보거나 답했다면 새 묶음을 자동 생성하지 않는다.
      // 앱을 다시 여는 것만으로 비용이 반복되지 않도록, 이후 묶음은 버튼으로만 요청한다.
      if (cacheSnap.exists && (cache.curationId || cache.generatedAtMs || cache.queueSchemaVersion || Array.isArray(cache.items))) {
        await persistQueueOnly({ activeItem: null, readyItems: [], pendingPairs: [], dismissedPairKeys });
        return betweenThoughtsQueueResponse({ activeItem: null, readyItems: [], pendingPairs: [], curationId: cache.curationId, model: cache.model, noPairReason: cache.noPairReason, generatedAtMs: cache.generatedAtMs });
      }
      // 첫 사용처럼 저장된 큐레이션 자체가 없을 때만 아래에서 최초 후보 묶음을 자동 생성한다.
    }

    if (action === "next") {
      if (activeItem) {
        dismissedPairKeys.push(betweenThoughtsPairKey(activeItem.fragmentIds));
        activeItem = null;
      }
      dismissedPairKeys = [...new Set(dismissedPairKeys)].slice(-80);
      if (readyItems.length) {
        activeItem = readyItems.shift();
        await persistQueueOnly({ activeItem, readyItems, pendingPairs, dismissedPairKeys });
        logger.info("Between Thoughts promoted already-generated item", { uid, runId, pendingCount: readyItems.length + pendingPairs.length });
        return betweenThoughtsQueueResponse({ activeItem, readyItems, pendingPairs, curationId: cache.curationId, model: cache.model, generatedAtMs: cache.generatedAtMs });
      }
      if (!pendingPairs.length) {
        await persistQueueOnly({ activeItem: null, readyItems: [], pendingPairs: [], dismissedPairKeys });
        return betweenThoughtsQueueResponse({ activeItem: null, readyItems: [], pendingPairs: [], curationId: cache.curationId, model: cache.model, generatedAtMs: cache.generatedAtMs });
      }

      const candidate = pendingPairs.shift();
      const questionAttempt = await reserveBetweenThoughtsQuestionAttemptQuota(uid);
      let deep;
      try {
        deep = await requestBetweenThoughtsDeepCuration([candidate], recordMap);
      } catch (error) {
        // 실패한 후보는 대기열 맨 앞에 되돌려 같은 유료 단계를 잃지 않게 한다.
        pendingPairs.unshift(candidate);
        logger.error("Between Thoughts next question failed", { uid, runId, stage: "deep", questionAttempt, pairKey: betweenThoughtsPairKey(candidate.fragmentIds), code: error?.code || null, message: error?.message || null });
        throw error;
      }
      activeItem = deep.items[0] || null;
      const weakPairSkipped = !activeItem;
      if (weakPairSkipped) dismissedPairKeys.push(betweenThoughtsPairKey(candidate.fragmentIds));
      dismissedPairKeys = [...new Set(dismissedPairKeys)].slice(-80);
      const usageRef = userRef.collection("aiUsage").doc(koreaDateKey());
      const batch = db.batch();
      batch.set(currentRef, {
        queueSchemaVersion: BETWEEN_THOUGHTS_QUEUE_SCHEMA_VERSION,
        activeItem: activeItem || null, readyItems: [], pendingPairs, dismissedPairKeys,
        lastDeepRequestId: deep.requestId || "", lastDeepFinishReason: deep.finishReason || "",
        lastDeepInputTokens: deep.inputTokens, lastDeepCachedInputTokens: deep.cachedInputTokens, lastDeepOutputTokens: deep.outputTokens,
        noPairReason: activeItem ? "" : (deep.noPairReason || "원문에서 연결 가치가 충분하지 않았습니다."),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(usageRef, {
        betweenThoughtsQuestions: FieldValue.increment(deep.items.length),
        betweenThoughtsPreparedPairs: FieldValue.increment(deep.items.length),
        betweenThoughtsInputTokens: FieldValue.increment(deep.inputTokens),
        betweenThoughtsCachedInputTokens: FieldValue.increment(deep.cachedInputTokens),
        betweenThoughtsOutputTokens: FieldValue.increment(deep.outputTokens),
        betweenThoughtsDeepInputTokens: FieldValue.increment(deep.inputTokens),
        betweenThoughtsModel: BETWEEN_THOUGHTS_MODEL,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      try { await batch.commit(); }
      catch (error) {
        logger.error("Between Thoughts next question storage failed", { uid, runId, questionAttempt, requestId: deep.requestId || null, inputTokens: deep.inputTokens, outputTokens: deep.outputTokens, code: error?.code || null, message: error?.message || null });
        throw error;
      }
      logger.info("Between Thoughts next question stored", { uid, runId, questionAttempt, itemCount: deep.items.length, pendingCount: pendingPairs.length, requestId: deep.requestId || null, finishReason: deep.finishReason || null, inputTokens: deep.inputTokens, cachedInputTokens: deep.cachedInputTokens, outputTokens: deep.outputTokens });
      return betweenThoughtsQueueResponse({ activeItem, readyItems: [], pendingPairs, curationId: cache.curationId, model: cache.model, noPairReason: activeItem ? "" : deep.noPairReason, generatedAtMs: cache.generatedAtMs, cached: false, weakPairSkipped });
    }

    // new-batch 또는 저장된 큐가 없는 최초 load: 다층 색인으로 후보 3개를 한 번만 고른다.
    const oldKeys = [activeItem, ...readyItems, ...pendingPairs].map((item) => betweenThoughtsPairKey(item?.fragmentIds || [])).filter(Boolean);
    dismissedPairKeys = [...new Set([...dismissedPairKeys, ...oldKeys, ...clientExcluded])].slice(-80);
    const generationIds = new Set(candidateIds);
    const generationRecords = records.filter((record) => generationIds.has(record.id));
    if (generationRecords.length < 2) return { ok: true, enabled: true, item: null, items: [], pendingCount: 0, reason: "not-enough-context" };

    let ensured;
    try { ensured = await ensureBetweenThoughtProfiles(uid, userRef, generationRecords); }
    catch (error) {
      logger.error("Between Thoughts index preparation failed", { uid, runId, stage: "index", candidateCount: generationRecords.length, code: error?.code || null, message: error?.message || null });
      throw error;
    }
    generationRecords.forEach((record) => { const index = ensured.profiles.get(record.id); if (index?.visualContext) record.visualContext = index.visualContext; });
    const profileCandidates = generationRecords.map((r) => compactBetweenThoughtProfile(r.id, ensured.profiles.get(r.id), r.date)).filter((x) => x.core);
    if (profileCandidates.length < 2) return { ok: true, enabled: true, item: null, items: [], pendingCount: 0, reason: "not-enough-profile-context" };

    const curationAttempt = await reserveBetweenThoughtsCurationQuota(uid);
    let scout;
    try { scout = await requestBetweenThoughtsScout(profileCandidates, dismissedPairKeys); }
    catch (error) {
      logger.error("Between Thoughts batch scout failed", { uid, runId, stage: "scout", curationAttempt, code: error?.code || null, message: error?.message || null });
      throw error;
    }
    logger.info("Between Thoughts batch scout completed", { uid, runId, curationAttempt, profileCandidateCount: profileCandidates.length, shortlistCount: scout.shortlist.length, requestId: scout.requestId || null, finishReason: scout.finishReason || null, inputTokens: scout.inputTokens, cachedInputTokens: scout.cachedInputTokens, outputTokens: scout.outputTokens });

    const allShortlist = scout.shortlist.slice(0, BETWEEN_THOUGHTS_SCOUT_PAIR_COUNT);
    const generatedAtMs = Date.now();
    const curationId = sha256(`${uid}:${generatedAtMs}:${allShortlist.map((x) => betweenThoughtsPairKey(x.fragmentIds)).join(",")}`).slice(0, 40);
    const scoutNoPairReason = allShortlist.length ? "" : "지금은 충분히 의미 있는 후보 조합을 찾지 못했습니다.";
    const usageRef = userRef.collection("aiUsage").doc(koreaDateKey());

    // scout 응답이 도착한 즉시 후보 대기열과 사용량을 먼저 저장한다.
    // 첫 질문 생성이 실패해도 후보 선정 비용을 다시 쓰지 않는다.
    const scoutBatch = db.batch();
    scoutBatch.set(currentRef, {
      queueSchemaVersion: BETWEEN_THOUGHTS_QUEUE_SCHEMA_VERSION,
      curationId, candidateIds: profileCandidates.map((x) => x.id), activeItem: null,
      readyItems: [], pendingPairs: allShortlist, dismissedPairKeys, noPairReason: scoutNoPairReason,
      model: BETWEEN_THOUGHTS_MODEL,
      thoughtIndexVersion: THOUGHT_INDEX_VERSION, thoughtIndexVisionVersion: THOUGHT_INDEX_VISION_VERSION,
      scoutRequestId: scout.requestId || "", scoutFinishReason: scout.finishReason || "",
      scoutInputTokens: scout.inputTokens, scoutCachedInputTokens: scout.cachedInputTokens, scoutOutputTokens: scout.outputTokens,
      generatedAtMs, generatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      items: [],
    }, { merge: true });
    scoutBatch.set(usageRef, {
      betweenThoughtsCurations: FieldValue.increment(1),
      betweenThoughtsCandidatePairs: FieldValue.increment(allShortlist.length),
      betweenThoughtsInputTokens: FieldValue.increment(scout.inputTokens),
      betweenThoughtsCachedInputTokens: FieldValue.increment(scout.cachedInputTokens),
      betweenThoughtsOutputTokens: FieldValue.increment(scout.outputTokens),
      betweenThoughtsScoutInputTokens: FieldValue.increment(scout.inputTokens),
      betweenThoughtsModel: BETWEEN_THOUGHTS_MODEL,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    try { await scoutBatch.commit(); }
    catch (error) {
      logger.error("Between Thoughts scout storage failed", { uid, runId, curationAttempt, scoutRequestId: scout.requestId || null, inputTokens: scout.inputTokens, cachedInputTokens: scout.cachedInputTokens, outputTokens: scout.outputTokens, code: error?.code || null, message: error?.message || null });
      throw error;
    }
    logger.info("Between Thoughts scout queue stored", { uid, runId, curationAttempt, candidatePairCount: allShortlist.length, scoutRequestId: scout.requestId || null, finishReason: scout.finishReason || null, inputTokens: scout.inputTokens, cachedInputTokens: scout.cachedInputTokens, outputTokens: scout.outputTokens });

    if (!allShortlist.length) {
      return betweenThoughtsQueueResponse({ activeItem: null, readyItems: [], pendingPairs: [], curationId, model: BETWEEN_THOUGHTS_MODEL, noPairReason: scoutNoPairReason, generatedAtMs, cached: false });
    }

    const firstCandidate = allShortlist[0];
    let questionAttempt = 0;
    try {
      questionAttempt = await reserveBetweenThoughtsQuestionAttemptQuota(uid);
    } catch (error) {
      logger.error("Between Thoughts first question quota failed after scout", { uid, runId, curationAttempt, pairKey: betweenThoughtsPairKey(firstCandidate.fragmentIds), code: error?.code || null, message: error?.message || null });
      return {
        ...betweenThoughtsQueueResponse({ activeItem: null, readyItems: [], pendingPairs: allShortlist, curationId, model: BETWEEN_THOUGHTS_MODEL, generatedAtMs, cached: false }),
        errorMessage: error?.message || "첫 질문은 다음에 만들 수 있어요.",
      };
    }

    let deep;
    try { deep = await requestBetweenThoughtsDeepCuration([firstCandidate], recordMap); }
    catch (error) {
      logger.error("Between Thoughts first question failed", { uid, runId, stage: "deep", curationAttempt, questionAttempt, pairKey: betweenThoughtsPairKey(firstCandidate.fragmentIds), code: error?.code || null, message: error?.message || null });
      return {
        ...betweenThoughtsQueueResponse({ activeItem: null, readyItems: [], pendingPairs: allShortlist, curationId, model: BETWEEN_THOUGHTS_MODEL, generatedAtMs, cached: false }),
        errorMessage: error?.message || "첫 질문을 만들지 못했습니다. 후보 대기열은 저장해뒀어요.",
      };
    }

    activeItem = deep.items[0] || null;
    pendingPairs = allShortlist.slice(1);
    readyItems = [];
    const weakPairSkipped = !activeItem;
    if (weakPairSkipped) dismissedPairKeys.push(betweenThoughtsPairKey(firstCandidate.fragmentIds));
    dismissedPairKeys = [...new Set(dismissedPairKeys)].slice(-80);
    const noPairReason = activeItem ? "" : deep.noPairReason;
    const deepBatch = db.batch();
    deepBatch.set(currentRef, {
      queueSchemaVersion: BETWEEN_THOUGHTS_QUEUE_SCHEMA_VERSION,
      activeItem: activeItem || null, readyItems, pendingPairs, dismissedPairKeys, noPairReason,
      lastDeepRequestId: deep.requestId || "", lastDeepFinishReason: deep.finishReason || "",
      lastDeepInputTokens: deep.inputTokens, lastDeepCachedInputTokens: deep.cachedInputTokens, lastDeepOutputTokens: deep.outputTokens,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    deepBatch.set(usageRef, {
      betweenThoughtsQuestions: FieldValue.increment(deep.items.length),
      betweenThoughtsPreparedPairs: FieldValue.increment(deep.items.length),
      betweenThoughtsInputTokens: FieldValue.increment(deep.inputTokens),
      betweenThoughtsCachedInputTokens: FieldValue.increment(deep.cachedInputTokens),
      betweenThoughtsOutputTokens: FieldValue.increment(deep.outputTokens),
      betweenThoughtsDeepInputTokens: FieldValue.increment(deep.inputTokens),
      betweenThoughtsModel: BETWEEN_THOUGHTS_MODEL,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    try { await deepBatch.commit(); }
    catch (error) {
      logger.error("Between Thoughts first question storage failed", { uid, runId, curationAttempt, questionAttempt, deepRequestId: deep.requestId || null, inputTokens: deep.inputTokens, cachedInputTokens: deep.cachedInputTokens, outputTokens: deep.outputTokens, code: error?.code || null, message: error?.message || null });
      throw error;
    }
    logger.info("Between Thoughts first question stored", { uid, runId, curationAttempt, questionAttempt, itemCount: deep.items.length, pendingCount: pendingPairs.length, deepRequestId: deep.requestId || null, finishReason: deep.finishReason || null, inputTokens: deep.inputTokens, cachedInputTokens: deep.cachedInputTokens, outputTokens: deep.outputTokens });
    return betweenThoughtsQueueResponse({ activeItem, readyItems, pendingPairs, curationId, model: BETWEEN_THOUGHTS_MODEL, noPairReason, generatedAtMs, cached: false, weakPairSkipped });
  }
);

function storedVectorArray(value) {
  try {
    if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
    if (value && typeof value.toArray === "function") {
      const array = value.toArray();
      return Array.isArray(array) ? array.map(Number).filter(Number.isFinite) : null;
    }
  } catch (_) {}
  return null;
}

function cosineDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return null;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (!aa || !bb) return null;
  return 1 - dot / (Math.sqrt(aa) * Math.sqrt(bb));
}

function selectStudioPathRows(rows, maxCount) {
  if (rows.length <= maxCount) return rows;
  const selected = new Map();
  const add = (row) => {
    if (row && selected.size < maxCount && !selected.has(row.id)) selected.set(row.id, row);
  };

  // 시간의 양끝, 최근 생각, 사용자가 중요 표시한 생각을 먼저 보존한다.
  add(rows[0]);
  add(rows[rows.length - 1]);
  const recentCount = Math.min(5, Math.max(1, Math.floor(maxCount / 8)));
  const starredCount = Math.min(4, Math.max(1, Math.floor(maxCount / 10)));
  rows.slice(-recentCount).forEach(add);
  rows.filter((row) => row.data?.starred).slice(0, starredCount).forEach(add);

  // 부모·자식으로 직접 이어진 뼈대와 갈라지는 지점을 보존한다.
  const childCount = new Map();
  rows.forEach((row) => (Array.isArray(row.data?.continuedFrom) ? row.data.continuedFrom : []).forEach((parentId) => {
    const id = String(parentId);
    childCount.set(id, (childCount.get(id) || 0) + 1);
  }));
  rows.slice().sort((a, b) => {
    const score = (row) => (childCount.get(row.id) || 0) * 3 + (Array.isArray(row.data?.continuedFrom) ? row.data.continuedFrom.length : 0);
    return score(b) - score(a);
  }).slice(0, Math.min(6, Math.max(1, Math.floor(maxCount / 8)))).forEach(add);

  // 임베딩은 해석을 대신하지 않고, 이미 고른 생각들과 의미상 다른 후보를 넓게 확보하는 데만 쓴다.
  const vectorRows = rows.map((row) => ({ row, vector: storedVectorArray(row.data?.embedding) })).filter((item) => item.vector?.length);
  const semanticTarget = Math.min(maxCount, Math.max(selected.size, Math.ceil(maxCount * 0.78)));
  while (selected.size < semanticTarget && vectorRows.length) {
    const selectedVectors = vectorRows.filter((item) => selected.has(item.row.id)).map((item) => item.vector);
    let best = null;
    let bestDistance = -1;
    for (const item of vectorRows) {
      if (selected.has(item.row.id)) continue;
      let minDistance = 1;
      if (selectedVectors.length) {
        const distances = selectedVectors.map((vector) => cosineDistance(item.vector, vector)).filter(Number.isFinite);
        if (distances.length) minDistance = Math.min(...distances);
      }
      if (minDistance > bestDistance) {
        bestDistance = minDistance;
        best = item.row;
      }
    }
    if (!best) break;
    add(best);
  }

  // 나머지는 전체 시간대에서 고르게 채워 특정 시기에 편중되지 않게 한다.
  const remaining = maxCount - selected.size;
  if (remaining > 0) {
    const step = (rows.length - 1) / Math.max(1, remaining - 1);
    for (let i = 0; i < remaining; i++) add(rows[Math.min(rows.length - 1, Math.round(i * step))]);
  }
  rows.slice().reverse().forEach(add);
  return [...selected.values()].sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
}

async function requestStudioPathScout(thread, profiles) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpsError("failed-precondition", "AI 연결 설정을 확인해주세요.");
  const systemPrompt = [
    "당신은 '생각의 텃밭'에서 사용자가 글을 쓰기 전에 선택적으로 부르는 길안내자다.",
    "지금 보는 것은 Thread 안 생각들의 다층 색인과 부모·자식 연결 정보다. 이 단계의 목적은 원문을 다시 읽어볼 후보 갈래를 좁히는 것이며, 글의 목차·결론·문장을 만들지 않는다.",
    "core/themes/events/claims/keyPhrases는 직접 내용에 가깝고, inferredIntents·valuesOrNeeds·emotions·tensions·shifts·openLoops·alternateReadings는 근거와 confidence가 붙은 해석 후보다. 추론 하나를 정답처럼 고정하지 않는다.",
    "visualAttachmentIntents·visualEmotionalFunctions·visualLatentContexts는 사진이 글에 더한 비언어적 의미 후보다. confidence와 근거를 함께 보고, 사진이 드러낸 현재 상황·대비·상징이 글의 갈래를 실제로 넓힐 때 활용한다.",
    "같은 요약이나 주제만 보지 말고 사건, 주장, 작성 의도, 가치, 양가감정, 관점 변화, 미해결 문제의 여러 축으로 후보를 살핀다. uncertainty가 큰 색인은 약한 근거로 취급한다.",
    `최대 ${STUDIO_PATH_SCOUT_COUNT}개의 후보 갈래를 고른다. 한 갈래는 2~6개의 생각으로 구성한다. 글감을 완성하려 하지 말고 글쓰기를 시작할 중심 나뭇가지만 찾는다.`,
    "Thread 전체에 하나의 선형 서사가 있다고 가정하지 않는다. 같은 소재 안의 다른 맥락, 새끼 생각, 갈라진 가지, 시간이 지나도 반복되는 관점이 함께 있을 수 있다.",
    "좋은 후보는 변화, 반복, 긴장·모순, 확장, 직접 이어짐 중 하나가 원문 확인 가치가 있을 만큼 구체적으로 보이는 묶음이다.",
    "단순히 같은 단어·책·소재라는 이유로 묶지 않는다. '둘 다 고민이다' 같은 추상적인 공통점도 탈락시킨다.",
    "후보끼리는 가능한 한 다른 방향이어야 한다. 수를 채우기 위해 약한 후보를 만들지 않는다.",
    "사용자가 말하지 않은 동기·감정·결론을 추측하지 않는다. confidence가 72 미만인 후보는 반환하지 않는다.",
    "workingQuestion은 이 생각들을 원문으로 다시 확인할 때 살펴볼 질문 한 문장이다. 사용자에게 글의 결론을 지시하지 않는다.",
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: STUDIO_GARDENER_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify({ thread, profiles }) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "studio_path_scout",
          strict: true,
          schema: {
            type: "object",
            properties: {
              candidates: {
                type: "array", minItems: 0, maxItems: STUDIO_PATH_SCOUT_COUNT,
                items: {
                  type: "object",
                  properties: {
                    fragmentIds: { type: "array", minItems: 2, maxItems: 6, items: { type: "string" } },
                    shape: { type: "string", enum: ["change", "repetition", "tension", "expansion", "direct", "contrast", "meaning"] },
                    reason: { type: "string" },
                    workingQuestion: { type: "string" },
                    confidence: { type: "integer", minimum: 0, maximum: 100 },
                  },
                  required: ["fragmentIds", "shape", "reason", "workingQuestion", "confidence"],
                  additionalProperties: false,
                },
              },
            },
            required: ["candidates"],
            additionalProperties: false,
          },
        },
      },
      max_completion_tokens: 1900,
    }),
  });
  let payload; try { payload = await response.json(); } catch (_) { payload = null; }
  if (!response.ok) {
    logger.error("OpenAI Studio path scout HTTP error", { status: response.status, code: payload?.error?.code || null });
    throw new HttpsError("internal", "글의 갈래 후보를 찾지 못했습니다.");
  }
  const raw = payload?.choices?.[0]?.message?.content;
  let parsed; try { parsed = JSON.parse(raw); } catch (_) { throw new HttpsError("internal", "글의 갈래 후보 형식이 올바르지 않습니다."); }
  const allowed = new Set(profiles.map((x) => x.id));
  const seen = new Set();
  const candidates = [];
  for (const item of Array.isArray(parsed?.candidates) ? parsed.candidates : []) {
    const ids = [...new Set((Array.isArray(item?.fragmentIds) ? item.fragmentIds : []).map(String).filter((id) => allowed.has(id)))];
    if (ids.length < 2 || ids.length > 6 || Number(item.confidence || 0) < 72) continue;
    const key = ids.slice().sort().join("|"); if (seen.has(key)) continue; seen.add(key);
    candidates.push({
      fragmentIds: ids,
      shape: String(item.shape || "direct"),
      reason: String(item.reason || "").trim().slice(0, 520),
      workingQuestion: String(item.workingQuestion || "").trim().slice(0, 360),
      confidence: Math.round(Number(item.confidence || 0)),
    });
    if (candidates.length >= STUDIO_PATH_SCOUT_COUNT) break;
  }
  return {
    candidates,
    inputTokens: Number(payload?.usage?.prompt_tokens || 0),
    cachedInputTokens: Number(payload?.usage?.prompt_tokens_details?.cached_tokens || 0),
    outputTokens: Number(payload?.usage?.completion_tokens || 0),
  };
}

async function requestStudioPathDeep(thread, candidates, recordMap) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpsError("failed-precondition", "AI 연결 설정을 확인해주세요.");
  const candidatePayload = candidates.map((candidate, index) => ({
    index,
    shape: candidate.shape,
    scoutReason: candidate.reason,
    workingQuestion: candidate.workingQuestion,
    fragments: candidate.fragmentIds.map((id) => recordMap.get(id)).filter(Boolean).map((record) => ({
      id: record.id,
      date: record.date,
      thought: record.thought,
      context: record.context,
      sourceExcerpt: record.sourceExcerpt,
      locator: record.locator,
      source: record.source,
      visualContext: record.visualContext || null,
    })),
  }));
  const systemPrompt = [
    "당신은 '생각의 텃밭'의 글쓰기 길안내자다. 이제 후보 갈래에 포함된 생각의 실제 원문·맥락·외부 인용과 출처를 다시 읽는다.",
    "visualContext가 있으면 사진을 비언어적 문장으로 보고, 첨부 의도·정서적 기능·잠재 맥락을 근거와 확신도와 함께 저장한 색인이다. 실제 사진을 다시 보는 것은 아니므로 이를 사실로 확정하지 않되, 원문과 함께 충분히 뒷받침되는 해석은 갈래 판단에 적극적으로 활용한다.",
    "원문 안의 줄바꿈된 '…'는 긴 글의 가운데 일부가 생략됐다는 표시다. 생략된 내용을 추정하지 않는다.",
    `원문에 근거해 글을 시작할 만한 갈래만 최대 ${STUDIO_PATH_RESULT_COUNT}개 남긴다. 약하거나 억지스러운 후보는 버린다. 하나만 좋으면 하나만 반환하고, 없으면 빈 배열을 반환한다.`,
    "갈래는 완성된 글감 묶음이나 목차가 아니다. 사용자가 쓰기 시작할 중심 나뭇가지다. 재료가 2개든 3개든 4개든 실제로 필요한 만큼만 남긴다.",
    "Thread 전체를 하나의 시간순 서사로 만들지 않는다. 변화가 없어도 반복·긴장·확장으로 글을 시작할 수 있다.",
    "thought는 사용자의 기록이고 sourceExcerpt는 외부 문장일 수 있다. promptContext는 이전 AI 질문의 압축 배경이므로 사용자의 주장으로 오해하지 않는다.",
    "title은 글의 완성 제목을 대신 지어주는 것이 아니라 사용자가 어떤 방향인지 알아볼 수 있는 짧은 갈래 이름이다.",
    "summary는 왜 이 생각들이 함께 글의 출발점이 될 수 있는지 1~2문장으로만 설명한다. 사용자의 결론이나 숨은 심리를 단정하지 않는다.",
    "guidingQuestion은 이 갈래로 글을 시작할 때 생각해볼 올바른 질문 한 문장이다. 답이나 구성안을 주지 않는다.",
    "fragmentIds는 반드시 해당 후보에 실제로 포함된 ID만 사용한다.",
  ].join("\n");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: STUDIO_GARDENER_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify({ thread, candidates: candidatePayload }) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "studio_writing_paths",
          strict: true,
          schema: {
            type: "object",
            properties: {
              paths: {
                type: "array", minItems: 0, maxItems: STUDIO_PATH_RESULT_COUNT,
                items: {
                  type: "object",
                  properties: {
                    candidateIndex: { type: "integer", minimum: 0, maximum: STUDIO_PATH_SCOUT_COUNT - 1 },
                    fragmentIds: { type: "array", minItems: 2, maxItems: 6, items: { type: "string" } },
                    shape: { type: "string", enum: ["change", "repetition", "tension", "expansion", "direct", "contrast", "meaning"] },
                    title: { type: "string" },
                    summary: { type: "string" },
                    guidingQuestion: { type: "string" },
                  },
                  required: ["candidateIndex", "fragmentIds", "shape", "title", "summary", "guidingQuestion"],
                  additionalProperties: false,
                },
              },
            },
            required: ["paths"], additionalProperties: false,
          },
        },
      },
      max_completion_tokens: 2200,
    }),
  });
  let payload; try { payload = await response.json(); } catch (_) { payload = null; }
  if (!response.ok) {
    logger.error("OpenAI Studio path deep HTTP error", { status: response.status, code: payload?.error?.code || null });
    throw new HttpsError("internal", "글의 갈래 원문 검토를 마치지 못했습니다.");
  }
  const raw = payload?.choices?.[0]?.message?.content;
  let parsed; try { parsed = JSON.parse(raw); } catch (_) { throw new HttpsError("internal", "글의 갈래 결과 형식이 올바르지 않습니다."); }
  const seen = new Set();
  const paths = [];
  for (const item of Array.isArray(parsed?.paths) ? parsed.paths : []) {
    const index = Number(item?.candidateIndex);
    const candidate = candidates[index]; if (!candidate) continue;
    const allowed = new Set(candidate.fragmentIds);
    const ids = [...new Set((Array.isArray(item.fragmentIds) ? item.fragmentIds : []).map(String).filter((id) => allowed.has(id)))];
    const title = String(item.title || "").trim().slice(0, 120);
    const summary = String(item.summary || "").trim().slice(0, 620);
    const guidingQuestion = String(item.guidingQuestion || "").trim().slice(0, 420);
    if (ids.length < 2 || !title || !summary || !guidingQuestion) continue;
    const key = ids.slice().sort().join("|"); if (seen.has(key)) continue; seen.add(key);
    paths.push({ fragmentIds: ids, shape: String(item.shape || candidate.shape || "direct"), title, summary, guidingQuestion });
    if (paths.length >= STUDIO_PATH_RESULT_COUNT) break;
  }
  return {
    paths,
    inputTokens: Number(payload?.usage?.prompt_tokens || 0),
    cachedInputTokens: Number(payload?.usage?.prompt_tokens_details?.cached_tokens || 0),
    outputTokens: Number(payload?.usage?.completion_tokens || 0),
  };
}

/**
 * 선택 기능: Thread 안에서 글을 시작할 만한 갈래를 찾는다.
 * 프로필로 넓게 후보를 좁힌 뒤 후보 원문만 다시 읽어 검증한다.
 * 결과는 Thread 내용이 바뀌지 않는 동안 재사용한다.
 */
exports.studioThreadPaths = onCall(
  {
    region: "us-central1",
    secrets: ["OPENAI_API_KEY"],
    timeoutSeconds: 180,
    memory: "512MiB",
    maxInstances: 3,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");
    const threadId = safeId(request.data?.threadId, "Thread");
    const forceRefresh = request.data?.forceRefresh === true;
    const userRef = db.collection("users").doc(uid);
    const threadSnap = await userRef.collection("threads").doc(threadId).get();
    if (!threadSnap.exists) throw new HttpsError("not-found", "Thread를 찾지 못했습니다.");
    const threadData = threadSnap.data() || {};

    const memberSnap = await userRef.collection("fragments").where("threadIds", "array-contains", threadId).get();
    const allRows = [];
    memberSnap.forEach((doc) => {
      const data = doc.data() || {};
      if (data.deletedAt) return;
      const thought = String(data.thought || data.text || "").trim();
      const excerpt = String(data.externalText || "").trim();
      const images = thoughtImageAttachments(data);
      if ((thought || excerpt).length < 8 && !images.length) return;
      allRows.push({ id: doc.id, data, at: String(data.date || data.createdAt || "") });
    });
    allRows.sort((a, b) => a.at.localeCompare(b.at));
    if (allRows.length < 2) return { ok: true, items: [], reason: "not-enough-context" };

    const signature = sha256(JSON.stringify({
      thoughtIndexVersion: THOUGHT_INDEX_VERSION,
      thoughtIndexVisionVersion: THOUGHT_INDEX_VISION_VERSION,
      title: String(threadData.title || ""), question: String(threadData.question || ""),
      fragments: allRows.map((x) => ({
        id: x.id, thought: String(x.data.thought || x.data.text || ""), context: String(x.data.context || ""),
        externalText: String(x.data.externalText || ""), sourceId: String(x.data.sourceId || ""),
        imageKeys: thoughtImageAttachments(x.data).map((image) => image.path || image.url),
        continuedFrom: Array.isArray(x.data.continuedFrom) ? x.data.continuedFrom.map(String).sort() : [],
        updatedAt: String(x.data.updatedAt || x.data.createdAt || ""),
      })),
    }));
    const cacheRef = userRef.collection("aiStudioThreadPaths").doc(threadId);
    const cacheSnap = await cacheRef.get();
    const cache = cacheSnap.exists ? cacheSnap.data() || {} : {};
    if (!forceRefresh && cache.signature === signature && Array.isArray(cache.items)) {
      return { ok: true, cached: true, items: cache.items, model: String(cache.model || STUDIO_GARDENER_MODEL) };
    }

    const selectedRows = selectStudioPathRows(allRows, STUDIO_PATH_MAX_THREAD_FRAGMENTS);
    const selectedIds = new Set(selectedRows.map((x) => x.id));
    const sourceIds = [...new Set(selectedRows.map((x) => String(x.data.sourceId || "")).filter(Boolean))];
    const sourceSnaps = await Promise.all(sourceIds.map((id) => userRef.collection("sources").doc(id).get()));
    const sourceMap = new Map();
    sourceSnaps.forEach((snap, i) => { if (snap.exists) sourceMap.set(sourceIds[i], snap.data() || {}); });
    const records = selectedRows.map((x) => betweenThoughtFullRecord(x.id, x.data, sourceMap.get(String(x.data.sourceId || "")) || null));
    const recordMap = new Map(records.map((x) => [x.id, x]));
    const ensured = await ensureBetweenThoughtProfiles(uid, userRef, records);
    records.forEach((record) => {
      const profile = ensured.profiles.get(record.id);
      if (profile?.visualContext) record.visualContext = profile.visualContext;
    });
    const childCount = new Map();
    selectedRows.forEach((x) => (Array.isArray(x.data.continuedFrom) ? x.data.continuedFrom : []).forEach((pid) => {
      const id = String(pid); if (selectedIds.has(id)) childCount.set(id, (childCount.get(id) || 0) + 1);
    }));
    const profiles = selectedRows.map((x) => {
      const profile = ensured.profiles.get(x.id); if (!profile) return null;
      return {
        ...compactBetweenThoughtProfile(x.id, profile, x.at),
        continuedFrom: (Array.isArray(x.data.continuedFrom) ? x.data.continuedFrom : []).map(String).filter((id) => selectedIds.has(id)).slice(0, 4),
        childCount: childCount.get(x.id) || 0,
      };
    }).filter(Boolean);
    if (profiles.length < 2) return { ok: true, items: [], reason: "profiles-not-ready" };

    const thread = { id: threadId, title: String(threadData.title || "").slice(0, 260), question: String(threadData.question || "").slice(0, 600), thoughtCount: allRows.length };
    const scout = await requestStudioPathScout(thread, profiles);
    let deep = { paths: [], inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    if (scout.candidates.length) deep = await requestStudioPathDeep(thread, scout.candidates, recordMap);
    // 공통 생각 색인은 별도 항목으로 한 번만 집계한다.
    // 이 기능의 사용량에는 실제 후보 선정과 원문 검토 토큰만 포함한다.
    const totalInputTokens = scout.inputTokens + deep.inputTokens;
    const totalCachedInputTokens = scout.cachedInputTokens + deep.cachedInputTokens;
    const totalOutputTokens = scout.outputTokens + deep.outputTokens;
    const usageRef = userRef.collection("aiUsage").doc(koreaDateKey());
    const batch = db.batch();
    batch.set(cacheRef, {
      threadId, signature, items: deep.paths, model: STUDIO_GARDENER_MODEL,
      thoughtIndexVersion: THOUGHT_INDEX_VERSION,
      thoughtIndexVisionVersion: THOUGHT_INDEX_VISION_VERSION,
      selectedFragmentCount: selectedRows.length, totalFragmentCount: allRows.length,
      generatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(usageRef, {
      // 캐시 결과를 다시 보는 경우에는 이 블록에 도달하지 않는다.
      // 프로필 생성과 후보 검토까지 성공적으로 끝난 새 분석만 1회로 센다.
      studioPathCompletedAnalyses: FieldValue.increment(1),
      studioPathInputTokens: FieldValue.increment(totalInputTokens),
      studioPathCachedInputTokens: FieldValue.increment(totalCachedInputTokens),
      studioPathOutputTokens: FieldValue.increment(totalOutputTokens),
      studioPathModel: STUDIO_GARDENER_MODEL,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    return {
      ok: true, cached: false, items: deep.paths, model: STUDIO_GARDENER_MODEL,
      inputTokens: totalInputTokens, cachedInputTokens: totalCachedInputTokens, outputTokens: totalOutputTokens,
      profiledNow: ensured.usage.count,
    };
  }
);

exports.studioGardenerUsage = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 15,
    memory: "256MiB",
    maxInstances: 5,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");

    const dateKey = koreaDateKey();
    const ref = db.collection("users").doc(uid).collection("aiUsage").doc(dateKey);
    const snap = await ref.get();
    const data = snap.exists ? snap.data() || {} : {};

    const used = Math.max(0, Number(data.studioQuestions || 0));
    const limit = Math.max(
      STUDIO_GARDENER_BASE_DAILY_LIMIT,
      Math.min(
        STUDIO_GARDENER_MAX_DAILY_LIMIT,
        Number(data.studioDailyLimit || STUDIO_GARDENER_BASE_DAILY_LIMIT)
      )
    );
    const inputTokens = Math.max(0, Number(data.studioInputTokens || 0));
    const cachedInputTokens = Math.max(0, Number(data.studioCachedInputTokens || 0));
    const outputTokens = Math.max(0, Number(data.studioOutputTokens || 0));
    const gardenerEstimatedCostUsd = studioEstimatedCostUsd(
      inputTokens,
      cachedInputTokens,
      outputTokens
    );

    const bloomingInterviewQuestions = Math.max(0, Number(data.bloomingInterviewQuestions || 0));
    const bloomingInterviewInputTokens = Math.max(0, Number(data.bloomingInterviewInputTokens || 0));
    const bloomingInterviewCachedInputTokens = Math.max(0, Number(data.bloomingInterviewCachedInputTokens || 0));
    const bloomingInterviewOutputTokens = Math.max(0, Number(data.bloomingInterviewOutputTokens || 0));
    const bloomingInterviewEstimatedCostUsd = studioEstimatedCostUsd(
      bloomingInterviewInputTokens,
      bloomingInterviewCachedInputTokens,
      bloomingInterviewOutputTokens
    );

    const betweenThoughtsQuestions = Math.max(0, Number(data.betweenThoughtsQuestions || 0));
    const betweenThoughtsCurations = Math.max(0, Number(data.betweenThoughtsCurations || 0));
    const betweenThoughtsPreparedPairs = Math.max(0, Number(data.betweenThoughtsPreparedPairs || betweenThoughtsQuestions));
    const betweenThoughtsInputTokens = Math.max(0, Number(data.betweenThoughtsInputTokens || 0));
    const betweenThoughtsCachedInputTokens = Math.max(0, Number(data.betweenThoughtsCachedInputTokens || 0));
    const betweenThoughtsOutputTokens = Math.max(0, Number(data.betweenThoughtsOutputTokens || 0));
    // v50 이전의 생각 프로필 사용량도 새 공통 생각 색인 항목에 합쳐 보여준다.
    const betweenThoughtsProfileGenerations = Math.max(0, Number(data.betweenThoughtsProfileGenerations || 0));
    const betweenThoughtsProfileInputTokens = Math.max(0, Number(data.betweenThoughtsProfileInputTokens || 0));
    const betweenThoughtsProfileCachedInputTokens = Math.max(0, Number(data.betweenThoughtsProfileCachedInputTokens || 0));
    const betweenThoughtsProfileOutputTokens = Math.max(0, Number(data.betweenThoughtsProfileOutputTokens || 0));
    const thoughtIndexGenerations = Math.max(0, Number(data.thoughtIndexGenerations || 0)) + betweenThoughtsProfileGenerations;
    const thoughtIndexInputTokens = Math.max(0, Number(data.thoughtIndexInputTokens || 0)) + betweenThoughtsProfileInputTokens;
    const thoughtIndexCachedInputTokens = Math.max(0, Number(data.thoughtIndexCachedInputTokens || 0)) + betweenThoughtsProfileCachedInputTokens;
    const thoughtIndexOutputTokens = Math.max(0, Number(data.thoughtIndexOutputTokens || 0)) + betweenThoughtsProfileOutputTokens;
    const betweenThoughtsCurationEstimatedCostUsd = studioEstimatedCostUsd(
      betweenThoughtsInputTokens,
      betweenThoughtsCachedInputTokens,
      betweenThoughtsOutputTokens
    );
    const thoughtIndexEstimatedCostUsd = studioEstimatedCostUsd(
      thoughtIndexInputTokens,
      thoughtIndexCachedInputTokens,
      thoughtIndexOutputTokens
    );
    const betweenThoughtsProfileEstimatedCostUsd = thoughtIndexEstimatedCostUsd;
    const betweenThoughtsEstimatedCostUsd = betweenThoughtsCurationEstimatedCostUsd;

    const studioPathDiscoveries = Math.max(0, Number(data.studioPathCompletedAnalyses || 0));
    const studioPathInputTokens = Math.max(0, Number(data.studioPathInputTokens || 0));
    const studioPathCachedInputTokens = Math.max(0, Number(data.studioPathCachedInputTokens || 0));
    const studioPathOutputTokens = Math.max(0, Number(data.studioPathOutputTokens || 0));
    const studioPathEstimatedCostUsd = studioEstimatedCostUsd(studioPathInputTokens, studioPathCachedInputTokens, studioPathOutputTokens);

    const fragmentEmbeddingTokens = Math.max(0, Number(data.fragmentEmbeddingTokens || 0));
    const fragmentEmbeddingCount = Math.max(0, Number(data.fragmentEmbeddingCount || 0));
    const studioMaterialEmbeddingTokens = Math.max(0, Number(data.studioMaterialEmbeddingTokens || 0));
    const studioMaterialEmbeddingCount = Math.max(0, Number(data.studioMaterialEmbeddingCount || 0));
    const embeddingTokens = fragmentEmbeddingTokens + studioMaterialEmbeddingTokens;
    const embeddingEstimatedCostUsd =
      (embeddingTokens / 1_000_000) * EMBEDDING_INPUT_USD_PER_M;
    const totalEstimatedCostUsd = gardenerEstimatedCostUsd + bloomingInterviewEstimatedCostUsd + betweenThoughtsEstimatedCostUsd + thoughtIndexEstimatedCostUsd + studioPathEstimatedCostUsd + embeddingEstimatedCostUsd;

    return {
      ok: true,
      dateKey,
      timezone: "Asia/Seoul",
      used,
      limit,
      remaining: Math.max(0, limit - used),
      inputTokens,
      cachedInputTokens,
      outputTokens,
      gardenerEstimatedCostUsd: Number(gardenerEstimatedCostUsd.toFixed(8)),
      bloomingInterviewQuestions,
      bloomingInterviewInputTokens,
      bloomingInterviewCachedInputTokens,
      bloomingInterviewOutputTokens,
      bloomingInterviewEstimatedCostUsd: Number(bloomingInterviewEstimatedCostUsd.toFixed(8)),
      betweenThoughtsQuestions,
      betweenThoughtsCurations,
      betweenThoughtsPreparedPairs,
      betweenThoughtsInputTokens,
      betweenThoughtsCachedInputTokens,
      betweenThoughtsOutputTokens,
      // 구버전 필드는 화면 호환을 위해 유지한다.
      betweenThoughtsProfileGenerations,
      betweenThoughtsProfileInputTokens,
      betweenThoughtsProfileCachedInputTokens,
      betweenThoughtsProfileOutputTokens,
      thoughtIndexGenerations,
      thoughtIndexInputTokens,
      thoughtIndexCachedInputTokens,
      thoughtIndexOutputTokens,
      thoughtIndexEstimatedCostUsd: Number(thoughtIndexEstimatedCostUsd.toFixed(8)),
      thoughtIndexModel: String(data.thoughtIndexModel || data.betweenThoughtsProfileModel || THOUGHT_INDEX_MODEL),
      thoughtIndexVersion: THOUGHT_INDEX_VERSION,
      betweenThoughtsCurationEstimatedCostUsd: Number(betweenThoughtsCurationEstimatedCostUsd.toFixed(8)),
      betweenThoughtsProfileEstimatedCostUsd: Number(betweenThoughtsProfileEstimatedCostUsd.toFixed(8)),
      betweenThoughtsEstimatedCostUsd: Number(betweenThoughtsEstimatedCostUsd.toFixed(8)),
      studioPathDiscoveries,
      studioPathCompletedAnalyses: studioPathDiscoveries,
      studioPathInputTokens,
      studioPathCachedInputTokens,
      studioPathOutputTokens,
      studioPathEstimatedCostUsd: Number(studioPathEstimatedCostUsd.toFixed(8)),
      // 이전 클라이언트와의 호환용. 정원사 비용만 의미한다.
      estimatedCostUsd: Number(gardenerEstimatedCostUsd.toFixed(8)),
      fragmentEmbeddingTokens,
      fragmentEmbeddingCount,
      studioMaterialEmbeddingTokens,
      studioMaterialEmbeddingCount,
      embeddingTokens,
      embeddingEstimatedCostUsd: Number(embeddingEstimatedCostUsd.toFixed(8)),
      totalEstimatedCostUsd: Number(totalEstimatedCostUsd.toFixed(8)),
      model: String(data.studioModel || STUDIO_GARDENER_MODEL),
      embeddingModel: EMBEDDING_MODEL,
      pricing: {
        inputUsdPerMillion: STUDIO_GARDENER_INPUT_USD_PER_M,
        cachedInputUsdPerMillion: STUDIO_GARDENER_CACHED_INPUT_USD_PER_M,
        outputUsdPerMillion: STUDIO_GARDENER_OUTPUT_USD_PER_M,
        embeddingInputUsdPerMillion: EMBEDDING_INPUT_USD_PER_M,
      },
    };
  }
);


/**
 * Thread에 연결된 생각들의 embedding 평균(centroid)을 기준으로,
 * 아직 어떤 Thread에도 연결되지 않은 생각 중 의미적으로 가까운 후보를 찾는다.
 * OpenAI 호출은 없고 Firestore Vector Search만 사용한다.
 */
exports.findThreadCandidates = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
    maxInstances: 10,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");

    const threadId = safeId(request.data?.threadId, "Thread");
    const userRef = db.collection("users").doc(uid);
    const threadSnap = await userRef.collection("threads").doc(threadId).get();
    if (!threadSnap.exists) throw new HttpsError("not-found", "Thread를 찾지 못했습니다.");

    const col = userRef.collection("fragments");
    const memberSnap = await col.where("threadIds", "array-contains", threadId).get();
    const memberIds = new Set();
    const vectors = [];

    memberSnap.forEach((doc) => {
      const data = doc.data() || {};
      if (data.deletedAt) return;
      memberIds.add(doc.id);
      const value = data.embedding;
      const arr = value && typeof value.toArray === "function" ? value.toArray() : null;
      if (Array.isArray(arr) && arr.length) vectors.push(arr);
    });

    if (!vectors.length) return { ok: true, items: [], reason: "no-embedding" };

    const dimensions = vectors[0].length;
    const usable = vectors.filter((v) => v.length === dimensions);
    const centroid = new Array(dimensions).fill(0);

    usable.forEach((v) => {
      for (let i = 0; i < dimensions; i++) centroid[i] += Number(v[i] || 0);
    });
    for (let i = 0; i < dimensions; i++) centroid[i] /= usable.length;

    let snap;
    try {
      snap = await col.findNearest({
        vectorField: "embedding",
        queryVector: centroid,
        limit: 24,
        distanceMeasure: "COSINE",
        distanceResultField: "vectorDistance",
      }).get();
    } catch (error) {
      logger.error("Thread vector candidate search failed", {
        code: error?.code || null,
        message: error?.message || null,
      });
      throw new HttpsError("internal", "Thread와 닮은 생각을 찾지 못했습니다.");
    }

    const items = [];
    snap.forEach((doc) => {
      if (memberIds.has(doc.id)) return;
      const data = doc.data() || {};
      if (data.deletedAt) return;
      if (Array.isArray(data.threadIds) && data.threadIds.length) return;
      const distance = Number(data.vectorDistance);
      if (!Number.isFinite(distance) || distance > 0.68) return;
      items.push({ id: doc.id, distance, score: Math.max(0, 1 - distance) });
    });

    items.sort((a, b) => b.score - a.score);
    return { ok: true, items: items.slice(0, 3) };
  }
);


function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i] || 0);
    const y = Number(b[i] || 0);
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  if (!normA || !normB) return null;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 현재 Fragment를 어느 Thread에 연결할지 추천한다.
 *
 * - OpenAI 호출 없음
 * - 이미 저장된 Fragment embedding만 사용
 * - 각 Thread 안의 생각들과 현재 생각의 cosine similarity를 계산
 * - 한 Thread의 '가장 닮은 생각' + '상위 3개 평균'을 섞어서 순위를 정한다
 */
exports.findThreadMatchesForFragment = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "512MiB",
    maxInstances: 10,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");

    const fragmentId = safeId(request.data?.fragmentId, "생각 조각");
    const userRef = db.collection("users").doc(uid);
    const fragmentsRef = userRef.collection("fragments");

    const [currentSnap, threadSnap, fragmentSnap] = await Promise.all([
      fragmentsRef.doc(fragmentId).get(),
      userRef.collection("threads").get(),
      fragmentsRef.get(),
    ]);

    if (!currentSnap.exists) {
      throw new HttpsError("not-found", "생각 조각을 찾지 못했습니다.");
    }

    const current = currentSnap.data() || {};
    const currentValue = current.embedding;
    const currentVector =
      currentValue && typeof currentValue.toArray === "function"
        ? currentValue.toArray()
        : null;

    if (!Array.isArray(currentVector) || !currentVector.length) {
      return { ok: true, items: [], reason: "no-embedding" };
    }

    const alreadyLinked = new Set(Array.isArray(current.threadIds) ? current.threadIds : []);
    const threadExists = new Set();
    threadSnap.forEach((doc) => threadExists.add(doc.id));

    // Thread별로 현재 Fragment와 멤버 Fragment 간 similarity를 모은다.
    const scoresByThread = new Map();

    fragmentSnap.forEach((doc) => {
      if (doc.id === fragmentId) return;

      const data = doc.data() || {};
      if (data.deletedAt) return;

      const tids = Array.isArray(data.threadIds) ? data.threadIds : [];
      if (!tids.length) return;

      const value = data.embedding;
      const vector =
        value && typeof value.toArray === "function"
          ? value.toArray()
          : null;

      if (!Array.isArray(vector) || vector.length !== currentVector.length) return;

      const sim = cosineSimilarity(currentVector, vector);
      if (!Number.isFinite(sim)) return;

      tids.forEach((tid) => {
        if (!threadExists.has(tid) || alreadyLinked.has(tid)) return;
        if (!scoresByThread.has(tid)) scoresByThread.set(tid, []);
        scoresByThread.get(tid).push(sim);
      });
    });

    const items = [];

    scoresByThread.forEach((scores, threadId) => {
      if (!scores.length) return;
      scores.sort((a, b) => b - a);

      const top = scores.slice(0, 3);
      const best = top[0];
      const topMean = top.reduce((sum, n) => sum + n, 0) / top.length;

      // 한 개의 강한 연결도 잡되, 여러 생각이 함께 닮았으면 더 높은 점수.
      const score = best * 0.58 + topMean * 0.42;

      // 지나치게 약한 연결은 추천하지 않는다.
      if (score < 0.36) return;

      items.push({
        threadId,
        score,
        bestSimilarity: best,
        comparedThoughts: scores.length,
      });
    });

    items.sort((a, b) => b.score - a.score);

    return {
      ok: true,
      items: items.slice(0, 3),
    };
  }
);


/**
 * Studio의 특정 칸에 넣을 재료를 추천한다.
 *
 * 쿼리 문맥:
 * - 프로젝트 제목
 * - 시작 Thread 제목/질문
 * - 현재 칸의 역할
 * - 가장 가까운 앞선 작성 답변 최대 2개
 *
 * 후보:
 * - 사용자의 기존 Fragment embedding
 *
 * 비용:
 * - 후보 Fragment는 기존 embedding을 재사용
 * - Studio 문맥 자체의 query embedding이 없거나 문맥이 바뀐 경우에만
 *   text-embedding-3-small을 1회 호출한다.
 * - 같은 문맥은 query embedding을 Firestore에 캐시해 재사용한다.
 */
exports.studioMaterialRecommendations = onCall(
  {
    region: "us-central1",
    secrets: ["OPENAI_API_KEY"],
    timeoutSeconds: 45,
    memory: "256MiB",
    maxInstances: 5,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");

    const projectId = safeId(request.data?.projectId, "Studio");
    const slotId = safeId(request.data?.slotId, "Studio 칸");

    const userRef = db.collection("users").doc(uid);
    const projectSnap = await userRef.collection("projects").doc(projectId).get();
    if (!projectSnap.exists) throw new HttpsError("not-found", "Studio 프로젝트를 찾지 못했습니다.");

    const project = projectSnap.data() || {};
    const slots = Array.isArray(project.slots) ? project.slots : [];
    const slotIndex = slots.findIndex((s) => s?.id === slotId);
    if (slotIndex < 0) throw new HttpsError("not-found", "Studio 칸을 찾지 못했습니다.");

    const meta =
      STUDIO_META[project.format]?.[slotId] ||
      [slotId, "이 칸을 쓰는 데 도움이 되는 생각"];

    let threadTitle = "";
    let threadQuestion = "";

    if (project.threadId) {
      const threadSnap = await userRef.collection("threads").doc(String(project.threadId)).get();
      if (threadSnap.exists) {
        threadTitle = String(threadSnap.data()?.title || "").slice(0, 250);
        threadQuestion = String(threadSnap.data()?.question || "").slice(0, 500);
      }
    }

    // 현재 칸에서 가장 가까운 앞쪽의 '실제 작성 답변' 최대 2개만 쓴다.
    const previousAnswers = slots
      .slice(0, slotIndex)
      .map((s, i) => ({
        id: String(s.id || ""),
        title: STUDIO_META[project.format]?.[s.id]?.[0] || String(s.id || ""),
        text: String(s.text || "").trim(),
        index: i,
      }))
      .filter((s) => s.text)
      .slice(-2)
      .map((s) => ({
        title: s.title,
        text: s.text.slice(0, 2200),
      }));

    const context = {
      projectTitle: String(project.title || "").slice(0, 350),
      format: String(project.format || "blog"),
      threadTitle,
      threadQuestion,
      targetSlotTitle: meta[0],
      targetSlotPurpose: meta[1],
      previousAnswers,
    };

    const contextText = [
      context.projectTitle ? `글 제목: ${context.projectTitle}` : "",
      context.threadTitle ? `시작 Thread: ${context.threadTitle}` : "",
      context.threadQuestion ? `Thread의 질문: ${context.threadQuestion}` : "",
      `지금 쓸 칸: ${context.targetSlotTitle}`,
      `이 칸의 목적: ${context.targetSlotPurpose}`,
      ...context.previousAnswers.map((a) => `앞서 쓴 내용 - ${a.title}:\n${a.text}`),
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 7000);

    if (!contextText.trim()) {
      return { ok: true, items: [], reason: "no-context" };
    }

    const contextHash = sha256(contextText);
    const queryCacheRef = userRef
      .collection("aiStudioMaterialQueries")
      .doc(`${projectId}__${slotId}`);

    const cacheSnap = await queryCacheRef.get();
    const cache = cacheSnap.exists ? cacheSnap.data() || {} : {};

    let queryVector = null;
    let cachedQuery = false;
    let queryInputTokens = 0;

    if (
      cache.contextHash === contextHash &&
      cache.embeddingModel === EMBEDDING_MODEL &&
      cache.embeddingVersion === EMBEDDING_VERSION &&
      cache.queryEmbedding &&
      typeof cache.queryEmbedding.toArray === "function"
    ) {
      queryVector = cache.queryEmbedding.toArray();
      cachedQuery = true;
    }

    if (!Array.isArray(queryVector) || !queryVector.length) {
      const result = await requestEmbeddings([contextText]);
      queryVector = result.vectors[0];
      queryInputTokens = result.totalTokens;

      await queryCacheRef.set(
        {
          projectId,
          slotId,
          contextHash,
          queryEmbedding: FieldValue.vector(queryVector),
          embeddingModel: EMBEDDING_MODEL,
          embeddingVersion: EMBEDDING_VERSION,
          inputTokens: queryInputTokens,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // 비용 투명성을 위해 별도 집계만 남긴다.
      const usageRef = userRef.collection("aiUsage").doc(koreaDateKey());
      await usageRef.set(
        {
          studioMaterialEmbeddingTokens: FieldValue.increment(queryInputTokens),
          studioMaterialEmbeddingCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    const attachedAnywhere = new Set();
    slots.forEach((s) => {
      (Array.isArray(s?.fragmentIds) ? s.fragmentIds : []).forEach((id) => attachedAnywhere.add(id));
    });

    const fragmentsRef = userRef.collection("fragments");

    let nearestSnap;
    try {
      nearestSnap = await fragmentsRef.findNearest({
        vectorField: "embedding",
        queryVector,
        limit: 18,
        distanceMeasure: "COSINE",
        distanceResultField: "vectorDistance",
      }).get();
    } catch (error) {
      logger.error("Studio material vector search failed", {
        code: error?.code || null,
        message: error?.message || null,
      });
      throw new HttpsError("internal", "추천 재료를 찾지 못했습니다.");
    }

    const items = [];

    nearestSnap.forEach((doc) => {
      const data = doc.data() || {};
      if (data.deletedAt) return;
      if (attachedAnywhere.has(doc.id)) return;

      const distance = Number(data.vectorDistance);
      if (!Number.isFinite(distance) || distance > 0.72) return;

      let score = Math.max(0, 1 - distance);

      // Studio가 특정 Thread에서 시작되었다면 그 흐름의 재료에 작은 보너스만 준다.
      if (
        project.threadId &&
        Array.isArray(data.threadIds) &&
        data.threadIds.includes(String(project.threadId))
      ) {
        score += 0.035;
      }

      items.push({
        id: doc.id,
        distance,
        score,
      });
    });

    items.sort((a, b) => b.score - a.score);

    return {
      ok: true,
      items: items.slice(0, 5),
      cachedQuery,
      queryInputTokens,
      model: EMBEDDING_MODEL,
    };
  }
);


/**
 * 오늘의 Studio 정원사 한도를 사용자가 직접 +10 늘린다.
 * KST 날짜별 aiUsage 문서에 저장되므로 다음 날에는 다시 기본 30회로 시작한다.
 */
exports.increaseStudioGardenerLimit = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 15,
    memory: "256MiB",
    maxInstances: 5,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");

    const ref = db.collection("users").doc(uid).collection("aiUsage").doc(koreaDateKey());

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() || {} : {};
      const used = Math.max(0, Number(data.studioQuestions || 0));
      const current = Math.max(
        STUDIO_GARDENER_BASE_DAILY_LIMIT,
        Math.min(
          STUDIO_GARDENER_MAX_DAILY_LIMIT,
          Number(data.studioDailyLimit || STUDIO_GARDENER_BASE_DAILY_LIMIT)
        )
      );

      if (current >= STUDIO_GARDENER_MAX_DAILY_LIMIT) {
        return {
          used,
          limit: current,
          remaining: Math.max(0, current - used),
          maxReached: true,
        };
      }

      const next = Math.min(
        STUDIO_GARDENER_MAX_DAILY_LIMIT,
        current + STUDIO_GARDENER_LIMIT_STEP
      );

      tx.set(
        ref,
        {
          studioDailyLimit: next,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return {
        used,
        limit: next,
        remaining: Math.max(0, next - used),
        maxReached: next >= STUDIO_GARDENER_MAX_DAILY_LIMIT,
      };
    });

    return {
      ok: true,
      ...result,
      step: STUDIO_GARDENER_LIMIT_STEP,
      baseLimit: STUDIO_GARDENER_BASE_DAILY_LIMIT,
      maxLimit: STUDIO_GARDENER_MAX_DAILY_LIMIT,
      timezone: "Asia/Seoul",
    };
  }
);


function utcRangeInfo(nowMs = Date.now()) {
  const now = new Date(nowMs);
  const todayStartMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0, 0, 0, 0
  );
  const tomorrowStartMs = todayStartMs + 24 * 60 * 60 * 1000;
  const monthStartMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    1,
    0, 0, 0, 0
  );
  return {
    nowSec: Math.floor(nowMs / 1000),
    todayStartSec: Math.floor(todayStartMs / 1000),
    tomorrowStartSec: Math.floor(tomorrowStartMs / 1000),
    monthStartSec: Math.floor(monthStartMs / 1000),
  };
}

function appendQueryParam(url, key, value) {
  if (Array.isArray(value)) {
    value.forEach((v) => url.searchParams.append(key, String(v)));
  } else if (value !== undefined && value !== null && value !== "") {
    url.searchParams.set(key, String(value));
  }
}

async function openAiAdminGet(path, params = {}) {
  const adminKey = process.env.OPENAI_ADMIN_KEY;
  if (!adminKey) {
    throw new HttpsError(
      "failed-precondition",
      "OPENAI_ADMIN_KEY 설정이 필요합니다."
    );
  }

  const url = new URL(`https://api.openai.com/v1${path}`);
  Object.entries(params).forEach(([key, value]) => appendQueryParam(url, key, value));

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${adminKey}`,
      "Content-Type": "application/json",
    },
  });

  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  if (!res.ok) {
    logger.error("OpenAI Admin API error", {
      path,
      status: res.status,
      message: body?.error?.message || text?.slice?.(0, 300) || null,
    });
    throw new HttpsError(
      "internal",
      `OpenAI Admin API 조회 실패 (${res.status})`
    );
  }

  return body;
}

async function openAiAdminPaginated(path, params = {}) {
  const buckets = [];
  let page = null;

  for (let i = 0; i < 10; i++) {
    const body = await openAiAdminGet(path, {
      ...params,
      ...(page ? { page } : {}),
    });

    if (Array.isArray(body?.data)) buckets.push(...body.data);
    if (!body?.has_more || !body?.next_page) break;
    page = body.next_page;
  }

  return buckets;
}

function bucketResults(bucket) {
  if (Array.isArray(bucket?.results)) return bucket.results;
  if (Array.isArray(bucket?.result)) return bucket.result;
  return [];
}

function summarizeCompletionBuckets(buckets, rangeStart, rangeEnd) {
  const total = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    requests: 0,
  };

  buckets.forEach((bucket) => {
    const start = Number(bucket?.start_time || 0);
    if (start < rangeStart || start >= rangeEnd) return;

    bucketResults(bucket).forEach((r) => {
      total.inputTokens += Number(r?.input_tokens || 0);
      total.cachedInputTokens += Number(r?.input_cached_tokens || 0);
      total.outputTokens += Number(r?.output_tokens || 0);
      total.requests += Number(r?.num_model_requests || 0);
    });
  });

  return total;
}

function summarizeEmbeddingBuckets(buckets, rangeStart, rangeEnd) {
  const total = { inputTokens: 0, requests: 0 };

  buckets.forEach((bucket) => {
    const start = Number(bucket?.start_time || 0);
    if (start < rangeStart || start >= rangeEnd) return;

    bucketResults(bucket).forEach((r) => {
      total.inputTokens += Number(r?.input_tokens || 0);
      total.requests += Number(r?.num_model_requests || 0);
    });
  });

  return total;
}

function summarizeCostBuckets(buckets, rangeStart, rangeEnd) {
  let value = 0;
  let currency = "usd";

  buckets.forEach((bucket) => {
    const start = Number(bucket?.start_time || 0);
    if (start < rangeStart || start >= rangeEnd) return;

    bucketResults(bucket).forEach((r) => {
      const amount = r?.amount || {};
      value += Number(amount?.value || 0);
      if (amount?.currency) currency = String(amount.currency).toLowerCase();
    });
  });

  return { value, currency };
}


function requireCostDashboardOwner(request) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");
  }

  const allowed = String(process.env.COST_DASHBOARD_ALLOWED_EMAIL || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (!allowed.length) {
    throw new HttpsError(
      "failed-precondition",
      "COST_DASHBOARD_ALLOWED_EMAIL 설정이 필요합니다."
    );
  }

  const email = String(request.auth?.token?.email || "").trim().toLowerCase();
  const verified = request.auth?.token?.email_verified !== false;
  if (!email || !verified || !allowed.includes(email)) {
    throw new HttpsError(
      "permission-denied",
      "비용 대시보드는 등록된 관리자 계정에서만 확인할 수 있습니다."
    );
  }

  return { uid, email };
}

function parseBillingExportTable(rawValue) {
  const value = String(rawValue || "").trim().replace(/^`|`$/g, "");
  const parts = value.split(".");
  if (
    parts.length !== 3 ||
    parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
  ) {
    throw new HttpsError(
      "failed-precondition",
      "GCP_BILLING_EXPORT_TABLE은 project.dataset.table 형식이어야 합니다."
    );
  }
  return {
    fullName: parts.join("."),
    projectId: parts[0],
    datasetId: parts[1],
    tableId: parts[2],
  };
}

async function googleCloudAccessToken() {
  const credential = adminApp?.options?.credential;
  if (credential && typeof credential.getAccessToken === "function") {
    const token = await credential.getAccessToken();
    if (token?.access_token) return token.access_token;
  }

  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } }
  );
  if (!response.ok) {
    throw new HttpsError("internal", "Google Cloud 인증 토큰을 가져오지 못했습니다.");
  }
  const body = await response.json();
  if (!body?.access_token) {
    throw new HttpsError("internal", "Google Cloud 인증 토큰이 비어 있습니다.");
  }
  return body.access_token;
}

async function bigQueryJson(url, options = {}) {
  const token = await googleCloudAccessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }

  if (!response.ok) {
    const message =
      body?.error?.message || text?.slice?.(0, 500) || `HTTP ${response.status}`;
    logger.error("BigQuery billing query error", {
      status: response.status,
      message,
    });
    throw new HttpsError("internal", `Firebase 비용 조회 실패: ${message}`);
  }
  return body;
}

function bigQueryRows(body) {
  const fields = Array.isArray(body?.schema?.fields) ? body.schema.fields : [];
  return (Array.isArray(body?.rows) ? body.rows : []).map((row) => {
    const values = Array.isArray(row?.f) ? row.f : [];
    const out = {};
    fields.forEach((field, index) => {
      out[field.name] = values[index]?.v ?? null;
    });
    return out;
  });
}

async function runBigQuery({ projectId, location, query, queryParameters }) {
  const base = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}`;
  let body = await bigQueryJson(`${base}/queries`, {
    method: "POST",
    body: JSON.stringify({
      query,
      useLegacySql: false,
      parameterMode: "NAMED",
      queryParameters,
      location,
      timeoutMs: 10000,
      maxResults: 1000,
      useQueryCache: true,
      maximumBytesBilled: "1073741824",
    }),
  });

  const jobId = body?.jobReference?.jobId;
  for (let attempt = 0; !body?.jobComplete && jobId && attempt < 5; attempt++) {
    const url = new URL(`${base}/queries/${encodeURIComponent(jobId)}`);
    url.searchParams.set("location", location);
    url.searchParams.set("timeoutMs", "10000");
    url.searchParams.set("maxResults", "1000");
    body = await bigQueryJson(url.toString());
  }

  if (!body?.jobComplete) {
    throw new HttpsError("deadline-exceeded", "Firebase 비용 집계가 아직 끝나지 않았습니다.");
  }

  return {
    rows: bigQueryRows(body),
    totalBytesProcessed: Number(body?.totalBytesProcessed || 0),
    cacheHit: Boolean(body?.cacheHit),
  };
}

function koreaBillingRange(nowMs = Date.now()) {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const shifted = new Date(nowMs + KST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const monthStartMs = Date.UTC(year, month, 1) - KST_OFFSET_MS;
  const todayStartMs = Date.UTC(year, month, day) - KST_OFFSET_MS;
  const tomorrowStartMs = Date.UTC(year, month, day + 1) - KST_OFFSET_MS;
  const todayKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    todayKey,
    monthStartIso: new Date(monthStartMs).toISOString(),
    todayStartIso: new Date(todayStartMs).toISOString(),
    tomorrowStartIso: new Date(tomorrowStartMs).toISOString(),
  };
}

function billingServiceCategory(serviceName, skuName) {
  const service = String(serviceName || "기타");
  const sku = String(skuName || "");
  const haystack = `${service} ${sku}`.toLowerCase();
  if (haystack.includes("firestore")) return "Cloud Firestore";
  if (haystack.includes("cloud run functions") || haystack.includes("cloud functions")) return "Cloud Functions";
  if (haystack.includes("firebase hosting")) return "Firebase Hosting";
  if (haystack.includes("cloud storage")) return "Firebase Storage / Cloud Storage";
  if (haystack.includes("artifact registry")) return "Artifact Registry";
  if (haystack.includes("cloud build")) return "Cloud Build";
  if (haystack.includes("secret manager")) return "Secret Manager";
  if (haystack.includes("bigquery")) return "BigQuery";
  if (haystack.includes("app engine")) return "App Engine";
  return service;
}

function summarizeBillingRows(rows, predicate) {
  const byService = new Map();
  let grossCost = 0;
  let credits = 0;
  let netCost = 0;

  rows.filter(predicate).forEach((row) => {
    const gross = Number(row.gross_cost || 0);
    const credit = Number(row.credits || 0);
    const net = Number(row.net_cost || gross + credit);
    const category = billingServiceCategory(row.service_name, row.sku_name);
    grossCost += gross;
    credits += credit;
    netCost += net;
    const current = byService.get(category) || {
      name: category,
      grossCost: 0,
      credits: 0,
      netCost: 0,
    };
    current.grossCost += gross;
    current.credits += credit;
    current.netCost += net;
    byService.set(category, current);
  });

  const services = [...byService.values()]
    .sort((a, b) => {
      const scoreA = Math.max(Math.abs(a.netCost), Math.abs(a.grossCost));
      const scoreB = Math.max(Math.abs(b.netCost), Math.abs(b.grossCost));
      return scoreB - scoreA;
    })
    .slice(0, 10)
    .map((item) => ({
      ...item,
      grossCost: Number(item.grossCost.toFixed(8)),
      credits: Number(item.credits.toFixed(8)),
      netCost: Number(item.netCost.toFixed(8)),
    }));

  return {
    grossCost: Number(grossCost.toFixed(8)),
    credits: Number(credits.toFixed(8)),
    netCost: Number(netCost.toFixed(8)),
    services,
  };
}

let firebaseCostMemoryCache = null;

/**
 * Firebase/Google Cloud의 실제 프로젝트 비용을 Cloud Billing BigQuery 표준 내보내기에서 조회한다.
 * 비용 자료는 민감하므로 COST_DASHBOARD_ALLOWED_EMAIL과 전용 런타임 서비스 계정으로 보호한다.
 */
exports.firebaseOfficialCost = onCall(
  {
    region: "us-central1",
    secrets: [
      "GCP_BILLING_EXPORT_TABLE",
      "GCP_BILLING_EXPORT_LOCATION",
      "COST_DASHBOARD_ALLOWED_EMAIL",
    ],
    serviceAccount: "thought-garden-cost-reader@idea-pocket-56063.iam.gserviceaccount.com",
    timeoutSeconds: 60,
    memory: "256MiB",
    maxInstances: 2,
  },
  async (request) => {
    requireCostDashboardOwner(request);

    const table = parseBillingExportTable(process.env.GCP_BILLING_EXPORT_TABLE);
    const location = String(process.env.GCP_BILLING_EXPORT_LOCATION || "US").trim();
    const firebaseProjectId = "idea-pocket-56063";
    const range = koreaBillingRange();
    const force = request.data?.force === true;
    const cacheKey = `${table.fullName}|${location}|${range.todayKey}`;

    if (
      !force &&
      firebaseCostMemoryCache?.key === cacheKey &&
      firebaseCostMemoryCache.expiresAt > Date.now()
    ) {
      return { ...firebaseCostMemoryCache.data, cached: true };
    }

    const query = `
      SELECT
        FORMAT_DATE('%Y-%m-%d', DATE(usage_start_time, 'Asia/Seoul')) AS usage_date,
        service.description AS service_name,
        sku.description AS sku_name,
        ANY_VALUE(currency) AS currency,
        SUM(CAST(cost AS NUMERIC)) AS gross_cost,
        SUM(IFNULL((SELECT SUM(CAST(c.amount AS NUMERIC)) FROM UNNEST(credits) c), 0)) AS credits,
        SUM(CAST(cost AS NUMERIC))
          + SUM(IFNULL((SELECT SUM(CAST(c.amount AS NUMERIC)) FROM UNNEST(credits) c), 0)) AS net_cost,
        FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%E6SZ', MAX(export_time)) AS latest_export_time
      FROM \`${table.fullName}\`
      WHERE project.id = @firebaseProjectId
        AND usage_start_time >= @monthStart
        AND usage_start_time < @rangeEnd
      GROUP BY usage_date, service_name, sku_name
      ORDER BY usage_date DESC, ABS(net_cost) DESC
    `;

    const result = await runBigQuery({
      projectId: table.projectId,
      location,
      query,
      queryParameters: [
        {
          name: "firebaseProjectId",
          parameterType: { type: "STRING" },
          parameterValue: { value: firebaseProjectId },
        },
        {
          name: "monthStart",
          parameterType: { type: "TIMESTAMP" },
          parameterValue: { value: range.monthStartIso },
        },
        {
          name: "rangeEnd",
          parameterType: { type: "TIMESTAMP" },
          parameterValue: { value: range.tomorrowStartIso },
        },
      ],
    });

    const rows = result.rows;
    const latestExportTime = rows
      .map((row) => String(row.latest_export_time || ""))
      .filter(Boolean)
      .sort()
      .at(-1) || null;
    const currency =
      rows.map((row) => String(row.currency || "").toUpperCase()).find(Boolean) || "USD";

    const data = {
      ok: true,
      source: "cloud_billing_bigquery_standard_export",
      projectId: firebaseProjectId,
      timezone: "Asia/Seoul",
      currency,
      today: summarizeBillingRows(rows, (row) => row.usage_date === range.todayKey),
      month: summarizeBillingRows(rows, () => true),
      latestExportTime,
      fetchedAt: new Date().toISOString(),
      queryBytesProcessed: result.totalBytesProcessed,
      queryCacheHit: result.cacheHit,
      cached: false,
    };

    firebaseCostMemoryCache = {
      key: cacheKey,
      expiresAt: Date.now() + 15 * 60 * 1000,
      data,
    };
    return data;
  }
);

/**
 * OpenAI 공식 Usage API / Costs API를 서버에서 조회한다.
 *
 * 보안:
 * - OPENAI_ADMIN_KEY는 Firebase Secret Manager에만 저장한다.
 * - OPENAI_PROJECT_ID로 생각의 텃밭 프로젝트만 필터링한다.
 * - 클라이언트에는 키나 프로젝트 ID를 반환하지 않는다.
 *
 * 시간:
 * - OpenAI Usage Dashboard와 맞추기 위해 UTC 기준으로 집계한다.
 */
exports.openAiOfficialUsage = onCall(
  {
    region: "us-central1",
    secrets: ["OPENAI_ADMIN_KEY", "OPENAI_PROJECT_ID", "COST_DASHBOARD_ALLOWED_EMAIL"],
    timeoutSeconds: 45,
    memory: "256MiB",
    maxInstances: 5,
  },
  async (request) => {
    requireCostDashboardOwner(request);

    const projectId = String(process.env.OPENAI_PROJECT_ID || "").trim();
    if (!projectId) {
      throw new HttpsError(
        "failed-precondition",
        "OPENAI_PROJECT_ID 설정이 필요합니다."
      );
    }

    const r = utcRangeInfo();
    const usageQuery = {
      start_time: r.monthStartSec,
      end_time: r.nowSec,
      bucket_width: "1d",
      limit: 31,
      project_ids: [projectId],
    };
    const costQuery = {
      start_time: r.monthStartSec,
      end_time: r.tomorrowStartSec,
      bucket_width: "1d",
      limit: 31,
      project_ids: [projectId],
    };

    const [completionBuckets, embeddingBuckets, costBuckets] =
      await Promise.all([
        openAiAdminPaginated("/organization/usage/completions", usageQuery),
        openAiAdminPaginated("/organization/usage/embeddings", usageQuery),
        openAiAdminPaginated("/organization/costs", costQuery),
      ]);

    const todayCompletion = summarizeCompletionBuckets(
      completionBuckets,
      r.todayStartSec,
      r.tomorrowStartSec
    );
    const monthCompletion = summarizeCompletionBuckets(
      completionBuckets,
      r.monthStartSec,
      r.tomorrowStartSec
    );

    const todayEmbedding = summarizeEmbeddingBuckets(
      embeddingBuckets,
      r.todayStartSec,
      r.tomorrowStartSec
    );
    const monthEmbedding = summarizeEmbeddingBuckets(
      embeddingBuckets,
      r.monthStartSec,
      r.tomorrowStartSec
    );

    const todayCost = summarizeCostBuckets(
      costBuckets,
      r.todayStartSec,
      r.tomorrowStartSec
    );
    const monthCost = summarizeCostBuckets(
      costBuckets,
      r.monthStartSec,
      r.tomorrowStartSec
    );

    return {
      ok: true,
      officialUsageVersion: "v51-unified-thought-index",
      timezone: "UTC",
      projectScoped: true,
      currency: monthCost.currency || todayCost.currency || "usd",
      today: {
        completionsInputTokens: todayCompletion.inputTokens,
        completionsCachedInputTokens: todayCompletion.cachedInputTokens,
        completionsOutputTokens: todayCompletion.outputTokens,
        completionsRequests: todayCompletion.requests,
        embeddingInputTokens: todayEmbedding.inputTokens,
        embeddingRequests: todayEmbedding.requests,
        costUsd: Number(todayCost.value.toFixed(8)),
      },
      month: {
        completionsInputTokens: monthCompletion.inputTokens,
        completionsCachedInputTokens: monthCompletion.cachedInputTokens,
        completionsOutputTokens: monthCompletion.outputTokens,
        completionsRequests: monthCompletion.requests,
        embeddingInputTokens: monthEmbedding.inputTokens,
        embeddingRequests: monthEmbedding.requests,
        costUsd: Number(monthCost.value.toFixed(8)),
      },
      fetchedAt: new Date().toISOString(),
    };
  }
);

const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("node:crypto");

if (!getApps().length) initializeApp();
const db = getFirestore();

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_VERSION = 1;
const MAX_EMBEDDING_TEXT_CHARS = 12000;

const STUDIO_GARDENER_MODEL = "gpt-5.4-mini";
const BLOOMING_INTERVIEW_MODEL = STUDIO_GARDENER_MODEL;
const BLOOMING_INTERVIEW_DAILY_LIMIT = 6;
const BETWEEN_THOUGHTS_MODEL = STUDIO_GARDENER_MODEL;
const BETWEEN_THOUGHTS_DAILY_LIMIT = 12;
const BETWEEN_THOUGHTS_CURATION_DAILY_LIMIT = 4;
const BETWEEN_THOUGHTS_PROFILE_DAILY_LIMIT = 60;
const BETWEEN_THOUGHTS_CURATION_MAX_CANDIDATES = 36;
const BETWEEN_THOUGHTS_SCOUT_PAIR_COUNT = 6;
const BETWEEN_THOUGHTS_CURATION_PAIR_COUNT = 3;
const BETWEEN_THOUGHTS_CURATION_CACHE_MS = 3 * 24 * 60 * 60 * 1000;
const STUDIO_PATH_DAILY_LIMIT = 6;
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

function buildEmbeddingText(fragment) {
  const parts = [];
  const thought = typeof fragment?.thought === "string" ? fragment.thought.trim() : "";
  const externalText = typeof fragment?.externalText === "string" ? fragment.externalText.trim() : "";
  const context = typeof fragment?.context === "string" ? fragment.context.trim() : "";

  if (thought) parts.push(`내 생각:\n${thought}`);
  if (externalText) parts.push(`함께 남긴 문장·장면:\n${externalText}`);
  if (context) parts.push(`기록 맥락:\n${context}`);

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
    if (fragment.deletedAt) {
      throw new HttpsError("failed-precondition", "휴지통의 생각 조각은 분석하지 않습니다.");
    }

    const text = buildEmbeddingText(fragment);
    if (!text) return { ok: true, skipped: true, reason: "no-text" };

    const textHash = sha256(text);
    if (
      fragment.embedding &&
      fragment.embeddingModel === EMBEDDING_MODEL &&
      fragment.embeddingVersion === EMBEDDING_VERSION &&
      fragment.embeddingTextHash === textHash
    ) {
      return { ok: true, skipped: true, reason: "already-current", model: EMBEDDING_MODEL };
    }

    const result = await requestEmbeddings([text]);
    const vector = result.vectors[0];

    const usageRef = db.collection("users").doc(uid).collection("aiUsage").doc(koreaDateKey());
    const writeBatch = db.batch();

    writeBatch.set(
      fragmentRef,
      {
        embedding: FieldValue.vector(vector),
        embeddingModel: EMBEDDING_MODEL,
        embeddingVersion: EMBEDDING_VERSION,
        embeddingTextHash: textHash,
        embeddingDimensions: vector.length,
        embeddingInputTokens: result.totalTokens,
        embeddingUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    writeBatch.set(
      usageRef,
      {
        fragmentEmbeddingTokens: FieldValue.increment(result.totalTokens),
        fragmentEmbeddingCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await writeBatch.commit();

    return {
      ok: true,
      skipped: false,
      model: EMBEDDING_MODEL,
      dimensions: vector.length,
      inputTokens: result.totalTokens,
    };
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
    "질문은 짧고 자연스럽게, 가능하면 80자 안팎으로 쓴다.",
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

  const question = String(parsed?.question || "").trim().slice(0, 180);
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
    timeoutSeconds: 45,
    memory: "256MiB",
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
        text: String(s.text || "").trim().slice(0, 1800),
      }))
      .filter((s) => s.text);

    // 현재 target slot에 사용자가 직접 붙여둔 재료
    const attachedIds = Array.isArray(targetSlot.fragmentIds)
      ? [...new Set(targetSlot.fragmentIds)].filter(Boolean).slice(0, 8)
      : [];

    const attachedMaterials = [];
    if (attachedIds.length) {
      const refs = attachedIds.map((id) => userRef.collection("fragments").doc(String(id)));
      const docs = await db.getAll(...refs);
      docs.forEach((doc) => {
        if (!doc.exists) return;
        const data = doc.data() || {};
        if (data.deletedAt) return;
        const text = [data.context, data.thought, data.externalText].filter(Boolean).join("\n").trim();
        if (text) attachedMaterials.push(text.slice(0, 900));
      });
    }

    // Studio가 Thread에서 시작됐다면 Thread 제목을 본다.
    // '글의 갈래 찾기'로 시작한 프로젝트는 선택된 출발 생각만 우선해서 읽고,
    // 일반 Thread 프로젝트일 때만 최근 Thread 생각을 넓게 참고한다.
    let threadTitle = "";
    let threadQuestion = "";
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
      ? [...new Set(project.startingFragmentIds.map(String).filter(Boolean))].slice(0, 8)
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
        docs.forEach((doc) => {
          if (!doc.exists) return;
          const data = doc.data() || {};
          if (data.deletedAt) return;
          const text = [data.context, data.thought, data.externalText].filter(Boolean).join("\n").trim();
          if (text) threadMaterials.push(text.slice(0, 1200));
        });
      } else {
        const fragSnap = await userRef
          .collection("fragments")
          .where("threadIds", "array-contains", threadId)
          .get();

        const rows = [];
        fragSnap.forEach((doc) => {
          const data = doc.data() || {};
          if (data.deletedAt) return;
          const text = [data.context, data.thought, data.externalText].filter(Boolean).join("\n").trim();
          if (!text) return;
          rows.push({ at: String(data.createdAt || data.date || ""), text: text.slice(0, 800) });
        });
        rows.sort((a, b) => a.at.localeCompare(b.at)).slice(-20).forEach((row) => threadMaterials.push(row.text));
      }
    }

    const context = {
      task: "현재 선택한 Studio 문항을 더 잘 써나가게 하는 질문 한 개 만들기",
      projectTitle: String(project.title || "").slice(0, 350),
      format: String(project.format || "blog"),
      threadTitle,
      threadQuestion,
      startingPath,
      threadMaterials,
      previousSlots,
      targetSlotTitle: meta[0],
      targetSlotPurpose: meta[1],
      targetSlotGuide:
        STUDIO_GARDENER_GUIDE[project.format]?.[slotId] ||
        "앞에서 이미 다룬 내용을 반복하지 말고, 현재 문항의 고유한 역할에서 아직 탐색하지 않은 방향을 연다.",
      previousGardenerQuestion: String(targetSlot.gardenerQuestion || "").trim().slice(0, 500),
      currentDraft: targetText.slice(0, 3500),
      attachedMaterials,
    };

    const hasContext =
      context.projectTitle ||
      context.threadTitle ||
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
    const texts = docs.map((data) => String(data.thought || data.text || data.externalText || "").trim().slice(0, 6000));
    if (texts.some((text) => text.length < 4)) return { ok: true, question: null, reason: "not-enough-context" };

    const canonicalIds = ids.slice().sort();
    const cacheId = sha256(canonicalIds.join("|")).slice(0, 40);
    const sourceHash = sha256(canonicalIds.map((id) => `${id}:${texts[ids.indexOf(id)]}`).join("|"));
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
    const result = await requestBetweenThoughtsQuestion(texts[0], texts[1]);
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
    const used = Math.max(0, Number(data.betweenThoughtsCurations || 0));
    if (used >= BETWEEN_THOUGHTS_CURATION_DAILY_LIMIT) {
      throw new HttpsError("resource-exhausted", "두 생각 사이의 새 큐레이션은 오늘 여기까지예요. 준비된 조합은 계속 볼 수 있어요.");
    }
    tx.set(ref, { betweenThoughtsCurations: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return used + 1;
  });
}

async function reserveBetweenThoughtProfiles(uid, count) {
  const n = Math.max(0, Math.min(BETWEEN_THOUGHTS_PROFILE_DAILY_LIMIT, Number(count || 0)));
  if (!n) return 0;
  const ref = db.collection("users").doc(uid).collection("aiUsage").doc(koreaDateKey());
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const used = Math.max(0, Number(data.betweenThoughtsProfileGenerations || 0));
    if (used + n > BETWEEN_THOUGHTS_PROFILE_DAILY_LIMIT) {
      throw new HttpsError("resource-exhausted", "오늘 만들 수 있는 생각 프로필 수를 넘었어요. 내일 이어서 정리할게요.");
    }
    tx.set(ref, {
      betweenThoughtsProfileGenerations: used + n,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return used + n;
  });
}

function betweenThoughtFullRecord(id, data, source) {
  return {
    id,
    date: String(data.date || data.createdAt || "").slice(0, 10),
    thought: String(data.thought || data.text || "").trim().slice(0, 4200),
    context: String(data.context || "").trim().slice(0, 900),
    sourceExcerpt: String(data.externalText || "").trim().slice(0, 2200),
    locator: String(data.locator || "").trim().slice(0, 200),
    sourceId: String(data.sourceId || ""),
    source: source ? {
      title: String(source.title || "").trim().slice(0, 260),
      creator: String(source.creator || "").trim().slice(0, 200),
      platform: String(source.platform || "").trim().slice(0, 140),
      publisher: String(source.publisher || "").trim().slice(0, 140),
      type: String(source.type || "").trim().slice(0, 40),
    } : null,
  };
}

function betweenThoughtProfileFingerprint(record) {
  return sha256(JSON.stringify({
    thought: record.thought,
    context: record.context,
    sourceExcerpt: record.sourceExcerpt,
    locator: record.locator,
    sourceId: record.sourceId,
    source: record.source,
  }));
}

function compactBetweenThoughtProfile(id, profile, date) {
  return {
    id,
    date: String(date || "").slice(0, 10),
    core: String(profile?.core || "").trim().slice(0, 320),
    themes: Array.isArray(profile?.themes) ? profile.themes.map(String).slice(0, 5) : [],
    valuesOrNeeds: Array.isArray(profile?.valuesOrNeeds) ? profile.valuesOrNeeds.map(String).slice(0, 4) : [],
    patternsOrTensions: Array.isArray(profile?.patternsOrTensions) ? profile.patternsOrTensions.map(String).slice(0, 4) : [],
    emotions: Array.isArray(profile?.emotions) ? profile.emotions.map(String).slice(0, 3) : [],
    unfinished: String(profile?.unfinished || "").trim().slice(0, 240),
    sourceRelation: String(profile?.sourceRelation || "none"),
    sourceAnchor: String(profile?.sourceAnchor || "").trim().slice(0, 220),
    contextKind: String(profile?.contextKind || "other"),
  };
}

async function requestBetweenThoughtProfiles(records) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpsError("failed-precondition", "AI 연결 설정을 확인해주세요.");
  const inputs = records.map((r) => ({
    id: r.id,
    date: r.date,
    thought: r.thought,
    context: r.context,
    sourceExcerpt: r.sourceExcerpt,
    locator: r.locator,
    source: r.source,
  }));
  const systemPrompt = [
    "당신은 '생각의 텃밭'에서 사용자의 생각 조각을 나중의 연결 탐색에 재사용할 수 있도록 짧은 '생각 프로필'로 정리한다.",
    "이 프로필은 사용자에게 직접 보여주는 요약문이 아니라 AI 큐레이션용 내부 표식이다. 따라서 짧고 구체적이어야 한다.",
    "thought는 사용자가 직접 쓴 생각이다. sourceExcerpt는 책·영상·대화·타인의 말 등 외부에서 가져온 인용/장면일 수 있다. 둘을 절대 사용자 생각처럼 섞지 않는다.",
    "core에는 사용자가 실제로 말한 핵심 생각만 1~2문장으로 적는다. 사용자가 말하지 않은 성격·진단·동기·감정을 추측하지 않는다.",
    "themes는 표면 주제, valuesOrNeeds는 사용자가 중요하게 여긴 가치나 욕구, patternsOrTensions는 반복 가능성이 있는 행동·긴장·모순을 짧은 구로 적는다. 근거가 없으면 빈 배열로 둔다.",
    "emotions는 글에서 직접 드러난 정서만 적는다. unfinished에는 아직 열려 있는 질문이나 미완의 생각이 실제로 보일 때만 적는다.",
    "출처가 있으면 sourceRelation은 사용자의 생각이 그 외부 내용과 어떤 관계인지 고른다. sourceAnchor에는 질문 연결에 쓸 만한 인용/장면의 핵심만 아주 짧게 적는다. 출처가 없으면 none과 빈 문자열을 쓴다.",
    "같은 책이나 같은 소재라는 사실만으로 나중에 강한 연결이라고 오해하지 않도록, 사용자가 그 내용을 어떻게 받아들였는지를 중심으로 프로필을 만든다.",
    "각 문자열은 짧고 평이한 한국어로 쓴다. 프로필 하나를 장황한 요약으로 만들지 않는다.",
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: BETWEEN_THOUGHTS_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify({ fragments: inputs }) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "between_thought_profiles",
          strict: true,
          schema: {
            type: "object",
            properties: {
              profiles: {
                type: "array",
                minItems: 1,
                maxItems: BETWEEN_THOUGHTS_CURATION_MAX_CANDIDATES,
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    core: { type: "string" },
                    themes: { type: "array", minItems: 0, maxItems: 5, items: { type: "string" } },
                    valuesOrNeeds: { type: "array", minItems: 0, maxItems: 4, items: { type: "string" } },
                    patternsOrTensions: { type: "array", minItems: 0, maxItems: 4, items: { type: "string" } },
                    emotions: { type: "array", minItems: 0, maxItems: 3, items: { type: "string" } },
                    unfinished: { type: "string" },
                    sourceRelation: { type: "string", enum: ["none", "resonates", "challenges", "applies", "questions", "extends"] },
                    sourceAnchor: { type: "string" },
                    contextKind: { type: "string", enum: ["personal_experience", "reflection", "decision", "desire", "source_response", "mixed", "other"] },
                  },
                  required: ["id", "core", "themes", "valuesOrNeeds", "patternsOrTensions", "emotions", "unfinished", "sourceRelation", "sourceAnchor", "contextKind"],
                  additionalProperties: false,
                },
              },
            },
            required: ["profiles"],
            additionalProperties: false,
          },
        },
      },
      max_completion_tokens: Math.min(6200, Math.max(700, records.length * 190)),
    }),
  });

  let payload;
  try { payload = await response.json(); } catch (_) { payload = null; }
  if (!response.ok) {
    logger.error("OpenAI Between Thoughts profile HTTP error", { status: response.status, code: payload?.error?.code || null, type: payload?.error?.type || null });
    throw new HttpsError("internal", "생각 프로필을 만들지 못했습니다.");
  }
  const raw = payload?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) throw new HttpsError("internal", "생각 프로필 결과가 비어 있습니다.");
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { throw new HttpsError("internal", "생각 프로필 형식이 올바르지 않습니다."); }
  const validIds = new Set(records.map((x) => x.id));
  const profiles = (Array.isArray(parsed?.profiles) ? parsed.profiles : [])
    .filter((p) => validIds.has(String(p?.id || "")))
    .map((p) => ({
      id: String(p.id),
      core: String(p.core || "").trim().slice(0, 320),
      themes: Array.isArray(p.themes) ? p.themes.map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 5) : [],
      valuesOrNeeds: Array.isArray(p.valuesOrNeeds) ? p.valuesOrNeeds.map((x) => String(x).trim().slice(0, 90)).filter(Boolean).slice(0, 4) : [],
      patternsOrTensions: Array.isArray(p.patternsOrTensions) ? p.patternsOrTensions.map((x) => String(x).trim().slice(0, 110)).filter(Boolean).slice(0, 4) : [],
      emotions: Array.isArray(p.emotions) ? p.emotions.map((x) => String(x).trim().slice(0, 50)).filter(Boolean).slice(0, 3) : [],
      unfinished: String(p.unfinished || "").trim().slice(0, 240),
      sourceRelation: String(p.sourceRelation || "none"),
      sourceAnchor: String(p.sourceAnchor || "").trim().slice(0, 220),
      contextKind: String(p.contextKind || "other"),
    }))
    .filter((p) => p.core);
  return {
    profiles,
    model: BETWEEN_THOUGHTS_MODEL,
    inputTokens: Number(payload?.usage?.prompt_tokens || 0),
    cachedInputTokens: Number(payload?.usage?.prompt_tokens_details?.cached_tokens || 0),
    outputTokens: Number(payload?.usage?.completion_tokens || 0),
  };
}

async function ensureBetweenThoughtProfiles(uid, userRef, records) {
  const profileCol = userRef.collection("aiBetweenThoughtProfiles");
  const snaps = await Promise.all(records.map((r) => profileCol.doc(r.id).get()));
  const resultMap = new Map();
  const stale = [];
  records.forEach((r, i) => {
    const fingerprint = betweenThoughtProfileFingerprint(r);
    const data = snaps[i].exists ? snaps[i].data() || {} : {};
    if (data.fingerprint === fingerprint && data.profile?.core) {
      resultMap.set(r.id, data.profile);
    } else {
      stale.push({ record: r, fingerprint });
    }
  });

  let usage = { count: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  if (stale.length) {
    await reserveBetweenThoughtProfiles(uid, stale.length);
    const generated = await requestBetweenThoughtProfiles(stale.map((x) => x.record));
    const generatedMap = new Map(generated.profiles.map((p) => [p.id, p]));
    const batch = db.batch();
    for (const item of stale) {
      const profile = generatedMap.get(item.record.id);
      if (!profile) continue;
      resultMap.set(item.record.id, profile);
      batch.set(profileCol.doc(item.record.id), {
        fragmentId: item.record.id,
        fingerprint: item.fingerprint,
        sourceId: item.record.sourceId || "",
        profile,
        model: generated.model,
        generatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    const count = [...stale].filter((x) => generatedMap.has(x.record.id)).length;
    if (count) {
      batch.set(userRef.collection("aiUsage").doc(koreaDateKey()), {
        betweenThoughtsProfileInputTokens: FieldValue.increment(generated.inputTokens),
        betweenThoughtsProfileCachedInputTokens: FieldValue.increment(generated.cachedInputTokens),
        betweenThoughtsProfileOutputTokens: FieldValue.increment(generated.outputTokens),
        betweenThoughtsProfileModel: BETWEEN_THOUGHTS_MODEL,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      await batch.commit();
      usage = { count, inputTokens: generated.inputTokens, cachedInputTokens: generated.cachedInputTokens, outputTokens: generated.outputTokens };
    }
  }
  return { profiles: resultMap, usage };
}

async function requestBetweenThoughtsScout(profileCandidates, excludePairKeys) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpsError("failed-precondition", "AI 연결 설정을 확인해주세요.");
  const systemPrompt = [
    "당신은 '생각의 텃밭'의 1차 큐레이터다. 지금 보는 것은 각 생각의 원문이 아니라 재사용 가능한 짧은 '생각 프로필'이다.",
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
      max_completion_tokens: 1400,
    }),
  });
  let payload;
  try { payload = await response.json(); } catch (_) { payload = null; }
  if (!response.ok) {
    logger.error("OpenAI Between Thoughts scout HTTP error", { status: response.status, code: payload?.error?.code || null, type: payload?.error?.type || null });
    throw new HttpsError("internal", "두 생각 사이의 후보를 고르지 못했습니다.");
  }
  const raw = payload?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) throw new HttpsError("internal", "두 생각 사이 후보 결과가 비어 있습니다.");
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { throw new HttpsError("internal", "두 생각 사이 후보 형식이 올바르지 않습니다."); }
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
    sourceExcerpt: r.sourceExcerpt,
    locator: r.locator,
    source: r.source,
  }));
  const systemPrompt = [
    "당신은 '생각의 텃밭'의 최종 큐레이터이자 인터뷰어다.",
    "1차 큐레이터가 생각 프로필만 보고 고른 후보 조합을 이제 실제 원문, 출처, 인용과 함께 다시 읽는다. 1차 판단을 그대로 믿지 말고 반드시 재검증한다.",
    `최종적으로 사용자가 함께 바라볼 가치가 분명한 조합만 최대 ${BETWEEN_THOUGHTS_CURATION_PAIR_COUNT}개 남기고, 각 조합에 질문 하나를 만든다.`,
    "가장 중요한 기준은 사용자가 두 카드를 보는 순간 '왜 이 둘을 같이 보여줬는지 알 것 같다'고 느낄 가능성이다. 설명을 길게 해야만 연결되는 조합은 탈락시킨다.",
    "같은 책·같은 영상·같은 출처라는 이유만으로는 연결 근거가 되지 않는다. 두 기록에서 사용자가 붙잡은 생각의 변화·긴장·적용 방식이 실제로 이어져야 한다.",
    "sourceExcerpt는 외부의 문장·장면이고 thought는 사용자의 생각이다. 외부 저자의 말을 사용자 신념처럼 취급하지 않는다. 다만 인용/장면이 사용자의 생각을 촉발한 핵심이라면 질문에 그 맥락을 자연스럽게 반영한다.",
    "직접 연결도 좋지만, 소재가 다른데 반복되는 가치·욕구·행동 패턴이 실제 문장에 드러나는 조합은 더 깊은 자기 이해를 만들 수 있다. 단, 추상적인 공통점만으로 묶지 않는다.",
    "질문은 'A는 이렇고 B는 저런데 왜 다른가요?', '공통점은 무엇인가요?', '차이는 무엇인가요?' 같은 비교 시험문제를 피한다.",
    "질문은 두 기록을 발판으로 아직 쓰지 않은 세 번째 생각을 떠올리게 해야 한다. 사용자가 자기 경험을 떠올리며 바로 답할 수 있는 자연스러운 한국어 한 문장이어야 한다.",
    "질문은 두 생각의 관계를 정답처럼 먼저 선언하지 않는다. 조언·평가·진단·칭찬·교훈도 하지 않는다.",
    "bridge는 사용자에게 보여주지 않는 내부 메모다. 실제 원문에서 확인되는 연결 근거를 구체적으로 한 문장으로 적는다.",
    "confidence는 원문까지 읽은 뒤 사용자가 연결을 납득할 가능성을 0~100으로 평가한다. 78 미만은 반환하지 않는다.",
    "가능하다면 최종 세 조합이 모두 같은 책/같은 주제에 몰리지 않게 한다. 단, 다양성을 위해 품질을 낮추지는 않는다.",
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
      max_completion_tokens: 1500,
    }),
  });
  let payload;
  try { payload = await response.json(); } catch (_) { payload = null; }
  if (!response.ok) {
    logger.error("OpenAI Between Thoughts deep curation HTTP error", { status: response.status, code: payload?.error?.code || null, type: payload?.error?.type || null });
    throw new HttpsError("internal", "두 생각 사이를 깊게 살펴보지 못했습니다.");
  }
  const raw = payload?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) throw new HttpsError("internal", "두 생각 사이 최종 결과가 비어 있습니다.");
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { throw new HttpsError("internal", "두 생각 사이 최종 형식이 올바르지 않습니다."); }
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
    inputTokens: Number(payload?.usage?.prompt_tokens || 0),
    cachedInputTokens: Number(payload?.usage?.prompt_tokens_details?.cached_tokens || 0),
    outputTokens: Number(payload?.usage?.completion_tokens || 0),
  };
}

/**
 * Fragment가 새로 생기거나 수정될 때 한 번 만드는 '두 생각 사이' 전용 생각 프로필.
 * 원문/출처가 바뀌지 않으면 같은 프로필을 재사용한다.
 */
exports.betweenThoughtsProfile = onCall(
  {
    region: "us-central1",
    secrets: ["OPENAI_API_KEY"],
    timeoutSeconds: 45,
    memory: "256MiB",
    maxInstances: 3,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "로그인 후 사용할 수 있습니다.");
    const fragmentId = safeId(request.data?.fragmentId, "생각 조각");
    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.collection("fragments").doc(fragmentId).get();
    if (!snap.exists) throw new HttpsError("not-found", "생각 조각을 찾지 못했습니다.");
    const data = snap.data() || {};
    if (data.deletedAt) return { ok: true, skipped: true, reason: "deleted" };
    const sourceId = String(data.sourceId || "");
    const sourceSnap = sourceId ? await userRef.collection("sources").doc(sourceId).get() : null;
    const record = betweenThoughtFullRecord(fragmentId, data, sourceSnap?.exists ? sourceSnap.data() || {} : null);
    if ((record.thought || record.sourceExcerpt).trim().length < 8) return { ok: true, skipped: true, reason: "not-enough-context" };
    const ensured = await ensureBetweenThoughtProfiles(uid, userRef, [record]);
    const profile = ensured.profiles.get(fragmentId);
    return { ok: true, cached: ensured.usage.count === 0, profiled: Boolean(profile), model: BETWEEN_THOUGHTS_MODEL };
  }
);

/**
 * Home 라운지의 '두 생각 사이' 큐레이터.
 * 1) 재사용 가능한 짧은 생각 프로필로 넓게 후보를 고르고,
 * 2) 선택된 조합만 원문·출처·인용을 다시 읽어 최종 질문을 만든다.
 * 준비된 조합은 새 Fragment가 생겨도 3일 동안 재사용하고, 새 Fragment의 프로필만 백그라운드에서 갱신한다.
 */
exports.betweenThoughtsCurate = onCall(
  {
    region: "us-central1",
    secrets: ["OPENAI_API_KEY"],
    timeoutSeconds: 90,
    memory: "256MiB",
    maxInstances: 3,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");
    const rawIds = Array.isArray(request.data?.candidateIds) ? request.data.candidateIds : [];
    const ids = [...new Set(rawIds.slice(0, BETWEEN_THOUGHTS_CURATION_MAX_CANDIDATES).map((id, i) => safeId(id, `생각 조각 ${i + 1}`)))];
    if (ids.length < 2) return { ok: true, items: [], reason: "not-enough-context" };
    const excludePairKeys = [...new Set((Array.isArray(request.data?.excludePairKeys) ? request.data.excludePairKeys : []).map((x) => String(x).slice(0, 180)).filter(Boolean))].slice(-20);
    const forceRefresh = Boolean(request.data?.forceRefresh);

    const userRef = db.collection("users").doc(uid);
    const col = userRef.collection("fragments");
    const snaps = await Promise.all(ids.map((id) => col.doc(id).get()));
    const docs = snaps.map((snap, i) => ({ id: ids[i], exists: snap.exists, data: snap.exists ? snap.data() || {} : {} }))
      .filter((x) => x.exists && !x.data.deletedAt);
    const sourceIds = [...new Set(docs.map((x) => String(x.data.sourceId || "")).filter(Boolean))];
    const sourceSnaps = await Promise.all(sourceIds.map((id) => userRef.collection("sources").doc(id).get()));
    const sourceMap = new Map();
    sourceSnaps.forEach((snap, i) => { if (snap.exists) sourceMap.set(sourceIds[i], snap.data() || {}); });
    const records = docs.map((x) => betweenThoughtFullRecord(x.id, x.data, sourceMap.get(String(x.data.sourceId || "")) || null))
      .filter((x) => (x.thought || x.sourceExcerpt).length >= 8);
    if (records.length < 2) return { ok: true, items: [], reason: "not-enough-context" };
    const recordMap = new Map(records.map((x) => [x.id, x]));
    const validIds = new Set(records.map((x) => x.id));

    const currentRef = userRef.collection("aiBetweenThoughtsCurations").doc("current");
    if (!forceRefresh) {
      const cacheSnap = await currentRef.get();
      const cache = cacheSnap.exists ? cacheSnap.data() || {} : {};
      const age = Date.now() - Number(cache.generatedAtMs || 0);
      if (age >= 0 && age < BETWEEN_THOUGHTS_CURATION_CACHE_MS && Array.isArray(cache.items)) {
        const validItems = cache.items.filter((item) => Array.isArray(item?.fragmentIds) && item.fragmentIds.length === 2 && item.fragmentIds.every((id) => validIds.has(String(id))));
        if (validItems.length) {
          return {
            ok: true,
            cached: true,
            items: validItems,
            curationId: String(cache.curationId || "current"),
            model: String(cache.model || BETWEEN_THOUGHTS_MODEL),
            noPairReason: String(cache.noPairReason || ""),
            generatedAtMs: Number(cache.generatedAtMs || 0),
          };
        }
      }
    }

    await reserveBetweenThoughtsCurationQuota(uid);
    const ensured = await ensureBetweenThoughtProfiles(uid, userRef, records);
    const profileCandidates = records.map((r) => compactBetweenThoughtProfile(r.id, ensured.profiles.get(r.id), r.date)).filter((x) => x.core);
    if (profileCandidates.length < 2) return { ok: true, items: [], reason: "not-enough-profile-context" };

    const scout = await requestBetweenThoughtsScout(profileCandidates, excludePairKeys);
    let deep = { items: [], noPairReason: "", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
    if (scout.shortlist.length) deep = await requestBetweenThoughtsDeepCuration(scout.shortlist, recordMap);

    const generatedAtMs = Date.now();
    const curationId = sha256(`${uid}:${generatedAtMs}:${deep.items.map((x) => x.fragmentIds.join("|")).join(",")}`).slice(0, 40);
    const totalInputTokens = scout.inputTokens + deep.inputTokens;
    const totalCachedInputTokens = scout.cachedInputTokens + deep.cachedInputTokens;
    const totalOutputTokens = scout.outputTokens + deep.outputTokens;
    const usageRef = userRef.collection("aiUsage").doc(koreaDateKey());
    const batch = db.batch();
    batch.set(currentRef, {
      curationId,
      candidateIds: profileCandidates.map((x) => x.id),
      excludePairKeys,
      items: deep.items,
      noPairReason: deep.noPairReason,
      model: BETWEEN_THOUGHTS_MODEL,
      scoutInputTokens: scout.inputTokens,
      scoutCachedInputTokens: scout.cachedInputTokens,
      scoutOutputTokens: scout.outputTokens,
      deepInputTokens: deep.inputTokens,
      deepCachedInputTokens: deep.cachedInputTokens,
      deepOutputTokens: deep.outputTokens,
      generatedAtMs,
      generatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(usageRef, {
      betweenThoughtsQuestions: FieldValue.increment(deep.items.length),
      betweenThoughtsPreparedPairs: FieldValue.increment(deep.items.length),
      betweenThoughtsInputTokens: FieldValue.increment(totalInputTokens),
      betweenThoughtsCachedInputTokens: FieldValue.increment(totalCachedInputTokens),
      betweenThoughtsOutputTokens: FieldValue.increment(totalOutputTokens),
      betweenThoughtsScoutInputTokens: FieldValue.increment(scout.inputTokens),
      betweenThoughtsDeepInputTokens: FieldValue.increment(deep.inputTokens),
      betweenThoughtsModel: BETWEEN_THOUGHTS_MODEL,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
    return {
      ok: true,
      cached: false,
      items: deep.items,
      curationId,
      model: BETWEEN_THOUGHTS_MODEL,
      noPairReason: deep.noPairReason,
      generatedAtMs,
      inputTokens: totalInputTokens,
      cachedInputTokens: totalCachedInputTokens,
      outputTokens: totalOutputTokens,
      profiledNow: ensured.usage.count,
    };
  }
);

async function reserveStudioPathQuota(uid) {
  const ref = db.collection("users").doc(uid).collection("aiUsage").doc(koreaDateKey());
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const used = Math.max(0, Number(data.studioPathDiscoveries || 0));
    if (used >= STUDIO_PATH_DAILY_LIMIT) {
      throw new HttpsError("resource-exhausted", "글의 갈래 찾기는 오늘 여기까지 사용할 수 있어요.");
    }
    tx.set(ref, { studioPathDiscoveries: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return used + 1;
  });
}

function selectStudioPathRows(rows, maxCount) {
  if (rows.length <= maxCount) return rows;
  const picked = [];
  const seen = new Set();
  for (let i = 0; i < maxCount; i++) {
    const index = Math.round((i * (rows.length - 1)) / Math.max(1, maxCount - 1));
    if (!seen.has(index)) { seen.add(index); picked.push(rows[index]); }
  }
  return picked;
}

async function requestStudioPathScout(thread, profiles) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpsError("failed-precondition", "AI 연결 설정을 확인해주세요.");
  const systemPrompt = [
    "당신은 '생각의 텃밭'에서 사용자가 글을 쓰기 전에 선택적으로 부르는 길안내자다.",
    "지금 보는 것은 Thread 안 생각들의 짧은 프로필과 부모·자식 연결 정보다. 이 단계의 목적은 원문을 다시 읽어볼 후보 갈래를 좁히는 것이며, 글의 목차·결론·문장을 만들지 않는다.",
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
    fragments: candidate.fragmentIds.map((id) => recordMap.get(id)).filter(Boolean),
  }));
  const systemPrompt = [
    "당신은 '생각의 텃밭'의 글쓰기 길안내자다. 이제 후보 갈래에 포함된 생각의 실제 원문·맥락·외부 인용과 출처를 다시 읽는다.",
    `원문에 근거해 글을 시작할 만한 갈래만 최대 ${STUDIO_PATH_RESULT_COUNT}개 남긴다. 약하거나 억지스러운 후보는 버린다. 하나만 좋으면 하나만 반환하고, 없으면 빈 배열을 반환한다.`,
    "갈래는 완성된 글감 묶음이나 목차가 아니다. 사용자가 쓰기 시작할 중심 나뭇가지다. 재료가 2개든 3개든 4개든 실제로 필요한 만큼만 남긴다.",
    "Thread 전체를 하나의 시간순 서사로 만들지 않는다. 변화가 없어도 반복·긴장·확장으로 글을 시작할 수 있다.",
    "thought/context는 사용자의 기록이고 sourceExcerpt는 외부 문장일 수 있다. 둘을 섞거나 외부 문장을 사용자의 생각으로 오해하지 않는다.",
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
    timeoutSeconds: 90,
    memory: "256MiB",
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
      if ((thought || excerpt).length < 8) return;
      allRows.push({ id: doc.id, data, at: String(data.date || data.createdAt || "") });
    });
    allRows.sort((a, b) => a.at.localeCompare(b.at));
    if (allRows.length < 2) return { ok: true, items: [], reason: "not-enough-context" };

    const signature = sha256(JSON.stringify({
      title: String(threadData.title || ""), question: String(threadData.question || ""),
      fragments: allRows.map((x) => ({
        id: x.id, thought: String(x.data.thought || x.data.text || ""), context: String(x.data.context || ""),
        externalText: String(x.data.externalText || ""), sourceId: String(x.data.sourceId || ""),
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

    await reserveStudioPathQuota(uid);
    const selectedRows = selectStudioPathRows(allRows, STUDIO_PATH_MAX_THREAD_FRAGMENTS);
    const selectedIds = new Set(selectedRows.map((x) => x.id));
    const sourceIds = [...new Set(selectedRows.map((x) => String(x.data.sourceId || "")).filter(Boolean))];
    const sourceSnaps = await Promise.all(sourceIds.map((id) => userRef.collection("sources").doc(id).get()));
    const sourceMap = new Map();
    sourceSnaps.forEach((snap, i) => { if (snap.exists) sourceMap.set(sourceIds[i], snap.data() || {}); });
    const records = selectedRows.map((x) => betweenThoughtFullRecord(x.id, x.data, sourceMap.get(String(x.data.sourceId || "")) || null));
    const recordMap = new Map(records.map((x) => [x.id, x]));
    const ensured = await ensureBetweenThoughtProfiles(uid, userRef, records);
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
    const totalInputTokens = scout.inputTokens + deep.inputTokens;
    const totalCachedInputTokens = scout.cachedInputTokens + deep.cachedInputTokens;
    const totalOutputTokens = scout.outputTokens + deep.outputTokens;
    const usageRef = userRef.collection("aiUsage").doc(koreaDateKey());
    const batch = db.batch();
    batch.set(cacheRef, {
      threadId, signature, items: deep.paths, model: STUDIO_GARDENER_MODEL,
      selectedFragmentCount: selectedRows.length, totalFragmentCount: allRows.length,
      generatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(usageRef, {
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
    const betweenThoughtsProfileGenerations = Math.max(0, Number(data.betweenThoughtsProfileGenerations || 0));
    const betweenThoughtsProfileInputTokens = Math.max(0, Number(data.betweenThoughtsProfileInputTokens || 0));
    const betweenThoughtsProfileCachedInputTokens = Math.max(0, Number(data.betweenThoughtsProfileCachedInputTokens || 0));
    const betweenThoughtsProfileOutputTokens = Math.max(0, Number(data.betweenThoughtsProfileOutputTokens || 0));
    const betweenThoughtsCurationEstimatedCostUsd = studioEstimatedCostUsd(
      betweenThoughtsInputTokens,
      betweenThoughtsCachedInputTokens,
      betweenThoughtsOutputTokens
    );
    const betweenThoughtsProfileEstimatedCostUsd = studioEstimatedCostUsd(
      betweenThoughtsProfileInputTokens,
      betweenThoughtsProfileCachedInputTokens,
      betweenThoughtsProfileOutputTokens
    );
    const betweenThoughtsEstimatedCostUsd = betweenThoughtsCurationEstimatedCostUsd + betweenThoughtsProfileEstimatedCostUsd;

    const studioPathDiscoveries = Math.max(0, Number(data.studioPathDiscoveries || 0));
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
    const totalEstimatedCostUsd = gardenerEstimatedCostUsd + bloomingInterviewEstimatedCostUsd + betweenThoughtsEstimatedCostUsd + studioPathEstimatedCostUsd + embeddingEstimatedCostUsd;

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
      betweenThoughtsProfileGenerations,
      betweenThoughtsProfileInputTokens,
      betweenThoughtsProfileCachedInputTokens,
      betweenThoughtsProfileOutputTokens,
      betweenThoughtsCurationEstimatedCostUsd: Number(betweenThoughtsCurationEstimatedCostUsd.toFixed(8)),
      betweenThoughtsProfileEstimatedCostUsd: Number(betweenThoughtsProfileEstimatedCostUsd.toFixed(8)),
      betweenThoughtsEstimatedCostUsd: Number(betweenThoughtsEstimatedCostUsd.toFixed(8)),
      studioPathDiscoveries,
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
    secrets: ["OPENAI_ADMIN_KEY", "OPENAI_PROJECT_ID"],
    timeoutSeconds: 45,
    memory: "256MiB",
    maxInstances: 5,
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Google 로그인 후 사용할 수 있습니다.");
    }

    const projectId = String(process.env.OPENAI_PROJECT_ID || "").trim();
    if (!projectId) {
      throw new HttpsError(
        "failed-precondition",
        "OPENAI_PROJECT_ID 설정이 필요합니다."
      );
    }

    const r = utcRangeInfo();

    // Usage API는 현재 시각까지의 진행 중 사용량을 조회한다.
    const usageQuery = {
      start_time: r.monthStartSec,
      end_time: r.nowSec,
      bucket_width: "1d",
      limit: 31,
      project_ids: [projectId],
    };

    // Costs API의 1일 버킷은 [UTC 자정, 다음 UTC 자정) 범위다.
    // end_time을 현재 시각으로 보내면 진행 중인 오늘 버킷이 빠질 수 있으므로,
    // 비용 조회에만 다음 UTC 자정을 exclusive end_time으로 사용한다.
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
      officialUsageVersion: "v48-cost-query-fix",
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

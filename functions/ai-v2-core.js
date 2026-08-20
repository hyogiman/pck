"use strict";

/**
 * Thought Garden AI v2 foundation.
 *
 * Core principle:
 *   When the AI speaks, its output must be more useful than silence.
 *
 * This module is intentionally dependency-free so its deterministic gates can
 * be unit-tested without Firebase or OpenAI. Existing Firestore document fields
 * are not changed here; AI v2 additions must be additive for Diary MCP compatibility.
 */

const AI_V2_VERSION = 1;
const QUESTION_GATE_VERSION = 1;

const MODEL_ROUTES = Object.freeze({
  embedding: "text-embedding-3-small",
  index: "gpt-5.6-luna",
  discovery: "gpt-5.6-luna",
  speaking: "gpt-5.6-terra",
  speakingReasoningEffort: "medium"
});

const QUESTION_SCORE_FIELDS = Object.freeze([
  "grounded",
  "novel",
  "specific",
  "clear",
  "naturalKorean",
  "insightPotential",
  "nonLeading",
  "relevantNow"
]);

// These are not forbidden Korean expressions in general. They are warning
// signs when a model falls back to vague, reusable pseudo-insight language.
const GENERIC_QUESTION_PATTERNS = Object.freeze([
  /어떤 방식으로.{0,30}(붙잡|마주|품|이어가)/,
  /무엇을.{0,20}붙잡고 있/,
  /어떤 의미로.{0,20}남/,
  /어떤 긴장 속/,
  /무엇을 품고 있/,
  /어떤 마음을.{0,15}붙잡/,
  /어떻게 마주하고 있/
]);

function cleanText(value, max = 30000) {
  return typeof value === "string" ? value.slice(0, max).trim() : "";
}

function normalizeForMatch(value) {
  return cleanText(value, 50000)
    .normalize("NFKC")
    .replace(/[“”‘’'\"`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ko-KR");
}

function containsEvidence(source, evidence) {
  const src = normalizeForMatch(source);
  const ev = normalizeForMatch(evidence);
  if (!src || !ev || ev.length < 4) return false;
  return src.includes(ev);
}

function scoreValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return -1;
  return Math.max(0, Math.min(5, Math.round(n)));
}

function normalizeScores(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const scores = {};
  for (const key of QUESTION_SCORE_FIELDS) scores[key] = scoreValue(source[key]);
  return scores;
}

function isQuestionShapeNatural(question) {
  const q = cleanText(question, 500);
  if (q.length < 12 || q.length > 180) return false;
  const questionMarks = (q.match(/\?/g) || []).length;
  if (questionMarks > 1) return false;
  // A Korean question can omit '?', but model output for this feature should not
  // be an imperative or a paragraph pretending to be a question.
  return /[?？]$/.test(q) || /(까요|나요|인가요|했나요|였나요|일까요|일지|싶나요|보이나요|느껴지나요)$/.test(q);
}

function genericPatternHit(question, sourceTexts = []) {
  const q = cleanText(question, 500);
  const source = sourceTexts.map((x) => cleanText(x, 30000)).join("\n");
  for (const pattern of GENERIC_QUESTION_PATTERNS) {
    if (!pattern.test(q)) continue;
    // If the user literally used the same expression, do not mechanically ban it.
    const phrase = q.match(pattern)?.[0] || "";
    if (!phrase || !normalizeForMatch(source).includes(normalizeForMatch(phrase))) return true;
  }
  return false;
}

function scorePass(scores) {
  const s = normalizeScores(scores);
  if (s.grounded < 4 || s.naturalKorean < 4 || s.insightPotential < 4) return false;
  if (Object.values(s).some((x) => x < 0)) return false;
  const total = Object.values(s).reduce((a, b) => a + b, 0);
  // 8 dimensions * 5 = 40. 34 requires a consistently strong candidate rather
  // than one excellent dimension hiding several weak ones.
  return total >= 34;
}

function validateEvidenceByMode(candidate, sources, mode) {
  const evidence = candidate?.evidence && typeof candidate.evidence === "object" ? candidate.evidence : {};
  if (mode === "between") {
    return containsEvidence(sources?.a, evidence.a) && containsEvidence(sources?.b, evidence.b);
  }
  const merged = [sources?.primary, sources?.draft, ...(Array.isArray(sources?.materials) ? sources.materials : [])]
    .filter(Boolean)
    .join("\n");
  return containsEvidence(merged, evidence.primary || evidence.a || evidence.draft);
}

/**
 * Deterministic final guard. Model self-ratings are only one signal; the server
 * also verifies evidence text, question shape and generic-language fallbacks.
 */
function validateQuestionCandidate(candidate, { mode, sources } = {}) {
  const reasons = [];
  const question = cleanText(candidate?.question, 500);
  const scores = normalizeScores(candidate?.scores);

  if (!question) reasons.push("empty-question");
  if (question && !isQuestionShapeNatural(question)) reasons.push("unnatural-shape");
  if (question && genericPatternHit(question, Object.values(sources || {}).flat().filter((x) => typeof x === "string"))) {
    reasons.push("generic-language");
  }
  if (!validateEvidenceByMode(candidate, sources || {}, mode || "blooming")) reasons.push("ungrounded-evidence");
  if (!scorePass(scores)) reasons.push("quality-score");

  return {
    ok: reasons.length === 0,
    question,
    scores,
    reasons
  };
}

function selectBestQuestion(result, options = {}) {
  if (!result || result.decision !== "speak") {
    return { decision: "silent", reason: cleanText(result?.reason, 500) || "model-chose-silence" };
  }
  const candidates = Array.isArray(result.candidates) ? result.candidates.slice(0, 3) : [];
  const checked = candidates.map((candidate, index) => ({
    index,
    candidate,
    validation: validateQuestionCandidate(candidate, options)
  }));
  const passing = checked.filter((x) => x.validation.ok);
  if (!passing.length) {
    return {
      decision: "silent",
      reason: "question-gate-rejected-all",
      rejected: checked.map((x) => ({ index: x.index, reasons: x.validation.reasons }))
    };
  }
  passing.sort((a, b) => {
    const total = (x) => Object.values(x.validation.scores).reduce((sum, n) => sum + n, 0);
    return total(b) - total(a);
  });
  const best = passing[0];
  return {
    decision: "speak",
    question: best.validation.question,
    observation: cleanText(result.observation, 1200),
    mode: cleanText(best.candidate?.mode, 80),
    evidence: best.candidate?.evidence || {},
    scores: best.validation.scores,
    selectedIndex: best.index
  };
}

function questionGenerationPrinciples(mode) {
  const common = [
    "목표는 사용자가 이미 쓴 말을 다시 확인시키는 것이 아니라, 아직 쓰지 않은 생각을 하나 더 만들게 하는 것이다.",
    "사용자가 실제로 쓴 사건·장면·표현에 근거한다. 사용자가 쓰지 않은 심리·의도·사실을 만들어내지 않는다.",
    "실제 사람이 대화에서 묻는 것처럼 쉬운 한국어를 쓴다. 시적이고 추상적인 문어체로 깊어 보이려 하지 않는다.",
    "질문 하나에는 한 가지 중심만 둔다. 두세 질문을 접속사로 이어 붙이지 않는다.",
    "이미 원문 안에 답이 있는 질문, 아무 일기에나 붙일 수 있는 범용 질문, 조언을 질문처럼 포장한 문장은 탈락시킨다.",
    "후보를 세 개 만든 뒤 각각 비판적으로 평가한다. 충분히 좋은 후보가 없으면 decision='silent'를 선택한다.",
    "evidence에는 질문 근거가 된 사용자의 짧은 원문 표현을 그대로 복사한다. 서버가 실제 원문 포함 여부를 검증한다."
  ];
  if (mode === "between") {
    common.push(
      "두 생각이 모두 있어야만 만들어질 수 있는 질문이어야 한다. A 하나만 또는 B 하나만 보고도 만들 수 있는 질문은 버린다.",
      "observation에는 두 원문에서 직접 확인되는 연결만 1~2문장으로 적는다. 해석을 사용자의 진실처럼 선언하지 않는다.",
      "좋은 결과는 A와 B를 함께 보았을 때 제3의 생각 C가 생기게 한다. 단순 공통점·차이점 시험문제는 피한다."
    );
  } else if (mode === "gardener") {
    common.push(
      "정원사는 편집자에 한정되지 않는다. 우선순위는 연결을 통한 확장, 생각의 깊이 확장, 반대 방향의 도전, 필요할 때의 짧은 편집 제안이다.",
      "현재 초안이 짧다면 관련 과거 생각·Thread·출처 재료를 활용해 생각할 거리를 풍부하게 만든다.",
      "사용자가 직접 도움을 요청한 상황이므로 질문이 가장 유용하면 질문하고, 충분히 생각이 나온 뒤라면 짧은 제안이나 편집 방향을 선택할 수 있다."
    );
  } else {
    common.push(
      "Blooming은 질문할 만한 명확한 빈틈이 있을 때만 말한다. 글이 이미 충분히 닫혀 있거나 질문이 억지라면 silent가 정답이다.",
      "저장 직후 사용자를 붙잡을 만큼 가치 있는 질문인지 엄격하게 판단한다."
    );
  }
  return common;
}

function questionResultSchema(mode) {
  const evidenceProperties = mode === "between"
    ? { a: { type: "string" }, b: { type: "string" } }
    : { primary: { type: "string" } };
  const scoreProps = Object.fromEntries(QUESTION_SCORE_FIELDS.map((key) => [key, { type: "integer", minimum: 0, maximum: 5 }]));
  return {
    type: "object",
    properties: {
      decision: { type: "string", enum: ["speak", "silent"] },
      reason: { type: "string" },
      observation: { type: "string" },
      candidates: {
        type: "array",
        minItems: 0,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            mode: { type: "string" },
            question: { type: "string" },
            evidence: {
              type: "object",
              properties: evidenceProperties,
              required: Object.keys(evidenceProperties),
              additionalProperties: false
            },
            scores: {
              type: "object",
              properties: scoreProps,
              required: QUESTION_SCORE_FIELDS,
              additionalProperties: false
            }
          },
          required: ["mode", "question", "evidence", "scores"],
          additionalProperties: false
        }
      }
    },
    required: ["decision", "reason", "observation", "candidates"],
    additionalProperties: false
  };
}

module.exports = {
  AI_V2_VERSION,
  QUESTION_GATE_VERSION,
  MODEL_ROUTES,
  QUESTION_SCORE_FIELDS,
  cleanText,
  normalizeForMatch,
  containsEvidence,
  normalizeScores,
  validateQuestionCandidate,
  selectBestQuestion,
  questionGenerationPrinciples,
  questionResultSchema
};

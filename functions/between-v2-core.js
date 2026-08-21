"use strict";

/**
 * Thought Garden · Between Thoughts v2 foundation.
 *
 * Between Thoughts is valuable only when the pair itself is necessary. Merely
 * citing one phrase from A and one phrase from B is not enough: the question
 * must fail when essentially the same question could be asked from A alone or
 * B alone.
 */
const {
  QUESTION_SCORE_FIELDS,
  cleanText,
  validateQuestionCandidate,
  questionGenerationPrinciples
} = require("./ai-v2-core");

const BETWEEN_PAIR_GATE_VERSION = 1;
const BETWEEN_PAIR_MIN_SCORE = 4;

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return -1;
  return Math.max(0, Math.min(5, Math.round(n)));
}

function normalizePairCheck(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    requiresBoth: source.requiresBoth === true,
    worksFromAAlone: source.worksFromAAlone === true,
    worksFromBAlone: source.worksFromBAlone === true,
    createsThirdThought: source.createsThirdThought === true,
    pairNecessity: clampScore(source.pairNecessity),
    thirdThoughtPotential: clampScore(source.thirdThoughtPotential),
    reason: cleanText(source.reason, 700)
  };
}

function validatePairCheck(raw) {
  const pairCheck = normalizePairCheck(raw);
  const reasons = [];

  if (!pairCheck.requiresBoth) reasons.push("pair-not-required");
  if (pairCheck.worksFromAAlone) reasons.push("works-from-a-alone");
  if (pairCheck.worksFromBAlone) reasons.push("works-from-b-alone");
  if (!pairCheck.createsThirdThought) reasons.push("no-third-thought");
  if (pairCheck.pairNecessity < BETWEEN_PAIR_MIN_SCORE) reasons.push("low-pair-necessity");
  if (pairCheck.thirdThoughtPotential < BETWEEN_PAIR_MIN_SCORE) reasons.push("low-third-thought-potential");

  return { ok: reasons.length === 0, pairCheck, reasons };
}

/**
 * Optional second-pass ablation judge. This is intentionally separate from the
 * candidate's own pairCheck so the production preview can later ask another
 * model pass: "Would this question still work from A alone? From B alone?"
 */
function normalizePairJudge(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    requiresBoth: source.requiresBoth === true,
    worksFromAAlone: source.worksFromAAlone === true,
    worksFromBAlone: source.worksFromBAlone === true,
    createsThirdThought: source.createsThirdThought === true,
    pairNecessity: clampScore(source.pairNecessity),
    thirdThoughtPotential: clampScore(source.thirdThoughtPotential),
    reason: cleanText(source.reason, 900)
  };
}

function validatePairJudge(raw) {
  const judge = normalizePairJudge(raw);
  const reasons = [];
  if (!judge.requiresBoth) reasons.push("judge-pair-not-required");
  if (judge.worksFromAAlone) reasons.push("judge-works-from-a-alone");
  if (judge.worksFromBAlone) reasons.push("judge-works-from-b-alone");
  if (!judge.createsThirdThought) reasons.push("judge-no-third-thought");
  if (judge.pairNecessity < BETWEEN_PAIR_MIN_SCORE) reasons.push("judge-low-pair-necessity");
  if (judge.thirdThoughtPotential < BETWEEN_PAIR_MIN_SCORE) reasons.push("judge-low-third-thought-potential");
  return { ok: reasons.length === 0, judge, reasons };
}

function validateBetweenCandidate(candidate, sources, pairJudge = null) {
  const base = validateQuestionCandidate(candidate, { mode: "between", sources });
  const pair = validatePairCheck(candidate?.pairCheck);
  const judge = pairJudge == null ? null : validatePairJudge(pairJudge);
  const reasons = [
    ...base.reasons,
    ...pair.reasons,
    ...(judge ? judge.reasons : [])
  ];

  return {
    ok: reasons.length === 0,
    question: base.question,
    scores: base.scores,
    pairCheck: pair.pairCheck,
    pairJudge: judge?.judge || null,
    reasons
  };
}

function scoreTotal(validation) {
  const questionTotal = Object.values(validation?.scores || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const pair = validation?.pairCheck || {};
  const judge = validation?.pairJudge || null;
  const generatorPairTotal = (Number(pair.pairNecessity) || 0) + (Number(pair.thirdThoughtPotential) || 0);
  const judgePairTotal = judge
    ? (Number(judge.pairNecessity) || 0) + (Number(judge.thirdThoughtPotential) || 0)
    : 0;
  // The independent ablation judge is not only a veto. Once candidates pass,
  // its pair-strength assessment should also help choose the strongest one.
  return questionTotal + generatorPairTotal + judgePairTotal;
}

function selectBestBetweenQuestion(result, { sources, pairJudges } = {}) {
  if (!result || result.decision !== "speak") {
    return {
      decision: "silent",
      reason: cleanText(result?.reason, 500) || "model-chose-silence"
    };
  }

  const candidates = Array.isArray(result.candidates) ? result.candidates.slice(0, 3) : [];
  const checked = candidates.map((candidate, index) => ({
    index,
    candidate,
    validation: validateBetweenCandidate(candidate, sources || {}, pairJudges?.[index] ?? null)
  }));
  const passing = checked.filter((row) => row.validation.ok);
  if (!passing.length) {
    return {
      decision: "silent",
      reason: "between-pair-gate-rejected-all",
      observation: cleanText(result.observation, 1200),
      rejected: checked.map((row) => ({ index: row.index, reasons: row.validation.reasons }))
    };
  }

  passing.sort((a, b) => scoreTotal(b.validation) - scoreTotal(a.validation));
  const best = passing[0];
  return {
    decision: "speak",
    question: best.validation.question,
    observation: cleanText(result.observation, 1200),
    mode: cleanText(best.candidate?.mode, 80),
    evidence: best.candidate?.evidence || {},
    scores: best.validation.scores,
    pairCheck: best.validation.pairCheck,
    pairJudge: best.validation.pairJudge,
    selectedIndex: best.index
  };
}

function betweenQuestionGenerationPrinciples() {
  return [
    ...questionGenerationPrinciples("between"),
    "각 질문 후보에는 pairCheck를 작성한다.",
    "pairCheck.requiresBoth는 A와 B를 둘 다 읽어야 질문의 중심이 성립할 때만 true다.",
    "먼저 A만 남기고 B를 가렸다고 상상한다. 거의 같은 질문을 자연스럽게 만들 수 있으면 worksFromAAlone=true이고 그 후보는 실패다.",
    "다음으로 B만 남기고 A를 가렸다고 상상한다. 거의 같은 질문을 자연스럽게 만들 수 있으면 worksFromBAlone=true이고 그 후보는 실패다.",
    "두 원문의 공통 단어를 단순히 한 문장에 함께 넣었다고 requiresBoth가 되는 것은 아니다.",
    "createsThirdThought는 A의 반복도 B의 반복도 아닌 제3의 관점·기준·긴장·통합을 실제로 열 때만 true다.",
    "A를 B를 해석하는 도구로 쓰거나 B를 A의 해결책·기준으로 단순 적용하지 않는다. 두 기록이 동등하게 질문의 중심을 바꾸어야 한다.",
    "질문에 A와 B가 모두 언급되어도, 실제 답이 한쪽 기록 안의 기준·이유·선택만 설명하면 다른 쪽은 장식이다. 좋은 Between 질문의 답은 A와 B 사이의 차이·변화·긴장·관계 자체를 설명하거나 새롭게 정의해야 한다.",
    "특히 서로 다른 상황에서 선택·감정·행동이 달라지는 쌍이라면 한 상황 내부의 기준만 묻지 않는다. A에서는 X였는데 B에서는 Y가 된 변화 자체, 두 상황 사이에서 무엇이 달라졌는지, 또는 그 차이를 가르는 조건을 원문 범위 안에서 묻는다.",
    "'두 기록을 함께 보면', '어떻게 함께 판단할 수 있을까요', '어떤 기준이 될 수 있을까'처럼 연결 행위 자체를 설명하는 메타 문구보다 사용자의 실제 장면·선택·가치가 바로 충돌하거나 이어지는 질문을 우선한다.",
    "두 기록의 차이가 상황에 따라 달라지는 선택·감정·행동이라면 사물의 조건을 묻는 데 그치지 말고, 그 상황에서 사용자의 기준이 무엇 때문에 달라지는지를 탐색한다.",
    "질문을 읽었을 때 사용자가 '왜 이 두 기록을 같이 보여줬는지'를 설명 없이 느낄 수 있어야 한다. 연결 설명이 빠지면 성립하지 않는 질문은 약한 질문이다.",
    "중요: 둘을 억지로 연결하기 위해 원문에 없는 새 목표나 의무를 만들지 않는다. 예를 들어 한 감정이 다른 감정을 '바꾸지 않게 해야 한다', 둘을 '구분해둘 필요가 있다', 한쪽을 '지켜야 한다' 같은 관리·보존 과제를 사용자가 말하지 않았다면 질문의 전제로 발명하지 않는다. 이런 연결은 createsThirdThought가 아니다.",
    "pairNecessity와 thirdThoughtPotential은 엄격하게 채점한다. 둘 중 하나라도 4점 미만이면 후보로 내지 않는 편이 낫다."
  ];
}

function pairCheckSchema() {
  return {
    type: "object",
    properties: {
      requiresBoth: { type: "boolean" },
      worksFromAAlone: { type: "boolean" },
      worksFromBAlone: { type: "boolean" },
      createsThirdThought: { type: "boolean" },
      pairNecessity: { type: "integer", minimum: 0, maximum: 5 },
      thirdThoughtPotential: { type: "integer", minimum: 0, maximum: 5 },
      reason: { type: "string" }
    },
    required: [
      "requiresBoth",
      "worksFromAAlone",
      "worksFromBAlone",
      "createsThirdThought",
      "pairNecessity",
      "thirdThoughtPotential",
      "reason"
    ],
    additionalProperties: false
  };
}

function betweenQuestionResultSchema() {
  const scoreProps = Object.fromEntries(QUESTION_SCORE_FIELDS.map((key) => [
    key,
    { type: "integer", minimum: 0, maximum: 5 }
  ]));
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
              properties: { a: { type: "string" }, b: { type: "string" } },
              required: ["a", "b"],
              additionalProperties: false
            },
            scores: {
              type: "object",
              properties: scoreProps,
              required: QUESTION_SCORE_FIELDS,
              additionalProperties: false
            },
            pairCheck: pairCheckSchema()
          },
          required: ["mode", "question", "evidence", "scores", "pairCheck"],
          additionalProperties: false
        }
      }
    },
    required: ["decision", "reason", "observation", "candidates"],
    additionalProperties: false
  };
}

function betweenPairJudgeSchema() {
  return pairCheckSchema();
}

module.exports = {
  BETWEEN_PAIR_GATE_VERSION,
  BETWEEN_PAIR_MIN_SCORE,
  normalizePairCheck,
  validatePairCheck,
  normalizePairJudge,
  validatePairJudge,
  validateBetweenCandidate,
  selectBestBetweenQuestion,
  betweenQuestionGenerationPrinciples,
  betweenQuestionResultSchema,
  betweenPairJudgeSchema
};

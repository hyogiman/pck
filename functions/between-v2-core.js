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

// Shared by the generator and the independent judge. These are outcome
// criteria, not a request to reveal intermediate reasoning or invent motives.
function betweenInsightQualityPrinciples() {
  return [
    "깊이의 기준: 답하면서 두 기록에 함께 적용할 새 기준, 개념의 구분, 또는 기준이 달라지는 조건을 하나 발견할 수 있어야 한다. 두 글을 다시 요약하는 것만으로 답이 끝나면 thirdThoughtPotential은 2 이하이며 createsThirdThought=false다.",
    "질문은 원문의 구체적인 말·장면을 붙잡고, 아직 답하지 않은 한 지점만 연다. '왜 다를까요'나 '어떤 의미인가요'만 붙여 깊이를 대신하지 않는다. 문장이 짧아도 무엇을 새로 생각할지 바로 잡혀야 한다.",
    "원문에 실제 대비가 있으면 기준의 적용 범위나 예외를 살핀다. 대비가 없더라도 두 경험이 한 개념의 서로 다른 면을 드러내면 그 개념을 넓혀볼 수 있다. 매번 모순·갈등이나 양자택일을 만들 필요는 없다.",
    "새 해석은 사용자가 검토할 열린 가능성으로 다룬다. 특정 숨은 감정·동기를 정답으로 심거나 원문에 없는 관계를 '혹시'로 포장하지 않는다. 어려운 철학 용어, 추상적인 명사, 긴 문장 자체는 깊이의 근거가 아니다.",
    "thirdThoughtPotential 4~5점은 두 기록이 함께 있어야 열리는 새 기준·구분·조건이 질문에서 구체적으로 보일 때만 준다. 원문에 이미 적힌 이유를 다시 묻거나, 한쪽의 결론을 다른 쪽에 적용하라는 조언이면 2 이하로 준다."
  ];
}

function betweenQuestionGenerationPrinciples() {
  return [
    ...questionGenerationPrinciples("between"),
    ...betweenInsightQualityPrinciples(),
    "각 질문 후보에는 pairCheck를 작성한다.",
    "pairCheck.requiresBoth는 A와 B를 둘 다 읽어야 질문의 중심이 성립할 때만 true다.",
    "먼저 A만 남기고 B를 가렸다고 상상한다. 거의 같은 질문을 자연스럽게 만들 수 있으면 worksFromAAlone=true이고 그 후보는 실패다.",
    "다음으로 B만 남기고 A를 가렸다고 상상한다. 거의 같은 질문을 자연스럽게 만들 수 있으면 worksFromBAlone=true이고 그 후보는 실패다.",
    "두 원문의 공통 단어를 단순히 한 문장에 함께 넣었다고 requiresBoth가 되는 것은 아니다.",
    "createsThirdThought는 A의 반복도 B의 반복도 아닌 제3의 관점·기준·긴장·통합을 실제로 열 때만 true다.",
    "A를 B를 해석하는 도구로 쓰거나 B를 A의 해결책·기준으로 단순 적용하지 않는다. 두 기록이 동등하게 질문의 중심을 바꾸어야 한다.",
    "질문에 A와 B가 모두 언급되어도, 실제 답이 한쪽 기록 안의 기준·이유·선택만 설명하면 다른 쪽은 장식이다. 좋은 Between 질문의 답은 A와 B 사이의 차이·변화·긴장·관계 자체를 설명하거나 새롭게 정의해야 한다.",
    "특히 서로 다른 상황에서 선택·감정·행동이 달라지는 쌍이라면 한 상황 내부의 기준만 묻지 않는다. A에서는 X였는데 B에서는 Y가 된 변화 자체, 두 상황 사이에서 무엇이 달라졌는지, 또는 그 차이를 가르는 조건을 원문 범위 안에서 묻는다.",
    "두 기록을 잇는 관계 자체도 원문에 근거해야 한다. A와 B 각각에 사실이 하나씩 있다는 이유만으로 둘 사이의 인과·공통 맥락·같은 행동·같은 날·같은 범주를 새로 가정하지 않는다.",
    "'만약 ~라면', '~하는 날이 있다면' 같은 조건문으로 원문에 없는 연결 전제를 임시로 만든 뒤 질문을 성립시키지 않는다. 그 가정이 빠지면 두 기록의 관계가 사라지는 후보는 grounded하지 않은 억지 연결이므로 silent가 낫다.",
    "같은 사람·대상·맥락이 두 기록에서 서로 다른 효과나 감정을 만들었다면 한쪽의 개념만 확장하지 말고, 같은 대상이 왜 A에서는 X이고 B에서는 Y가 되었는지 그 차이·조건·의미의 변화를 질문 중심에 둔다. 단순 우선순위 경쟁으로 바꾸지 않는다.",
    "'두 기록을 함께 보면', '어떻게 함께 판단할 수 있을까요', '어떤 기준이 될 수 있을까'처럼 연결 행위 자체를 설명하는 메타 문구보다 사용자의 실제 장면·선택·가치가 바로 충돌하거나 이어지는 질문을 우선한다.",
    "두 기록의 차이가 상황에 따라 달라지는 선택·감정·행동이라면 사물의 조건을 묻는 데 그치지 말고, 그 상황에서 사용자의 기준이 무엇 때문에 달라지는지를 탐색한다.",
    "질문을 읽었을 때 사용자가 '왜 이 두 기록을 같이 보여줬는지'를 설명 없이 느낄 수 있어야 한다. 연결 설명이 빠지면 성립하지 않는 질문은 약한 질문이다.",
    "중요: 둘을 억지로 연결하기 위해 원문에 없는 새 목표나 의무를 만들지 않는다. 예를 들어 한 감정이 다른 감정을 '바꾸지 않게 해야 한다', 둘을 '구분해둘 필요가 있다', 한쪽을 '지켜야 한다' 같은 관리·보존 과제를 사용자가 말하지 않았다면 질문의 전제로 발명하지 않는다. 이런 연결은 createsThirdThought가 아니다.",
    "pairNecessity와 thirdThoughtPotential은 엄격하게 채점한다. 둘 중 하나라도 4점 미만이면 후보로 내지 않는 편이 낫다.",
    "후보가 둘 이상이면 같은 질문의 표현만 바꾸지 않는다. 원문이 허용할 때 서로 다른 생각의 방향을 검토하고, 하나만 유용하면 하나만 남긴다. 후보 수를 채우지 않는다.",
    "아래는 질문 수준을 보여주는 가상 예시이며 현재 사용자의 기록이 아니다. 예시의 문장·사건·결론을 현재 질문이나 evidence로 옮기지 말고, 현재 입력의 두 원문만 근거로 사용한다. 좋은 예시의 문장 틀도 기계적으로 반복하지 않는다.",
    "예시 1 — A: '혼자 공부할 때는 모르는 부분을 만나면 책을 덮곤 했다.' B: '스터디에서는 모르는 부분을 말하면 다음에 찾아볼 내용이 생겼다.' 약한 질문: '공부는 어떤 의미인가요?' 더 나은 질문: '스터디에서는 다음에 찾아볼 거리가 되는 모르는 부분이, 혼자일 때는 멈출 이유가 되는 차이는 어디서 생길까요?' 두 상황이 배움의 막힘을 다르게 만드는 조건을 열되, 성격이나 불안을 원인으로 정하지 않는다.",
    "예시 2 — A: '일기에는 그날 있었던 일을 빠짐없이 남기려고 한다.' B: '몇 달 전 일기를 다시 읽으니 사건의 순서보다 몇 줄에 남은 그날의 기분이 떠올랐다.' 약한 질문: '일기를 왜 쓰시나요?' 더 나은 질문: '빠짐없이 적는 것과 그날을 다시 떠올릴 수 있게 적는 것은, 어디까지 같은 일일까요?' 기록의 완전함과 다시 읽을 때의 가치를 함께 살펴보되 어느 쪽이 옳다고 정하지 않는다.",
    "예시 3 — A: '메모 앱의 글자 크기를 키웠다. 이제 읽기 편하다.' B: '저녁 산책 중에 본 노을이 예뻤다.' 결과: silent. 둘 다 '잘 보였다'는 식의 공통점을 새로 붙여 관찰력이나 삶의 태도를 캐묻지 않는다."
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
  betweenInsightQualityPrinciples,
  betweenQuestionGenerationPrinciples,
  betweenQuestionResultSchema,
  betweenPairJudgeSchema
};

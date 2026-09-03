"use strict";

const {
  QUESTION_SCORE_FIELDS,
  cleanText,
  normalizeForMatch,
  containsEvidence,
  validateQuestionCandidate
} = require("./ai-v2-core");

const STUDIO_GARDENER_V2_VERSION = 1;

const STUDIO_ACTION_MODES = Object.freeze([
  "connect",
  "deepen",
  "challenge",
  "edit"
]);

const STUDIO_PLAN_SCORE_FIELDS = Object.freeze([
  "grounded",
  "novel",
  "addsValue",
  "contextFit",
  "thinkingDeveloped"
]);

const STUDIO_EDIT_SCORE_FIELDS = Object.freeze([
  "grounded",
  "specific",
  "clear",
  "naturalKorean",
  "addsValue",
  "preservesVoice",
  "relevantNow"
]);

function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return -1;
  return Math.max(0, Math.min(5, Math.round(n)));
}

function scoreMap(raw, fields) {
  const source = raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(fields.map((key) => [key, clampScore(source[key])]));
}

function authoredStudioText(context = {}) {
  const previous = Array.isArray(context.previousSlots)
    ? context.previousSlots.map((slot) => cleanText(slot?.text, 6000))
    : [];

  return [
    cleanText(context.projectTitle, 600),
    ...previous,
    cleanText(context.currentDraft, 8000)
  ].filter(Boolean).join("\n\n");
}

function materialText(material) {
  if (!material || typeof material !== "object") return "";
  return [
    cleanText(material.text, 12000),
    cleanText(material.thought, 8000),
    cleanText(material.context, 3000),
    cleanText(material.sourceExcerpt, 3000),
    cleanText(material.excerpt, 3000)
  ].filter(Boolean).join("\n");
}

function materialById(context, id) {
  const wanted = String(id || "");
  return (Array.isArray(context?.materials) ? context.materials : [])
    .find((row) => String(row?.id || row?.fragmentId || "") === wanted) || null;
}

function normalizeStudioPlan(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const decision = source.decision === "act" ? "act" : "silent";
  const mode = decision === "silent"
    ? "silent"
    : cleanText(source.mode, 40);

  return {
    decision,
    mode,
    reason: cleanText(source.reason, 800),
    primaryEvidence: cleanText(source.primaryEvidence, 800),
    materialId: cleanText(source.materialId, 220),
    materialEvidence: cleanText(source.materialEvidence, 800),
    scores: scoreMap(source.scores, STUDIO_PLAN_SCORE_FIELDS)
  };
}

function validateStudioPlan(raw, context = {}) {
  const plan = normalizeStudioPlan(raw);
  const reasons = [];

  if (plan.decision === "silent") {
    return {
      ok: true,
      plan: { ...plan, mode: "silent" },
      reasons
    };
  }

  if (!STUDIO_ACTION_MODES.includes(plan.mode)) {
    reasons.push("invalid-mode");
  }

  const authored = authoredStudioText(context);
  if (!plan.primaryEvidence || !containsEvidence(authored, plan.primaryEvidence)) {
    reasons.push("ungrounded-primary-evidence");
  }

  for (const field of ["grounded", "novel", "addsValue", "contextFit"]) {
    if (plan.scores[field] < 4) reasons.push(`low-${field}`);
  }

  if (plan.mode === "edit" && plan.scores.thinkingDeveloped < 4) {
    reasons.push("edit-before-thinking-developed");
  }

  if (plan.mode === "connect") {
    const material = materialById(context, plan.materialId);
    if (!material) {
      reasons.push("connect-material-missing");
    } else if (
      !plan.materialEvidence ||
      !containsEvidence(materialText(material), plan.materialEvidence)
    ) {
      reasons.push("ungrounded-material-evidence");
    }
  }

  return { ok: reasons.length === 0, plan, reasons };
}

function selectStudioPlan(raw, context = {}) {
  const checked = validateStudioPlan(raw, context);

  if (!checked.ok) {
    return {
      decision: "silent",
      mode: "silent",
      reason: "studio-plan-gate-rejected",
      rejectedReasons: checked.reasons
    };
  }

  if (checked.plan.decision === "silent") {
    return {
      decision: "silent",
      mode: "silent",
      reason: checked.plan.reason || "planner-chose-silence"
    };
  }

  return checked.plan;
}

function repeatedQuestion(question, context = {}) {
  const current = normalizeForMatch(question);
  if (!current) return false;

  const prior = [
    ...(Array.isArray(context.previousGardenerQuestions)
      ? context.previousGardenerQuestions
      : []),
    ...(Array.isArray(context.previousSlots)
      ? context.previousSlots.map((slot) => slot?.gardenerQuestion)
      : [])
  ].filter(Boolean);

  return prior.some((value) => {
    const old = normalizeForMatch(value);
    if (!old) return false;
    if (old === current) return true;
    if (Math.min(old.length, current.length) < 20) return false;
    return old.includes(current) || current.includes(old);
  });
}

function studioQuestionSources(context = {}) {
  return {
    primary: authoredStudioText(context),
    draft: cleanText(context.currentDraft, 8000),
    materials: (Array.isArray(context.materials) ? context.materials : [])
      .map(materialText)
      .filter(Boolean)
  };
}

function validateStudioQuestionCandidate(
  candidate,
  { context = {}, mode = "deepen", selectedMaterialId = "" } = {}
) {
  const base = validateQuestionCandidate(candidate, {
    mode: "studio",
    sources: studioQuestionSources(context)
  });

  const reasons = [...base.reasons];

  const primaryEvidence =
    cleanText(
      candidate?.evidence?.primary,
      800
    );

  if (
    !primaryEvidence ||
    !containsEvidence(
      authoredStudioText(context),
      primaryEvidence
    )
  ) {
    reasons.push(
      "ungrounded-primary-evidence"
    );
  }

  if (!["connect", "deepen", "challenge"].includes(mode)) {
    reasons.push("invalid-question-mode");
  }

  if (base.question && repeatedQuestion(base.question, context)) {
    reasons.push("repeated-question");
  }

  if (mode === "connect") {
    const evidence = candidate?.evidence || {};
    const materialId = cleanText(evidence.materialId, 220);
    const expectedId = cleanText(selectedMaterialId, 220);

    if (!materialId || (expectedId && materialId !== expectedId)) {
      reasons.push("connect-material-id-mismatch");
    }

    const material = materialById(context, materialId);
    if (!material) {
      reasons.push("connect-material-missing");
    } else if (
      !cleanText(evidence.material, 800) ||
      !containsEvidence(materialText(material), evidence.material)
    ) {
      reasons.push("ungrounded-material-evidence");
    }
  }

  return {
    ok: reasons.length === 0,
    question: base.question,
    scores: base.scores,
    reasons
  };
}

function validateStudioEditCandidate(candidate, context = {}) {
  const suggestion = cleanText(candidate?.suggestion, 500);
  const evidence = cleanText(candidate?.evidence?.primary, 800);
  const scores = scoreMap(candidate?.scores, STUDIO_EDIT_SCORE_FIELDS);
  const reasons = [];

  if (suggestion.length < 12 || suggestion.length > 220) {
    reasons.push("bad-edit-shape");
  }

  if (!evidence || !containsEvidence(authoredStudioText(context), evidence)) {
    reasons.push("ungrounded-edit-evidence");
  }

  for (const field of STUDIO_EDIT_SCORE_FIELDS) {
    if (scores[field] < 4) reasons.push(`low-${field}`);
  }

  return {
    ok: reasons.length === 0,
    suggestion,
    scores,
    reasons
  };
}

module.exports = {
  STUDIO_GARDENER_V2_VERSION,
  STUDIO_ACTION_MODES,
  STUDIO_PLAN_SCORE_FIELDS,
  STUDIO_EDIT_SCORE_FIELDS,
  authoredStudioText,
  materialText,
  normalizeStudioPlan,
  validateStudioPlan,
  selectStudioPlan,
  repeatedQuestion,
  studioQuestionSources,
  validateStudioQuestionCandidate,
  validateStudioEditCandidate
};
/* Thought Garden · AI v2 mobile quality lab
 * Loads with ?ai-v2-test=1, or automatically on localhost/127.0.0.1 for the
 * private development lab. No test result is written to Firestore.
 */
(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const localLab = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (params.get("ai-v2-test") !== "1" && !localLab) return;

  // The spontaneous Blooming runtime checks this before starting. Test mode
  // must never create/claim/show a real Blooming artifact while we are judging
  // dry-run output.
  window.__THOUGHT_GARDEN_AI_V2_TEST__ = true;

  const SCORE_LABELS = {
    grounded: "원문 근거",
    novel: "새로움",
    specific: "구체성",
    clear: "명확성",
    naturalKorean: "자연스러운 한국어",
    insightPotential: "생각 확장 가능성",
    addsValue: "침묵보다 더할 가치",
    nonLeading: "넘겨짚지 않음",
    relevantNow: "지금 물을 가치"
  };

  const REASON_LABELS = {
    "model-chose-silence": "AI가 질문하지 않는 편이 낫다고 판단함",
    "question-gate-rejected-all": "후보 질문이 모두 품질 기준을 통과하지 못함",
    "empty-or-invalid-model-output": "모델의 구조화 응답이 유효하지 않음",
    "not-enough-context": "질문을 만들 만큼 내용이 충분하지 않음",
    "no-eligible-fragment": "자동 Blooming 후보가 없음",
    "scout-found-no-strong-candidate": "과거 생각 중 다시 꺼낼 만큼 강한 후보를 찾지 못함",
    "scout-returned-unknown-fragment": "선별 결과가 현재 후보와 맞지 않음"
  };

  function e(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function excerpt(value, n = 150) {
    const text = String(value || "").trim().replace(/\s+/g, " ");
    return text.length > n ? `${text.slice(0, n)}…` : text;
  }

  function dateKey(fragment) {
    return String(fragment?.date || fragment?.createdAt || fragment?.updatedAt || "").slice(0, 10);
  }

  function allTestFragments() {
    try {
      const rows = Array.isArray(state?.fragments) ? state.fragments : [];
      return rows
        .filter((f) => f && !f.deletedAt && !f.deleted_at && String(f.thought || f.text || "").trim().length >= 4)
        .sort((a, b) => String(b.createdAt || b.date || "").localeCompare(String(a.createdAt || a.date || "")))
        .slice(0, 80);
    } catch (_) { return []; }
  }

  function connectedForTest() {
    try {
      return !!(state?.firebase?.connected && state.firebase.user && !state.firebase.user.isAnonymous && state.firebase.functions);
    } catch (_) { return false; }
  }

  function installStyle() {
    const style = document.createElement("style");
    style.id = "aiV2TestStyle";
    style.textContent = `
      #aiV2Lab{position:fixed;inset:0;z-index:100000;background:#f3f1e8;color:#25291f;overflow:auto;font-family:var(--sans,system-ui,sans-serif)}
      #aiV2Lab *{box-sizing:border-box}
      .aiv2-wrap{width:min(100%,820px);margin:0 auto;padding:calc(18px + env(safe-area-inset-top)) 15px calc(40px + env(safe-area-inset-bottom))}
      .aiv2-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:18px}
      .aiv2-kicker{font-size:.68rem;letter-spacing:.12em;font-weight:800;color:#375f47}
      .aiv2-head h1{font-size:1.3rem;margin:5px 0 4px;font-weight:700}
      .aiv2-head p{font-size:.78rem;color:#777b70;margin:0;line-height:1.5}
      .aiv2-close{border:1px solid #ddd8c9;background:#fdfcf7;border-radius:999px;padding:8px 12px;font-weight:700;white-space:nowrap}
      .aiv2-card{background:#fdfcf7;border:1px solid #e3dfd0;border-radius:18px;padding:16px;margin:12px 0;box-shadow:0 2px 10px rgba(40,44,32,.05)}
      .aiv2-card h2{font-size:1rem;margin:0 0 8px}
      .aiv2-help{font-size:.76rem;line-height:1.55;color:#777b70;margin:0 0 12px}
      .aiv2-select{width:100%;padding:11px 12px;border:1px solid #ddd8c9;border-radius:12px;background:#fff;font:inherit}
      .aiv2-source{margin-top:11px;padding:13px;border-radius:13px;background:#eef4ee;font-family:var(--serif,serif);font-size:.9rem;line-height:1.65;white-space:pre-wrap}
      .aiv2-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
      .aiv2-btn{border:1px solid #d3e2d5;background:#e5efe4;color:#375f47;border-radius:12px;padding:11px 10px;font-weight:800;font-size:.8rem}
      .aiv2-btn.primary{background:#375f47;color:#fff;border-color:#375f47}
      .aiv2-btn:disabled{opacity:.45}
      .aiv2-status{padding:11px 12px;border-radius:12px;background:#ece9dd;font-size:.8rem;line-height:1.5}
      .aiv2-status.good{background:#e5efe4;color:#2c5039}.aiv2-status.silent{background:#f0eee7;color:#67695f}.aiv2-status.bad{background:#fbefed;color:#8d433c}
      .aiv2-label{font-size:.68rem;font-weight:800;letter-spacing:.06em;color:#777b70;margin:15px 0 6px}
      .aiv2-question{font-family:var(--serif,serif);font-size:1.08rem;line-height:1.65;padding:14px;background:#eef4ee;border-radius:14px;color:#2c4a38}
      .aiv2-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
      .aiv2-score{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;background:#f3f1e8;border-radius:10px;font-size:.74rem}.aiv2-score b{color:#375f47}
      .aiv2-meta{font-size:.74rem;line-height:1.55;color:#686b61;background:#f7f5ef;border-radius:11px;padding:10px 11px;white-space:pre-wrap}
      .aiv2-candidates{display:grid;gap:7px}.aiv2-candidate{border-left:3px solid #d3e2d5;padding:8px 10px;background:#f7f5ef;font-size:.75rem;line-height:1.5}.aiv2-candidate strong{display:block;margin-bottom:3px}
      .aiv2-evals{display:grid;gap:9px;margin-top:10px}.aiv2-eval{border:1px solid #e3dfd0;border-radius:12px;padding:11px;background:#f7f5ef;font-size:.75rem;line-height:1.5}.aiv2-eval.pass{border-color:#bfd4c3;background:#edf5ed}.aiv2-eval.fail{border-color:#e8c7c2;background:#fbefed}.aiv2-eval-head{display:flex;justify-content:space-between;gap:8px;font-weight:800;margin-bottom:5px}.aiv2-eval-q{margin-top:7px;padding:8px 9px;border-radius:9px;background:#fff;font-family:var(--serif,serif);font-size:.82rem;line-height:1.55}
      .aiv2-raw{margin-top:12px}.aiv2-raw summary{font-size:.75rem;color:#777b70;cursor:pointer}.aiv2-raw pre{font-size:.68rem;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;background:#22251f;color:#f1f0e9;border-radius:12px;padding:12px;overflow:auto}
      @media(max-width:540px){.aiv2-actions,.aiv2-grid{grid-template-columns:1fr}.aiv2-head{align-items:center}}
    `;
    document.head.appendChild(style);
  }

  function closeLab() {
    if (localLab) {
      document.getElementById("aiV2Lab")?.remove();
      document.getElementById("aiV2TestStyle")?.remove();
      return;
    }
    const url = new URL(location.href);
    url.searchParams.delete("ai-v2-test");
    location.href = url.toString();
  }

  function installLab() {
    if (document.getElementById("aiV2Lab")) return;
    installStyle();
    const root = document.createElement("div");
    root.id = "aiV2Lab";
    root.innerHTML = `
      <main class="aiv2-wrap">
        <div class="aiv2-head">
          <div><div class="aiv2-kicker">THOUGHT GARDEN · PRIVATE TEST LAB</div><h1>🌱 AI v2 질문 품질 테스트</h1><p>실제 기록을 읽는 시험도 있지만 테스트 결과는 저장하지 않습니다.</p></div>
          <button class="aiv2-close" id="aiV2Close" type="button">테스트 종료</button>
        </div>
        <section class="aiv2-card">
          <h2>0. 가상 표준시험</h2>
          <p class="aiv2-help">실제 내 기록을 보기 전에, 미리 만든 가상 기록으로 “말해야 할 때와 침묵해야 할 때”를 제대로 구분하는지 시험합니다. 저장되는 데이터는 없습니다.</p>
          <div class="aiv2-actions"><button class="aiv2-btn primary" id="aiV2SyntheticSmoke" type="button">빠른 표준시험 6개</button><button class="aiv2-btn" id="aiV2SyntheticFull" type="button">전체 표준시험 12개</button></div>
        </section>
        <section class="aiv2-card">
          <h2>1. 특정 생각으로 질문 시험</h2>
          <p class="aiv2-help">내가 직접 기록 하나를 고릅니다. Terra가 질문할 가치가 있는지 판단하고, Question Gate를 통과한 경우에만 질문을 보여줍니다.</p>
          <select class="aiv2-select" id="aiV2FragmentSelect"></select>
          <div class="aiv2-source" id="aiV2SelectedSource">기록을 불러오는 중…</div>
          <div class="aiv2-actions"><button class="aiv2-btn primary" id="aiV2ManualRun" type="button">선택한 생각 시험하기</button><button class="aiv2-btn" id="aiV2Refresh" type="button">최근 기록 다시 불러오기</button></div>
        </section>
        <section class="aiv2-card">
          <h2>2. 실제 Blooming처럼 자동 선별 시험</h2>
          <p class="aiv2-help">Luna가 과거 생각 후보를 고르고 Terra가 질문까지 만듭니다. 이 dry-run은 실제 Blooming 대기열·빈도·노출기록을 변경하지 않습니다.</p>
          <button class="aiv2-btn primary" style="width:100%" id="aiV2AutoRun" type="button">자동 Blooming 한 번 시험하기</button>
        </section>
        <section class="aiv2-card" id="aiV2ResultCard">
          <h2>결과</h2>
          <div id="aiV2Result"><div class="aiv2-status">아직 시험하지 않았어요.</div></div>
        </section>
      </main>`;
    document.body.appendChild(root);
    document.getElementById("aiV2Close").onclick = closeLab;
    document.getElementById("aiV2Refresh").onclick = renderFragmentSelect;
    document.getElementById("aiV2FragmentSelect").onchange = renderSelectedSource;
    document.getElementById("aiV2ManualRun").onclick = runManual;
    document.getElementById("aiV2AutoRun").onclick = runAuto;
    document.getElementById("aiV2SyntheticSmoke").onclick = () => runSynthetic("smoke");
    document.getElementById("aiV2SyntheticFull").onclick = () => runSynthetic("full");
    renderFragmentSelect();
  }

  function renderFragmentSelect() {
    const select = document.getElementById("aiV2FragmentSelect");
    if (!select) return;
    const rows = allTestFragments();
    const previous = select.value;
    select.innerHTML = rows.map((f) => `<option value="${e(f.id)}">${e(dateKey(f) || "날짜 없음")} · ${e(excerpt(f.thought || f.text, 54))}</option>`).join("");
    if (previous && rows.some((f) => f.id === previous)) select.value = previous;
    renderSelectedSource();
  }

  function selectedFragment() {
    const id = document.getElementById("aiV2FragmentSelect")?.value;
    return allTestFragments().find((f) => f.id === id) || null;
  }

  function renderSelectedSource() {
    const f = selectedFragment();
    const box = document.getElementById("aiV2SelectedSource");
    if (!box) return;
    box.textContent = f ? String(f.thought || f.text || "") : "선택할 수 있는 생각이 없습니다.";
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
    button.disabled = !!busy;
    button.textContent = busy ? label : button.dataset.originalLabel;
  }

  function scoresHtml(scores) {
    if (!scores || typeof scores !== "object") return "";
    return `<div class="aiv2-label">QUESTION GATE</div><div class="aiv2-grid">${Object.entries(SCORE_LABELS).map(([key, label]) => `<div class="aiv2-score"><span>${e(label)}</span><b>${e(scores[key] ?? "-")} / 5</b></div>`).join("")}</div>`;
  }

  function usageText(data) {
    const chunks = [];
    const add = (name, usage) => {
      if (!usage) return;
      chunks.push(`${name}: 입력 ${Number(usage.inputTokens || 0).toLocaleString()} · 출력 ${Number(usage.outputTokens || 0).toLocaleString()} · reasoning ${Number(usage.reasoningTokens || 0).toLocaleString()}`);
    };
    add("질문", data?.usage || data?.finalUsage);
    if (data?.scoutUsage) add("후보 선별", data.scoutUsage);
    return chunks.join("\n");
  }

  function candidatesHtml(candidates) {
    if (!Array.isArray(candidates) || !candidates.length) return "";
    return `<div class="aiv2-label">LUNA가 검토한 상위 후보</div><div class="aiv2-candidates">${candidates.slice(0, 12).map((c) => `<div class="aiv2-candidate"><strong>${e(c.date || "날짜 없음")} · 사전점수 ${e(c.heuristicScore ?? "-")}</strong>${e(c.excerpt || "")}</div>`).join("")}</div>`;
  }

  function renderResult(data, kind) {
    const box = document.getElementById("aiV2Result");
    if (!box) return;
    const speaks = data?.shouldInterrupt === true || data?.status === "speak";
    const silent = data?.shouldInterrupt === false || data?.status === "silent" || data?.status === "none";
    const statusClass = speaks ? "good" : silent ? "silent" : "bad";
    const statusTitle = speaks ? "✅ 질문할 가치가 있다고 판단" : silent ? "🤫 이번에는 질문하지 않음" : `상태: ${data?.status || "알 수 없음"}`;
    const reason = data?.reason ? (REASON_LABELS[data.reason] || data.reason) : "";
    const selected = data?.selectedFragment;
    const scout = data?.scout;
    const question = data?.question;
    const evidence = data?.evidence;
    const usage = usageText(data);

    box.innerHTML = `
      <div class="aiv2-status ${statusClass}"><strong>${e(statusTitle)}</strong>${reason ? `<br>${e(reason)}` : ""}</div>
      ${kind === "auto" && selected ? `<div class="aiv2-label">자동으로 선택한 과거 생각</div><div class="aiv2-source">${e(selected.thought || "")}</div>` : ""}
      ${scout ? `<div class="aiv2-label">LUNA의 선택 근거</div><div class="aiv2-meta">신뢰도 ${e(scout.confidence ?? "-")} / 100\n성장 가능 지점: ${e(scout.growthEdge || "-")}\n선택 이유: ${e(scout.reason || "-")}</div>` : ""}
      ${question ? `<div class="aiv2-label">최종 질문</div><div class="aiv2-question">${e(question)}</div>` : ""}
      ${evidence ? `<div class="aiv2-label">원문 근거</div><div class="aiv2-meta">${e(JSON.stringify(evidence, null, 2))}</div>` : ""}
      ${scoresHtml(data?.scores)}
      ${usage ? `<div class="aiv2-label">토큰 사용량</div><div class="aiv2-meta">${e(usage)}</div>` : ""}
      ${kind === "auto" ? candidatesHtml(data?.candidates) : ""}
      <details class="aiv2-raw"><summary>원본 테스트 결과 JSON 보기</summary><pre>${e(JSON.stringify(data, null, 2))}</pre></details>`;
    document.getElementById("aiV2ResultCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderSyntheticResult(data) {
    const box = document.getElementById("aiV2Result");
    if (!box) return;
    const summary = data?.summary || {};
    const allPass = !!summary.allDecisionChecksPassed;
    const resultRows = Array.isArray(data?.results) ? data.results : [];
    const usage = usageText(data);
    box.innerHTML = `
      <div class="aiv2-status ${allPass ? "good" : "bad"}"><strong>${allPass ? "✅ 표준 판단시험 통과" : "⚠️ 표준 판단시험에서 실패 사례가 있음"}</strong><br>${e(summary.pass ?? 0)} / ${e(summary.total ?? 0)} 통과 · 말해야 할 사례 ${e(summary.speakPass ?? 0)}/${e(summary.speakTotal ?? 0)} · 침묵해야 할 사례 ${e(summary.silentPass ?? 0)}/${e(summary.silentTotal ?? 0)}</div>
      <div class="aiv2-label">가상 사례별 결과</div>
      <div class="aiv2-evals">${resultRows.map((row) => `<div class="aiv2-eval ${row.decisionPass ? "pass" : "fail"}"><div class="aiv2-eval-head"><span>${row.decisionPass ? "PASS" : "FAIL"} · ${e(row.label || row.id)}</span><span>${e(row.expectedDecision)} → ${e(row.actualDecision)}</span></div><div>${e(row.thought || "")}</div>${row.question ? `<div class="aiv2-eval-q">${e(row.question)}</div>` : ""}<div style="margin-top:6px;color:#777b70">기대 이유: ${e(row.whyExpected || "-")}</div></div>`).join("")}</div>
      ${usage ? `<div class="aiv2-label">전체 토큰 사용량</div><div class="aiv2-meta">${e(usage)}</div>` : ""}
      <div class="aiv2-meta" style="margin-top:10px">${e(data?.note || "자동 판정이 통과해도 실제 질문 문장은 사람이 최종 검토합니다.")}</div>
      <details class="aiv2-raw"><summary>원본 표준시험 JSON 보기</summary><pre>${e(JSON.stringify(data, null, 2))}</pre></details>`;
    document.getElementById("aiV2ResultCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function runSynthetic(mode) {
    const smokeButton = document.getElementById("aiV2SyntheticSmoke");
    const fullButton = document.getElementById("aiV2SyntheticFull");
    const activeButton = mode === "full" ? fullButton : smokeButton;
    setBusy(activeButton, true, mode === "full" ? "12개 검사 중…" : "6개 검사 중…");
    if (smokeButton !== activeButton) smokeButton.disabled = true;
    if (fullButton !== activeButton) fullButton.disabled = true;
    document.getElementById("aiV2Result").innerHTML = `<div class="aiv2-status">가상 기록으로 Blooming이 말할 때와 침묵할 때를 구분하는지 검사 중이에요. 실제 텃밭 기록은 읽지 않습니다.</div>`;
    try {
      const data = await callFn("bloomingInterviewSyntheticEvalV2", { mode });
      renderSyntheticResult(data);
    } catch (error) {
      console.error(error);
      document.getElementById("aiV2Result").innerHTML = `<div class="aiv2-status bad">가상 표준시험 호출에 실패했어요.<br>${e(error?.message || error)}</div>`;
    } finally {
      setBusy(activeButton, false, "");
      if (smokeButton !== activeButton) smokeButton.disabled = false;
      if (fullButton !== activeButton) fullButton.disabled = false;
    }
  }

  async function runManual() {
    const f = selectedFragment();
    if (!f) return;
    const button = document.getElementById("aiV2ManualRun");
    setBusy(button, true, "Terra가 읽는 중…");
    document.getElementById("aiV2Result").innerHTML = `<div class="aiv2-status">선택한 생각을 다시 읽고 질문할 가치가 있는지 판단 중이에요…</div>`;
    try {
      const data = await callFn("bloomingInterviewQuestionV2", { fragmentId: f.id });
      renderResult(data, "manual");
    } catch (error) {
      console.error(error);
      document.getElementById("aiV2Result").innerHTML = `<div class="aiv2-status bad">테스트 호출에 실패했어요.<br>${e(error?.message || error)}</div>`;
    } finally {
      setBusy(button, false, "");
    }
  }

  async function runAuto() {
    const button = document.getElementById("aiV2AutoRun");
    setBusy(button, true, "Luna → Terra 검사 중…");
    document.getElementById("aiV2Result").innerHTML = `<div class="aiv2-status">과거 생각 후보를 고른 뒤, 실제 Blooming 질문까지 dry-run 중이에요. 실제 대기열에는 저장하지 않습니다.</div>`;
    try {
      const data = await callFn("bloomingInterviewAutoPreviewV2", {});
      renderResult(data, "auto");
    } catch (error) {
      console.error(error);
      document.getElementById("aiV2Result").innerHTML = `<div class="aiv2-status bad">자동 Blooming 테스트에 실패했어요.<br>${e(error?.message || error)}</div>`;
    } finally {
      setBusy(button, false, "");
    }
  }

  function waitForApp(attempt = 0) {
    if (connectedForTest() && typeof callFn === "function" && allTestFragments().length) {
      installLab();
      return;
    }
    if (attempt > 45) {
      installLab();
      const result = document.getElementById("aiV2Result");
      if (result) result.innerHTML = `<div class="aiv2-status bad">로그인된 Firebase 텃밭을 불러오지 못했어요. 일반 앱에서 로그인 상태를 먼저 확인해주세요.</div>`;
      return;
    }
    setTimeout(() => waitForApp(attempt + 1), 350);
  }

  waitForApp();
})();
"use strict";

/* Thought Garden · Blooming v2 UI integration preview
 *
 * Localhost-only helper for the private AI v2 lab. It calls the existing
 * read-only auto preview and renders the result through the real Blooming
 * dialog DOM. It never calls prepare/claim/markShown and never saves an answer.
 */
(() => {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (!local) {
    console.warn("Blooming V2 UI preview is localhost-only.");
    return;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function shortThought(value, max = 420) {
    const text = String(value || "").trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function restoreLab() {
    const lab = document.getElementById("aiV2Lab");
    if (lab) lab.style.display = "";
  }

  function closePreview(dialog) {
    try { if (dialog?.open) dialog.close(); } catch (_) {}
    restoreLab();
  }

  function showPreview(data) {
    if (data?.status !== "speak" || !data?.question || !data?.selectedFragment) {
      const msg = data?.status === "silent" || data?.status === "none"
        ? "이번 자동 선별에서는 질문하지 않는 편이 낫다고 판단했습니다. 테스트랩 결과를 확인해주세요."
        : "UI 미리보기에 사용할 질문을 받지 못했습니다.";
      if (typeof toast === "function") toast(msg);
      else console.info(msg);
      return false;
    }

    const dialog = document.getElementById("bloomingInterviewDialog");
    const title = document.getElementById("bloomingInterviewTitle");
    const body = document.getElementById("bloomingInterviewBody");
    const actions = document.getElementById("bloomingInterviewActions");
    if (!dialog || !title || !body || !actions) {
      throw new Error("기존 Blooming Interview 다이얼로그 DOM을 찾지 못했습니다.");
    }

    const source = data.selectedFragment;
    const when = String(source.date || "").slice(0, 10);
    const lab = document.getElementById("aiV2Lab");
    if (lab) lab.style.display = "none";

    title.innerHTML = "🎙️ 잠깐만요!";
    body.innerHTML = `
      <p class="interview-lead">${when ? `${escapeHtml(when)}에` : "전에"} 남긴 이 생각이 다시 눈에 들어왔어요.</p>
      <div class="interview-fragment">${escapeHtml(shortThought(source.thought))}</div>
      <div class="interview-question">${escapeHtml(data.question)}</div>
      <textarea class="textarea" id="bloomingInterviewAnswer" placeholder="지금 떠오르는 만큼만 적어도 괜찮아요." style="margin-top:12px;min-height:120px"></textarea>`;
    actions.innerHTML = `<button class="btn" id="bloomingInterviewNoAnswer" type="button">지금은 지나갈게요</button><button class="btn primary" id="saveBloomingInterviewAnswer" type="button">🌱 생각으로 남기기</button>`;

    const finish = () => closePreview(dialog);
    document.getElementById("bloomingInterviewNoAnswer").onclick = finish;
    document.getElementById("saveBloomingInterviewAnswer").onclick = () => {
      if (typeof toast === "function") toast("UI 미리보기라 답변은 저장하지 않았어요. 🌱");
      finish();
    };
    dialog.addEventListener("close", restoreLab, { once: true });

    dialog.showModal();
    return true;
  }

  async function runBloomingV2UiPreview() {
    if (typeof callFn !== "function") throw new Error("앱의 Firebase 함수 연결이 아직 준비되지 않았습니다.");
    if (!state?.firebase?.connected || !state.firebase.user || state.firebase.user.isAnonymous) {
      throw new Error("로그인된 Firebase 텃밭을 먼저 불러와주세요.");
    }

    const labResult = document.getElementById("aiV2Result");
    if (labResult) labResult.innerHTML = '<div class="aiv2-status">실제 Blooming 팝업에 넣을 질문을 read-only로 준비하고 있어요…</div>';

    const data = await callFn("bloomingInterviewAutoPreviewV2", {});
    console.log("Blooming V2 UI preview (dry-run)", data);

    if (typeof window.__renderAiV2PreviewResult === "function") {
      try { window.__renderAiV2PreviewResult(data); } catch (_) {}
    }
    showPreview(data);
    return data;
  }

  window.__runBloomingV2UiPreview = runBloomingV2UiPreview;
  runBloomingV2UiPreview().catch((error) => {
    console.error("Blooming V2 UI preview failed", error);
    restoreLab();
    const box = document.getElementById("aiV2Result");
    if (box) box.innerHTML = `<div class="aiv2-status bad">UI 통합 미리보기에 실패했어요.<br>${escapeHtml(error?.message || error)}</div>`;
  });
})();

/* Thought Garden · Blooming Interview v2 runtime
 *
 * A prepared question may arrive at any time, but it is only shown when the
 * user is visibly in the app and not actively writing or using another dialog.
 * The server owns rarity, candidate selection, question quality and claiming;
 * this file owns only the humane timing of the popup.
 */
(() => {
  "use strict";

  // Quality-lab sessions are dry-runs. Never prepare, claim or count a real
  // spontaneous Blooming while the user is inspecting model output.
  if (window.__THOUGHT_GARDEN_AI_V2_TEST__ || new URLSearchParams(location.search).get("ai-v2-test") === "1") {
    window.__thoughtGardenBloomingV2 = { testMode: true, disabled: true };
    return;
  }

  const runtime = {
    prepared: null,
    claimed: null,
    prepareStarted: false,
    prepareRetryUsed: false,
    claimBusy: false,
    shownThisSession: false,
    lastInteractionAt: Date.now(),
    lastTextInputAt: 0,
    tickId: null
  };

  const PREPARE_IDLE_MS = 1600;
  const SHOW_IDLE_MS = 2400;
  const CLAIM_SAFETY_MS = 1200;

  function noteInteraction(event) {
    runtime.lastInteractionAt = Date.now();
    if (event?.type === "input" || event?.type === "keydown") runtime.lastTextInputAt = Date.now();
  }

  ["pointerdown", "touchstart", "keydown", "input"].forEach((name) => {
    document.addEventListener(name, noteInteraction, { capture: true, passive: name === "touchstart" || name === "pointerdown" });
  });
  window.addEventListener("scroll", noteInteraction, { passive: true });

  function connected() {
    try {
      return !!(state?.firebase?.connected && state.firebase.user && !state.firebase.user.isAnonymous && state.firebase.functions);
    } catch (_) { return false; }
  }

  function enabled() {
    try { return typeof bloomingInterviewEnabled === "function" ? bloomingInterviewEnabled() : true; }
    catch (_) { return true; }
  }

  function visibleOpenDialog() {
    return !!document.querySelector("dialog[open]");
  }

  function isTextEditingElement(el) {
    if (!el) return false;
    const tag = String(el.tagName || "").toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") {
      const type = String(el.type || "text").toLowerCase();
      return !["button", "submit", "reset", "checkbox", "radio", "date", "time", "file", "color", "range"].includes(type);
    }
    return !!el.isContentEditable;
  }

  function visibleElement(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function hasUnsavedLookingDraft() {
    // This is deliberately conservative only for the capture view. Existing
    // Studio writing may already contain text, so Studio is blocked separately.
    try {
      if (state?.view !== "capture") return false;
      return [...document.querySelectorAll('.view.active[data-view="capture"] textarea, .view.active[data-view="capture"] [contenteditable="true"]')]
        .filter(visibleElement)
        .some((el) => String(el.value ?? el.textContent ?? "").trim().length > 0);
    } catch (_) { return false; }
  }

  function baseSafe() {
    if (document.visibilityState !== "visible") return false;
    if (!connected() || !enabled()) return false;
    if (visibleOpenDialog()) return false;
    if (isTextEditingElement(document.activeElement)) return false;
    if (Date.now() - runtime.lastTextInputAt < 5000) return false;
    return true;
  }

  function safeToPrepare() {
    if (!baseSafe()) return false;
    return Date.now() - runtime.lastInteractionAt >= PREPARE_IDLE_MS;
  }

  function safeToShow() {
    if (!baseSafe()) return false;
    try {
      // Studio is a sustained writing workspace. Never interrupt it, even when
      // the caret is temporarily not focused.
      if (state?.view === "studio") return false;
      if (hasUnsavedLookingDraft()) return false;
    } catch (_) {}
    return Date.now() - runtime.lastInteractionAt >= SHOW_IDLE_MS;
  }

  function readyExpired(ready) {
    const t = Date.parse(String(ready?.expiresAt || ""));
    return !ready?.id || !Number.isFinite(t) || t <= Date.now();
  }

  function claimExpired(claimed) {
    const t = Date.parse(String(claimed?.ready?.claimExpiresAt || ""));
    return !Number.isFinite(t) || t <= Date.now() + CLAIM_SAFETY_MS;
  }

  async function prepareInBackground() {
    if (runtime.prepareStarted || runtime.shownThisSession || !safeToPrepare()) return;
    runtime.prepareStarted = true;
    try {
      const data = await callFn("bloomingInterviewPrepareV2", {});
      if (data?.status === "ready" && data.ready && !readyExpired(data.ready)) {
        runtime.prepared = data.ready;
        return;
      }
      // A stale stored question was safely discarded server-side. Give this
      // session one chance to prepare a fresh one without waiting for a restart.
      if (data?.status === "stale-cleared" && !runtime.prepareRetryUsed) {
        runtime.prepareRetryUsed = true;
        runtime.prepareStarted = false;
        setTimeout(() => { prepareInBackground().catch(() => {}); }, 5000);
      }
    } catch (error) {
      console.warn("Blooming v2 prepare failed", error);
    }
  }

  async function claimPrepared() {
    if (!runtime.prepared || runtime.claimed || runtime.claimBusy || !safeToShow()) return;
    if (readyExpired(runtime.prepared)) { runtime.prepared = null; return; }
    runtime.claimBusy = true;
    try {
      const data = await callFn("bloomingInterviewClaimV2", { artifactId: runtime.prepared.id });
      if (data?.status === "claimed" && data.claimToken && data.ready) {
        runtime.claimed = { claimToken: data.claimToken, ready: data.ready };
      } else if (data?.status === "missing" || data?.status === "busy") {
        runtime.prepared = null;
      }
    } catch (error) {
      console.warn("Blooming v2 claim failed", error);
    } finally {
      runtime.claimBusy = false;
    }
  }

  function excerpt(fragment) {
    try {
      if (typeof fragmentInterviewExcerpt === "function") return fragmentInterviewExcerpt(fragment);
    } catch (_) {}
    const text = String(fragment?.thought || fragment?.text || "").trim();
    return text.length > 420 ? `${text.slice(0, 420)}…` : text;
  }

  function showClaimed() {
    if (!runtime.claimed || runtime.shownThisSession || !safeToShow()) return false;
    if (claimExpired(runtime.claimed)) {
      runtime.claimed = null;
      runtime.prepared = null;
      runtime.prepareStarted = false;
      return false;
    }

    const ready = runtime.claimed.ready;
    const source = state.fragments?.find?.((x) => x.id === ready.sourceFragmentId);
    if (!source) return false;
    const dialog = document.getElementById("bloomingInterviewDialog");
    const title = document.getElementById("bloomingInterviewTitle");
    const body = document.getElementById("bloomingInterviewBody");
    const actions = document.getElementById("bloomingInterviewActions");
    if (!dialog || !title || !body || !actions) return false;

    state.bloomingInterview = {
      sourceId: ready.sourceFragmentId,
      question: String(ready.question || ""),
      model: String(ready.model || ""),
      returnAfterSaveId: null,
      busy: false,
      v2: true,
      artifactId: ready.id
    };

    const when = String(ready.sourceDate || source.date || "").slice(0, 10);
    title.innerHTML = "🎙️ 잠깐만요!";
    body.innerHTML = `
      <p class="interview-lead">${when ? `${esc(when)}에` : "전에"} 남긴 이 생각이 다시 눈에 들어왔어요.</p>
      <div class="interview-fragment">${esc(excerpt(source))}</div>
      <div class="interview-question">${esc(String(ready.question || ""))}</div>
      <textarea class="textarea" id="bloomingInterviewAnswer" placeholder="지금 떠오르는 만큼만 적어도 괜찮아요." style="margin-top:12px;min-height:120px"></textarea>`;
    actions.innerHTML = `<button class="btn" id="bloomingInterviewNoAnswer" type="button">지금은 지나갈게요</button><button class="btn primary" id="saveBloomingInterviewAnswer" type="button" style="white-space:nowrap;font-size:.76rem;padding-left:10px;padding-right:10px">🌱 생각으로 남기기</button>`;
    document.getElementById("bloomingInterviewNoAnswer").onclick = finishBloomingInterview;
    document.getElementById("saveBloomingInterviewAnswer").onclick = saveBloomingInterviewAnswer;

    // Do not autofocus the textarea. This popup can appear while browsing, and
    // forcing the mobile keyboard open would turn a gentle interruption into a
    // disruptive one.
    dialog.showModal();
    runtime.shownThisSession = true;

    const artifactId = ready.id;
    const claimToken = runtime.claimed.claimToken;
    runtime.prepared = null;
    runtime.claimed = null;

    // The popup is already visible, so recording the appearance is best-effort
    // with one retry. If the network blips, the server claim still suppresses a
    // duplicate for ten minutes.
    const mark = async (retry) => {
      try {
        const data = await callFn("bloomingInterviewMarkShownV2", { artifactId, claimToken });
        if (data?.status !== "shown" && retry) setTimeout(() => mark(false), 2500);
      } catch (error) {
        if (retry) setTimeout(() => mark(false), 2500);
        else console.warn("Blooming v2 shown marker failed", error);
      }
    };
    mark(true).catch(() => {});
    return true;
  }

  async function tick() {
    if (!enabled()) return;
    if (!runtime.prepareStarted && !runtime.prepared && !runtime.claimed && !runtime.shownThisSession) {
      await prepareInBackground();
    }
    if (runtime.prepared && !runtime.claimed && !runtime.shownThisSession) await claimPrepared();
    if (runtime.claimed && !runtime.shownThisSession) showClaimed();
  }

  // Disable the old save-time invitation. The existing dialog and answer-save
  // machinery remain useful and are reused by v2; only its trigger is replaced.
  try {
    if (typeof maybeOfferBloomingInterview === "function") {
      maybeOfferBloomingInterview = async function () { return false; };
    }
  } catch (error) {
    console.warn("Blooming v2 could not disable legacy trigger", error);
  }

  runtime.tickId = window.setInterval(() => { tick().catch(() => {}); }, 1400);
  window.setTimeout(() => { tick().catch(() => {}); }, 2600);
  window.addEventListener("pageshow", () => { runtime.lastInteractionAt = Date.now(); window.setTimeout(() => tick().catch(() => {}), 1800); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      runtime.lastInteractionAt = Date.now();
      window.setTimeout(() => tick().catch(() => {}), 1800);
    }
  });

  window.__thoughtGardenBloomingV2 = runtime;
})();

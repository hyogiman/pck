/**
 * 생각의 텃밭 — 익명 계정 → 기존 Google 계정 정식 병합
 *
 * 보안 핵심: 클라이언트가 sourceUid / targetUid 를 보내지 않는다.
 *   prepareMigration  : sourceUid = request.auth.uid  (AAA로 인증된 상태)
 *   completeMigration : targetUid = request.auth.uid  (BBB로 인증된 상태)
 * 두 시점의 인증을 일회성 티켓이 이어 붙여, 서버가 양쪽 소유권을 모두 확인한다.
 *
 * 원본(AAA)은 절대 지우지 않는다. 실패해도 재호출하면 이어서 진행된다.
 */
const crypto = require("crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage, getDownloadURL } = require("firebase-admin/storage");

if (!getApps().length) initializeApp();

const db = getFirestore();
const COLLECTIONS = ["sources", "fragments", "threads", "projects"];
const CLAIM_WINDOW_MS = 10 * 60 * 1000; // 티켓으로 '인수'할 수 있는 시간. 작업 시간 제한이 아니다.
const TIME_BUDGET_MS = 40 * 1000;       // 한 번 호출에서 쓸 시간. 넘으면 진행상황만 남기고 반환한다.
const DOC_BATCH = 150;
const FILE_BATCH = 8;

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const mask = (uid) => (uid ? uid.slice(0, 4) + "…" + uid.slice(-2) : "-");
const fileKey = (p) => crypto.createHash("sha1").update(p).digest("hex");
const log = (...a) => console.log("[migration]", ...a);

/* ────────────────────────── 1단계: 준비 (AAA로 인증된 상태) ────────────────────────── */
exports.prepareMigration = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "로그인 상태가 아닙니다.");

    const sourceUid = auth.uid; // ← 클라이언트 입력이 아니다
    const provider = auth.token?.firebase?.sign_in_provider;
    if (provider !== "anonymous") {
      throw new HttpsError("failed-precondition", "이 기기의 임시 계정에서만 시작할 수 있습니다.");
    }

    // 대상 이메일은 '힌트'일 뿐이다. 이걸로 targetUid를 확정하되,
    // 실제 권한은 completeMigration에서 그 UID로 로그인한 사람만 갖는다.
    const targetEmail = String(request.data?.targetEmail || "").trim().toLowerCase();
    let targetUid = null;
    if (targetEmail) {
      try {
        const u = await require("firebase-admin/auth").getAuth().getUserByEmail(targetEmail);
        targetUid = u.uid;
      } catch (e) {
        log("getUserByEmail 실패 — 티켓 방식으로 진행", e.code);
      }
    }
    if (targetUid && targetUid === sourceUid) {
      throw new HttpsError("failed-precondition", "같은 계정으로는 옮길 수 없습니다.");
    }

    // 옮길 것이 실제로 있는지 확인 (빈 계정이면 병합 자체가 불필요)
    let total = 0;
    for (const c of COLLECTIONS) {
      const snap = await db.collection("users").doc(sourceUid).collection(c).count().get();
      total += snap.data().count;
    }
    if (total === 0) throw new HttpsError("failed-precondition", "옮길 기록이 없습니다.");

    const ticket = crypto.randomBytes(32).toString("hex");
    const jobRef = db.collection("migrationJobs").doc();
    await jobRef.set({
      sourceUid,
      targetUid,                 // null이면 complete에서 먼저 claim한 인증 사용자로 확정
      targetEmail: targetEmail || null,
      ticketHash: sha256(ticket), // 티켓 원문은 저장하지 않는다
      status: "prepared",
      phase: "preflight",
      cursor: {},
      stats: { sourceTotal: total },
      createdAt: FieldValue.serverTimestamp(),
      claimExpiresAt: Date.now() + CLAIM_WINDOW_MS,
      updatedAt: FieldValue.serverTimestamp(),
    });

    log("prepared", jobRef.id, "src", mask(sourceUid), "tgt", mask(targetUid), "items", total);
    return { jobId: jobRef.id, ticket, sourceTotal: total };
  }
);

/* ────────────────────── 2단계: 인수 + 이전 (BBB로 인증된 상태) ────────────────────── */
exports.completeMigration = onCall(
  { region: "us-central1", timeoutSeconds: 540, memory: "512MiB" },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "로그인 상태가 아닙니다.");
    const uid = auth.uid;
    const jobId = String(request.data?.jobId || "");
    const ticket = String(request.data?.ticket || "");
    if (!jobId) throw new HttpsError("invalid-argument", "작업 번호가 없습니다.");

    const jobRef = db.collection("migrationJobs").doc(jobId);
    const snap = await jobRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "이전 작업을 찾을 수 없습니다.");
    const job = snap.data();

    // 이미 끝난 작업을 다시 불러도 아무 일도 일어나지 않는다 (중복 생성 방지)
    if (job.status === "completed") return { done: true, status: "completed", stats: job.stats || {} };
    if (job.status === "conflict") {
      throw new HttpsError("already-exists", "같은 번호의 기록이 이미 기존 텃밭에 있어 멈췄습니다. 원본은 그대로입니다.");
    }

    /* ── 소유권 확인 ── */
    if (job.status === "prepared") {
      if (!ticket || sha256(ticket) !== job.ticketHash) {
        throw new HttpsError("permission-denied", "이전 권한을 확인하지 못했습니다.");
      }
      if (Date.now() > (job.claimExpiresAt || 0)) {
        throw new HttpsError("deadline-exceeded", "시간이 지나 이전을 시작하지 못했습니다. 다시 시도해 주세요.");
      }
      if (job.targetUid && uid !== job.targetUid) {
        throw new HttpsError("permission-denied", "이 이전을 이어받을 수 있는 계정이 아닙니다.");
      }
      if (uid === job.sourceUid) {
        throw new HttpsError("failed-precondition", "옮겨올 계정과 받는 계정이 같습니다.");
      }
      await jobRef.update({
        targetUid: uid,                    // 티켓 방식이었다면 여기서 확정
        status: "claimed",
        claimedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      job.targetUid = uid;
      job.status = "claimed";
      log("claimed", jobId, "by", mask(uid));
    } else {
      // 인수 이후에는 티켓 만료와 무관하게, 그 계정만 이어서 진행할 수 있다
      if (uid !== job.targetUid) throw new HttpsError("permission-denied", "이 이전의 대상 계정이 아닙니다.");
    }

    const started = Date.now();
    const overBudget = () => Date.now() - started > TIME_BUDGET_MS;
    const srcRoot = db.collection("users").doc(job.sourceUid);
    const tgtRoot = db.collection("users").doc(job.targetUid);
    const bucket = getStorage().bucket();
    let phase = job.phase || "preflight";
    const cursor = job.cursor || {};
    const stats = job.stats || {};

    const save = async (extra = {}) =>
      jobRef.update({ phase, cursor, stats, updatedAt: FieldValue.serverTimestamp(), ...extra });

    /* ── 사전 점검: 원래 기존 텃밭에 있던 같은 번호가 있으면 멈춘다 ── */
    if (phase === "preflight") {
      const conflicts = [];
      for (const c of COLLECTIONS) {
        const srcIds = (await srcRoot.collection(c).select().get()).docs.map((d) => d.id);
        stats[c] = srcIds.length;
        for (let i = 0; i < srcIds.length; i += 30) {
          const chunk = srcIds.slice(i, i + 30);
          const refs = chunk.map((id) => tgtRoot.collection(c).doc(id));
          const got = await db.getAll(...refs);
          got.forEach((d, k) => { if (d.exists) conflicts.push(`${c}/${chunk[k]}`); });
        }
      }
      if (conflicts.length) {
        await save({ status: "conflict", error: { code: "id-conflict", sample: conflicts.slice(0, 5) } });
        log("conflict", jobId, conflicts.length);
        throw new HttpsError("already-exists", "같은 번호의 기록이 이미 기존 텃밭에 있어 멈췄습니다. 원본은 그대로입니다.");
      }
      phase = "files";
      await save({ status: "migrating" });
    }

    /* ── 첨부 파일 먼저 (문서보다 앞: 실패해도 '사진 없는 글'이 생기지 않게) ── */
    if (phase === "files") {
      // attachments는 fragments 문서에만 존재한다 (코드 전수 확인)
      const frags = await srcRoot.collection("fragments").get();
      const jobs = [];
      frags.forEach((d) => {
        (d.get("attachments") || []).forEach((a) => { if (a && a.path) jobs.push(a.path); });
      });
      const startAt = cursor.fileIndex || 0;
      let i = startAt, copied = 0;
      for (; i < jobs.length && copied < FILE_BATCH && !overBudget(); i++) {
        const oldPath = jobs[i];
        if (!oldPath.startsWith(`users/${job.sourceUid}/`)) continue; // 남의 경로는 건드리지 않는다
        const newPath = `users/${job.targetUid}/` + oldPath.slice(`users/${job.sourceUid}/`.length);
        const mapRef = jobRef.collection("files").doc(fileKey(oldPath));
        if ((await mapRef.get()).exists) continue;                    // 이번 이전이 이미 옮긴 것 → 건너뛴다

        const src = bucket.file(oldPath);
        const dst = bucket.file(newPath);
        if (!(await src.exists())[0]) { await mapRef.set({ oldPath, missing: true }); continue; }

        try {
          // ifGenerationMatch:0 → 대상이 이미 있으면 실패한다 (덮어쓰기 방지)
          await src.copy(dst, { preconditionOpts: { ifGenerationMatch: 0 } });
        } catch (e) {
          const exists = (await dst.exists())[0];
          if (!exists) throw e;   // 진짜 실패 → 다음 호출에서 이 지점부터 재시도
          // 이미 있음: 이전 시도가 만든 것으로 보고 이어간다
        }
        // 다운로드 토큰은 객체마다 달라야 한다 → 새로 발급 후 공식 API로 URL을 얻는다
        await dst.setMetadata({ metadata: { firebaseStorageDownloadTokens: crypto.randomUUID() } });
        const url = await getDownloadURL(dst);
        await mapRef.set({ oldPath, newPath, url });
        copied++;
      }
      cursor.fileIndex = i;
      stats.files = jobs.length;
      if (i < jobs.length) { await save(); return { done: false, phase, progress: { done: i, total: jobs.length } }; }
      phase = "docs"; cursor.col = 0; cursor.docId = null; await save();
    }

    /* ── 문서 (같은 번호 그대로 — 내부 참조를 다시 매길 필요가 없다) ── */
    if (phase === "docs") {
      // 파일 경로/주소 대응표를 메모리에 올린다
      const fileMap = new Map();
      (await jobRef.collection("files").get()).forEach((d) => fileMap.set(d.get("oldPath"), d.data()));

      while ((cursor.col || 0) < COLLECTIONS.length) {
        const c = COLLECTIONS[cursor.col || 0];
        let q = srcRoot.collection(c).orderBy("__name__").limit(DOC_BATCH);
        if (cursor.docId) q = srcRoot.collection(c).orderBy("__name__").startAfter(cursor.docId).limit(DOC_BATCH);
        const page = await q.get();
        if (page.empty) { cursor.col = (cursor.col || 0) + 1; cursor.docId = null; await save(); continue; }

        const batch = db.batch();
        page.forEach((d) => {
          const data = d.data();
          if (c === "fragments" && Array.isArray(data.attachments)) {
            data.attachments = data.attachments.map((a) => {
              const m = a && a.path ? fileMap.get(a.path) : null;
              return m && m.newPath ? { ...a, path: m.newPath, url: m.url } : a;
            });
          }
          batch.set(tgtRoot.collection(c).doc(d.id), data); // deletedAt(휴지통)도 그대로 따라간다
        });
        await batch.commit();
        cursor.docId = page.docs[page.docs.length - 1].id;
        await save();
        if (overBudget()) return { done: false, phase, progress: { col: c } };
      }
      phase = "settings"; await save();
    }

    /* ── 설정: 기존 계정을 기준으로 두고, 비어 있는 항목만 채운다 ── */
    if (phase === "settings") {
      const sRef = srcRoot.collection("settings").doc("private");
      const tRef = tgtRoot.collection("settings").doc("private");
      const [sDoc, tDoc] = await db.getAll(sRef, tRef);
      if (sDoc.exists) {
        const sKeys = sDoc.get("apiKeys") || {};
        const tKeys = tDoc.exists ? tDoc.get("apiKeys") || {} : {};
        const merged = { ...tKeys };                       // 기존 계정 값이 이긴다
        let filled = 0;
        for (const [k, v] of Object.entries(sKeys)) {
          if (!merged[k] && v) { merged[k] = v; filled++; } // 비어 있던 항목만 채움
        }
        if (filled) await tRef.set({ apiKeys: merged, updatedAtServer: FieldValue.serverTimestamp() }, { merge: true });
        stats.settingsFilled = filled;                      // 값 자체는 절대 로그에 남기지 않는다
      }
      phase = "verify"; await save();
    }

    /* ── 검증 ── */
    if (phase === "verify") {
      const result = {};
      for (const c of COLLECTIONS) {
        const s = (await srcRoot.collection(c).count().get()).data().count;
        const t = (await tgtRoot.collection(c).select().get()).docs.length;
        result[c] = { source: s, targetTotal: t };
        if (t < s) {
          await save({ status: "migrating" });
          throw new HttpsError("aborted", "옮기는 중 일부가 빠져 다시 시도해야 합니다. 원본은 그대로입니다.");
        }
      }
      // 첨부가 새 경로를 가리키는지
      let badPath = 0, checked = 0;
      (await tgtRoot.collection("fragments").get()).forEach((d) => {
        (d.get("attachments") || []).forEach((a) => {
          checked++;
          if (a?.path && !a.path.startsWith(`users/${job.targetUid}/`)) badPath++;
        });
      });
      stats.verify = { ...result, attachments: checked, wrongPath: badPath };
      if (badPath > 0) {
        await save({ status: "migrating", phase: "files" });
        throw new HttpsError("aborted", "첨부 파일 주소를 아직 다 바꾸지 못했습니다. 다시 시도하면 이어서 진행합니다.");
      }
      phase = "completed";
      await save({
        status: "completed",
        completedAt: FieldValue.serverTimestamp(),
        sourcePreserved: true,          // V1: 원본은 지우지 않는다
        cleanupAfter: Date.now() + 7 * 86400000, // 나중에 정리 기능을 붙일 때 쓸 표시일 뿐
      });
      log("completed", jobId, "src", mask(job.sourceUid), "tgt", mask(job.targetUid), stats.verify);
    }

    return { done: true, status: "completed", stats };
  }
);

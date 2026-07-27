/**
 * 생각의 텃밭 — 익명 계정 → 기존 Google 계정 정식 병합  (v3)
 *
 * 보안 핵심: 클라이언트가 sourceUid / targetUid 를 보내지 않는다.
 *   prepareMigration  : sourceUid = request.auth.uid  (AAA로 인증된 상태)
 *   completeMigration : targetUid = request.auth.uid  (BBB로 인증된 상태)
 * 두 시점의 인증을 일회성 티켓이 이어 붙여, 서버가 양쪽 소유권을 모두 확인한다.
 *
 * 원본(AAA)은 절대 지우지 않는다. 실패해도 재호출하면 이어서 진행된다.
 *
 * v2 변경
 *  ① claim을 트랜잭션으로 + 작업 중 lease → 동시 실행 차단
 *  ② 대상 파일이 이미 있을 때, '이 작업이 만든 것'이라는 근거가 있을 때만 이어감
 *  ③ 원본 첨부 파일이 사라졌으면 조용히 넘기지 않고 명시적으로 멈춤 (무한 재시도 방지)
 *  ④ 검증 범위를 이번에 옮긴 항목으로 한정 (기존 BBB 데이터 때문에 실패하지 않게)
 *
 * v3 변경
 *  ⑤ lease 해제 시 현재 호출이 소유한 lease인지 트랜잭션으로 확인
 *  ⑥ 옮길 수 없는 Storage 경로를 조용히 건너뛰지 않고 명시적으로 중단
 *     (단, 이미 '받는 계정' 자리에 있는 경로는 정상으로 보고 그대로 둔다)
 *  ⑦ 동일 Storage path가 여러 조각에서 참조돼도 한 번만 이전하도록 중복 제거
 */
const crypto = require("crypto");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage, getDownloadURL } = require("firebase-admin/storage");

if (!getApps().length) initializeApp();

const db = getFirestore();
const COLLECTIONS = ["sources", "fragments", "threads", "projects"];
const CLAIM_WINDOW_MS = 10 * 60 * 1000; // 티켓으로 '인수'할 수 있는 시간. 작업 시간 제한이 아니다.
const LEASE_MS = 120 * 1000;            // 한 호출이 붙잡는 작업권. 죽어도 이 시간 뒤 자동 해제된다.
const TIME_BUDGET_MS = 40 * 1000;       // 한 번 호출에서 쓸 시간. 넘으면 진행상황만 남기고 반환한다.
const DOC_BATCH = 150;
const FILE_BATCH = 8;
const ID_CHUNK = 30;                    // getAll 한 번에 묶는 개수

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const mask = (uid) => (uid ? uid.slice(0, 4) + "…" + uid.slice(-2) : "-");
const fileKey = (p) => crypto.createHash("sha1").update(p).digest("hex");
const log = (...a) => console.log("[migration]", ...a);
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

/* ────────────────────────── 1단계: 준비 (AAA로 인증된 상태) ────────────────────────── */
exports.prepareMigration = onCall(
  { region: "us-central1", timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError("unauthenticated", "로그인 상태가 아닙니다.");

    const sourceUid = auth.uid; // ← 클라이언트 입력이 아니다
    if (auth.token?.firebase?.sign_in_provider !== "anonymous") {
      throw new HttpsError("failed-precondition", "이 기기의 임시 계정에서만 시작할 수 있습니다.");
    }

    // 대상 이메일은 '힌트'일 뿐이다. 이걸로 targetUid를 확정하되,
    // 실제 권한은 completeMigration에서 그 UID로 로그인한 사람만 갖는다.
    const targetEmail = String(request.data?.targetEmail || "").trim().toLowerCase();
    let targetUid = null;
    if (targetEmail) {
      try { targetUid = (await getAuth().getUserByEmail(targetEmail)).uid; }
      catch (e) { log("getUserByEmail 실패 — 티켓 방식으로 진행", e.code); }
    }
    if (targetUid && targetUid === sourceUid) {
      throw new HttpsError("failed-precondition", "같은 계정으로는 옮길 수 없습니다.");
    }

    let total = 0;
    for (const c of COLLECTIONS) {
      total += (await db.collection("users").doc(sourceUid).collection(c).count().get()).data().count;
    }
    if (total === 0) throw new HttpsError("failed-precondition", "옮길 기록이 없습니다.");

    const ticket = crypto.randomBytes(32).toString("hex");
    const jobRef = db.collection("migrationJobs").doc();
    await jobRef.set({
      sourceUid,
      targetUid,                  // null이면 complete에서 먼저 claim한 인증 사용자로 확정
      targetEmail: targetEmail || null,
      ticketHash: sha256(ticket), // 티켓 원문은 저장하지 않는다
      status: "prepared",
      phase: "preflight",
      cursor: {},
      stats: { sourceTotal: total },
      leaseOwner: null,
      leaseExpiresAt: 0,
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
    const leaseId = crypto.randomBytes(12).toString("hex");

    /* ── ① 소유권 확인 + 작업권 획득을 하나의 트랜잭션으로 ──
       읽고-판단하고-쓰는 사이에 다른 호출이 끼어들 수 없게 한다. */
    const gate = await db.runTransaction(async (tx) => {
      const snap = await tx.get(jobRef);
      if (!snap.exists) return { err: ["not-found", "이전 작업을 찾을 수 없습니다."] };
      const j = snap.data();
      const now = Date.now();

      if (j.status === "completed") return { finished: true, stats: j.stats || {} };
      if (j.status === "conflict") {
        return { err: ["already-exists", "같은 번호의 기록이 이미 기존 텃밭에 있어 멈췄습니다. 원본은 그대로입니다."] };
      }
      // 다른 호출이 작업 중이면 물러난다 (lease는 시간이 지나면 자동으로 풀린다)
      if (j.leaseOwner && (j.leaseExpiresAt || 0) > now) return { busy: true };

      if (j.status === "prepared") {
        if (!ticket || sha256(ticket) !== j.ticketHash) return { err: ["permission-denied", "이전 권한을 확인하지 못했습니다."] };
        if (now > (j.claimExpiresAt || 0)) return { err: ["deadline-exceeded", "시간이 지나 이전을 시작하지 못했습니다. 다시 시도해 주세요."] };
        if (j.targetUid && uid !== j.targetUid) return { err: ["permission-denied", "이 이전을 이어받을 수 있는 계정이 아닙니다."] };
        if (uid === j.sourceUid) return { err: ["failed-precondition", "옮겨올 계정과 받는 계정이 같습니다."] };
        tx.update(jobRef, {
          targetUid: uid, status: "claimed", claimedAt: FieldValue.serverTimestamp(),
          leaseOwner: leaseId, leaseExpiresAt: now + LEASE_MS, updatedAt: FieldValue.serverTimestamp(),
        });
        return { job: { ...j, targetUid: uid, status: "claimed" }, claimedNow: true };
      }

      // 인수 이후에는 티켓 만료와 무관하게, 그 계정만 이어서 진행할 수 있다
      if (uid !== j.targetUid) return { err: ["permission-denied", "이 이전의 대상 계정이 아닙니다."] };
      const patch = { leaseOwner: leaseId, leaseExpiresAt: now + LEASE_MS, updatedAt: FieldValue.serverTimestamp() };
      // '원본 파일 없음'으로 멈춘 뒤 다시 시도하는 경우 — 사용자가 그 첨부를 정리했을 수 있다
      if (j.status === "failed") { patch.status = "migrating"; patch.error = FieldValue.delete(); }
      tx.update(jobRef, patch);
      return { job: { ...j, status: j.status === "failed" ? "migrating" : j.status } };
    });

    if (gate.finished) return { done: true, status: "completed", stats: gate.stats };
    if (gate.busy) return { done: false, busy: true, phase: "busy" };
    if (gate.err) throw new HttpsError(gate.err[0], gate.err[1]);
    const job = gate.job;
    if (gate.claimedNow) log("claimed", jobId, "by", mask(uid));

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
    // 오래된 호출이 뒤늦게 끝나 새 호출의 lease를 풀어버리지 않도록,
    // 현재 job의 leaseOwner가 '내 leaseId'일 때만 해제한다.
    const releaseLease = async () => {
      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(jobRef);
          if (!snap.exists) return;
          const current = snap.data();
          if (current.leaseOwner !== leaseId) return;
          tx.update(jobRef, {
            leaseOwner: null,
            leaseExpiresAt: 0,
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
      } catch (e) {
        log("lease 해제 실패", e.code);
      }
    };

    try {
      /* ── 사전 점검: 원래 기존 텃밭에 있던 같은 번호가 있으면 멈춘다 ── */
      if (phase === "preflight") {
        const conflicts = [];
        for (const c of COLLECTIONS) {
          const srcIds = (await srcRoot.collection(c).select().get()).docs.map((d) => d.id);
          stats[c] = srcIds.length;
          for (const ids of chunk(srcIds, ID_CHUNK)) {
            const got = await db.getAll(...ids.map((id) => tgtRoot.collection(c).doc(id)));
            got.forEach((d, k) => { if (d.exists) conflicts.push(`${c}/${ids[k]}`); });
          }
        }
        if (conflicts.length) {
          await save({ status: "conflict", error: { code: "id-conflict", count: conflicts.length } });
          log("conflict", jobId, conflicts.length);
          throw new HttpsError("already-exists", "같은 번호의 기록이 이미 기존 텃밭에 있어 멈췄습니다. 원본은 그대로입니다.");
        }
        phase = "files";
        await save({ status: "migrating" });
      }

      /* ── 첨부 파일 먼저 (문서보다 앞: 실패해도 '사진 없는 글'이 생기지 않게) ── */
      if (phase === "files") {
        // attachments는 fragments 문서에만 존재한다 (코드 전수 확인)
        const wanted = [];
        const seenPaths = new Set();
        (await srcRoot.collection("fragments").get()).forEach((d) => {
          (d.get("attachments") || []).forEach((a) => {
            if (!a || !a.path || seenPaths.has(a.path)) return;
            seenPaths.add(a.path);
            wanted.push({ path: a.path, fragmentId: d.id, name: a.name || "" });
          });
        });
        // 이번 작업이 이미 옮긴 목록 — 색인이 아니라 이 매니페스트가 진행 상황의 근거다
        const manifest = new Map();
        (await jobRef.collection("files").get()).forEach((d) => manifest.set(d.get("oldPath"), d.data()));

        let copied = 0, doneCount = 0;
        for (const w of wanted) {
          const prev = manifest.get(w.path);
          if (prev && prev.status === "done") { doneCount++; continue; }   // 이 작업이 이미 끝낸 것
          if (w.path.startsWith(`users/${job.targetUid}/`)) {
            // 이미 '받는 계정' 자리에 있는 파일 (예: 이 임시 계정이 예전에 그 계정의 백업을 가져온 경우).
            // 옮길 필요가 없고, 문서의 경로도 그대로 두면 검증을 통과한다.
            doneCount++; continue;
          }
          if (!w.path.startsWith(`users/${job.sourceUid}/`)) {
            // 조용히 건너뛰면 문서에는 옛 UID 경로가 남고 verify에서 계속 실패한다.
            // 데이터 손실 없이 사용자가 원인을 알 수 있도록 명시적으로 멈춘다.
            await save({
              status: "failed",
              error: { code: "source-path-owner-mismatch", fragmentId: w.fragmentId, name: w.name },
            });
            log("source-path-owner-mismatch", jobId, w.fragmentId);
            throw new HttpsError("failed-precondition",
              "첨부 파일 경로가 현재 임시 계정과 맞지 않아 병합을 완료하지 않았습니다. 원본 데이터는 그대로입니다.");
          }
          if (copied >= FILE_BATCH || overBudget()) break;

          const newPath = `users/${job.targetUid}/` + w.path.slice(`users/${job.sourceUid}/`.length);
          const mapRef = jobRef.collection("files").doc(fileKey(w.path));
          const src = bucket.file(w.path);
          const dst = bucket.file(newPath);

          if (!(await src.exists())[0]) {
            // ③ 조용히 넘기면 문서에 옛 경로가 남아 검증이 영원히 실패한다. 명시적으로 멈춘다.
            await save({
              status: "failed",
              error: { code: "source-file-missing", fragmentId: w.fragmentId, name: w.name },
            });
            log("source-file-missing", jobId, w.fragmentId);
            throw new HttpsError("failed-precondition",
              "첨부 파일 1개를 찾지 못해 병합을 완료하지 않았습니다. 원본 데이터는 그대로입니다.");
          }

          // 먼저 '내가 만들 자리'라고 남긴다 → 나중에 대상 파일의 주인을 가릴 근거가 된다
          if (!prev) await mapRef.set({ oldPath: w.path, newPath, jobId, status: "copying" });

          try {
            // ifGenerationMatch:0 → 대상이 이미 있으면 실패한다 (덮어쓰기 방지)
            await src.copy(dst, { preconditionOpts: { ifGenerationMatch: 0 } });
          } catch (e) {
            if (!(await dst.exists())[0]) throw e;   // 진짜 실패 → 다음 호출에서 재시도
            // ② 대상이 이미 있다. '이 작업이 만든 것'이라는 근거가 있을 때만 이어간다.
            if (!(prev && prev.jobId === jobId)) {
              await save({ status: "conflict", error: { code: "storage-path-conflict" } });
              throw new HttpsError("already-exists",
                "옮길 자리에 이미 다른 파일이 있어 멈췄습니다. 원본은 그대로입니다.");
            }
          }
          // 다운로드 토큰은 객체마다 달라야 한다 → 새로 발급 후 공식 API로 URL을 얻는다
          await dst.setMetadata({
            metadata: { firebaseStorageDownloadTokens: crypto.randomUUID(), migrationJobId: jobId },
          });
          const url = await getDownloadURL(dst);
          await mapRef.set({ oldPath: w.path, newPath, jobId, url, status: "done" });
          copied++; doneCount++;
        }

        stats.files = wanted.length;
        cursor.fileIndex = doneCount;                 // 진행 표시용일 뿐, 판단 근거는 매니페스트다
        if (doneCount < wanted.length) {
          await save();
          await releaseLease();
          return { done: false, phase, progress: { done: doneCount, total: wanted.length } };
        }
        phase = "docs"; cursor.col = 0; cursor.docId = null; await save();
      }

      /* ── 문서 (같은 번호 그대로 — 내부 참조를 다시 매길 필요가 없다) ── */
      if (phase === "docs") {
        const fileMap = new Map();
        (await jobRef.collection("files").get()).forEach((d) => {
          if (d.get("status") === "done" && d.get("newPath")) fileMap.set(d.get("oldPath"), d.data());
        });

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
          if (overBudget()) { await releaseLease(); return { done: false, phase, progress: { col: c } }; }
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
          const merged = { ...tKeys };                        // 기존 계정 값이 이긴다
          let filled = 0;
          for (const [k, v] of Object.entries(sKeys)) {
            if (!merged[k] && v) { merged[k] = v; filled++; } // 비어 있던 항목만 채움
          }
          if (filled) await tRef.set({ apiKeys: merged, updatedAtServer: FieldValue.serverTimestamp() }, { merge: true });
          stats.settingsFilled = filled;                       // 값 자체는 절대 로그에 남기지 않는다
        }
        phase = "verify"; await save();
      }

      /* ── ④ 검증: 이번에 옮긴 항목만 본다 (기존 BBB 데이터는 판정에 넣지 않는다) ── */
      if (phase === "verify") {
        const result = {};
        let fragIds = [];
        for (const c of COLLECTIONS) {
          const srcIds = (await srcRoot.collection(c).select().get()).docs.map((d) => d.id);
          if (c === "fragments") fragIds = srcIds;
          let missing = 0;
          for (const ids of chunk(srcIds, ID_CHUNK)) {
            const got = await db.getAll(...ids.map((id) => tgtRoot.collection(c).doc(id)));
            got.forEach((d) => { if (!d.exists) missing++; });
          }
          result[c] = { source: srcIds.length, missing };
          if (missing) {
            phase = "docs"; cursor.col = 0; cursor.docId = null;
            await save({ status: "migrating" });
            throw new HttpsError("aborted", "옮기는 중 일부가 빠져 다시 시도해야 합니다. 원본은 그대로입니다.");
          }
        }
        // 첨부 경로 검사도 이번에 옮긴 조각에만 적용한다
        let checked = 0, badPath = 0;
        for (const ids of chunk(fragIds, ID_CHUNK)) {
          const got = await db.getAll(...ids.map((id) => tgtRoot.collection("fragments").doc(id)));
          got.forEach((d) => {
            (d.get("attachments") || []).forEach((a) => {
              checked++;
              if (a && a.path && !a.path.startsWith(`users/${job.targetUid}/`)) badPath++;
            });
          });
        }
        stats.verify = { ...result, attachments: checked, wrongPath: badPath };
        if (badPath > 0) {
          phase = "files";
          await save({ status: "migrating" });
          throw new HttpsError("aborted", "첨부 파일 주소를 아직 다 바꾸지 못했습니다. 다시 시도하면 이어서 진행합니다.");
        }
        phase = "completed";
        await save({
          status: "completed",
          completedAt: FieldValue.serverTimestamp(),
          sourcePreserved: true,                    // V1: 원본은 지우지 않는다
          cleanupAfter: Date.now() + 7 * 86400000,  // 나중에 정리 기능을 붙일 때 쓸 표시일 뿐
          leaseOwner: null, leaseExpiresAt: 0,
        });
        log("completed", jobId, "src", mask(job.sourceUid), "tgt", mask(job.targetUid), stats.verify);
      }

      return { done: true, status: "completed", stats };
    } catch (e) {
      await releaseLease();      // 실패해도 작업권은 놓아준다 — 곧바로 재시도할 수 있게
      throw e;
    }
  }
);

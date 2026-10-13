// HUB-FR-119 · HUB-FR-126 · HUB-FR-127 · HUB-FR-128 · HUB-FR-115 · HUB-FR-116 · HUB-BR-31 · HUB-BR-33 · PC-R04…R07, R09…R11, R13 ·
// P-c1 · plan §1 (luồng), §3.2, §6.3–6.5 · test-plan §3 F01–F12: Hub thật + Runtime giả. Launcher dựng `payload.autofix`, công cụ ép,
// resolve toàn repo; stage-driver theo kết quả (gate / "Cần người quyết" autofix_check_failed | sandbox_unavailable, chỉ
// add_attempt/cancel); Chưa đạt ⇒ vòng k+1 nhận `base_patch` cộng dồn cùng nhánh; view `autofix`; trần token 200k.
// Đỏ trước code: `needPc` (0031 vắng) + def `autofix` 400.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  afOf,
  afRows,
  C1,
  type CtxPc,
  DIFF,
  failedReport,
  internalGet,
  type Json,
  jobDone,
  jobToken,
  MD_AUTO,
  mkAf,
  needPc,
  nextStageJob,
  openTask,
  postReport,
  reportAndDone,
  reportFor,
  review,
  runRow,
  settlePc,
  stageView,
  startAf,
  startPc,
  waitDecision,
  waitStatus,
} from "./_support/pc";

let c: CtxPc;
beforeAll(async () => {
  c = await startPc();
  if (!c.pc) return;
  await mkAf(c, "pc-f", { install: "bun install", allow: ["src/**"] });
  await mkAf(c, "pc-fread", { read: [{ source_key: "docs-lib", allowlist: ["**"] }] });
  await mkAf(c, "pc-flocal", { source: "local-app" });
}, 60_000);
afterEach(async () => {
  await settlePc(c);
});
afterAll(async () => {
  await c?.stop();
});

const resolveItems = async (runId: string): Promise<Json[]> =>
  (
    await c.sql<Json[]>`select payload from hub.jobs where payload->>'type' = 'source.resolve'
      and payload->>'process_run_id' = ${runId} order by created_at`
  ).flatMap((r) => (r.payload?.items ?? []) as Json[]);

describe("F01–F03 · launcher dựng job tự-sửa [PC-R04, R05, R07]", () => {
  it("HUB-FR-126 · HUB-FR-128 · WRK-FR-28 · PC-R04 · PC-R05 · E1 · F01 · payload.autofix: nguồn ghim C1 allowlist [], lệnh, nhánh ai/<run>/fix, vòng 1, base_patch null; resolve item caps autofix + allowlist_union []", async () => {
    needPc(c);
    const a = await startAf(c, "pc-f");
    expect(afOf(a.job)).toEqual({
      source: {
        key: "app-repo",
        kind: "git_remote",
        pin: { kind: "git_remote", url: "https://github.com/pb-test/app-repo.git", sha: C1 },
        allowlist: [],
      },
      install_cmd: "bun install",
      test_cmd: "bun test",
      write_allowlist: ["src/**"],
      branch: `ai/${a.runId}/fix`,
      round: 1,
      base_patch: null,
    });
    const item = (await resolveItems(a.runId)).find((i) => i.key === "app-repo");
    expect({ caps: item?.caps, union: item?.allowlist_union }).toEqual({
      caps: "autofix",
      union: [],
    });
  }, 30_000);
  it("HUB-BR-31 · HUB-BR-33 · PC-R07 · F02 · allowed_tools: không nguồn chỉ-đọc ⇒ []; có nguồn chỉ-đọc ⇒ [Read,Grep,Glob]; không bao giờ Write", async () => {
    needPc(c);
    const a = await startAf(c, "pc-f");
    const b = await startAf(c, "pc-fread");
    expect(a.job.payload.allowed_tools).toEqual([]);
    expect(b.job.payload.allowed_tools).toEqual(["Read", "Grep", "Glob"]);
    expect(b.job.payload.sources?.map((s: Json) => s.key)).toEqual(["docs-lib"]);
  }, 30_000);
  it("HUB-FR-126 · Q3 · F03 · local_path: payload.autofix.source.kind local_path; view sau báo cáo có pin_sha null (không lộ path)", async () => {
    needPc(c);
    const a = await startAf(c, "pc-flocal");
    expect(afOf(a.job)?.source?.kind).toBe("local_path");
    await reportAndDone(c, a.job, a.token, reportFor(a.job));
    await waitStatus(c.sql, a.runId, "waiting_review");
    const v = await stageView(c, "A", a.runId);
    expect(v?.autofix?.pin_sha).toBeNull();
    expect(JSON.stringify(v?.autofix ?? {})).not.toContain("/qc-roots");
  }, 30_000);
});

describe("F04–F05 · gate + view [HUB-FR-128, PC-R09]", () => {
  it("HUB-FR-128 · HUB-FR-109 · F04 · ok ⇒ gate review; view autofix đủ (pin_sha, nhánh, vòng, thống kê, diff_file, test); A tải diff = nội dung; diff KHÔNG vào process_outputs", async () => {
    needPc(c);
    const a = await startAf(c, "pc-f");
    await reportAndDone(c, a.job, a.token, reportFor(a.job));
    await waitStatus(c.sql, a.runId, "waiting_review");
    expect(await openTask(c.sql, a.runId, "review")).toBeDefined();
    const v = (await stageView(c, "A", a.runId))?.autofix;
    expect({
      key: v?.source_key,
      pin: v?.pin_sha,
      branch: v?.branch,
      round: v?.round,
      status: v?.status,
      stats: v?.diff_stats,
      test: v?.test,
      fails: v?.failures,
    }).toEqual({
      key: "app-repo",
      pin: C1,
      branch: `ai/${a.runId}/fix`,
      round: 1,
      status: "ok",
      stats: { files: 1, insertions: 1, deletions: 1, bytes: DIFF.length },
      test: { exit_code: 0, duration_ms: 12_400 },
      fails: [],
    });
    expect(v?.diff_file?.name).toBe("fix-r1.diff.txt");
    const got = await c.call("A", "GET", `/attachments/${v?.diff_file?.id}/content`);
    expect([got.status, got.text]).toEqual([200, DIFF]);
    const outs = await c.sql<
      Json[]
    >`select attachment_id from hub.process_outputs where process_run_id = ${a.runId}`;
    expect(outs.map((o) => o.attachment_id)).not.toContain(v?.diff_file?.id);
  }, 30_000);
  it("HUB-FR-128 · PC-R09 · F05 · no_changes ⇒ vẫn qua gate; view status no_changes, diff_file null; Đạt ⇒ run done", async () => {
    needPc(c);
    const a = await startAf(c, "pc-f");
    await reportAndDone(
      c,
      a.job,
      a.token,
      reportFor(a.job, { status: "no_changes", diff: null, diff_stats: null }),
    );
    await waitStatus(c.sql, a.runId, "waiting_review");
    const v = (await stageView(c, "A", a.runId))?.autofix;
    expect([v?.status, v?.diff_file]).toEqual(["no_changes", null]);
    const t = await openTask(c.sql, a.runId, "review");
    expect((await review(c, "B", t?.id, { result: "pass" })).status).toBe(200);
    await waitStatus(c.sql, a.runId, "done");
  }, 30_000);
});

describe("F06–F09 · Cần người quyết [PC-R06, PC-R10]", () => {
  it("HUB-FR-115 · PC-R10 · F06 · check_failed ⇒ needs_decision autofix_check_failed, options [add_attempt, cancel]; use_current bị từ chối; add_attempt ⇒ vòng 2, prompt có tóm tắt lỗi, KHÔNG giá trị bí mật", async () => {
    needPc(c);
    const a = await startAf(c, "pc-f");
    const secret = "AKIAQCQCQCQCQCQCQCQC";
    const fails = [
      { check: "secrets", path: "src/cfg.ts", line: 7, rule: "aws_key", detail: `khớp ${secret}` },
    ];
    await reportAndDone(c, a.job, a.token, failedReport(a.job, fails));
    const d = await waitDecision(c.sql, a.runId);
    expect({ reason: d?.reason, options: d?.options }).toEqual({
      reason: "autofix_check_failed",
      options: ["add_attempt", "cancel"],
    });
    const cur = await c.call("A", "POST", `/process-runs/${a.runId}/decide`, {
      option: "use_current",
    });
    expect(cur.status).toBeGreaterThanOrEqual(400);
    expect((await runRow(c.sql, a.runId)).status).toBe("needs_decision");
    expect(
      (await c.call("A", "POST", `/process-runs/${a.runId}/decide`, { option: "add_attempt" }))
        .status,
    ).toBe(200);
    const j2 = await nextStageJob(c, a.runId);
    const prompt = String(j2.payload.prompt ?? "");
    expect(prompt).toContain("src/cfg.ts:7");
    expect(prompt).not.toContain(secret);
    expect({
      round: afOf(j2)?.round,
      base: afOf(j2)?.base_patch,
      branch: afOf(j2)?.branch,
    }).toEqual({
      round: 2,
      base: null,
      branch: `ai/${a.runId}/fix`,
    });
  }, 45_000);
  it("HUB-FR-115 · PC-R10 · plan Edge · F07 · job xong KHÔNG báo cáo ⇒ autofix_check_failed (không qua gate)", async () => {
    needPc(c);
    const a = await startAf(c, "pc-f");
    await jobDone(c, a.job, MD_AUTO);
    const d = await waitDecision(c.sql, a.runId);
    expect([d?.reason, await openTask(c.sql, a.runId, "review")]).toEqual([
      "autofix_check_failed",
      undefined,
    ]);
  }, 30_000);
  it("HUB-FR-127 · HUB-BR-33 · WRK-BR-08 · PC-R06 · F08 · job lỗi reason container ⇒ needs_decision sandbox_unavailable, options [add_attempt, cancel]", async () => {
    needPc(c);
    const a = await startAf(c, "pc-f");
    await c.rt.fail(a.job, "INTERNAL_ERROR", "không dựng được container", "container" as never);
    const d = await waitDecision(c.sql, a.runId);
    expect({ reason: d?.reason, options: d?.options }).toEqual({
      reason: "sandbox_unavailable",
      options: ["add_attempt", "cancel"],
    });
  }, 30_000);
  it("HUB-FR-115 · plan Edge apply_patch · F09 · Thêm lượt sau check_failed{apply_patch} ⇒ base_patch null", async () => {
    needPc(c);
    const a = await startAf(c, "pc-f");
    await reportAndDone(c, a.job, a.token, reportFor(a.job));
    await waitStatus(c.sql, a.runId, "waiting_review");
    const t = await openTask(c.sql, a.runId, "review");
    await review(c, "B", t?.id, { result: "fail", feedback: "Sửa thêm" });
    const j2 = await nextStageJob(c, a.runId);
    const tk2 = await jobToken(c.sql, j2);
    await reportAndDone(
      c,
      j2,
      tk2,
      failedReport(j2, [{ check: "apply_patch", detail: "patch không áp được" }]),
    );
    await waitDecision(c.sql, a.runId);
    await c.call("A", "POST", `/process-runs/${a.runId}/decide`, { option: "add_attempt" });
    const j3 = await nextStageJob(c, a.runId);
    expect(afOf(j3)?.base_patch).toBeNull();
  }, 45_000);
});

describe("F10–F12 · làm lại cộng dồn + trần token [PC-R11, PC-R13]", () => {
  it("HUB-FR-128 · E3 · PC-R11 · F10 · Chưa đạt ⇒ vòng 2 cùng nhánh, base_patch = diff vòng 1; job 2 tải được base_patch; view vòng 2", async () => {
    needPc(c);
    const a = await startAf(c, "pc-f");
    await reportAndDone(c, a.job, a.token, reportFor(a.job));
    await waitStatus(c.sql, a.runId, "waiting_review");
    const [r1] = await afRows(c.sql, a.runId);
    const t = await openTask(c.sql, a.runId, "review");
    expect(
      (await review(c, "B", t?.id, { result: "fail", feedback: "Thiếu ca biên" })).status,
    ).toBe(200);
    const j2 = await nextStageJob(c, a.runId);
    const af2 = afOf(j2);
    expect({ round: af2?.round, branch: af2?.branch, base: af2?.base_patch?.id }).toEqual({
      round: 2,
      branch: `ai/${a.runId}/fix`,
      base: r1?.diff_attachment_id,
    });
    const tk2 = await jobToken(c.sql, j2);
    const dl = await internalGet(c, j2.id, tk2, af2?.base_patch?.id);
    expect([dl.status, dl.text]).toEqual([200, DIFF]);
    const diff2 = `${DIFF}diff --git a/src/b.ts b/src/b.ts\n`;
    await reportAndDone(
      c,
      j2,
      tk2,
      reportFor(j2, {
        diff: diff2,
        diff_stats: { files: 2, insertions: 2, deletions: 1, bytes: diff2.length },
      }),
    );
    await waitStatus(c.sql, a.runId, "waiting_review");
    const v = (await stageView(c, "A", a.runId))?.autofix;
    expect([v?.round, v?.diff_file?.name, v?.diff_stats?.files]).toEqual([2, "fix-r2.diff.txt", 2]);
  }, 45_000);
  it("HUB-FR-128 · F11 · check_failed có test ⇒ view.test_log_file ≠ null, failures giữ nguyên thứ tự", async () => {
    needPc(c);
    const a = await startAf(c, "pc-f");
    const fails = [
      { check: "paths", path: ".github/workflows/ci.yml", detail: "đường dẫn cấm" },
      { check: "tests", detail: "exit 1" },
    ];
    await reportAndDone(
      c,
      a.job,
      a.token,
      failedReport(a.job, fails, { exit_code: 1, duration_ms: 2_000, log_tail: "1 fail" }),
    );
    await waitDecision(c.sql, a.runId);
    const v = (await stageView(c, "A", a.runId))?.autofix;
    expect([v?.status, v?.diff_file, v?.test_log_file !== null, v?.failures]).toEqual([
      "check_failed",
      null,
      true,
      fails,
    ]);
  }, 30_000);
  it("HUB-FR-116 · PC-R13 · F12 · stage tự-sửa token_budget null ⇒ trần 200000: dùng 210000 ⇒ needs_decision stage_tokens", async () => {
    needPc(c);
    const a = await startAf(c, "pc-f");
    const r = await postReport(c, a.job.id, a.token, reportFor(a.job));
    expect(r.status).toBe(201);
    await jobDone(c, a.job, MD_AUTO, { input: 200_000, output: 10_000 });
    expect((await waitDecision(c.sql, a.runId))?.reason).toBe("stage_tokens");
  }, 30_000);
});

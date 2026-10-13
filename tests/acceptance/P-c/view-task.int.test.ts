// HUB-FR-128 · HUB-FR-115 · PC-R10 · PC-R14 · P-c1 · vá review: view TASK (người duyệt không phải chủ run) và task
// quyết định. Hub thật + Runtime giả (như flow.int).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  afDefBody,
  afStage,
  type CtxPc,
  failedReport,
  type Json,
  jobDone,
  jobToken,
  MD_AUTO,
  mkAf,
  needPc,
  nextStageJob,
  openTask,
  PA_FIX,
  postDef,
  reportAndDone,
  reportFor,
  review,
  settlePc,
  startAf,
  startPc,
  viewOf,
  waitDecision,
  waitFor,
  waitStatus,
} from "./_support/pc";

let c: CtxPc;
beforeAll(async () => {
  c = await startPc2();
}, 60_000);
afterEach(async () => {
  await settlePc(c);
});
afterAll(async () => {
  await c?.stop();
});

async function startPc2(): Promise<CtxPc> {
  const ctx = await startPc();
  if (!ctx.pc) return ctx;
  await mkAf(ctx, "pc-vt-one", { allow: ["src/**"] });
  // PC-R… một def chỉ có MỘT stage tự-sửa (AUTOFIX_MAX) ⇒ stage 1 là stage thường, duyệt bởi cùng nhóm.
  const plain = {
    ...afStage({ key: "doc" }),
    name: "Viết tài liệu",
    autofix: null,
    after: { kind: "review", group_id: PA_FIX.gPO },
  };
  const body = afDefBody("pc-vt-two", [afStage({ key: "fix", allow: ["src/**"] }), plain]);
  const r = await postDef(ctx, body);
  expect({ def: "pc-vt-two", status: r.status, err: r.json?.error }).toEqual({
    def: "pc-vt-two",
    status: 201,
    err: undefined,
  });
  return ctx;
}

describe("V01–V02 · view task chỉ thấy autofix của stage mình duyệt [HUB-FR-128, PC-R14]", () => {
  it("HUB-FR-128 · PC-R14 · V01 · stage 0 tự-sửa đã được T duyệt Đạt, stage 1 (thường) chờ nhóm PO: stage thường không mang autofix; X (không task, không quyền xem) 404 không lộ nhánh/diff; chủ run A vẫn có autofix stage 0", async () => {
    needPc(c);
    const a = await startAf(c, "pc-vt-two");
    await reportAndDone(c, a.job, a.token, reportFor(a.job));
    await waitStatus(c.sql, a.runId, "waiting_review");
    const t0 = await openTask(c.sql, a.runId, "review");
    expect((await review(c, "T", t0?.id, { result: "pass" })).status).toBe(200);
    const j2 = await nextStageJob(c, a.runId);
    await jobDone(c, j2, MD_AUTO);
    await waitFor(
      () => openTask(c.sql, a.runId, "review"),
      (t) => t !== undefined && t.stage_idx === 1,
      8_000,
    );
    // Stage 1 (thường) không bao giờ mang `autofix`; người không có task / không có quyền xem run không nhận diff.
    const vb = await viewOf(c, "B", a.runId);
    expect(vb.status).toBe(200);
    expect(((vb.json?.stages ?? []) as Json[])[1]?.autofix).toBeUndefined();
    const vx = await viewOf(c, "X", a.runId);
    expect(vx.status).toBe(404);
    expect(JSON.stringify(vx.json ?? {})).not.toContain(`ai/${a.runId}/fix`);
    const sa = ((await viewOf(c, "A", a.runId)).json?.stages ?? []) as Json[];
    expect(sa[0]?.autofix?.branch).toBe(`ai/${a.runId}/fix`);
  }, 60_000);
  it("HUB-FR-128 · PC-R14 · V02 · B duyệt stage 0 (1 stage): B nhận autofix của stage 0 (view task đủ diff_file/failures/test)", async () => {
    needPc(c);
    const a = await startAf(c, "pc-vt-one");
    await reportAndDone(c, a.job, a.token, reportFor(a.job));
    await waitStatus(c.sql, a.runId, "waiting_review");
    const v = ((await viewOf(c, "B", a.runId)).json?.stages ?? [])[0]?.autofix;
    expect([v?.status, v?.round, v?.diff_file !== null, v?.test?.exit_code]).toEqual([
      "ok",
      1,
      true,
      0,
    ]);
  }, 45_000);
});

describe("V03 · options của task quyết định autofix_* [HUB-FR-115, PC-R10]", () => {
  it("HUB-FR-115 · PC-R10 · V03 · task decision trong view (my_tasks) của autofix_check_failed có options [add_attempt, cancel], KHÔNG use_current (kể cả stage đã có output)", async () => {
    needPc(c);
    const a = await startAf(c, "pc-vt-one");
    await jobDone(c, a.job, MD_AUTO); // không báo cáo ⇒ autofix_check_failed; stage đã có output (md)
    const d = await waitDecision(c.sql, a.runId);
    expect(d?.options).toEqual(["add_attempt", "cancel"]);
    const tasks = ((await viewOf(c, "A", a.runId)).json?.my_tasks ?? []) as Json[];
    const dec = tasks.find((t) => t.kind === "decision");
    expect({ reason: dec?.reason, options: dec?.options }).toEqual({
      reason: "autofix_check_failed",
      options: ["add_attempt", "cancel"],
    });
  }, 45_000);
  it("HUB-FR-115 · PC-R10 · V04 · vòng 1 có output (đã được duyệt Chưa đạt), vòng 2 check_failed ⇒ decision có output: task trong view vẫn KHÔNG có use_current", async () => {
    needPc(c);
    const a = await startAf(c, "pc-vt-one");
    await reportAndDone(c, a.job, a.token, reportFor(a.job));
    await waitStatus(c.sql, a.runId, "waiting_review");
    const t = await openTask(c.sql, a.runId, "review");
    expect((await review(c, "B", t?.id, { result: "fail", feedback: "Sửa thêm" })).status).toBe(
      200,
    );
    const j2 = await nextStageJob(c, a.runId);
    const tk2 = await jobToken(c.sql, j2);
    await reportAndDone(c, j2, tk2, failedReport(j2, [{ check: "tests", detail: "exit 1" }]));
    const d = await waitDecision(c.sql, a.runId);
    expect(d?.options).toEqual(["add_attempt", "cancel"]);
    const tasks = ((await viewOf(c, "A", a.runId)).json?.my_tasks ?? []) as Json[];
    const dec = tasks.find((x) => x.kind === "decision" && x.status === "open");
    expect({ reason: dec?.reason, has_output: dec?.has_output, options: dec?.options }).toEqual({
      reason: "autofix_check_failed",
      has_output: true,
      options: ["add_attempt", "cancel"],
    });
  }, 60_000);
  it("HUB-FR-115 · PC-R10 · V05 · decision autofix_* có output: GET /me/review-tasks (hàng đợi của người quyết) cũng KHÔNG đưa use_current vào task.options", async () => {
    needPc(c);
    const a = await startAf(c, "pc-vt-one");
    await reportAndDone(c, a.job, a.token, reportFor(a.job));
    await waitStatus(c.sql, a.runId, "waiting_review");
    const t = await openTask(c.sql, a.runId, "review");
    expect((await review(c, "B", t?.id, { result: "fail", feedback: "Sửa thêm" })).status).toBe(
      200,
    );
    const j2 = await nextStageJob(c, a.runId);
    const tk2 = await jobToken(c.sql, j2);
    await reportAndDone(c, j2, tk2, failedReport(j2, [{ check: "tests", detail: "exit 1" }]));
    await waitDecision(c.sql, a.runId);
    const list = await c.call("A", "GET", "/me/review-tasks?status=open&limit=50");
    expect(list.status).toBe(200);
    const mine = ((list.json?.items ?? []) as Json[]).find(
      (i) => i.process_run?.id === a.runId && i.task?.kind === "decision",
    );
    expect({
      reason: mine?.task?.reason,
      has_output: mine?.task?.has_output,
      options: mine?.task?.options,
    }).toEqual({
      reason: "autofix_check_failed",
      has_output: true,
      options: ["add_attempt", "cancel"],
    });
  }, 60_000);
});

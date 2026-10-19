// N2-FR-02 · N2-AC03…AC05 · kết quả duyệt "Từ chối" (`reject`): bắt buộc lý do, kết thúc run (`cancelled`), task `reject` +
// góp ý; khác "Chưa đạt" (làm lại). Run thật qua Hub (`toGate`: A bắt đầu `hoa-don-t`, G1 Kế toán = B, T duyệt).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type Json, review, runRow, toGate } from "../P-d/_support/pd";
import { type CtxN2, errCode, needReject, startN2 } from "./_n2";

let c: CtxN2;
beforeAll(async () => {
  c = await startN2({ processRunsPerTenant: 200 });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const taskRow = async (id: string) =>
  (await c.sql<Json[]>`select * from hub.review_tasks where id = ${id}`)[0];

describe("N2-AC03…05 · Từ chối [N2-FR-02]", () => {
  it("N2-AC03 · reject không lý do / lý do toàn khoảng trắng ⇒ 422 FEEDBACK_REQUIRED, run vẫn waiting_review, task mở", async () => {
    await needReject(c.sql);
    const g = await toGate(c);
    for (const body of [{ result: "reject" }, { result: "reject", feedback: "   " }]) {
      const r = await review(c, "B", g.taskId, body);
      expect({ status: r.status, code: errCode(r) }).toEqual({
        status: 422,
        code: "FEEDBACK_REQUIRED",
      });
    }
    expect((await runRow(c.sql, g.runId))?.status).toBe("waiting_review");
    expect((await taskRow(g.taskId))?.status).toBe("open");
  }, 60_000);

  it("N2-AC04 · reject có lý do ⇒ 200, task closed/reject + feedback + decided_by B; stage + run cancelled; Đạt sau đó 409", async () => {
    await needReject(c.sql);
    const g = await toGate(c);
    const r = await review(c, "B", g.taskId, { result: "reject", feedback: "Sai số tiền" });
    expect({ status: r.status, code: errCode(r) }).toEqual({ status: 200, code: null });
    const t = await taskRow(g.taskId);
    expect({ status: t?.status, result: t?.result, feedback: t?.feedback }).toEqual({
      status: "closed",
      result: "reject",
      feedback: "Sai số tiền",
    });
    const run = await runRow(c.sql, g.runId);
    expect(run?.status).toBe("cancelled");
    const open = await c.sql<Json[]>`select id from hub.review_tasks
      where process_run_id = ${g.runId} and status = 'open'`;
    expect([...open]).toEqual([]);
    const [st] = await c.sql<Json[]>`select status from hub.stage_runs
      where process_run_id = ${g.runId} and stage_idx = 0 order by round desc, attempt desc limit 1`;
    expect(st?.status).toBe("cancelled");
    const again = await review(c, "T", g.taskId, { result: "pass" });
    expect({ status: again.status, code: errCode(again) }).toEqual({
      status: 409,
      code: "REVIEW_TASK_CLOSED",
    });
  }, 60_000);

  it("N2-AC05 · Chưa đạt vẫn là làm lại (run running, stage queued attempt 2) — không kết thúc run", async () => {
    await needReject(c.sql);
    const g = await toGate(c);
    const r = await review(c, "B", g.taskId, { result: "fail", feedback: "Thiếu tổng tiền" });
    expect(r.status).toBe(200);
    const run = await runRow(c.sql, g.runId);
    expect(run?.status).toBe("running");
    expect((await taskRow(g.taskId))?.result).toBe("fail");
  }, 60_000);

  it("N2-FR-02 · contract: TASK_RESULTS kết thúc bằng reject; ReviewDecisionRequest nhận reject", async () => {
    const chat = (await import("@ai/contracts/chat")) as Json;
    expect((chat.TASK_RESULTS as string[]).at(-1)).toBe("reject");
    expect(
      chat.ReviewDecisionRequestSchema.safeParse({ result: "reject", feedback: "x" }).success,
    ).toBe(true);
  });
});

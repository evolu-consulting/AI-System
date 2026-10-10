// HUB-FR-110 · AC-H30 · P2-02, P2-13 (test-plan-int §3): trả lời task ask — đầu thắng ⇒ task closed, stage `queued`, `kick`
// sau COMMIT (stageLauncher giả ghi runId). Fixture SQL run `waiting_answer` (không cần PF1). Đỏ trước code ở `needSchema`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CtxPa, PA, PA_FIX, startPa } from "../_support/pa";
import { needSchema } from "../_support/schema";
import { answer, askRun, assignees, audits, seedDef, stageStatus, taskRow } from "./_local";

let c: CtxPa;
beforeAll(async () => {
  c = await startPa();
  if (!c.ready) return;
  await seedDef(c);
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("P2-02 · trả lời ask [HUB-FR-110]", () => {
  it("HUB-FR-110 · P2-02 · A trả lời ⇒ 200 result=answer; task closed; stage queued; kick(runId) đúng 1 lần; audit answer", async () => {
    needSchema(c.ready);
    const f = await askRun(c);
    const k0 = c.hub.kicks.length;
    const r = await answer(c, "A", f.taskId, { answer: "Tháng 9", choice: "Tháng 9" });
    expect(r.status).toBe(200);
    expect(r.json?.result).toBe("answer");
    expect(r.json?.status).toBe("closed");
    expect(r.json?.can_act).toBe(false);
    expect(await taskRow(c, f.taskId)).toMatchObject({
      status: "closed",
      result: "answer",
      answer: "Tháng 9",
    });
    expect(await stageStatus(c, f.run.stageRunIds[0] as string)).toBe("queued");
    const [run] = await c.sql`select status from hub.process_runs where id = ${f.run.runId}`;
    expect(run?.status).toBe("running");
    expect(c.hub.kicks.slice(k0)).toEqual([f.run.runId]);
    expect((await audits(c, f.taskId, "answer")).map((a) => a.actor_id)).toEqual([PA.A.id]);
  });
});

describe("P2-13 · ai trả lời được [§3, Q7]", () => {
  it("HUB-FR-110 · P2-13 · X (thành viên R, không assignee) ⇒ 404; D (beta) ⇒ 404; task vẫn open", async () => {
    needSchema(c.ready);
    const f = await askRun(c);
    expect((await answer(c, "X", f.taskId)).status).toBe(404);
    expect((await answer(c, "D", f.taskId)).status).toBe(404);
    expect(
      (
        await c.call("D", "POST", `/review-tasks/${f.taskId}/answer?tenant_id=${PA.A.tid}`, {
          answer: "x",
        })
      ).status,
    ).toBe(404);
    expect((await taskRow(c, f.taskId))?.status).toBe("open");
  });
  it("HUB-FR-110 · P2-13 · answerer=group Kế toán ⇒ mọi thành viên là assignee: T trả lời 200, B sau ⇒ 409 REVIEW_TASK_CLOSED", async () => {
    needSchema(c.ready);
    const f = await askRun(c, { groupId: PA_FIX.gKeToan });
    expect((await assignees(c, f.taskId)).map((a) => a.group_id)).toEqual([PA_FIX.gKeToan]);
    const t = await answer(c, "T", f.taskId, { answer: "Tháng 10" });
    expect(t.status).toBe(200);
    const b = await answer(c, "B", f.taskId, { answer: "Tháng 9" });
    expect(b.status).toBe(409);
    expect(b.json?.error?.code).toBe("REVIEW_TASK_CLOSED");
    expect(
      (await answer(c, "X", (await askRun(c, { groupId: PA_FIX.gKeToan })).taskId)).status,
    ).toBe(404);
  });
});

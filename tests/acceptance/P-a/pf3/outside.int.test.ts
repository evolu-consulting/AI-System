// HUB-BR-25 · AC-H29 · T8 · T9 · P3-08, P3-10, P3-11 (test-plan-int §4): người kiểm ngoài phòng T (Group Kế toán, không ở R).
// P3-08 ⇢PF1 (`GET /process-runs/:id` + output — PF1), P3-10 ⇢PF1 (`POST /review-tasks/:id/decision` — PF1): chỉ xanh khi PF1
// vào `main`. P3-11: fixture 3 tin `process` đăng bằng `postThreadOnce` (B0). Đỏ trước code ở `needSchema`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { openMeStream } from "../../X2a/_x2a";
import {
  type CtxPa,
  insertEvent,
  insertOutput,
  type Json,
  PA,
  PA_FIX,
  part,
  startPa,
} from "../_support/pa";
import { needSchema } from "../_support/schema";
import { myTaskIds, notices, reviewRun, seedDef } from "./_local";

let c: CtxPa;
beforeAll(async () => {
  c = await startPa();
  if (!c.ready) return;
  await seedDef(c);
}, 60_000);
afterAll(async () => {
  await c?.stop();
});
const views = (id: string) =>
  c.sql<
    Json[]
  >`select count(*)::int as n from hub.audit_log where action = 'view' and entity = 'review_task' and entity_id = ${id}`;

describe("P3-08 ⇢PF1 · T mở task [AC-H29]", () => {
  it("AC-H29 · P3-08 ⇢PF1 · T GET run ⇒ access=task (my_tasks review, không input/history/thread); output đang kiểm 200; output phiên bản khác 404; audit view", async () => {
    needSchema(c.ready);
    const f = await reviewRun(c);
    const other = await insertOutput(c.sql, {
      tid: PA.A.tid,
      runId: f.run.runId,
      stageRunId: f.run.stageRunIds[0] as string,
      stageIdx: 0,
      version: 2,
    });
    const v = await c.call("T", "GET", `/process-runs/${f.run.runId}`);
    expect(v.status).toBe(200);
    expect(v.json?.access).toBe("task");
    expect((v.json?.my_tasks ?? []).map((t: Json) => t.id)).toEqual([f.taskId]);
    for (const k of ["input", "history", "thread", "decision", "outputs"])
      expect(v.json?.[k]).toBeUndefined();
    expect(
      (await c.call("T", "GET", `/process-runs/${f.run.runId}/outputs/${f.outputId}`)).status,
    ).toBe(200);
    expect((await c.call("T", "GET", `/process-runs/${f.run.runId}/outputs/${other}`)).status).toBe(
      404,
    );
    expect((await views(f.taskId))[0]?.n).toBeGreaterThanOrEqual(1);
  });
});

describe("P3-10 ⇢PF1 · T Đạt từ ngoài phòng [T8]", () => {
  it("AC-H29 · P3-10 ⇢PF1 · T Đạt ⇒ thread F có task_result{actor T, outside, pass} cho B, X; T GET /rooms/R + ?flow_id=F ⇒ 404; T closed list có TaskDetail can_act=false", async () => {
    needSchema(c.ready);
    const h = c.hub.handles();
    expect({ postThreadOnce: typeof h?.postThreadOnce }).toEqual({ postThreadOnce: "function" });
    const f = await reviewRun(c);
    const r = await c.call("T", "POST", `/review-tasks/${f.taskId}/decision`, { result: "pass" });
    expect(r.status).toBe(200);
    await h.postThreadOnce();
    for (const who of ["B", "X"] as const) {
      const m = await c.call(who, "GET", `/rooms/${PA_FIX.room}/messages?flow_id=${f.run.flowId}`);
      expect(m.status).toBe(200);
      const tr = (m.json?.items ?? []).find((x: Json) => x.process?.kind === "task_result");
      expect(tr?.process).toMatchObject({ task_id: f.taskId, result: "pass", outside: true });
      expect(tr?.process?.actor?.id).toBe(PA.T.id);
    }
    const a = await c.call("T", "GET", `/rooms/${PA_FIX.room}/messages?flow_id=${f.run.flowId}`);
    const b = await c.call("T", "GET", `/rooms/${PA_FIX.room}`);
    expect([a.status, b.status]).toEqual([404, 404]);
    expect(await myTaskIds(c, "T")).not.toContain(f.taskId);
    const cl = await c.call("T", "GET", "/me/review-tasks?status=closed");
    const it0 = (cl.json?.items ?? []).find((i: Json) => i.task?.id === f.taskId);
    expect(it0?.task).toMatchObject({ status: "closed", result: "pass", can_act: false });
  });
});

describe("P3-11 · tin thread không tới T [T8, T9]", () => {
  it("HUB-BR-25 · P3-11 · 3 tin process đăng vào R ⇒ T không nhận room.message/room.unread của R; không notice cho X; T không đọc thread", async () => {
    needSchema(c.ready);
    const h = c.hub.handles();
    expect({ postThreadOnce: typeof h?.postThreadOnce }).toEqual({ postThreadOnce: "function" });
    const f = await reviewRun(c);
    const nX0 = (await notices(c, PA.X.id)).length;
    const sT = await openMeStream(c.hub, await c.tok("T"));
    const sB = await openMeStream(c.hub, await c.tok("B"));
    try {
      await insertEvent(c.sql, {
        runId: f.run.runId,
        roomId: PA_FIX.room,
        meta: part.block(f.run.runId),
      });
      await insertEvent(c.sql, {
        runId: f.run.runId,
        roomId: PA_FIX.room,
        meta: part.output(f.run.runId, f.outputId),
      });
      const last = await insertEvent(c.sql, {
        runId: f.run.runId,
        roomId: PA_FIX.room,
        meta: part.task_result(f.run.runId, PA.B, f.taskId),
      });
      expect(await h.postThreadOnce()).toBe(3);
      expect(
        (await sB.until((e) => e.event === "room.message" && e.data?.message?.id === last, 5_000))
          ?.event,
      ).toBe("room.message");
      const roomEv = sT.events.filter(
        (e) =>
          (e.event === "room.message" || e.event === "room.unread") &&
          (e.data?.room_id === PA_FIX.room || e.data?.message?.room_id === PA_FIX.room),
      );
      expect(roomEv).toEqual([]);
    } finally {
      sT.close();
      sB.close();
    }
    expect((await notices(c, PA.X.id)).length).toBe(nX0);
    expect(
      (await c.call("T", "GET", `/rooms/${PA_FIX.room}/messages?flow_id=${f.run.flowId}`)).status,
    ).toBe(404);
  });
});

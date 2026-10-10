// HUB-FR-112 · CHAT-AC-54 · CHAT-AC-55 · HUB-BR-25 · D12 · P3-01, P3-02, P3-03, P3-09, P3-12 (test-plan-int §4; plan-contract §3
// `/me/review-tasks`, `/me/process-inbox*`). Fixture SQL task review + notice (không cần PF1). P3-12 ⇢PF1 (cần PF1 mở
// decision qua `POST /review-tasks/:id/decision`) chỉ xanh khi PF1 vào `main`. Đỏ trước code ở `needSchema`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { adminChange } from "../../H1/_fixtures";
import { type CtxPa, type Json, PA, PA_FIX, startPa, T, waitFor } from "../_support/pa";
import { needSchema } from "../_support/schema";
import { insertNotice, myTaskIds, notices, reviewRun, seedDef } from "./_local";

let c: CtxPa;
beforeAll(async () => {
  c = await startPa();
  if (!c.ready) return;
  await seedDef(c);
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("P3-01, P3-02 · Chờ tôi kiểm [CHAT-AC-54]", () => {
  it("CHAT-AC-54 · P3-01 · task review Group Kế toán: T, B thấy; H, X không; open_count; item.task là TaskDetail can_act=true", async () => {
    needSchema(c.ready);
    const f = await reviewRun(c);
    for (const r of ["T", "B"] as const) {
      const res = await c.call(r, "GET", "/me/review-tasks");
      expect(res.status).toBe(200);
      const it0 = (res.json?.items ?? []).find((i: Json) => i.task?.id === f.taskId);
      expect(it0?.task).toMatchObject({
        kind: "review",
        status: "open",
        stage_idx: 0,
        can_act: true,
      });
      expect(it0?.process_run).toMatchObject({ id: f.run.runId, status: "waiting_review" });
      expect(it0?.process_run?.started_by?.id).toBe(PA.A.id);
      expect(res.json?.open_count).toBeGreaterThanOrEqual(1);
      const { TaskDetailSchema: S } = (await import("@ai/contracts/chat")) as Json;
      expect(S?.safeParse?.(it0?.task)?.success).toBe(true);
    }
    for (const r of ["H", "X"] as const) expect(await myTaskIds(c, r)).not.toContain(f.taskId);
  });
  it("CHAT-AC-54 · P3-01 · status=closed tách khỏi open; open_count không phụ thuộc status; cursor limit=2 qua 3 task không trùng", async () => {
    needSchema(c.ready);
    const closed = await reviewRun(c, { status: "closed" });
    expect(await myTaskIds(c, "T")).not.toContain(closed.taskId);
    expect(await myTaskIds(c, "T", "?status=closed")).toContain(closed.taskId);
    const a = await c.call("T", "GET", "/me/review-tasks");
    const b = await c.call("T", "GET", "/me/review-tasks?status=closed");
    expect(b.json?.open_count).toBe(a.json?.open_count);
    for (let i = 0; i < 3; i++) await reviewRun(c);
    const p1 = await c.call("T", "GET", "/me/review-tasks?limit=2");
    expect(p1.json?.items?.length).toBe(2);
    expect(typeof p1.json?.next_cursor).toBe("string");
    const p2 = await c.call(
      "T",
      "GET",
      `/me/review-tasks?limit=2&cursor=${encodeURIComponent(p1.json?.next_cursor)}`,
    );
    expect(p2.status).toBe(200);
    const ids1 = p1.json.items.map((i: Json) => i.task.id);
    const ids2 = (p2.json?.items ?? []).map((i: Json) => i.task.id);
    expect(ids2.length).toBeGreaterThan(0);
    expect(ids1.filter((x: string) => ids2.includes(x))).toEqual([]);
  });
  it("HUB-FR-112 · P3-02 · task đóng (SQL) biến khỏi open của T, B", async () => {
    needSchema(c.ready);
    const f = await reviewRun(c);
    expect(await myTaskIds(c, "T")).toContain(f.taskId);
    await c.sql`update hub.review_tasks set status = 'closed', result = 'pass', decided_by = ${PA.B.id}, decided_at = now()
      where id = ${f.taskId}`;
    expect(await myTaskIds(c, "T")).not.toContain(f.taskId);
    expect(await myTaskIds(c, "B")).not.toContain(f.taskId);
  });
});

describe("P3-03 · DM Quy trình [CHAT-AC-55, D12]", () => {
  it("CHAT-AC-55 · P3-03 · T: sender=PROCESS_SYSTEM_SENDER, unread=1, item strict ProcessNotice (không nội dung); read ⇒ unread 0; id notice của A ⇒ 404", async () => {
    needSchema(c.ready);
    const f = await reviewRun(c);
    const nT = await insertNotice(c, { user: PA.T, runId: f.run.runId, taskId: f.taskId });
    const nA = await insertNotice(c, { user: PA.A, runId: f.run.runId, kind: "run_finished" });
    const C = (await import("@ai/contracts/chat")) as Json;
    const r = await c.call("T", "GET", "/me/process-inbox");
    expect(r.status).toBe(200);
    expect(r.json?.sender).toEqual(C.PROCESS_SYSTEM_SENDER);
    expect(r.json?.sender).toEqual({ key: "process", name: { vi: "Quy trình", en: "Processes" } });
    expect(r.json?.unread).toBe(1);
    expect((r.json?.items ?? []).map((i: Json) => i.id)).toEqual([nT]);
    const item = r.json?.items?.[0];
    expect(item).toMatchObject({
      kind: "review_requested",
      process_run_id: f.run.runId,
      task_id: f.taskId,
      read: false,
    });
    expect(C.ProcessNoticeSchema?.safeParse?.(item)?.success).toBe(true);
    for (const k of ["content", "output", "question", "input"]) expect(item?.[k]).toBeUndefined();
    const bad = await c.call("T", "POST", "/me/process-inbox/read", { up_to_id: nA });
    expect(bad.status).toBe(404);
    const rd = await c.call("T", "POST", "/me/process-inbox/read", { up_to_id: nT });
    expect(rd.status).toBe(200);
    expect(rd.json?.unread).toBe(0);
    expect((await c.call("T", "GET", "/me/process-inbox")).json?.unread).toBe(0);
  });
});

describe("P3-09 · gỡ khỏi Group + tenant khác [HUB-BR-25]", () => {
  it("HUB-BR-25 · P3-09 · B bị gỡ khỏi Group Kế toán ⇒ không còn thấy task; D (beta) thấy 0", async () => {
    needSchema(c.ready);
    const f = await reviewRun(c);
    expect(await myTaskIds(c, "B")).toContain(f.taskId);
    expect(await myTaskIds(c, "D")).toEqual([]);
    await adminChange(
      c.sql,
      "user",
      T.acme,
      (tx) =>
        tx`delete from admin.group_members where group_id = ${PA_FIX.gKeToan} and user_id = ${PA.B.id}`,
    );
    const ids = await waitFor(
      () => myTaskIds(c, "B"),
      (v) => !v.includes(f.taskId),
      5_000,
    );
    expect(ids).not.toContain(f.taskId);
    expect(
      (await c.call("B", "POST", `/review-tasks/${f.taskId}/forward`, { to_user_id: PA.T.id }))
        .status,
    ).toBe(404);
    await c.sql`insert into admin.group_members (tenant_id, group_id, user_id) values (${T.acme}, ${PA_FIX.gKeToan}, ${PA.B.id})`;
  });
});

describe("P3-12 ⇢PF1 · notice decision_requested [readiness #2]", () => {
  it("HUB-FR-112 · P3-12 ⇢PF1 · redo_limit (P1-51): notice decision_requested cho A, B, T; không Adm/X; T thấy task decision can_act=true", async () => {
    needSchema(c.ready);
    const f = await reviewRun(c);
    await c.sql`update hub.stage_runs set attempt = 4, attempt_limit = 4 where id = ${f.run.stageRunIds[0] as string}`;
    const r = await c.call("B", "POST", `/review-tasks/${f.taskId}/decision`, {
      result: "fail",
      feedback: "Thiếu MST",
    });
    expect(r.status).toBe(200);
    const [run] =
      await c.sql`select status, decision from hub.process_runs where id = ${f.run.runId}`;
    expect(run?.status).toBe("needs_decision");
    const has = async (u: string) => (await notices(c, u, "decision_requested")).length > 0;
    expect({ A: await has(PA.A.id), B: await has(PA.B.id), T: await has(PA.T.id) }).toEqual({
      A: true,
      B: true,
      T: true,
    });
    expect({ Adm: await has(PA.Adm.id), X: await has(PA.X.id) }).toEqual({ Adm: false, X: false });
    const res = await c.call("T", "GET", "/me/review-tasks");
    const dec = (res.json?.items ?? []).find(
      (i: Json) => i.process_run?.id === f.run.runId && i.task?.kind === "decision",
    );
    expect(dec?.task).toMatchObject({ reason: "redo_limit", can_act: true });
  });
});

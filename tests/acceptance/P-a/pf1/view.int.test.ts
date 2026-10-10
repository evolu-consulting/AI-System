// HUB-FR-113 · HUB-BR-25/26 · AC-H32 · T8 · U5 · P1-52, P1-70…P1-77 (test-plan-int §2, plan-contract §2–§3, §5, plan-thread
// T8/T10): `GET /process-runs/:id` theo người xem (full/task, `my_tasks`, `open_tasks`, `decision.can_decide`, `thread`),
// output theo phiên bản, hết hạn qua `sweepOnce`, `process.updated` sau COMMIT, người bắt đầu rời phòng (dạng ngoài phòng).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  insertOutput,
  insertRun,
  insertTask,
  type Json,
  PA,
  PA_FIX,
  postRoom,
  type RunFix,
  T,
  waitFor,
} from "../_support/pa";
import { needSchema } from "../_support/schema";
import {
  type CtxPf1,
  DEFS,
  jobDone,
  nextStageJob,
  openMeStream,
  openTask,
  review,
  runRow,
  startInRoom,
  startPf1,
  sweep,
  toGate,
  waitStatus,
} from "./_local";

let c: CtxPf1;
const OPTS3 = ["add_attempt", "use_current", "cancel"];
const decisionOf = (reason: string) => ({
  reason,
  stage_idx: 0,
  options: OPTS3,
  at: new Date().toISOString(),
});
const R3 = "a5a10000-0000-4000-8000-000000000301"; // phòng riêng cho P1-75 (A rời)

let redo: RunFix; // needs_decision redo_limit, có output (P1-52, P1-70, P1-71)
let redoNoOut: RunFix; // needs_decision redo_limit, chưa output
let teamCalls: RunFix; // needs_decision team_calls
let review1: RunFix; // waiting_review, task group Kế toán (P1-76, P1-77, P1-72)
let reviewTask = "";
const out: string[] = [];

beforeAll(async () => {
  c = await startPf1();
  if (!c.ready) return;
  const s = c.sql;
  const mk = async (reason: string, withOut: boolean) => {
    const r = await insertRun(s, {
      def: DEFS.hd,
      startedBy: PA.A,
      roomId: PA_FIX.room,
      status: "needs_decision",
      decision: decisionOf(reason),
    });
    if (withOut)
      await insertOutput(s, {
        tid: T.acme,
        runId: r.runId,
        stageRunId: r.stageRunIds[0] as string,
        stageIdx: 0,
      });
    await insertTask(s, {
      tid: T.acme,
      runId: r.runId,
      stageRunId: r.stageRunIds[0] as string,
      kind: "decision",
      reason,
      userIds: [PA.A.id],
      groupId: reason === "redo_limit" ? PA_FIX.gKeToan : null,
    });
    return r;
  };
  redo = await mk("redo_limit", true);
  redoNoOut = await mk("redo_limit", false);
  teamCalls = await mk("team_calls", true);
  review1 = await insertRun(s, {
    def: DEFS.hd,
    startedBy: PA.A,
    roomId: PA_FIX.room,
    status: "waiting_review",
  });
  const sr = review1.stageRunIds[0] as string;
  out.push(
    await insertOutput(s, {
      tid: T.acme,
      runId: review1.runId,
      stageRunId: sr,
      stageIdx: 0,
      version: 1,
    }),
  );
  out.push(
    await insertOutput(s, {
      tid: T.acme,
      runId: review1.runId,
      stageRunId: sr,
      stageIdx: 0,
      version: 2,
    }),
  );
  reviewTask = await insertTask(s, {
    tid: T.acme,
    runId: review1.runId,
    stageRunId: sr,
    kind: "review",
    outputId: out[1],
    groupId: PA_FIX.gKeToan,
  });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const view = (r: "A" | "B" | "X" | "T" | "Adm" | "H" | "D", id: string) =>
  c.call(r, "GET", `/process-runs/${id}`);
const nAudit = async (actor: string, entityId?: string) =>
  (
    await c.sql<
      { n: number }[]
    >`select count(*)::int as n from hub.audit_log where action = 'view' and actor_id = ${actor}
      and (${entityId ?? null}::uuid is null or entity_id = ${entityId ?? null})`
  )[0]?.n ?? 0;

describe("PF1 · xem run (view)", () => {
  it("HUB-BR-26 · P1-52 · decision redo_limit có/chưa output: T task (options 3/2, has_output, can_act); B full; Adm can_decide; X không", async () => {
    needSchema(c.ready);
    const t = await view("T", redo.runId);
    expect(t.status).toBe(200);
    expect(t.json?.access).toBe("task");
    expect(t.json?.my_tasks?.[0]).toMatchObject({
      kind: "decision",
      has_output: true,
      can_act: true,
    });
    expect(t.json?.my_tasks?.[0]?.options).toEqual(OPTS3);
    const t2 = await view("T", redoNoOut.runId);
    expect(t2.json?.my_tasks?.[0]).toMatchObject({
      kind: "decision",
      has_output: false,
      can_act: true,
    });
    expect(t2.json?.my_tasks?.[0]?.options).toEqual(["add_attempt", "cancel"]);
    const b = await view("B", redo.runId);
    expect(b.json?.access).toBe("full");
    expect(((b.json?.my_tasks ?? []) as Json[]).find((x) => x.kind === "decision")?.can_act).toBe(
      true,
    );
    const adm = await view("Adm", redo.runId);
    expect(adm.json?.access).toBe("full");
    expect(adm.json?.decision?.can_decide).toBe(true);
    expect(((adm.json?.my_tasks ?? []) as Json[]).some((x) => x.kind === "decision")).toBe(false);
    const x = await view("X", redo.runId);
    expect(x.json?.decision?.can_decide).toBe(false);
    expect(x.json?.my_tasks).toEqual([]);
  }, 30_000);

  it("HUB-BR-26 · P1-52 · decision team_calls: B (Group kiểm) không có task, T ⇒ 404 (chỉ A được giao)", async () => {
    needSchema(c.ready);
    const b = await view("B", teamCalls.runId);
    expect(b.json?.access).toBe("full");
    expect(((b.json?.my_tasks ?? []) as Json[]).some((x) => x.kind === "decision")).toBe(false);
    expect(b.json?.decision?.can_decide).toBe(false);
    expect((await view("T", teamCalls.runId)).status).toBe(404);
  }, 30_000);

  it("HUB-FR-113 · P1-70 · A GET run ⇒ full, stages, history, my_tasks, can_cancel=true, decision.can_decide=true", async () => {
    needSchema(c.ready);
    const a = await view("A", redo.runId);
    expect(a.status).toBe(200);
    expect(a.json).toMatchObject({
      access: "full",
      id: redo.runId,
      status: "needs_decision",
      can_cancel: true,
    });
    expect(((a.json?.stages ?? []) as Json[]).length).toBe(2);
    expect(Array.isArray(a.json?.history)).toBe(true);
    expect(
      ((a.json?.my_tasks ?? []) as Json[]).some((x) => x.kind === "decision" && x.can_act === true),
    ).toBe(true);
    expect(a.json?.decision).toMatchObject({
      reason: "redo_limit",
      stage_idx: 0,
      can_decide: true,
    });
    expect(a.json?.thread).toEqual({ room_id: PA_FIX.room, flow_id: redo.flowId });
  }, 30_000);

  it("HUB-FR-113 · D5 · stages[].executor.name.vi là tên thật của agent (≠ id)", async () => {
    needSchema(c.ready);
    const a = await view("A", redo.runId);
    expect(a.status).toBe(200);
    const st = (a.json?.stages ?? []) as Json[];
    expect(st.length).toBe(2);
    const ex0 = st[0]?.executor as Json;
    expect(ex0.name?.vi).toBe("Đọc hoá đơn");
    for (const s of st) {
      const ex = s.executor as Json;
      expect(typeof ex.name?.vi).toBe("string");
      expect(ex.name.vi).not.toBe(ex.agent_id ?? ex.id);
      expect(ex.name.vi).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
  }, 30_000);

  it("HUB-FR-113 · P1-71 · X (thành viên R) ⇒ full, can_cancel=false, can_decide=false", async () => {
    needSchema(c.ready);
    const x = await view("X", redo.runId);
    expect(x.json).toMatchObject({ access: "full", can_cancel: false });
    expect(x.json?.decision?.can_decide).toBe(false);
  }, 30_000);

  it("HUB-FR-113 · P1-72 · A GET /outputs/:oid v1, v2 ⇒ 200 cả hai", async () => {
    needSchema(c.ready);
    for (const [i, oid] of out.entries()) {
      const r = await c.call("A", "GET", `/process-runs/${review1.runId}/outputs/${oid}`);
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ id: oid, version: i + 1, stage_idx: 0 });
      expect(typeof r.json?.content).toBe("string");
    }
  }, 30_000);

  it("AC-H32 · P1-73 · `expires_at` quá khứ + sweepOnce ⇒ expired, task đóng `expired`, không stage pass; mọi lệnh ⇒ 409", async () => {
    needSchema(c.ready);
    const r = await insertRun(c.sql, {
      def: DEFS.hd,
      startedBy: PA.A,
      roomId: PA_FIX.room,
      status: "waiting_review",
    });
    const oid = await insertOutput(c.sql, {
      tid: T.acme,
      runId: r.runId,
      stageRunId: r.stageRunIds[0] as string,
      stageIdx: 0,
    });
    const tid = await insertTask(c.sql, {
      tid: T.acme,
      runId: r.runId,
      stageRunId: r.stageRunIds[0] as string,
      kind: "review",
      outputId: oid,
      groupId: PA_FIX.gKeToan,
    });
    await c.sql`update hub.process_runs set expires_at = now() - interval '1 minute' where id = ${r.runId}`;
    const res = await sweep(c);
    expect(res?.expired).toBeGreaterThanOrEqual(1);
    expect((await runRow(c.sql, r.runId)).status).toBe("expired");
    const [t] = await c.sql<Json[]>`select status, result from hub.review_tasks where id = ${tid}`;
    expect(t).toMatchObject({ status: "closed", result: "expired" });
    const st = await c.sql<
      Json[]
    >`select passed_by from hub.stage_runs where process_run_id = ${r.runId}`;
    for (const s of st) expect(s.passed_by).toBeNull();
    const cancel = await c.call("A", "POST", `/process-runs/${r.runId}/cancel`, {});
    expect({ s: cancel.status, c: cancel.json?.error?.code }).toEqual({
      s: 409,
      c: "PROCESS_RUN_STATE",
    });
    const dec = await c.call("A", "POST", `/process-runs/${r.runId}/decide`, { option: "cancel" });
    expect({ s: dec.status, c: dec.json?.error?.code }).toEqual({ s: 409, c: "PROCESS_RUN_STATE" });
    const rv = await review(c, "B", tid, { result: "pass" });
    expect({ s: rv.status, c: rv.json?.error?.code }).toEqual({ s: 409, c: "REVIEW_TASK_CLOSED" });
  }, 30_000);

  it("HUB-FR-113 · P1-74 · B Đạt ⇒ `process.updated` tới A, X, T sau COMMIT; không tới H, D", async () => {
    needSchema(c.ready);
    await c.sql`update hub.process_runs set status = 'cancelled', finished_at = now()
      where status in ('running', 'waiting_review', 'waiting_answer', 'needs_decision')`;
    const g = await toGate(c);
    const roles = ["A", "X", "T", "H", "D"] as const;
    const streams = await Promise.all(roles.map(async (r) => openMeStream(c.hub, await c.tok(r))));
    try {
      expect((await review(c, "B", g.taskId, { result: "pass" })).status).toBe(200);
      const isUpd = (e: Json) =>
        e.event === "process.updated" && e.data?.process_run_id === g.runId;
      for (const [i, r] of roles.entries()) {
        const s = streams[i];
        if (!s) continue;
        const ev = await s.until(isUpd, r === "H" || r === "D" ? 1_500 : 5_000);
        expect({ role: r, got: ev !== undefined }).toEqual({
          role: r,
          got: r !== "H" && r !== "D",
        });
      }
    } finally {
      for (const s of streams) s.close();
    }
  }, 60_000);

  it("HUB-FR-113 · P1-75 · A rời phòng giữa run ⇒ run chạy tiếp; A GET = dạng ngoài phòng (task, không thread/history/FB); inbox 200; audit view mỗi lần", async () => {
    needSchema(c.ready);
    await c.sql`update hub.process_runs set status = 'cancelled', finished_at = now()
      where status in ('running', 'waiting_review', 'waiting_answer', 'needs_decision')`;
    await c.sql`insert into hub.rooms (id, tenant_id, kind, name, last_seq, last_activity_at, created_by, created_at)
      values (${R3}, ${T.acme}, 'group', 'Phòng R3 bí mật', 0, now(), ${PA.A.id}, now())`;
    const m = (u: string, role: string) => ({
      room_id: R3,
      tenant_id: T.acme,
      user_id: u,
      role,
      joined_at: new Date(Date.now() - 86_400_000),
      last_read_seq: 0,
    });
    await c.sql`insert into hub.room_members ${c.sql([m(PA.A.id, "owner"), m(PA.B.id, "member"), m(PA.X.id, "member")])}`;
    const s = await startInRoom(c, { roomId: R3 });
    await jobDone(c, await nextStageJob(c, s.runId));
    await waitStatus(c.sql, s.runId, "waiting_review");
    const task = await openTask(c.sql, s.runId, "review");
    await c.sql`update hub.room_members set left_at = now() where room_id = ${R3} and user_id = ${PA.A.id}`;
    const fb = await postRoom(c, "X", R3, { content: "FB-AFTER-LEAVE", flow_id: s.flowId });
    expect(fb.res.status).toBe(201);
    expect((await review(c, "B", task?.id, { result: "pass" })).status).toBe(200);
    await nextStageJob(c, s.runId); // run chạy tiếp: stage 2 có job
    const a0 = await nAudit(PA.A.id);
    const v = await view("A", s.runId);
    expect(v.status).toBe(200);
    expect(v.json?.access).toBe("task");
    expect(v.json?.thread).toBeUndefined();
    expect(v.json?.history).toBeUndefined();
    expect(Array.isArray(v.json?.stages)).toBe(true);
    expect(((v.json?.outputs ?? []) as Json[]).length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(v.json?.my_tasks)).toBe(true);
    expect(v.text).not.toContain("FB-AFTER-LEAVE");
    expect(v.text).not.toContain("Phòng R3 bí mật");
    expect(await nAudit(PA.A.id)).toBe(a0 + 1);
    await view("A", s.runId);
    expect(await nAudit(PA.A.id)).toBe(a0 + 2);
    expect((await c.call("A", "GET", "/me/process-inbox")).status).toBe(200);
  }, 60_000);

  it("HUB-FR-113 · P1-76 · run waiting_review (group Kế toán): X ⇒ full, my_tasks=[], open_tasks[0] review + group, thread {R, F}", async () => {
    needSchema(c.ready);
    const x = await view("X", review1.runId);
    expect(x.json?.access).toBe("full");
    expect(x.json?.my_tasks).toEqual([]);
    expect(x.json?.open_tasks?.[0]).toMatchObject({
      id: reviewTask,
      kind: "review",
      stage_idx: 0,
      group: { id: PA_FIX.gKeToan, name: "Kế toán" },
    });
    expect(Array.isArray(x.json?.open_tasks?.[0]?.assignees)).toBe(true);
    expect(x.json?.thread).toEqual({ room_id: PA_FIX.room, flow_id: review1.flowId });
  }, 30_000);

  it("HUB-FR-113 · P1-77 · X (không assignee) POST decision pass ⇒ 404; task vẫn open; 0 sự kiện `task_result`", async () => {
    needSchema(c.ready);
    const r = await review(c, "X", reviewTask, { result: "pass" });
    expect(r.status).toBe(404);
    const [t] = await c.sql<Json[]>`select status from hub.review_tasks where id = ${reviewTask}`;
    expect(t?.status).toBe("open");
    const ev = await waitFor(
      async () =>
        (
          await c.sql<{ n: number }[]>`select count(*)::int as n from hub.process_thread_events
            where process_run_id = ${review1.runId} and kind = 'task_result'`
        )[0]?.n ?? 0,
      (n) => n > 0,
      500,
    );
    expect(ev).toBe(0);
  }, 30_000);
});

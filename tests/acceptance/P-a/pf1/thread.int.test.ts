// HUB-FR-113 · CHAT-AC-52 · U1 · P1-80…P1-89 (P1-81(c) ở thread-loops.int) — test-plan-int §2 "PF1 · tin thread phòng",
// plan-thread §1–§3: run trong phòng = thread X2b; Hub đăng tin `sender_type=process` qua outbox `process_thread_events`
// (`processLoops:false` ⇒ test gọi `postThreadOnce`, trừ ca "post sau COMMIT" chờ điều kiện). Phòng riêng (SQL) cho ca
// xoá phòng / người bắt đầu rời phòng để không làm hỏng phòng R dùng chung.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { endSqlRun } from "../../H2a/_h2a2";
import { type MeStream, ofRoom } from "../../X2a/_x2a";
import { type Json, PA, PA_FIX, type Role, type Sql, T, waitFor } from "../_support/pa";
import { needSchema } from "../_support/schema";
import {
  type CtxPf1,
  handles,
  type Job,
  jobDone,
  MD_AUTO,
  MD_MISSING,
  MD_OK,
  openMeStream,
  openTask,
  P1,
  postThread,
  procMsgs,
  review,
  runRow,
  stageRow,
  startApi,
  startInRoom,
  startPf1,
  sweep,
  toGate,
  waitStatus,
} from "./_local";

const TO = 60_000;
let c: CtxPf1;
const xr = (n: number) => `a5a18000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ROOM_DEL = xr(1); // P1-84: A owner, B member — xoá giữa run
const ROOM_LEAVE = xr(2); // P1-85: A owner (rời giữa run), B, X
const MD_STAGE2 = "## Kết quả\nĐã ghi sổ HD-12.";

async function mkRoom(
  sql: Sql,
  id: string,
  name: string,
  members: { p: { id: string }; role: string }[],
) {
  await sql`insert into hub.rooms (id, tenant_id, kind, name, last_seq, last_activity_at, created_by, created_at)
    values (${id}, ${T.acme}, 'group', ${name}, 0, now(), ${PA.A.id}, now())`;
  for (const m of members)
    await sql`insert into hub.room_members (room_id, tenant_id, user_id, role, joined_at, last_read_seq)
      values (${id}, ${T.acme}, ${m.p.id}, ${m.role}, now() - interval '1 day', 0)`;
}

beforeAll(async () => {
  c = await startPf1({ processRunsPerTenant: 200 });
  if (!c.ready) return;
  await mkRoom(c.sql, ROOM_DEL, "Phòng xoá", [
    { p: PA.A, role: "owner" },
    { p: PA.B, role: "member" },
  ]);
  await mkRoom(c.sql, ROOM_LEAVE, "Phòng rời", [
    { p: PA.A, role: "owner" },
    { p: PA.B, role: "member" },
    { p: PA.X, role: "member" },
  ]);
}, TO);
afterAll(async () => {
  await c?.stop();
});

/** Kết thúc mọi `hub.runs` còn chạy (giới hạn run đồng thời của người bắt đầu). */
async function settleRuns(): Promise<void> {
  const rows = await c.sql<{ id: string }[]>`select id from hub.runs where status = 'running'`;
  for (const r of rows) await endSqlRun(c.sql, r.id);
}
/** Job queued kế (bất kỳ) của process run trong `ms`; không có ⇒ undefined. */
async function tryJob(runId: string, ms = 400): Promise<Job | undefined> {
  const row = await waitFor(
    async () =>
      (
        await c.sql<
          { run_id: string }[]
        >`select j.run_id from hub.jobs j join hub.runs r on r.id = j.run_id
          where r.process_run_id = ${runId} and j.status = 'queued' order by j.created_at limit 1`
      )[0],
    (v) => v !== undefined,
    ms,
  );
  return row ? c.rt.tryNext(row.run_id, 1_000) : undefined;
}
/** Phục vụ job tới khi run đạt `status`. */
async function serveUntil(
  runId: string,
  status: string,
  h: (j: Job) => Promise<void>,
  ms = 20_000,
) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await runRow(c.sql, runId))?.status === status) break;
    const j = await tryJob(runId);
    if (j) await h(j);
  }
  return waitStatus(c.sql, runId, status, 1_000);
}
/** Gate 1 Đạt bởi B ⇒ stage 2 trả MD_STAGE2 ⇒ run done. */
async function passToDone(runId: string, taskId: string, by: Role = "B") {
  const r = await review(c, by, taskId, { result: "pass" });
  expect(r.status).toBe(200);
  await serveUntil(runId, "done", (j) => jobDone(c, j, MD_STAGE2));
}
const kinds = (rows: Json[]) => rows.map((r) => r.process_kind);
const timeline = async (r: Role, roomId: string, q = "") =>
  c.call(r, "GET", `/rooms/${roomId}/messages${q}`);
const events = (runId: string) =>
  c.sql<Json[]>`select id, kind, meta, posted_at, outcome, created_at from hub.process_thread_events
    where process_run_id = ${runId} order by created_at, id`;
const userMsgCount = async (roomId: string) =>
  (
    await c.sql<{ n: number }[]>`select count(*)::int as n from hub.room_messages
      where room_id = ${roomId} and sender_type = 'user'`
  )[0]?.n ?? 0;

describe("P1-80…P1-89 · tin thread phòng [U1, plan-thread]", () => {
  it(
    "CHAT-AC-52 · P1-80 · v1 → Chưa đạt → v2 → Đạt → stage 2 ⇒ 7 tin process đúng thứ tự trong thread F",
    async () => {
      needSchema(c.ready);
      const g = await toGate(c);
      expect(
        (await review(c, "B", g.taskId, { result: "fail", feedback: "Thiếu MST" })).status,
      ).toBe(200);
      await serveUntil(g.runId, "waiting_review", (j) => jobDone(c, j, MD_OK));
      const t2 = await openTask(c.sql, g.runId, "review");
      expect(t2?.id).toBeTruthy();
      expect(t2?.id).not.toBe(g.taskId);
      await passToDone(g.runId, t2?.id);
      await postThread(c);
      const rows = await procMsgs(c.sql, g.runId);
      expect(kinds(rows)).toEqual([
        "block",
        "output",
        "task_result",
        "output",
        "task_result",
        "output",
        "run_end",
      ]);
      expect(rows[0]?.placement).toBe("main");
      for (const r of rows) expect(r.flow_id).toBe(g.flowId);
      for (const r of rows.slice(1)) expect(r.placement).toBe("flow");
      const m = rows.map((r) => r.process_meta);
      expect(m[1]).toMatchObject({
        kind: "output",
        stage_idx: 0,
        after: "review",
        review_task_id: g.taskId,
      });
      expect(m[1]?.output?.version).toBe(1);
      expect(m[2]).toMatchObject({
        kind: "task_result",
        result: "fail",
        feedback: "Thiếu MST",
        outside: false,
      });
      expect(m[2]?.actor?.id).toBe(PA.B.id);
      expect(m[3]?.output?.version).toBe(2);
      expect(m[4]).toMatchObject({ kind: "task_result", result: "pass" });
      expect(m[5]).toMatchObject({
        kind: "output",
        stage_idx: 1,
        after: "auto",
        review_task_id: null,
      });
      expect(m[6]).toMatchObject({ kind: "run_end", status: "done", actor: null });
      // API thread theo `seq`: tin gọi (user) trước, rồi tin process
      const tl = await timeline("A", PA_FIX.room, `?flow_id=${g.flowId}`);
      expect(tl.status).toBe(200);
      const items = (tl.json?.items ?? []) as Json[];
      const seqs = items.map((i) => i.seq);
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
      const trig = items.find((i) => i.sender_type === "user" && i.process_run_id === g.runId);
      expect(trig).toBeDefined();
      const proc = items.filter((i) => i.sender_type === "process");
      expect(proc.map((i) => i.process?.kind).filter((k) => k !== "block")).toEqual([
        "output",
        "task_result",
        "output",
        "task_result",
        "output",
        "run_end",
      ]);
      expect(proc.every((i) => (i.seq as number) > (trig?.seq as number))).toBe(true);
      await settleRuns();
    },
    TO,
  );

  it(
    "HUB-FR-113 · P1-81 · (a) Đạt ⇒ tin task_result đăng sau COMMIT ≤ 2 s; sự kiện cùng tx đóng task",
    async () => {
      needSchema(c.ready);
      const g = await toGate(c);
      await postThread(c);
      expect((await events(g.runId)).some((e) => e.kind === "task_result")).toBe(false);
      const r = await review(c, "B", g.taskId, { result: "pass" });
      expect(r.status).toBe(200);
      const [task] = await c.sql<
        Json[]
      >`select status from hub.review_tasks where id = ${g.taskId}`;
      expect(task?.status).toBe("closed");
      expect((await events(g.runId)).filter((e) => e.kind === "task_result")).toHaveLength(1);
      const rows = await waitFor(
        () => procMsgs(c.sql, g.runId),
        (xs) => xs.some((m) => m.process_kind === "task_result"),
        2_000,
      );
      expect(kinds(rows)).toContain("task_result");
      await settleRuns();
    },
    TO,
  );

  it(
    "HUB-FR-113 · P1-81 · (b) B ∥ T Đạt ⇒ người thua 409, đúng 1 sự kiện task_result (tx thua ROLLBACK)",
    async () => {
      needSchema(c.ready);
      const g = await toGate(c);
      const rs = await Promise.all([
        review(c, "B", g.taskId, { result: "pass" }),
        review(c, "T", g.taskId, { result: "pass" }),
      ]);
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(rs.find((r) => r.status === 409)?.json?.error?.code).toBe("REVIEW_TASK_CLOSED");
      expect((await events(g.runId)).filter((e) => e.kind === "task_result")).toHaveLength(1);
      await postThread(c);
      expect(kinds(await procMsgs(c.sql, g.runId)).filter((k) => k === "task_result")).toHaveLength(
        1,
      );
      await settleRuns();
    },
    TO,
  );

  it("HUB-FR-113 · P1-82 · ×20 Đạt ∥ !hoa-don-t mới ∥ postThreadOnce ∥ sweepOnce ⇒ không 40P01/timeout, mỗi sự kiện đăng 1 lần", async () => {
    needSchema(c.ready);
    const runIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const g = await toGate(c);
      runIds.push(g.runId);
      const out = await Promise.allSettled([
        review(c, "B", g.taskId, { result: "pass" }),
        startInRoom(c, { input: `HD-${100 + i}` }),
        postThread(c),
        sweep(c),
      ]);
      for (const o of out) expect(o.status).toBe("fulfilled");
      const rv = (out[0] as PromiseFulfilledResult<Json>).value;
      expect(rv.status).toBe(200);
      const st = out[1] as PromiseFulfilledResult<{ runId: string }>;
      runIds.push(st.value.runId);
      await settleRuns();
    }
    await postThread(c);
    await postThread(c);
    for (const id of runIds) {
      const evs = await events(id);
      for (const e of evs) expect(e.posted_at).not.toBeNull();
      const msgs = await procMsgs(c.sql, id);
      const ids = msgs.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const e of evs.filter((x) => x.outcome === "posted"))
        expect(ids.filter((m) => m === e.id)).toHaveLength(1);
    }
  }, 300_000);

  it(
    "HUB-FR-113 · P1-83 · Đạt qua API (không POST tin phòng) ⇒ 0 tin user mới, 1 task_result actor B; T can_act=false",
    async () => {
      needSchema(c.ready);
      const g = await toGate(c);
      await postThread(c);
      const before = await userMsgCount(PA_FIX.room);
      expect((await review(c, "B", g.taskId, { result: "pass" })).status).toBe(200);
      await postThread(c);
      expect(await userMsgCount(PA_FIX.room)).toBe(before);
      const tr = (await procMsgs(c.sql, g.runId)).filter((m) => m.process_kind === "task_result");
      expect(tr).toHaveLength(1);
      expect(tr[0]?.process_meta?.actor?.id).toBe(PA.B.id);
      const v = await c.call("T", "GET", `/process-runs/${g.runId}`);
      expect(v.status).toBe(200);
      const mine = ((v.json?.my_tasks ?? []) as Json[]).filter((t) => t.id === g.taskId);
      for (const t of mine) expect(t.can_act).toBe(false);
      await settleRuns();
    },
    TO,
  );

  it(
    "HUB-FR-113 · P1-84 · phòng bị xoá khi run running ⇒ run tới done; sự kiện sau xoá `skipped`; A GET run full, thread=null",
    async () => {
      needSchema(c.ready);
      const s = await startInRoom(c, { key: "p-auto", roomId: ROOM_DEL });
      const j1 = await tryJob(s.runId, 8_000);
      expect(j1).toBeDefined();
      await postThread(c);
      const del = await c.call("A", "DELETE", `/rooms/${ROOM_DEL}`);
      expect([200, 204]).toContain(del.status);
      const at = new Date();
      await jobDone(c, j1 as Job, MD_AUTO);
      await serveUntil(s.runId, "done", (j) => jobDone(c, j, MD_AUTO));
      await postThread(c);
      const after = (await events(s.runId)).filter((e) => new Date(e.created_at) >= at);
      expect(after.length).toBeGreaterThan(0);
      for (const e of after) expect(e.outcome).toBe("skipped");
      const v = await c.call("A", "GET", `/process-runs/${s.runId}`);
      expect(v.status).toBe(200);
      expect(v.json?.access).toBe("full");
      expect(v.json?.thread).toBeNull();
      await settleRuns();
    },
    TO,
  );

  it(
    "HUB-FR-113 · P1-85 · A rời phòng khi waiting_review; B Đạt ⇒ tin vẫn đăng (posted); A đọc phòng/thread 404, không room.*; view ngoài phòng",
    async () => {
      needSchema(c.ready);
      const s = await startInRoom(c, { roomId: ROOM_LEAVE });
      await serveUntil(s.runId, "waiting_review", (j) => jobDone(c, j, MD_OK));
      const t = await openTask(c.sql, s.runId, "review");
      await postThread(c);
      await c.sql`update hub.room_members set left_at = now() where room_id = ${ROOM_LEAVE} and user_id = ${PA.A.id}`;
      const meA = await openMeStream(c.hub, await c.tok("A"));
      try {
        const at = new Date();
        await passToDone(s.runId, t?.id);
        await postThread(c);
        const after = (await events(s.runId)).filter((e) => new Date(e.created_at) >= at);
        expect(after.map((e) => e.kind)).toEqual(expect.arrayContaining(["task_result", "output"]));
        for (const e of after) expect(e.outcome).toBe("posted");
        const unknown = await timeline("A", "a5a18000-0000-4000-8000-000000009999");
        for (const q of ["", `?flow_id=${s.flowId}`]) {
          const r = await timeline("A", ROOM_LEAVE, q);
          expect(r.status).toBe(404);
          expect(r.json).toEqual(unknown.json);
        }
        expect(ofRoom(meA, ROOM_LEAVE).filter((e) => e.event.startsWith("room."))).toHaveLength(0);
        const v = await c.call("A", "GET", `/process-runs/${s.runId}`);
        expect(v.status).toBe(200);
        expect(v.json?.access).toBe("task");
        expect(v.json?.thread).toBeUndefined();
      } finally {
        meA.close();
      }
      await settleRuns();
    },
    TO,
  );

  it(
    "HUB-FR-113 · P1-86 · Đạt ⇒ X nhận room.message + room.unread; process.updated tới A, X, T; T, H không nhận room.* của R",
    async () => {
      needSchema(c.ready);
      const g = await toGate(c);
      await postThread(c);
      const ss: Record<string, MeStream> = {};
      for (const r of ["A", "X", "T", "H"] as Role[])
        ss[r] = await openMeStream(c.hub, await c.tok(r));
      try {
        expect((await review(c, "B", g.taskId, { result: "pass" })).status).toBe(200);
        await postThread(c);
        const isRun = (e: Json) =>
          e.event === "process.updated" && e.data?.process_run_id === g.runId;
        expect(
          await (ss.X as MeStream).until(
            (e) => e.event === "room.message" && e.data?.room_id === PA_FIX.room,
            5_000,
          ),
        ).toBeDefined();
        expect(
          await (ss.X as MeStream).until(
            (e) => e.event === "room.unread" && e.data?.room_id === PA_FIX.room,
            5_000,
          ),
        ).toBeDefined();
        for (const r of ["A", "X", "T"])
          expect(await (ss[r] as MeStream).until(isRun, 5_000)).toBeDefined();
        for (const r of ["T", "H"])
          expect(
            ofRoom(ss[r] as MeStream, PA_FIX.room).filter((e) => e.event.startsWith("room.")),
          ).toHaveLength(0);
        expect((ss.H as MeStream).events.filter(isRun)).toHaveLength(0);
      } finally {
        for (const s of Object.values(ss)) s.close();
      }
      await settleRuns();
    },
    TO,
  );

  it(
    "HUB-FR-113 · P1-87 · p-team 3 thành viên ⇒ 1 tin output, steps 3 hàng member; lead-team ⇒ 1 plan + n member",
    async () => {
      needSchema(c.ready);
      const sec: Record<string, string> = {
        [P1.agM1]: "Phần A",
        [P1.agM2]: "Phần B",
        [P1.agM3]: "Phần C",
      };
      const member = (j: Job) =>
        jobDone(c, j, `## ${sec[j.payload.agent.id] ?? "Phần A"}\nNội dung ${j.payload.agent.id}.`);
      const s = await startInRoom(c, { key: "p-team" });
      await serveUntil(s.runId, "waiting_review", member);
      await postThread(c);
      const outs = (await procMsgs(c.sql, s.runId)).filter((m) => m.process_kind === "output");
      expect(outs).toHaveLength(1);
      const steps = outs[0]?.process_meta?.steps as Json[];
      expect(steps).toHaveLength(3);
      for (const st of steps) {
        expect(st.role).toBe("member");
        expect(typeof st.member_key).toBe("string");
        expect(typeof st.tokens).toBe("number");
      }
      const plan = JSON.stringify([
        { member: "m1", sections: ["Phần A"], instruction: "Viết phần A" },
        { member: "m2", sections: ["Phần B"], instruction: "Viết phần B" },
        { member: "m3", sections: ["Phần C"], instruction: "Viết phần C" },
      ]);
      const s2 = await startInRoom(c, { key: "p-lead" });
      await serveUntil(s2.runId, "waiting_review", (j) =>
        j.payload.agent.id === P1.agLead ? jobDone(c, j, plan) : member(j),
      );
      await postThread(c);
      const o2 = (await procMsgs(c.sql, s2.runId)).filter((m) => m.process_kind === "output");
      expect(o2).toHaveLength(1);
      const st2 = o2[0]?.process_meta?.steps as Json[];
      expect(st2.filter((x) => x.role === "plan")).toHaveLength(1);
      expect(st2[0]?.role).toBe("plan");
      expect(st2.filter((x) => x.role === "member").length).toBeGreaterThanOrEqual(1);
      await settleRuns();
    },
    TO,
  );

  it(
    "HUB-FR-113 · P1-88 · output thiếu mục; decision redo_limit; huỷ (actor A); hết hạn (actor null); đóng task hệ thống không sinh task_result",
    async () => {
      needSchema(c.ready);
      // (1) M3: thiếu mục ⇒ output template_ok=false + template_missing
      const s = await startInRoom(c);
      const j = await tryJob(s.runId, 8_000);
      await jobDone(c, j as Job, MD_MISSING);
      await waitFor(
        () => stageRow(c.sql, s.runId, 0),
        (st) => st?.attempt === 2,
        8_000,
      );
      await postThread(c);
      const o = (await procMsgs(c.sql, s.runId)).find((m) => m.process_kind === "output");
      expect(o?.process_meta?.output).toMatchObject({
        template_ok: false,
        template_missing: ["Tổng tiền"],
      });
      await settleRuns();
      // (2) redo_limit ⇒ tin decision; A huỷ ⇒ run_end cancelled actor A
      const g = await toGate(c);
      await c.sql`update hub.stage_runs set attempt = attempt_limit where process_run_id = ${g.runId} and stage_idx = 0`;
      expect(
        (await review(c, "B", g.taskId, { result: "fail", feedback: "Sai số tiền" })).status,
      ).toBe(200);
      await waitStatus(c.sql, g.runId, "needs_decision");
      expect((await c.call("A", "POST", `/process-runs/${g.runId}/cancel`, {})).status).toBe(200);
      await postThread(c);
      const m2 = (await procMsgs(c.sql, g.runId)).map((m) => m.process_meta);
      expect(m2.find((m) => m.kind === "decision")).toMatchObject({
        reason: "redo_limit",
        options: ["add_attempt", "use_current", "cancel"],
      });
      expect(m2.find((m) => m.kind === "run_end")).toMatchObject({
        status: "cancelled",
        actor: { id: PA.A.id },
      });
      expect(m2.filter((m) => m.kind === "task_result")).toHaveLength(1); // chỉ Chưa đạt của B; đóng task decision không sinh
      // (3) hết hạn ⇒ run_end expired actor null
      const g3 = await toGate(c);
      await c.sql`update hub.process_runs set expires_at = now() - interval '1 minute' where id = ${g3.runId}`;
      await sweep(c);
      await waitStatus(c.sql, g3.runId, "expired");
      await postThread(c);
      const m3 = (await procMsgs(c.sql, g3.runId)).map((m) => m.process_meta);
      expect(m3.find((m) => m.kind === "run_end")).toMatchObject({
        status: "expired",
        actor: null,
      });
      expect(m3.filter((m) => m.kind === "task_result")).toHaveLength(0);
      await settleRuns();
    },
    TO,
  );

  it(
    "HUB-FR-113 · P1-89 · POST /process-runs origin room ⇒ 0 tin gọi, 1 block (trigger null); origin none/admin ⇒ 0 sự kiện",
    async () => {
      needSchema(c.ready);
      const r = await startApi(c, { origin: { kind: "room", room_id: PA_FIX.room } });
      expect(r.status).toBe(201);
      const id = r.json?.id as string;
      await postThread(c);
      expect(kinds(await procMsgs(c.sql, id))).toEqual(["block"]);
      const [u] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.room_messages
      where process_run_id = ${id} and sender_type = 'user'`;
      expect(u?.n).toBe(0);
      expect((await runRow(c.sql, id))?.trigger_message_id).toBeNull();
      const none = await startApi(c, { origin: { kind: "none" } });
      expect(none.status).toBe(201);
      const adm = await c.call("Adm", "POST", `/process-defs/${PA_FIX.defHoaDon}/run`, {
        input: "HD-99",
      });
      expect(adm.status).toBe(201);
      for (const rid of [none.json?.id, adm.json?.id] as string[])
        expect(await events(rid)).toHaveLength(0);
      expect(handles(c)).toBeDefined();
      await settleRuns();
    },
    TO,
  );
});

// HUB-FR-113 · T5 · T10 · §10 · S0-15…S0-17 (test-plan-int §1, plan-thread §1, §3): outbox `process_thread_events` → tin
// `process` qua `ProcessHandles.postThreadOnce` (seam plan-contract §7.1, `processLoops:false`): đúng thứ tự, idempotent
// (`id = event.id`), song song ⇒ 1 tin; phòng xoá ⇒ `skipped`; `enqueueThread` origin không phải phòng ⇒ "" + 0 hàng; không
// deadlock với tx start/cổng. Ghi chú: "post(run) ∥ postThreadOnce" thay bằng 2 `postThreadOnce` song song (post chưa có chữ ký).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { fn, loadHubScope, loadThread } from "../_support/modules";
import {
  type CtxPa,
  DEF_HD,
  fixId,
  insertDef,
  insertEvent,
  insertRun,
  type Json,
  PA,
  PA_FIX,
  part,
  type RunFix,
  startPa,
  T,
} from "../_support/pa";
import { needSchema } from "../_support/schema";

let c: CtxPa;
let run: RunFix;
beforeAll(async () => {
  c = await startPa();
  if (!c.ready) return;
  await insertDef(c.sql, { id: PA_FIX.defHoaDon, tenantId: T.acme });
  run = await insertRun(c.sql, {
    def: DEF_HD(PA_FIX.defHoaDon),
    startedBy: PA.A,
    roomId: PA_FIX.room,
  });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

/** `postThreadOnce` từ handles (B0 chưa có ⇒ đỏ ở expect). */
function postOnce(): () => Promise<number> {
  const h = c.hub.handles();
  expect({ postThreadOnce: typeof h?.postThreadOnce }).toEqual({ postThreadOnce: "function" });
  return () => h.postThreadOnce();
}
const procMsgs = (runId: string) =>
  c.sql<
    Json[]
  >`select id, seq, placement, sender_id, process_kind, process_meta, flow_id from hub.room_messages
    where process_run_id = ${runId} and sender_type = 'process' order by seq`;

describe("S0-15…S0-17 · ThreadPoster [T5]", () => {
  it("HUB-FR-113 · S0-15 · 3 sự kiện ⇒ 3 tin đúng thứ tự/cột; lần 2 = 0; song song ⇒ đúng 1 tin; mọi sự kiện posted", async () => {
    needSchema(c.ready);
    const post = postOnce();
    const t0 = Date.now() - 60_000;
    const metas = [part.block(run.runId), part.output(run.runId), part.ask(run.runId)];
    const ids: string[] = [];
    for (const [i, meta] of metas.entries())
      ids.push(
        await insertEvent(c.sql, {
          runId: run.runId,
          roomId: PA_FIX.room,
          meta,
          createdAt: new Date(t0 + i * 1000),
        }),
      );
    expect(await post()).toBe(3);
    const rows = await procMsgs(run.runId);
    expect(rows.map((r) => r.id)).toEqual(ids);
    expect(rows.map((r) => r.placement)).toEqual(["main", "flow", "flow"]);
    expect(rows.map((r) => r.process_kind)).toEqual(["block", "output", "ask"]);
    for (const r of rows) {
      expect(r.sender_id).toBe(PA_FIX.defHoaDon);
      expect(r.flow_id).toBe(run.flowId);
      expect(r.process_meta?.process_run_id).toBe(run.runId);
    }
    expect(await post()).toBe(0);
    const late = await insertEvent(c.sql, {
      runId: run.runId,
      roomId: PA_FIX.room,
      meta: part.run_end(run.runId),
    });
    await Promise.all([post(), post()]);
    const after = await procMsgs(run.runId);
    expect(after.filter((r) => r.id === late)).toHaveLength(1);
    expect(after).toHaveLength(4);
    const evs = await c.sql<
      Json[]
    >`select posted_at, outcome from hub.process_thread_events where process_run_id = ${run.runId}`;
    for (const e of evs)
      expect({ posted: e.posted_at !== null, outcome: e.outcome }).toEqual({
        posted: true,
        outcome: "posted",
      });
  });
  it('HUB-FR-113 · S0-16 · phòng xoá mềm ⇒ sự kiện skipped, 0 tin, run giữ trạng thái; enqueueThread origin admin ⇒ "" + 0 hàng', async () => {
    needSchema(c.ready);
    const post = postOnce();
    const room3 = fixId();
    await c.sql`insert into hub.rooms (id, tenant_id, kind, name, last_seq, last_activity_at, created_by, created_at, deleted_at)
      values (${room3}, ${T.acme}, 'group', 'Phòng xoá', 0, now(), ${PA.A.id}, now(), now())`;
    const r3 = await insertRun(c.sql, {
      def: DEF_HD(PA_FIX.defHoaDon),
      startedBy: PA.A,
      roomId: room3,
    });
    const ev = await insertEvent(c.sql, {
      runId: r3.runId,
      roomId: room3,
      meta: part.output(r3.runId),
    });
    await post();
    const [e] = await c.sql<Json[]>`select outcome from hub.process_thread_events where id = ${ev}`;
    expect(e?.outcome).toBe("skipped");
    expect(await procMsgs(r3.runId)).toHaveLength(0);
    const [st] = await c.sql<Json[]>`select status from hub.process_runs where id = ${r3.runId}`;
    expect(st?.status).toBe("running");
    const enqueue = fn(await loadThread(), "enqueueThread");
    const withScope = fn(await loadHubScope(), "withHubScope");
    const adminRun = await insertRun(c.sql, { def: DEF_HD(PA_FIX.defHoaDon), startedBy: PA.A });
    const out = await withScope(
      c.hub.db,
      { kind: "user", tenantId: T.acme, userId: PA.A.id },
      (tx: unknown) =>
        enqueue(tx, { runId: adminRun.runId, roomId: PA_FIX.room, ...part.output(adminRun.runId) }),
    );
    expect(out).toBe("");
    const [n] = await c.sql<
      Json[]
    >`select count(*)::int as n from hub.process_thread_events where process_run_id = ${adminRun.runId}`;
    expect(n?.n).toBe(0);
  });
  it("HUB-FR-113 · S0-17 · ×20: postThreadOnce ∥ tx start (rooms→process_runs) ∥ tx cổng (process_runs→sự kiện) ⇒ không 40P01, mỗi sự kiện đăng 1 lần", async () => {
    needSchema(c.ready);
    const post = postOnce();
    const errs: string[] = [];
    const created: string[] = [];
    const catchCode = (p: Promise<unknown>) =>
      p.catch((e: { code?: string; message?: string }) => {
        errs.push(e.code ?? String(e.message));
      });
    for (let i = 0; i < 20; i++) {
      const pre = await insertEvent(c.sql, {
        runId: run.runId,
        roomId: PA_FIX.room,
        meta: part.output(run.runId),
      });
      created.push(pre);
      const start = c.sql.begin(async (tx) => {
        await tx`select id from hub.rooms where id = ${PA_FIX.room} for update`;
        await insertRun(tx as unknown as typeof c.sql, {
          def: DEF_HD(PA_FIX.defHoaDon),
          startedBy: PA.A,
          roomId: PA_FIX.room,
        });
      });
      const gate = c.sql.begin(async (tx) => {
        await tx`select id from hub.process_runs where id = ${run.runId} for update`;
        created.push(
          await insertEvent(tx as unknown as typeof c.sql, {
            runId: run.runId,
            roomId: PA_FIX.room,
            meta: part.output(run.runId),
          }),
        );
      });
      await Promise.all([catchCode(post()), catchCode(start), catchCode(gate)]);
    }
    await post();
    expect(errs).toEqual([]);
    const ids = new Set((await procMsgs(run.runId)).map((r) => r.id));
    for (const id of created) expect(ids.has(id)).toBe(true);
    const [d] = await c.sql<
      Json[]
    >`select count(*)::int as n, count(distinct id)::int as d from hub.room_messages
      where process_run_id = ${run.runId}`;
    expect(d?.n).toBe(d?.d);
  });
});

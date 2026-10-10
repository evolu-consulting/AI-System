// HUB-FR-105 · HUB-BR-21/24/28 · AC-H28 · CHAT-AC-51/52 · ADM-FR-67 · P1-01…P1-14 (test-plan-int §2, plan-contract §3):
// bắt đầu run từ phòng (`!key`, thread U1) / Hỏi AI (202, D14) / `POST /process-runs` / admin; gợi ý khi sai key; giới hạn
// 5 run/tenant (advisory, 429 + ROLLBACK); danh sách `/processes`, `/process-runs`; mọi `hub.runs` stage thuộc người bắt đầu.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cm, insertRun, type Json, PA, PA_FIX, T } from "../_support/pa";
import { needSchema } from "../_support/schema";
import {
  type CtxPf1,
  DEFS,
  insertDefPf1,
  jobDone,
  MD_OK,
  nextStageJob,
  postThread,
  procMsgs,
  review,
  runRow,
  stageHubRuns,
  startApi,
  startInRoom,
  startPf1,
  toGate,
  waitStatus,
} from "./_local";

let c: CtxPf1;
const CONV_A = "a5a10000-0000-4000-8000-000000000101"; // hội thoại thường của A
const CONV_B = "a5a10000-0000-4000-8000-000000000102"; // hội thoại của B
const ACTIVE = ["running", "waiting_review", "waiting_answer", "needs_decision"];

beforeAll(async () => {
  c = await startPf1();
  if (!c.ready) return;
  const conv = (id: string, uid: string) => ({
    id,
    tenant_id: T.acme,
    user_id: uid,
    title: "Hỏi AI",
    title_norm: "hỏi ai",
  });
  await c.sql`insert into hub.conversations ${c.sql([conv(CONV_A, PA.A.id), conv(CONV_B, PA.B.id)])}`;
  const v = (id: number, key: string) => ({
    ...DEFS.hd,
    id: `a5a10000-0000-4000-8000-0000000002${id}`,
    key,
  });
  await insertDefPf1(c.sql, v(1, "hd-kt"), { runGroupIds: [PA_FIX.gKeToan] });
  await insertDefPf1(c.sql, v(2, "hd-off"), { enabled: false });
  await insertDefPf1(c.sql, v(3, "hd-del"), { deleted: true });
  await insertDefPf1(c.sql, v(4, "hd-mau"), { tenantId: null });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

/** Dọn run quy trình + `hub.runs` còn chạy (giữ giới hạn 5/tenant, run đồng thời). */
async function settleAll(): Promise<void> {
  await c.sql`update hub.process_runs set status = 'cancelled', finished_at = now()
    where status in ${c.sql(ACTIVE)}`;
  await c.sql`update hub.jobs set status = 'cancelled', finished_at = now() where status in ('queued', 'running')`;
  await c.sql`update hub.runs set status = 'finished', finished_at = now(), owner = null, lease_until = null
    where status = 'running'`;
}
const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
const nRuns = () => count(c.sql`select count(*)::int as n from hub.process_runs`);
const nJobs = () => count(c.sql`select count(*)::int as n from hub.jobs`);
const nRoomMsgs = (roomId = PA_FIX.room, placement?: string) =>
  count(c.sql`select count(*)::int as n from hub.room_messages where room_id = ${roomId}
    and (${placement ?? null}::text is null or placement = ${placement ?? null})`);
const nEvents = () => count(c.sql`select count(*)::int as n from hub.process_thread_events`);
const code = (r: { json: Json }) => r.json?.error?.code;
const notFound = (r: { status: number; json: Json }) => ({ status: r.status, code: code(r) });

describe("PF1 · bắt đầu run (start)", () => {
  it("AC-H28 · P1-01 · `!hoa-don-t HD-12` ở R ⇒ 201 + header, run origin room, hub.runs direct của A, khối block main", async () => {
    needSchema(c.ready);
    await settleAll();
    const main0 = await nRoomMsgs(PA_FIX.room, "main");
    const s = await startInRoom(c, { input: "HD-12" });
    const res = s.res as Json;
    expect(res.json?.process_run_id).toBe(s.runId);
    expect(res.json?.flow_id).toBe(s.flowId);
    expect(res.headers.get("x-flow-id")).toBe(s.flowId);
    const run = await runRow(c.sql, s.runId);
    expect(run).toMatchObject({
      origin_kind: "room",
      origin_room_id: PA_FIX.room,
      started_by: PA.A.id,
      def_version: 1,
      flow_id: s.flowId,
      trigger_message_id: s.messageId,
      input: "HD-12",
    });
    expect(run.snapshot?.key).toBe("hoa-don-t");
    expect(run.snapshot?.stages?.length).toBe(2);
    const conv = await c.sql<
      Json[]
    >`select id from hub.conversations where process_run_id = ${s.runId}`;
    expect(conv.length).toBe(1);
    await nextStageJob(c, s.runId);
    const hr = await stageHubRuns(c.sql, s.runId);
    expect(hr.length).toBe(1);
    expect(hr[0]?.user_id).toBe(PA.A.id);
    expect(hr[0]?.stage_run_id).toBeTruthy();
    const [k] = await c.sql<Json[]>`select kind from hub.runs where id = ${hr[0]?.id}`;
    expect(k?.kind).toBe("direct");
    await postThread(c);
    const msgs = await procMsgs(c.sql, s.runId);
    expect(msgs.length).toBe(1);
    expect(msgs[0]).toMatchObject({ placement: "main", process_kind: "block", flow_id: s.flowId });
    const [trig] = await c.sql<Json[]>`select seq from hub.room_messages where id = ${s.messageId}`;
    expect(Number(msgs[0]?.seq)).toBeGreaterThan(Number(trig?.seq));
    expect(await nRoomMsgs(PA_FIX.room, "main")).toBe(main0 + 2);
  }, 60_000);

  it("HUB-BR-28 · P1-02 · `!hoa-dn x` ⇒ 404 PROCESS_NOT_FOUND{suggestions:[hoa-don-t]}; `!` ⇒ 404; không lưu tin, 0 run, 0 job", async () => {
    needSchema(c.ready);
    const [m0, r0, j0] = [await nRoomMsgs(), await nRuns(), await nJobs()];
    const a = await c.call("A", "POST", `/rooms/${PA_FIX.room}/messages`, {
      client_msg_id: cm(),
      content: "!hoa-dn x",
    });
    expect(notFound(a)).toEqual({ status: 404, code: "PROCESS_NOT_FOUND" });
    expect(a.json?.error?.details?.suggestions).toEqual(["hoa-don-t"]);
    const b = await c.call("A", "POST", `/rooms/${PA_FIX.room}/messages`, {
      client_msg_id: cm(),
      content: "!",
    });
    expect(notFound(b)).toEqual({ status: 404, code: "PROCESS_NOT_FOUND" });
    expect(Array.isArray(b.json?.error?.details?.suggestions)).toBe(true);
    expect([await nRoomMsgs(), await nRuns(), await nJobs()]).toEqual([m0, r0, j0]);
  }, 30_000);

  it("HUB-BR-28 · P1-03 · run group không chứa X / tắt / đã xoá / mẫu ⇒ 404 PROCESS_NOT_FOUND cùng dạng", async () => {
    needSchema(c.ready);
    const r0 = await nRuns();
    const send = (role: "A" | "X", content: string) =>
      c.call(role, "POST", `/rooms/${PA_FIX.room}/messages`, { client_msg_id: cm(), content });
    const cases = [
      await send("X", "!hd-kt x"),
      await send("A", "!hd-off x"),
      await send("A", "!hd-del x"),
      await send("A", "!hd-mau x"),
    ];
    for (const r of cases) expect(notFound(r)).toEqual({ status: 404, code: "PROCESS_NOT_FOUND" });
    expect(Object.keys(cases[0]?.json?.error ?? {}).sort()).toEqual(
      Object.keys(cases[3]?.json?.error ?? {}).sort(),
    );
    expect(await nRuns()).toBe(r0);
  }, 30_000);

  it("HUB-FR-105 · P1-04 · tin có `answer_run_id` + `!hoa-don-t` ⇒ đường trả lời X2b, không tạo run", async () => {
    needSchema(c.ready);
    const r0 = await nRuns();
    const r = await c.call("A", "POST", `/rooms/${PA_FIX.room}/messages`, {
      client_msg_id: cm(),
      content: "!hoa-don-t",
      answer_run_id: "a5a10000-0000-4000-8000-000000009999",
    });
    expect(r.headers.get("x-process-run-id")).toBeNull();
    expect(code(r)).not.toBe("PROCESS_NOT_FOUND");
    expect(await nRuns()).toBe(r0);
  }, 30_000);

  it("CHAT-AC-52 · P1-05 · Hỏi AI `!hoa-don-t x` ⇒ 202 {process_run} + header, không tin hội thoại, 0 sự kiện thread, thread=null", async () => {
    needSchema(c.ready);
    await settleAll();
    const msg0 = await count(
      c.sql`select count(*)::int as n from hub.messages where conversation_id = ${CONV_A}`,
    );
    const ev0 = await nEvents();
    const r = await c.call("A", "POST", `/conversations/${CONV_A}/messages`, {
      content: "!hoa-don-t x",
    });
    expect(r.status).toBe(202);
    const id = r.json?.process_run?.id;
    expect(r.headers.get("x-process-run-id")).toBe(id);
    expect(r.json?.process_run?.origin).toMatchObject({
      kind: "conversation",
      conversation_id: CONV_A,
    });
    expect(
      await count(
        c.sql`select count(*)::int as n from hub.messages where conversation_id = ${CONV_A}`,
      ),
    ).toBe(msg0);
    expect((await runRow(c.sql, id)).origin_kind).toBe("conversation");
    const list = await c.call("A", "GET", `/process-runs?conversation_id=${CONV_A}`);
    expect(list.status).toBe(200);
    expect(((list.json?.items ?? []) as Json[]).map((x) => x.id)).toContain(id);
    expect(await nEvents()).toBe(ev0);
    const v = await c.call("A", "GET", `/process-runs/${id}`);
    expect(v.json?.thread).toBeNull();
  }, 30_000);

  it("HUB-FR-105 · P1-06 · POST /process-runs origin none ⇒ 201; phòng không là thành viên ⇒ 404; hội thoại của B ⇒ 404", async () => {
    needSchema(c.ready);
    await settleAll();
    const a = await startApi(c, { origin: { kind: "none" } });
    expect(a.status).toBe(201);
    expect(a.headers.get("x-process-run-id")).toBe(a.json?.id);
    const b = await startApi(c, { origin: { kind: "room", room_id: PA_FIX.roomOther } });
    expect(notFound(b)).toEqual({ status: 404, code: "NOT_FOUND" });
    const d = await startApi(c, { origin: { kind: "conversation", conversation_id: CONV_B } });
    expect(notFound(d)).toEqual({ status: 404, code: "NOT_FOUND" });
  }, 30_000);

  it("HUB-FR-105 · P1-07 · 5 run active acme ⇒ lần 6: 429 + Retry-After 30, tin không lưu, 0 sự kiện; beta 201; 1 run done ⇒ 201", async () => {
    needSchema(c.ready);
    await settleAll();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++)
      ids.push(
        (await insertRun(c.sql, { def: DEFS.hd, startedBy: PA.A, roomId: PA_FIX.room })).runId,
      );
    const [m0, ev0] = [await nRoomMsgs(), await nEvents()];
    const r = await c.call("A", "POST", `/rooms/${PA_FIX.room}/messages`, {
      client_msg_id: cm(),
      content: "!hoa-don-t x",
    });
    expect({ status: r.status, code: code(r) }).toEqual({
      status: 429,
      code: "TOO_MANY_PROCESS_RUNS",
    });
    expect(r.headers.get("retry-after")).toBe("30");
    expect([await nRoomMsgs(), await nEvents()]).toEqual([m0, ev0]);
    expect((await startApi(c, { role: "D" })).status).toBe(201);
    await c.sql`update hub.process_runs set status = 'done', finished_at = now() where id = ${ids[0] as string}`;
    expect((await startApi(c)).status).toBe(201);
  }, 30_000);

  it("HUB-FR-105 · P1-08 · 4 active + 6 yêu cầu song song ⇒ đúng 1×201, 5×429 (advisory lock)", async () => {
    needSchema(c.ready);
    await settleAll();
    for (let i = 0; i < 4; i++)
      await insertRun(c.sql, { def: DEFS.hd, startedBy: PA.A, roomId: PA_FIX.room });
    const rs = await Promise.all(Array.from({ length: 6 }, () => startApi(c)));
    const st = rs.map((r) => r.status).sort();
    expect(st).toEqual([201, 429, 429, 429, 429, 429]);
  }, 30_000);

  it("HUB-FR-101 · P1-09 · trùng `client_msg_id` ⇒ 200 tin cũ, vẫn 1 run", async () => {
    needSchema(c.ready);
    await settleAll();
    const r0 = await nRuns();
    const body = { client_msg_id: cm(), content: "!hoa-don-t trùng" };
    const a = await c.call("A", "POST", `/rooms/${PA_FIX.room}/messages`, body);
    expect(a.status).toBe(201);
    const b = await c.call("A", "POST", `/rooms/${PA_FIX.room}/messages`, body);
    expect(b.status).toBe(200);
    expect(b.json?.id).toBe(a.json?.id);
    expect(await nRuns()).toBe(r0 + 1);
  }, 30_000);

  it("CHAT-AC-51 · P1-10 · GET /processes: chỉ bật + group cho phép, sort tên, không mẫu/beta; X không thấy hoa-don-t", async () => {
    needSchema(c.ready);
    const a = await c.call("A", "GET", "/processes");
    expect(a.status).toBe(200);
    const keys = ((a.json?.items ?? []) as Json[]).map((i) => i.key);
    expect(keys).toContain("hoa-don-t");
    for (const k of ["hd-off", "hd-del", "hd-mau", "hd-kt"]) expect(keys).not.toContain(k);
    const names = ((a.json?.items ?? []) as Json[]).map((i) => i.name as string);
    expect(names).toEqual([...names].sort((p, q) => p.localeCompare(q)));
    expect(((a.json?.items ?? []) as Json[]).find((i) => i.key === "hoa-don-t")?.stage_count).toBe(
      2,
    );
    const x = await c.call("X", "GET", "/processes");
    expect(((x.json?.items ?? []) as Json[]).map((i) => i.key)).not.toContain("hoa-don-t");
    expect(((x.json?.items ?? []) as Json[]).map((i) => i.key)).toContain("p-auto");
  }, 30_000);

  it("ADM-FR-67 · P1-11 · GET /process-runs mine / scope=tenant member 403, tadmin mọi run / room_id ngoài ⇒ 404 / cursor", async () => {
    needSchema(c.ready);
    await settleAll();
    await insertRun(c.sql, { def: DEFS.hd, startedBy: PA.B, roomId: PA_FIX.room, status: "done" });
    const mine = await c.call("A", "GET", "/process-runs");
    expect(mine.status).toBe(200);
    const items = mine.json?.items as Json[];
    expect(items.length).toBeGreaterThanOrEqual(5);
    for (const i of items) expect(i.started_by?.id).toBe(PA.A.id);
    const m = await c.call("X", "GET", "/process-runs?scope=tenant");
    expect({ status: m.status, code: code(m) }).toEqual({ status: 403, code: "FORBIDDEN" });
    const t = await c.call("Adm", "GET", "/process-runs?scope=tenant&limit=200");
    const all = await count(
      c.sql`select count(*)::int as n from hub.process_runs where tenant_id = ${T.acme}`,
    );
    expect(((t.json?.items ?? []) as Json[]).length).toBe(all);
    expect(((t.json?.items ?? []) as Json[]).some((i) => i.started_by?.id === PA.B.id)).toBe(true);
    const h = await c.call("H", "GET", `/process-runs?room_id=${PA_FIX.room}`);
    expect(h.status).toBe(404);
    const p1 = await c.call("A", "GET", "/process-runs?limit=3");
    expect(((p1.json?.items ?? []) as Json[]).length).toBe(3);
    expect(typeof p1.json?.next_cursor).toBe("string");
    const p2 = await c.call(
      "A",
      "GET",
      `/process-runs?limit=3&cursor=${encodeURIComponent(p1.json?.next_cursor)}`,
    );
    const ids1 = ((p1.json?.items ?? []) as Json[]).map((i) => i.id);
    const ids2 = ((p2.json?.items ?? []) as Json[]).map((i) => i.id);
    expect(ids2.length).toBeGreaterThan(0);
    expect(ids2.filter((i) => ids1.includes(i))).toEqual([]);
    expect([...ids1, ...ids2]).toEqual(items.map((i) => i.id).slice(0, ids1.length + ids2.length));
  }, 30_000);

  it("ADM-FR-67 · P1-12 · tadmin POST /process-defs/:id/run ⇒ 201 origin admin, started_by = tadmin", async () => {
    needSchema(c.ready);
    await settleAll();
    const r = await c.call("Adm", "POST", `/process-defs/${PA_FIX.defHoaDon}/run`, {
      input: "HD-99",
    });
    expect(r.status).toBe(201);
    expect(r.json?.origin?.kind).toBe("admin");
    expect(r.json?.started_by?.id).toBe(PA.Adm.id);
    expect((await runRow(c.sql, r.json?.id)).started_by).toBe(PA.Adm.id);
  }, 30_000);

  it("HUB-BR-24 · P1-13 · run qua cổng do B (Chưa đạt) và T (Đạt) ⇒ mọi hub.runs stage user A; usage chỉ A; B, T = 0", async () => {
    needSchema(c.ready);
    await settleAll();
    const g = await toGate(c);
    expect((await review(c, "B", g.taskId, { result: "fail", feedback: "Thiếu MST" })).status).toBe(
      200,
    );
    await jobDone(c, await nextStageJob(c, g.runId), MD_OK);
    await waitStatus(c.sql, g.runId, "waiting_review");
    const [t2] = await c.sql<
      Json[]
    >`select id from hub.review_tasks where process_run_id = ${g.runId}
      and kind = 'review' and status = 'open'`;
    expect((await review(c, "T", t2?.id, { result: "pass" })).status).toBe(200);
    await jobDone(c, await nextStageJob(c, g.runId), "## Kết quả\nĐã ghi sổ.");
    await waitStatus(c.sql, g.runId, "done");
    const hr = await stageHubRuns(c.sql, g.runId);
    expect(hr.length).toBe(3);
    for (const r of hr) expect(r.user_id).toBe(PA.A.id);
    const u = await c.sql<
      Json[]
    >`select distinct u.user_id from hub.usage_logs u join hub.runs r on r.id = u.run_id
      where r.process_run_id = ${g.runId}`;
    expect(u.map((r) => r.user_id)).toEqual([PA.A.id]);
    for (const who of [PA.B.id, PA.T.id])
      expect(
        await count(c.sql`select count(*)::int as n from hub.usage_logs u join hub.runs r on r.id = u.run_id
          where r.process_run_id = ${g.runId} and u.user_id = ${who}`),
      ).toBe(0);
  }, 60_000);

  it("HUB-BR-24 · P1-14 · quota A hết giữa run ⇒ needs_decision `agent_failed`; không job theo B (Q5)", async () => {
    needSchema(c.ready);
    await settleAll();
    const g = await toGate(c);
    expect((await review(c, "B", g.taskId, { result: "pass" })).status).toBe(200);
    const job = await nextStageJob(c, g.runId);
    await c.rt.fail(job, "ALL_PROVIDERS_EXHAUSTED" as never, "hết hạn mức", "quota" as never);
    const run = await waitStatus(c.sql, g.runId, "needs_decision");
    expect(run.decision?.reason).toBe("agent_failed");
    const hr = await stageHubRuns(c.sql, g.runId);
    for (const r of hr) expect(r.user_id).toBe(PA.A.id);
    expect(hr.some((r) => r.user_id === PA.B.id)).toBe(false);
  }, 60_000);
});

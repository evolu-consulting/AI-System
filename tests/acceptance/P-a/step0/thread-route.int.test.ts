// HUB-FR-113 · CHAT-AC-52 · T7 · S0-14 (test-plan-int §1, plan-thread §1 T7): tin trong thread quy trình — chữ thường 201 (0 run
// X2b), tag `@agent` ⇒ 422 PROCESS_THREAD_NO_AGENT (không lưu), `!key` ⇒ chữ thường, `!!` bỏ một `!`, `answer_run_id` ⇒ 404,
// `flow_id` thread ở phòng khác ⇒ 404. Fixture SQL: run A origin R + khối `block` đã đăng (owner). Chỉ chèn khi `ready`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { R } from "../../H1/_fixtures";
import {
  type CtxPa,
  DEF_HD,
  fixId,
  insertDef,
  insertRun,
  type Json,
  PA,
  PA_FIX,
  part,
  postRoom,
  type RunFix,
  startPa,
  T,
} from "../_support/pa";
import { needSchema, tableExists } from "../_support/schema";

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
  await c.sql`update hub.rooms set last_seq = 1 where id = ${PA_FIX.room}`;
  await c.sql`insert into hub.room_messages ${c.sql({
    id: fixId(),
    room_id: PA_FIX.room,
    tenant_id: T.acme,
    seq: 1,
    sender_type: "process",
    sender_id: PA_FIX.defHoaDon,
    content: "Hoá đơn thử · bắt đầu",
    flow_id: run.flowId,
    placement: "main",
    process_run_id: run.runId,
    process_kind: "block",
    process_meta: c.sql.json(part.block(run.runId)),
    created_at: new Date(),
  })}`;
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const count = async (t: string): Promise<number> => {
  if (!(await tableExists(c.sql, t))) return 0;
  return Number((await c.sql.unsafe(`select count(*)::int as n from ${t}`))[0]?.n ?? 0);
};
const inThread = async (content: string): Promise<boolean> => {
  const r = await c.call("B", "GET", `/rooms/${PA_FIX.room}/messages?flow_id=${run.flowId}`);
  return (r.json?.items ?? []).some((m: Json) => m.content === content);
};

describe("S0-14 · gửi tin trong thread quy trình [T7]", () => {
  it("CHAT-AC-52 · S0-14 · chữ thường ⇒ 201 trong thread, 0 run X2b", async () => {
    needSchema(c.ready);
    const runs = await count("hub.runs");
    const s = await postRoom(c, "B", PA_FIX.room, { content: "Đã gửi file", flow_id: run.flowId });
    expect(s.res.status).toBe(201);
    expect(await count("hub.runs")).toBe(runs);
    expect(await inThread("Đã gửi file")).toBe(true);
  });
  it("CHAT-AC-52 · S0-14 · tag `@trello` đầu tin ⇒ 422 PROCESS_THREAD_NO_AGENT, không lưu, 0 run", async () => {
    needSchema(c.ready);
    const runs = await count("hub.runs");
    const s = await postRoom(c, "B", PA_FIX.room, {
      content: "@trello xem lại",
      flow_id: run.flowId,
    });
    expect({ s: s.res.status, code: s.res.json?.error?.code }).toEqual({
      s: 422,
      code: "PROCESS_THREAD_NO_AGENT",
    });
    expect(await count("hub.runs")).toBe(runs);
    expect(await inThread("@trello xem lại")).toBe(false);
  });
  it("HUB-BR-28 · S0-14 · `!hoa-don-t x` trong thread ⇒ 201 chữ thường, 0 process_runs mới; `!!x` ⇒ nội dung `!x`", async () => {
    needSchema(c.ready);
    const pr = await count("hub.process_runs");
    const s = await postRoom(c, "B", PA_FIX.room, { content: "!hoa-don-t x", flow_id: run.flowId });
    expect(s.res.status).toBe(201);
    expect(s.processRunId).toBeNull();
    expect(await count("hub.process_runs")).toBe(pr);
    const e = await postRoom(c, "B", PA_FIX.room, { content: "!!x", flow_id: run.flowId });
    expect(e.res.status).toBe(201);
    expect(e.res.json?.content).toBe("!x");
  });
  it("CHAT-AC-52 · S0-14 · kèm answer_run_id ⇒ 404 NOT_FOUND; flow thread ở phòng khác ⇒ 404", async () => {
    needSchema(c.ready);
    const a = await postRoom(c, "B", PA_FIX.room, {
      content: "Trả lời",
      flow_id: run.flowId,
      answer_run_id: R.runLive,
    });
    expect({ s: a.res.status, code: a.res.json?.error?.code }).toEqual({
      s: 404,
      code: "NOT_FOUND",
    });
    const o = await postRoom(c, "B", PA_FIX.roomOther, {
      content: "Lạc phòng",
      flow_id: run.flowId,
    });
    expect(o.res.status).toBe(404);
  });
});

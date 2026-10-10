// HUB-FR-113 · CHAT-AC-52 · T1 · T9 · S0-18, S0-19 (test-plan-int §1, plan-thread §4): đọc tin `process` (khối gốc + thread,
// tên người gửi = tên quy trình snapshot, `process` parse `RoomProcessPart`, meta hỏng ⇒ bỏ `process` giữ `content`, preview
// danh sách phòng) + chưa đọc như tin agent X2b (`room.message`/`room.unread`, `room_flow_reads`; T ngoài phòng không nhận).
// S0-19 gộp vào file này (cùng fixture). Fixture SQL owner, chỉ khi `ready`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { openMeStream } from "../../X2a/_x2a";
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
let r1: RunFix;
let seq = 0;
async function msg(run: RunFix, meta: Json, placement: "main" | "flow"): Promise<string> {
  const id = fixId();
  seq += 1;
  await c.sql`insert into hub.room_messages ${c.sql({
    id,
    room_id: PA_FIX.room,
    tenant_id: T.acme,
    seq,
    sender_type: "process",
    sender_id: PA_FIX.defHoaDon,
    content: `Quy trình · ${meta.kind}`,
    flow_id: run.flowId,
    placement,
    process_run_id: run.runId,
    process_kind: meta.kind,
    process_meta: c.sql.json(meta),
    created_at: new Date(Date.now() - 60_000 + seq * 1000),
  })}`;
  await c.sql`update hub.rooms set last_seq = ${seq}, last_activity_at = now() where id = ${PA_FIX.room}`;
  return id;
}
beforeAll(async () => {
  c = await startPa();
  if (!c.ready) return;
  await insertDef(c.sql, { id: PA_FIX.defHoaDon, tenantId: T.acme });
  const r2 = await insertRun(c.sql, {
    def: DEF_HD(PA_FIX.defHoaDon),
    startedBy: PA.B,
    roomId: PA_FIX.room,
  });
  await msg(r2, { kind: "block", broken: true }, "main"); // meta hỏng
  r1 = await insertRun(c.sql, {
    def: DEF_HD(PA_FIX.defHoaDon),
    startedBy: PA.A,
    roomId: PA_FIX.room,
  });
  await msg(r1, part.block(r1.runId), "main");
  await msg(r1, part.output(r1.runId), "flow");
  await msg(r1, part.task_result(r1.runId, PA.B), "flow");
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("S0-18 · đọc tin `process` [T1]", () => {
  it("CHAT-AC-52 · S0-18 · timeline main: khối có tên quy trình, process.kind=block, flow{message_count:2, recent[].process.kind}", async () => {
    needSchema(c.ready);
    const r = await c.call("X", "GET", `/rooms/${PA_FIX.room}/messages`);
    expect(r.status).toBe(200);
    const items: Json[] = r.json?.items ?? [];
    const block = items.find((m) => m.process_run_id === r1.runId && m.sender_type === "process");
    expect(block?.sender?.display_name).toBe("Hoá đơn thử");
    expect(block?.process?.kind).toBe("block");
    expect(block?.flow?.message_count).toBe(2);
    expect((block?.flow?.recent ?? []).map((x: Json) => x.process?.kind)).toContain("task_result");
    const broken = items.find((m) => m.sender_type === "process" && m.process_run_id !== r1.runId);
    expect(broken?.content).toBe("Quy trình · block");
    expect(broken?.process).toBeUndefined();
  });
  it("CHAT-AC-52 · S0-18 · ?flow_id=F trả 2 tin flow, `process` parse RoomProcessPart; preview phòng có tên quy trình", async () => {
    needSchema(c.ready);
    const { RoomProcessPartSchema: S } = await import("@ai/contracts/chat").then((m) => m as Json);
    const r = await c.call("X", "GET", `/rooms/${PA_FIX.room}/messages?flow_id=${r1.flowId}`);
    expect(r.status).toBe(200);
    const flow = (r.json?.items ?? []).filter(
      (m: Json) => m.sender_type === "process" && m.placement === "flow",
    );
    expect(flow.map((m: Json) => m.process?.kind)).toEqual(["output", "task_result"]);
    expect(typeof S?.safeParse).toBe("function");
    for (const m of flow) expect(S.safeParse(m.process).success).toBe(true);
    const list = await c.call("X", "GET", "/rooms");
    const room = (list.json?.items ?? []).find((x: Json) => x.id === PA_FIX.room);
    expect(room?.last_message?.sender?.display_name).toBe("Hoá đơn thử");
  });
});

describe("S0-19 · chưa đọc tin `process` [T9]", () => {
  it("HUB-FR-113 · S0-19 · B, X nhận room.message + room.unread; X đọc flow ⇒ chưa đọc thread 0; T không nhận gì", async () => {
    needSchema(c.ready);
    const h = c.hub.handles();
    expect({ postThreadOnce: typeof h?.postThreadOnce }).toEqual({ postThreadOnce: "function" });
    const run = await insertRun(c.sql, {
      def: DEF_HD(PA_FIX.defHoaDon),
      startedBy: PA.A,
      roomId: PA_FIX.room,
    });
    const sB = await openMeStream(c.hub, await c.tok("B"));
    const sX = await openMeStream(c.hub, await c.tok("X"));
    const sT = await openMeStream(c.hub, await c.tok("T"));
    try {
      await insertEvent(c.sql, {
        runId: run.runId,
        roomId: PA_FIX.room,
        meta: part.block(run.runId),
      });
      const out = await insertEvent(c.sql, {
        runId: run.runId,
        roomId: PA_FIX.room,
        meta: part.output(run.runId),
      });
      expect(await h.postThreadOnce()).toBe(2);
      for (const s of [sB, sX]) {
        expect(
          (await s.until((e) => e.event === "room.message" && e.data?.message?.id === out, 5_000))
            ?.event,
        ).toBe("room.message");
        expect((await s.until((e) => e.event === "room.unread", 5_000))?.event).toBe("room.unread");
      }
      const [m] = await c.sql<Json[]>`select seq from hub.room_messages where id = ${out}`;
      const rd = await c.call("X", "POST", `/rooms/${PA_FIX.room}/flows/${run.flowId}/read`, {
        seq: Number(m?.seq),
      });
      expect(rd.status).toBe(200);
      expect(rd.json?.unread).toBe(0);
      expect(
        sT.events.filter(
          (e) => e.data?.room_id === PA_FIX.room || e.data?.message?.room_id === PA_FIX.room,
        ),
      ).toEqual([]);
      const kinds = new Set([...sB.events, ...sX.events].map((e) => e.event));
      for (const k of kinds)
        expect(k.startsWith("room.") || k.startsWith("process.") || k === "stream.reset").toBe(
          true,
        );
    } finally {
      for (const s of [sB, sX, sT]) s.close();
    }
  });
});

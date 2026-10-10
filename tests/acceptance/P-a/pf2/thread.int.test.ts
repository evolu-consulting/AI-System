// HUB-FR-113 · T6 · T8 · plan-thread §2 · P2-16 (test-plan-int §3): forward + answer sinh tin thread `forward` (không `note`)
// rồi `task_result` (actor H ngoài phòng, `outside:true`); H không đọc được thread F; X (thành viên R) đọc được.
// Fixture SQL run origin R `waiting_answer`; đăng bằng `postThreadOnce` (processLoops:false). Đỏ trước code ở `needSchema`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CtxPa, type Json, PA, PA_FIX, startPa } from "../_support/pa";
import { needSchema } from "../_support/schema";
import { answer, askRun, forward, seedDef } from "./_local";

let c: CtxPa;
beforeAll(async () => {
  c = await startPa();
  if (!c.ready) return;
  await seedDef(c);
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("P2-16 · tin thread của nhờ/trả lời [T6, T8]", () => {
  it("HUB-FR-113 · P2-16 · thread F: forward{from A,to H,depth 1} không note, rồi task_result{ask, actor H, outside, answer}; H 404; X đọc được", async () => {
    needSchema(c.ready);
    const h = c.hub.handles();
    expect({ postThreadOnce: typeof h?.postThreadOnce }).toEqual({ postThreadOnce: "function" });
    const f = await askRun(c);
    expect((await forward(c, "A", f.taskId, PA.H.id, "NOTE-SECRET-P2")).status).toBe(200);
    expect((await answer(c, "H", f.taskId, { answer: "dd/mm" })).status).toBe(200);
    await h.postThreadOnce();
    const rows = await c.sql<
      Json[]
    >`select process_kind, process_meta, content from hub.room_messages
      where room_id = ${PA_FIX.room} and flow_id = ${f.run.flowId} and sender_type = 'process' order by seq`;
    const kinds = rows.map((r) => r.process_kind);
    expect(kinds.filter((k) => k === "forward" || k === "task_result")).toEqual([
      "forward",
      "task_result",
    ]);
    const fw = rows.find((r) => r.process_kind === "forward")?.process_meta;
    expect(fw).toMatchObject({ task_id: f.taskId, task_kind: "ask", depth: 1 });
    expect(fw?.from?.id).toBe(PA.A.id);
    expect(fw?.to?.id).toBe(PA.H.id);
    expect(fw && "note" in fw).toBe(false);
    const tr = rows.find((r) => r.process_kind === "task_result")?.process_meta;
    expect(tr).toMatchObject({
      task_id: f.taskId,
      task_kind: "ask",
      result: "answer",
      outside: true,
      answer: "dd/mm",
    });
    expect(tr?.actor?.id).toBe(PA.H.id);
    const all = await c.sql<
      Json[]
    >`select content, process_meta::text as meta from hub.room_messages where room_id = ${PA_FIX.room}`;
    for (const m of all)
      expect(`${m.content} ${m.meta ?? ""}`.includes("NOTE-SECRET-P2")).toBe(false);
    expect(
      (await c.call("H", "GET", `/rooms/${PA_FIX.room}/messages?flow_id=${f.run.flowId}`)).status,
    ).toBe(404);
    const x = await c.call("X", "GET", `/rooms/${PA_FIX.room}/messages?flow_id=${f.run.flowId}`);
    expect(x.status).toBe(200);
    const xk = (x.json?.items ?? []).map((m: Json) => m.process?.kind);
    expect(xk).toEqual(expect.arrayContaining(["forward", "task_result"]));
  });
});

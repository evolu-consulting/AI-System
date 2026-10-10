// AC-H32 · HUB-BR-26 · P3-04 (test-plan-int §4; plan D12, §4 hàng nhắc; plan-contract §7.1 `remindOnce`, `now`): nhắc 1 lần
// sau 1 ngày, task vẫn open, run không đổi trạng thái; task đã đóng không nhắc. Đồng hồ = seam `now` giả (không lùi SQL).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CtxPa, type Json, PA, startPa } from "../_support/pa";
import { needSchema } from "../_support/schema";
import { notices, reviewRun, seedDef } from "./_local";

let clock = Date.now();
let c: CtxPa;
beforeAll(async () => {
  c = await startPa({ now: () => new Date(clock) });
  if (!c.ready) return;
  await seedDef(c);
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("P3-04 · nhắc sau 1 ngày [AC-H32, HUB-BR-26]", () => {
  it("AC-H32 · P3-04 · remindOnce ×2 khi remind_at quá khứ ⇒ đúng 1 notice reminder/assignee (B, T), reminded_at set; task open; run giữ waiting_review; task closed ⇒ không nhắc", async () => {
    needSchema(c.ready);
    const h = c.hub.handles();
    expect({ remindOnce: typeof h?.remindOnce }).toEqual({ remindOnce: "function" });
    const open = await reviewRun(c);
    const closed = await reviewRun(c, { status: "closed" });
    const before = {
      B: (await notices(c, PA.B.id, "reminder")).length,
      T: (await notices(c, PA.T.id, "reminder")).length,
    };
    expect(await h.remindOnce()).toBe(0); // chưa tới remind_at (= tạo + 1 ngày)
    clock = Date.now() + 25 * 3_600_000;
    expect(await h.remindOnce()).toBeGreaterThanOrEqual(1);
    await h.remindOnce();
    for (const [k, u] of [
      ["B", PA.B.id],
      ["T", PA.T.id],
    ] as const) {
      const rows = await notices(c, u, "reminder");
      expect(rows.length - before[k]).toBe(1);
      expect(rows.filter((n) => n.task_id === open.taskId).length).toBe(1);
      expect(rows.some((n) => n.task_id === closed.taskId)).toBe(false);
    }
    expect((await notices(c, PA.X.id, "reminder")).length).toBe(0);
    const [t] = await c.sql<
      Json[]
    >`select status, reminded_at from hub.review_tasks where id = ${open.taskId}`;
    expect(t?.status).toBe("open");
    expect(t?.reminded_at).not.toBeNull();
    const [tc] = await c.sql<
      Json[]
    >`select reminded_at from hub.review_tasks where id = ${closed.taskId}`;
    expect(tc?.reminded_at).toBeNull();
    const [r] = await c.sql<
      Json[]
    >`select status from hub.process_runs where id = ${open.run.runId}`;
    expect(r?.status).toBe("waiting_review");
  });
});

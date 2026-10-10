// HUB-FR-112 · M6 · D12 · P3-05 (test-plan-int §4): "Quy trình" KHÔNG là user hệ thống — không có `admin.users`, không trong
// danh bạ, không tạo phòng/DM, không có endpoint gửi tin vào inbox. Đỏ trước code ở `needSchema` (+ route inbox).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CtxPa, type Json, startPa } from "../_support/pa";
import { needSchema } from "../_support/schema";
import { reviewRun, seedDef } from "./_local";

let c: CtxPa;
beforeAll(async () => {
  c = await startPa({ now: () => new Date(Date.now() + 25 * 3_600_000) });
  if (!c.ready) return;
  await seedDef(c);
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("P3-05 · người gửi hệ thống [M6]", () => {
  it("HUB-FR-112 · P3-05 · không admin.users 'Quy trình'/'process'; danh bạ không có; nhắc không tạo phòng; POST inbox ⇒ 404/405; GET inbox 200", async () => {
    needSchema(c.ready);
    const [u] = await c.sql<Json[]>`select count(*)::int as n from admin.users
      where display_name in ('Quy trình', 'Processes') or username = 'process'`;
    expect(u?.n).toBe(0);
    for (const q of ["Quy", "Quy trình", "process"]) {
      const d = await c.call("A", "GET", `/directory?q=${encodeURIComponent(q)}`);
      expect(d.status).toBe(200);
      const names = (d.json?.items ?? []).map((x: Json) => x.display_name);
      expect(names).not.toContain("Quy trình");
    }
    const [r0] = await c.sql<Json[]>`select count(*)::int as n from hub.rooms`;
    await reviewRun(c);
    const h = c.hub.handles();
    expect({ remindOnce: typeof h?.remindOnce }).toEqual({ remindOnce: "function" });
    await h.remindOnce();
    const [r1] = await c.sql<Json[]>`select count(*)::int as n from hub.rooms`;
    expect(r1?.n).toBe(r0?.n);
    expect((await c.call("T", "GET", "/me/process-inbox")).status).toBe(200);
    for (const p of ["/me/process-inbox", "/me/process-inbox/messages"]) {
      const res = await c.call("T", "POST", p, { content: "xin chào" });
      expect([404, 405]).toContain(res.status);
    }
  });
});

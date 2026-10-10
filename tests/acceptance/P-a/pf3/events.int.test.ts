// HUB-FR-112 · CHAT-AC-54 · plan-contract §5 · P3-06, P3-07 (test-plan-int §4): `process.notice{notice, unread}` tới chủ notice
// sau COMMIT (remindOnce); P3-07 ⇢PF1 (B Đạt qua `POST /review-tasks/:id/decision` — route PF1) ⇒ T nhận `review_task.closed`,
// notice `task_closed`, `/me/review-tasks` của T rỗng task đó. Đồng hồ = seam `now`. Đỏ trước code ở `needSchema`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { openMeStream } from "../../X2a/_x2a";
import { type CtxPa, PA, startPa } from "../_support/pa";
import { needSchema } from "../_support/schema";
import { myTaskIds, notices, reviewRun, seedDef } from "./_local";

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

describe("P3-06 · sự kiện process.notice [§5]", () => {
  it("HUB-FR-112 · P3-06 · remindOnce ⇒ T nhận process.notice{notice{kind reminder, task_id}, unread ≥ 1} sau COMMIT (notice đã đọc được qua API)", async () => {
    needSchema(c.ready);
    const h = c.hub.handles();
    expect({ remindOnce: typeof h?.remindOnce }).toEqual({ remindOnce: "function" });
    const f = await reviewRun(c);
    const s = await openMeStream(c.hub, await c.tok("T"));
    const sX = await openMeStream(c.hub, await c.tok("X"));
    try {
      clock = Date.now() + 25 * 3_600_000;
      await h.remindOnce();
      const ev = await s.until(
        (e) => e.event === "process.notice" && e.data?.notice?.task_id === f.taskId,
        5_000,
      );
      expect(ev?.data?.notice?.kind).toBe("reminder");
      expect(ev?.data?.unread).toBeGreaterThanOrEqual(1);
      const inbox = await c.call("T", "GET", "/me/process-inbox");
      expect(inbox.json?.items?.map((n: { id: string }) => n.id)).toContain(ev?.data?.notice?.id);
      expect(sX.events.filter((e) => e.event === "process.notice")).toEqual([]);
    } finally {
      s.close();
      sX.close();
    }
  });
});

describe("P3-07 ⇢PF1 · task chung đóng [CHAT-AC-54]", () => {
  it("CHAT-AC-54 · P3-07 ⇢PF1 · B Đạt task chung với T ⇒ T nhận review_task.closed{result:pass}; /me/review-tasks T không còn; notice task_closed cho T", async () => {
    needSchema(c.ready);
    const f = await reviewRun(c);
    const s = await openMeStream(c.hub, await c.tok("T"));
    try {
      const r = await c.call("B", "POST", `/review-tasks/${f.taskId}/decision`, { result: "pass" });
      expect(r.status).toBe(200);
      const ev = await s.until(
        (e) => e.event === "review_task.closed" && e.data?.task_id === f.taskId,
        5_000,
      );
      expect(ev?.data?.result).toBe("pass");
    } finally {
      s.close();
    }
    expect(await myTaskIds(c, "T")).not.toContain(f.taskId);
    expect((await notices(c, PA.T.id, "task_closed")).some((n) => n.task_id === f.taskId)).toBe(
      true,
    );
  });
});

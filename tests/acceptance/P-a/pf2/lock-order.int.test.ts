// HUB-FR-111 · plan §10 (thứ tự khoá) · P2-14 (test-plan-int §3): answer ∥ forward cùng task ×20 — không deadlock/500;
// answer luôn thắng (người chuyển giữ quyền trả lời); forward hoặc 200 trước (thêm assignee) hoặc 409 REVIEW_TASK_CLOSED sau.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CtxPa, PA, startPa } from "../_support/pa";
import { needSchema } from "../_support/schema";
import { answer, askRun, assignees, forward, seedDef, taskRow } from "./_local";

let c: CtxPa;
beforeAll(async () => {
  c = await startPa();
  if (!c.ready) return;
  await seedDef(c);
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("P2-14 · thứ tự khoá answer ∥ forward [plan §10]", () => {
  it("HUB-FR-111 · P2-14 · answer ∥ forward ×20 ⇒ không deadlock; answer 200; forward 200 (có assignee) hoặc 409 CLOSED (không assignee)", async () => {
    needSchema(c.ready);
    for (let i = 0; i < 20; i++) {
      const f = await askRun(c);
      const [a, fw] = await Promise.all([
        answer(c, "A", f.taskId, { answer: `v${i}` }),
        forward(c, "A", f.taskId, PA.H.id),
      ]);
      expect(a.status).toBe(200);
      expect([200, 409]).toContain(fw.status);
      const hasH = (await assignees(c, f.taskId)).some((x) => x.user_id === PA.H.id);
      if (fw.status === 409) {
        expect(fw.json?.error?.code).toBe("REVIEW_TASK_CLOSED");
        expect(hasH).toBe(false);
      } else expect(hasH).toBe(true);
      expect((await taskRow(c, f.taskId))?.status).toBe("closed");
    }
  }, 60_000);
});

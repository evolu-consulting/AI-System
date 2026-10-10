// HUB-FR-113 · T5 · P1-81(c) — test-plan-int §2: mô phỏng sập sau COMMIT (sự kiện outbox chèn SQL, `posted_at` null);
// app BẬT vòng nền (`processLoops` vắng ⇒ reconcile 5 s) ⇒ tin xuất hiện ≤ 5 s + biên (chờ điều kiện 8 s), `outcome=posted`.
// File riêng vì cần hub với vòng nền (DB reset theo file).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { insertEvent, insertRun, PA, PA_FIX, part, type RunFix, waitFor } from "../_support/pa";
import { needSchema } from "../_support/schema";
import { type CtxPf1, DEFS, procMsgs, startPf1 } from "./_local";

let c: CtxPf1;
let run: RunFix;
beforeAll(async () => {
  c = await startPf1({ loops: true });
  if (!c.ready) return;
  run = await insertRun(c.sql, {
    def: DEFS.hd,
    startedBy: PA.A,
    roomId: PA_FIX.room,
    status: "waiting_review",
  });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("P1-81(c) · outbox reconcile nền [T5]", () => {
  it("HUB-FR-113 · P1-81 · (c) sự kiện `output` chưa đăng (sập sau COMMIT) ⇒ vòng nền đăng ≤ 5 s + biên, outcome=posted", async () => {
    needSchema(c.ready);
    const ev = await insertEvent(c.sql, {
      runId: run.runId,
      roomId: PA_FIX.room,
      meta: part.output(run.runId),
    });
    const rows = await waitFor(
      () => procMsgs(c.sql, run.runId),
      (xs) => xs.some((m) => m.id === ev),
      8_000,
    );
    expect(rows.map((m) => m.id)).toContain(ev);
    const [e] =
      await c.sql`select outcome, posted_at from hub.process_thread_events where id = ${ev}`;
    expect(e?.outcome).toBe("posted");
    expect(e?.posted_at).not.toBeNull();
  }, 30_000);
});

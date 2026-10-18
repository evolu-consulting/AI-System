// AC-H41 · HUB-FR-144 · HUB-BR-42 · test-plan-int §3 PD-I23: hẹn `wait_until` sống qua khởi động lại — dừng hub-api,
// dựng hub mới cùng DB + cùng đồng hồ (`secondHub`), quét trên hub mới ⇒ stage chờ xong đúng một lần, bước kế có job.
// File riêng: ca dừng `c.hub` (closure `c.call` trỏ hub cũ) nên không đặt chung file với ca khác.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { HubPa } from "../../P-a/_support/pa";
import {
  type CtxPd,
  needPdSchema,
  secondHub,
  startPd,
  timersOf,
  waitStageStatus,
} from "../_support/pd";
import { hubRunsOfStage, jobOfStage, stageOutputs, startWait, sweepOn, waitMd } from "./_wait";

let c: CtxPd;
let h2: HubPa | undefined;
let hubStopped = false;
beforeAll(async () => {
  c = await startPd();
}, 60_000);
afterAll(async () => {
  await h2?.stop();
  if (!hubStopped) return c?.stop();
  // `c.hub` đã dừng trong ca ⇒ không gọi `c.stop()` (đóng hub lần hai); tự đóng redis + sql của ctx.
  c.redis.disconnect();
  await c.sql.end();
});

describe("PD-I23 · khởi động lại [AC-H41][HUB-FR-144]", () => {
  it("AC-H41 · PD-I23 · dừng hub, hub mới cùng DB, tới 2026-11-17T02:00Z `sweep` ⇒ s1 done, 1 output đúng nguyên văn, s2 đúng 1 job, fired_at", async () => {
    needPdSchema(c.pd);
    const { runId } = await startWait(c, { fields: { ngay_het_han: "2026-11-20" } });
    await waitStageStatus(c, runId, 1, "waiting_timer");
    await c.hub.stop();
    hubStopped = true;
    h2 = await secondHub(c, { now: c.clk.now });
    c.clk.set(new Date("2026-11-17T02:00:00Z"));
    await sweepOn(h2);
    await waitStageStatus(c, runId, 1, "done", 0);
    const line = "Đã chờ tới 2026-11-17 09:00 (Asia/Ho_Chi_Minh).";
    const outs = await stageOutputs(c.sql, runId, 1);
    expect(outs.map((o) => o.content)).toEqual([waitMd("Chờ hạn", line)]);
    const ts = await timersOf(c.sql, runId);
    expect(ts.length).toBe(1);
    expect(ts[0]?.fired_at).not.toBeNull();
    expect(ts[0]?.cancelled_at).toBeNull();
    await jobOfStage(c, runId, 2);
    await sweepOn(h2);
    expect(await hubRunsOfStage(c.sql, runId, 2)).toBe(1);
    expect((await stageOutputs(c.sql, runId, 1)).length).toBe(1);
  }, 60_000);
});

// AC-H41 · HUB-FR-144 · HUB-BR-42 · PD-R12 · test-plan-int §3 PD-I37, PD-I38: huỷ run ⇒ hẹn mở (`wait_until`/`retry`)
// được đặt `cancelled_at` cùng giao dịch huỷ (đọc ngay sau 200, chưa quét); quét sau hạn không bắn, run không hồi sinh.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type CtxPd,
  cancelRun,
  jobsOfRun,
  needPdSchema,
  nextStageJob,
  PD_DEFS,
  runRow,
  SEC,
  startPd,
  startRun,
  sweepN,
  timersOf,
  waitStageStatus,
} from "../_support/pd";
import { ensureDef, settle, stageOutputs, startWait } from "./_wait";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("PD-I37, PD-I38 · huỷ run huỷ hẹn [AC-H41][PD-R12]", () => {
  it("AC-H41 · PD-I37 · run waiting_timer ⇒ A huỷ ⇒ hẹn cancelled_at (ngay, cùng tx), fired_at NULL; qua hạn `sweep` ⇒ 0 output s1", async () => {
    needPdSchema(c.pd);
    const { runId } = await startWait(c, { fields: { ngay_het_han: "2026-11-20" } });
    await waitStageStatus(c, runId, 1, "waiting_timer");
    const r = await cancelRun(c, "A", runId);
    expect(r.status).toBe(200);
    const ts = await timersOf(c.sql, runId);
    expect(ts.length).toBe(1);
    expect(ts[0]?.cancelled_at).not.toBeNull();
    expect(ts[0]?.fired_at).toBeNull();
    expect((await runRow(c.sql, runId)).status).toBe("cancelled");
    c.clk.set(new Date("2026-11-18T00:00:00Z"));
    await sweepN(c, 2);
    const after = await timersOf(c.sql, runId);
    expect(after.map((t) => t.fired_at)).toEqual([null]);
    expect((await stageOutputs(c.sql, runId, 1)).length).toBe(0);
    expect((await runRow(c.sql, runId)).status).toBe("cancelled");
  }, 60_000);

  it("AC-H39 · PD-I38 · hẹn retry mở ⇒ Adm huỷ run ⇒ cancelled_at; `sweep` sau hạn ⇒ 0 job mới, run cancelled không hồi sinh", async () => {
    needPdSchema(c.pd);
    await settle(c.sql);
    await ensureDef(c, PD_DEFS.retry());
    const runId = await startRun(c, "pd-retry");
    const job = await nextStageJob(c, runId);
    await c.rt.fail(job, "UPSTREAM_ERROR" as never, "lỗi tạm");
    await waitStageStatus(c, runId, 0, "waiting_timer");
    const open = await timersOf(c.sql, runId);
    expect(open.map((t) => [t.kind, t.fired_at, t.cancelled_at])).toEqual([["retry", null, null]]);
    const jobs0 = (await jobsOfRun(c.sql, runId)).length;
    const r = await cancelRun(c, "Adm", runId);
    expect(r.status).toBe(200);
    const ts = await timersOf(c.sql, runId);
    expect(ts[0]?.cancelled_at).not.toBeNull();
    expect(ts[0]?.fired_at).toBeNull();
    c.clk.advance(60 * SEC);
    await sweepN(c, 2);
    expect((await timersOf(c.sql, runId))[0]?.fired_at).toBeNull();
    expect((await jobsOfRun(c.sql, runId)).length).toBe(jobs0);
    expect((await runRow(c.sql, runId)).status).toBe("cancelled");
  }, 60_000);
});

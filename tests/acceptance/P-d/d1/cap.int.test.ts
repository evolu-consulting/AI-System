// AC-H41 · HUB-FR-105 · HUB-BR-42 · PD-R16 · test-plan-int §3 PD-I30…I32: trần 5 run/tenant chỉ đếm
// `PROCESS_RUN_CAP_COUNTED` (không tính `waiting_timer`); run tỉnh dậy từ hẹn không qua trần. Mẫu P1-07 (`insertRun`, 429 +
// `Retry-After`). Chèn run `waiting_timer` CHỈ sau `needPdSchema` (CHECK 0036).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { insertRun } from "../../P-a/_support/pa";
import {
  type CtxPd,
  DEFS,
  needPdSchema,
  PA,
  PA_FIX,
  startApi,
  startPd,
  sweepN,
  timersOf,
  waitStageStatus,
} from "../_support/pd";
import { jobOfStage, settle, startWait } from "./_wait";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

/** n run `running` + m run `waiting_timer` acme (SQL, def `hoa-don-t`). */
async function fill(running: number, waiting: number): Promise<void> {
  for (let i = 0; i < running; i++)
    await insertRun(c.sql, { def: DEFS.hd, startedBy: PA.A, roomId: PA_FIX.room });
  for (let i = 0; i < waiting; i++)
    await insertRun(c.sql, {
      def: DEFS.hd,
      startedBy: PA.A,
      roomId: PA_FIX.room,
      status: "waiting_timer",
      stageStatus: "waiting_timer",
    });
}
const errCode = (r: { json: unknown }) =>
  (r.json as { error?: { code?: string } } | null)?.error?.code ?? null;

describe("PD-I30…I32 · trần run/tenant với waiting_timer [AC-H41][PD-R16]", () => {
  it("AC-H41 · PD-I30 · 4 running + 1 waiting_timer acme ⇒ A start 201 (waiting_timer không tính trần)", async () => {
    needPdSchema(c.pd);
    await settle(c.sql);
    await fill(4, 1);
    const r = await startApi(c);
    expect({ status: r.status, code: errCode(r) }).toEqual({ status: 201, code: null });
  }, 30_000);

  it("AC-H41 · PD-I31 · 5 running + 1 waiting_timer ⇒ A start 429 TOO_MANY_PROCESS_RUNS + Retry-After 30", async () => {
    needPdSchema(c.pd);
    await settle(c.sql);
    await fill(5, 1);
    const r = await startApi(c);
    expect({ status: r.status, code: errCode(r) }).toEqual({
      status: 429,
      code: "TOO_MANY_PROCESS_RUNS",
    });
    expect(r.headers.get("retry-after")).toBe("30");
  }, 30_000);

  it("AC-H41 · PD-I32 · run thật waiting_timer tới hạn + 5 running (SQL) ⇒ `sweep` ⇒ run tỉnh dậy, s2 có job (không bị trần)", async () => {
    needPdSchema(c.pd);
    const { runId } = await startWait(c, { fields: { ngay_het_han: "2026-11-20" } });
    await waitStageStatus(c, runId, 1, "waiting_timer");
    await fill(5, 0);
    c.clk.set(new Date("2026-11-17T02:00:01Z"));
    await sweepN(c, 1);
    await waitStageStatus(c, runId, 1, "done", 0);
    expect((await timersOf(c.sql, runId))[0]?.fired_at).not.toBeNull();
    await jobOfStage(c, runId, 2);
  }, 60_000);
});

// N2-FR-04 · N2-AC10 · trần run đồng thời theo tenant (`admin.tenants.process_runs_max`, mặc định 5): Hub đọc trần của ĐÚNG
// tenant người bắt đầu trong câu đếm; `waiting_review` vẫn đếm; seam `processRunsPerTenant` vắng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { insertRun } from "../P-a/_support/pa";
import { DEFS, PA, PA_FIX, startApi } from "../P-d/_support/pd";
import { ACME, BETA, type CtxN2, errCode, needRunsMax, setRunsMax, startN2 } from "./_n2";

let c: CtxN2;
beforeAll(async () => {
  c = await startN2();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const clearRuns = () =>
  c.sql`update hub.process_runs set status = 'cancelled' where status <> 'cancelled'`;

describe("N2-AC10 · trần run theo tenant [N2-FR-04]", () => {
  it("N2-FR-04 · cột mặc định 5 cho mọi tenant", async () => {
    await needRunsMax(c.sql);
    const rows = await c.sql<{ n: number }[]>`select process_runs_max as n from admin.tenants
      where id in (${ACME}, ${BETA})`;
    expect(rows.map((r) => Number(r.n))).toEqual([5, 5]);
  });

  it("N2-AC10 · acme trần 1, có 1 run waiting_review ⇒ A start 429 + Retry-After; beta (trần 5) vẫn 201", async () => {
    await needRunsMax(c.sql);
    await clearRuns();
    await setRunsMax(c.sql, ACME, 1);
    await insertRun(c.sql, {
      def: DEFS.hd,
      startedBy: PA.A,
      roomId: PA_FIX.room,
      status: "waiting_review",
    });
    const a = await startApi(c);
    expect({ status: a.status, code: errCode(a) }).toEqual({
      status: 429,
      code: "TOO_MANY_PROCESS_RUNS",
    });
    expect(a.headers.get("retry-after")).toBe("30");
    const d = await startApi(c, { role: "D" });
    expect({ status: d.status, code: errCode(d) }).toEqual({ status: 201, code: null });
  }, 30_000);

  it("N2-AC10 · nâng trần acme lên 2 ⇒ áp ngay (không cache): A start 201, lần kế 429", async () => {
    await needRunsMax(c.sql);
    await clearRuns();
    await setRunsMax(c.sql, ACME, 2);
    await insertRun(c.sql, { def: DEFS.hd, startedBy: PA.A, roomId: PA_FIX.room });
    const ok = await startApi(c);
    expect({ status: ok.status, code: errCode(ok) }).toEqual({ status: 201, code: null });
    const no = await startApi(c);
    expect({ status: no.status, code: errCode(no) }).toEqual({
      status: 429,
      code: "TOO_MANY_PROCESS_RUNS",
    });
  }, 30_000);

  it("N2-FR-04 · DB chặn trần ngoài 1…1000 (CHECK)", async () => {
    await needRunsMax(c.sql);
    for (const n of [0, 1001]) {
      const err = await setRunsMax(c.sql, ACME, n).then(
        () => null,
        (e: { code?: string }) => e.code ?? "x",
      );
      expect({ n, err }).toEqual({ n, err: "23514" });
    }
    await setRunsMax(c.sql, ACME, 5);
  });
});

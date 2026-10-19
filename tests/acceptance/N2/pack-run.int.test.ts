// N2-FR-01 · N2-AC01/AC02 · gói khởi chạy run trong cùng process (cổng `PackRuns`, không HTTP nội bộ) và gắn `run_id` vào
// bản ghi gói; lỗi (def không chạy được / trần / item tenant khác / item đã có run) ⇒ không run mới, `run_id` giữ null.
// Mẫu: `POST /pack/pkdemo/items/:id/run` (guard write). N2-D08: `outcomes` cho gói biết run bị từ chối.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ID, seedItem } from "../N1/_support/n1";
import { type Json, nextStageJob, PA } from "../P-d/_support/pd";
import {
  ACME,
  BETA,
  type CtxN2,
  enablePk,
  errCode,
  needPkRun,
  needRunsMax,
  setRunsMax,
  startN2,
  untilPkActions,
} from "./_n2";

let c: CtxN2;
beforeAll(async () => {
  c = await startN2();
  await seedItem(c.sql, ACME, ID.itemA, ID.lineA, "Mục A");
  await seedItem(c.sql, BETA, ID.itemB, ID.lineB, "Mục B");
  await enablePk(c, ACME, [PA.A, PA.B]);
  await untilPkActions(c, "A", ["read", "write"]);
}, 90_000);
afterAll(async () => {
  await c?.stop();
});

const runOf = (itemId: string) =>
  c.call("A", "POST", `/pack/pkdemo/items/${itemId}/run`, {
    process_key: "p-single",
    input: "HS-01",
  });
const itemRun = async (id: string) =>
  (await c.sql<Json[]>`select run_id from pkdemo.items where id = ${id}`)[0]?.run_id ?? null;
const runCount = async () =>
  Number((await c.sql<{ n: number }[]>`select count(*)::int as n from hub.process_runs`)[0]?.n);

describe("N2-AC01/02 · khởi chạy run từ gói [N2-FR-01]", () => {
  it("N2-AC02 · process_key không chạy được ⇒ 404 PROCESS_NOT_FOUND; item tenant khác ⇒ 404; 0 run mới, run_id null", async () => {
    await needPkRun(c.sql);
    const before = await runCount();
    const nf = await c.call("A", "POST", `/pack/pkdemo/items/${ID.itemA}/run`, {
      process_key: "khong-co",
      input: "x",
    });
    expect({ status: nf.status, code: errCode(nf) }).toEqual({
      status: 404,
      code: "PROCESS_NOT_FOUND",
    });
    const other = await runOf(ID.itemB);
    expect(other.status).toBe(404);
    const bad = await c.call("A", "POST", `/pack/pkdemo/items/${ID.itemA}/run`, { input: 1 });
    expect(bad.status).toBe(400);
    expect({
      runs: await runCount(),
      a: await itemRun(ID.itemA),
      b: await itemRun(ID.itemB),
    }).toEqual({ runs: before, a: null, b: null });
  }, 30_000);

  it("N2-AC02 · trần tenant đầy ⇒ 429 TOO_MANY_PROCESS_RUNS, run_id null", async () => {
    await needPkRun(c.sql);
    await needRunsMax(c.sql);
    await setRunsMax(c.sql, ACME, 1);
    await c.sql`update hub.process_runs set status = 'cancelled'`;
    const fill = await c.call("A", "POST", "/process-runs", {
      process_key: "p-single",
      input: "fill",
      origin: { kind: "none" },
    });
    expect(fill.status).toBe(201);
    const r = await runOf(ID.itemA);
    expect({ status: r.status, code: errCode(r) }).toEqual({
      status: 429,
      code: "TOO_MANY_PROCESS_RUNS",
    });
    expect(await itemRun(ID.itemA)).toBeNull();
    await c.sql`update hub.process_runs set status = 'cancelled'`;
    await setRunsMax(c.sql, ACME, 5);
  }, 30_000);

  it("N2-AC01 · A (write) ⇒ 201 {run_id}; items.run_id = run; run acme, started_by A; stage có job (đã kick); lần 2 ⇒ 409", async () => {
    await needPkRun(c.sql);
    const r = await runOf(ID.itemA);
    expect({ status: r.status, code: errCode(r) }).toEqual({ status: 201, code: null });
    const runId = r.json?.run_id as string;
    expect(await itemRun(ID.itemA)).toBe(runId);
    const [run] = await c.sql<Json[]>`select tenant_id, started_by from hub.process_runs
      where id = ${runId}`;
    expect({ t: run?.tenant_id, by: run?.started_by }).toEqual({ t: ACME, by: PA.A.id });
    await nextStageJob(c, runId);
    const again = await runOf(ID.itemA);
    expect(again.status).toBe(409);
    expect(await itemRun(ID.itemA)).toBe(runId);
  }, 30_000);

  it("N2-AC01 · người không có quyền write gói (X) ⇒ 403, không run", async () => {
    const before = await runCount();
    const r = await c.call("X", "POST", `/pack/pkdemo/items/${ID.itemA}/run`, {
      process_key: "p-single",
      input: "x",
    });
    expect(r.status).toBe(403);
    expect(await runCount()).toBe(before);
  });
});

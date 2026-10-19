// N2-D08 · security L3 · review Trung #2/#4: (1) `PackRuns.outcomes` qua route mẫu `GET /pack/pkdemo/items/:id/run` — gói chỉ
// đọc kết quả run mà item ĐANG GIỮ (run Từ chối ⇒ cancelled + rejected + lý do; item không run / tenant khác ⇒ 404);
// (2) huỷ bù: gắn `run_id` lỗi (trigger owner ném) ⇒ run vừa mở về `cancelled`, không còn `hub.runs` sống, `run_id` null.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ID, seedItem } from "../N1/_support/n1";
import {
  type Json,
  jobDone,
  MD_OK,
  nextStageJob,
  PA,
  review,
  waitStatus,
} from "../P-d/_support/pd";
import { ACME, BETA, type CtxN2, enablePk, needPkRun, startN2, untilPkActions } from "./_n2";

const x = (n: number) => `a5e20000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const IT = { rej: x(1), rejL: x(2), none: x(3), noneL: x(4), boom: x(5), boomL: x(6) } as const;

let c: CtxN2;
beforeAll(async () => {
  c = await startN2({ processRunsPerTenant: 200 });
  await seedItem(c.sql, ACME, IT.rej, IT.rejL, "Mục từ chối");
  await seedItem(c.sql, ACME, IT.none, IT.noneL, "Mục chưa chạy");
  await seedItem(c.sql, ACME, IT.boom, IT.boomL, "BOOM");
  await seedItem(c.sql, BETA, ID.itemB, ID.lineB, "Mục B");
  await enablePk(c, ACME, [PA.A, PA.B]);
  await untilPkActions(c, "A", ["read", "write"]);
}, 90_000);
afterAll(async () => {
  if (c) await c.sql`drop trigger if exists n2_boom on pkdemo.items`;
  await c?.stop();
});

const itemRun = async (id: string) =>
  (await c.sql<Json[]>`select run_id from pkdemo.items where id = ${id}`)[0]?.run_id ?? null;
const outcome = (id: string) => c.call("A", "GET", `/pack/pkdemo/items/${id}/run`);

describe("N2-D08 · kết quả run của item [N2-FR-01][N2-FR-02]", () => {
  it("N2-D08 · item chạy `hoa-don-t`, B Từ chối ⇒ GET item/run = {cancelled, rejected, feedback}", async () => {
    await needPkRun(c.sql);
    const r = await c.call("A", "POST", `/pack/pkdemo/items/${IT.rej}/run`, {
      process_key: "hoa-don-t",
      input: "HD-12",
    });
    expect(r.status).toBe(201);
    const runId = r.json?.run_id as string;
    await jobDone(c, await nextStageJob(c, runId), MD_OK);
    await waitStatus(c.sql, runId, "waiting_review");
    const [t] = await c.sql<Json[]>`select id from hub.review_tasks where process_run_id = ${runId}
      and kind = 'review' and status = 'open'`;
    const rej = await review(c, "B", t?.id, { result: "reject", feedback: "Sai giá" });
    expect(rej.status).toBe(200);
    const o = await outcome(IT.rej);
    expect({ status: o.status, body: o.json }).toEqual({
      status: 200,
      body: { run_id: runId, status: "cancelled", rejected: true, feedback: "Sai giá" },
    });
  }, 60_000);

  it("security L3 · item chưa có run / item tenant khác / id lạ ⇒ 404 (không hỏi run tuỳ ý)", async () => {
    await needPkRun(c.sql);
    for (const id of [IT.none, ID.itemB, x(99)]) expect((await outcome(id)).status).toBe(404);
  });
});

describe("N2-FR-01 · huỷ bù khi gắn run lỗi [N2-D04]", () => {
  it("review #4 · trigger chặn gắn `run_id` của item BOOM ⇒ 500, run mới `cancelled`, 0 hub.runs sống, run_id null", async () => {
    await needPkRun(c.sql);
    await c.sql.unsafe(`create or replace function pkdemo.n2_boom() returns trigger language plpgsql as $$
      begin if new.title = 'BOOM' and new.run_id is not null then raise exception 'n2 boom'; end if; return new; end $$`);
    await c.sql.unsafe(`create trigger n2_boom before update on pkdemo.items
      for each row execute function pkdemo.n2_boom()`);
    const since = new Date(Date.now() - 1000);
    const r = await c.call("A", "POST", `/pack/pkdemo/items/${IT.boom}/run`, {
      process_key: "p-single",
      input: "HS-B",
    });
    expect(r.status).toBe(500);
    expect(await itemRun(IT.boom)).toBeNull();
    const runs = await c.sql<Json[]>`select id, status from hub.process_runs
      where started_by = ${PA.A.id} and input = 'HS-B' and started_at >= ${since}`;
    expect(runs.map((x) => x.status)).toEqual(["cancelled"]);
    const live = await c.sql<Json[]>`select id from hub.runs
      where process_run_id = ${runs[0]?.id} and status in ('queued', 'running')`;
    expect([...live]).toEqual([]);
  }, 30_000);
});

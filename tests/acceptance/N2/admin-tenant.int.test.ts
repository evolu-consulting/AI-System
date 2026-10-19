// N2-FR-04 · N2-AC11 · admin-api `PATCH /admin/tenants/:id` nhận `process_runs_max` (1…1000, platform_admin), response có
// trường; Hub đọc giá trị mới ở lần start kế (không cache).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startApi } from "../P-d/_support/pd";
import { ACME, type CtxN2, errCode, needRunsMax, startN2 } from "./_n2";

let c: CtxN2;
beforeAll(async () => {
  c = await startN2();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const get = async () => (await c.admin.call("GET", `/admin/tenants/${ACME}`)).json;

describe("N2-AC11 · admin sửa trần run [N2-FR-04]", () => {
  it("N2-AC11 · GET có process_runs_max = 5; PATCH 0 / 1001 / 2.5 ⇒ 400; 200 ⇒ 200 + đọc lại", async () => {
    await needRunsMax(c.sql);
    const t = await get();
    expect(t?.process_runs_max).toBe(5);
    for (const v of [0, 1001, 2.5]) {
      const r = await c.admin.call("PATCH", `/admin/tenants/${ACME}`, {
        version: t.version,
        process_runs_max: v,
      });
      expect({ v, status: r.status, code: errCode(r) }).toEqual({
        v,
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }
    const ok = await c.admin.call("PATCH", `/admin/tenants/${ACME}`, {
      version: t.version,
      process_runs_max: 200,
    });
    expect({ status: ok.status, max: ok.json?.process_runs_max }).toEqual({
      status: 200,
      max: 200,
    });
    expect((await get())?.process_runs_max).toBe(200);
  });

  it("N2-AC11 · trần 1 qua admin-api ⇒ Hub áp ngay: run thứ 2 của acme 429", async () => {
    await needRunsMax(c.sql);
    await c.sql`update hub.process_runs set status = 'cancelled'`;
    const t = await get();
    const r = await c.admin.call("PATCH", `/admin/tenants/${ACME}`, {
      version: t.version,
      process_runs_max: 1,
    });
    expect(r.status).toBe(200);
    expect((await startApi(c)).status).toBe(201);
    const second = await startApi(c);
    expect({ status: second.status, code: errCode(second) }).toEqual({
      status: 429,
      code: "TOO_MANY_PROCESS_RUNS",
    });
  }, 30_000);
});

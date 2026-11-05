// CR-121 · cr121-c3a-overview-api · int route `GET /ops/overview` (hub-api thật, DB test): chỉ platform_admin (tenant_admin/member ⇒ 403,
// không token ⇒ 401); platform_admin ⇒ 200 đúng hợp đồng; tham số sai ⇒ dùng mặc định (không 4xx); lần hai trong 60 s trả cùng bản cache.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { OpsOverviewSchema } from "@ai/contracts/hub-admin";
import {
  call,
  type Hub,
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Sql,
  sign,
  startHub,
  USERS,
} from "../../../../../tests/acceptance/H1/_fixtures";

let sql: Sql;
let k: Keys;
let hub: Hub;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  k = await makeKeys();
  hub = await startHub(k);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
});

describe("GET /ops/overview · quyền + hợp đồng", () => {
  it("tenant_admin/member ⇒ 403, không token ⇒ 401, platform_admin ⇒ 200 đúng schema, tham số sai ⇒ mặc định, lần hai = cache", async () => {
    for (const who of [USERS.lan, USERS.tadmin]) {
      const res = await call(hub, "GET", "/ops/overview", { token: await sign(k, who) });
      expect({ status: res.status, code: res.json?.error?.code }).toEqual({
        status: 403,
        code: "FORBIDDEN",
      });
    }
    expect((await call(hub, "GET", "/ops/overview")).status).toBe(401);

    const token = await sign(k, USERS.padmin);
    const ok = await call(hub, "GET", "/ops/overview", { token });
    expect(ok.status).toBe(200);
    const body = OpsOverviewSchema.parse(ok.json);
    expect(body.params).toEqual({ stuck_hours: 4, quota_pct: 80 });
    expect(body.kpi.p95.p95_basis).toBe("excluding_review_wait");

    const bad = await call(hub, "GET", "/ops/overview?stuck_hours=0&quota_pct=abc", { token });
    expect(bad.status).toBe(200);
    expect(OpsOverviewSchema.parse(bad.json).params).toEqual({ stuck_hours: 4, quota_pct: 80 });

    const custom = await call(hub, "GET", "/ops/overview?stuck_hours=8", { token });
    expect(OpsOverviewSchema.parse(custom.json).params.stuck_hours).toBe(8);

    const again = await call(hub, "GET", "/ops/overview", { token });
    expect(again.json.generated_at).toBe(body.generated_at);
  });
});

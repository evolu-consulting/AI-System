// CR-104 · ops-core · int route `/ops/*` (hub-api thật, DB test): chỉ platform_admin (member/tenant_admin ⇒ 403, không token ⇒
// 401) trên MỌI route; cấu hình sai ⇒ 422 không ghi gì; lưu cấu hình ⇒ một sự kiện `settings_changed` (ai, cũ → mới);
// "Kiểm tra ngay" chạy lượt (check mẫu DB/Redis) rồi lần bấm thứ hai trong 1 phút ⇒ 429.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { OPS_DEFAULT_SETTINGS } from "@ai/contracts/hub-admin";
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

const ROUTES = [
  { method: "GET", path: "/ops/status" },
  { method: "POST", path: "/ops/check" },
  { method: "GET", path: "/ops/settings" },
  { method: "PUT", path: "/ops/settings", body: OPS_DEFAULT_SETTINGS },
] as const;

describe("ops-watch · quyền /ops/*", () => {
  it("không phải platform_admin gọi /ops/* ⇒ 403 (member, tenant_admin), không token ⇒ 401, không ghi gì", async () => {
    for (const who of [USERS.lan, USERS.tadmin]) {
      const token = await sign(k, who);
      for (const r of ROUTES) {
        const res = await call(hub, r.method, r.path, {
          token,
          ...("body" in r ? { body: r.body } : {}),
        });
        expect({
          who: who.username,
          ...r,
          status: res.status,
          code: res.json?.error?.code,
        }).toEqual({
          who: who.username,
          ...r,
          status: 403,
          code: "FORBIDDEN",
        });
      }
    }
    for (const r of ROUTES) expect((await call(hub, r.method, r.path)).status).toBe(401);
    const [n] = await sql<{ c: number; e: number }[]>`
      select (select count(*)::int from hub.ops_checks) as c, (select count(*)::int from hub.ops_events) as e`;
    expect(n).toEqual({ c: 0, e: 0 });
  });
});

describe("ops-watch · cấu hình + kiểm tra ngay (platform_admin)", () => {
  it("ngưỡng ngoài khoảng cho phép ⇒ lưu bị từ chối 422, cấu hình giữ nguyên", async () => {
    const token = await sign(k, USERS.padmin);
    const bad = {
      ...OPS_DEFAULT_SETTINGS,
      checks: { ...OPS_DEFAULT_SETTINGS.checks, disk: { enabled: true, warn: 120, crit: 90 } },
    };
    for (const body of [bad, { ...OPS_DEFAULT_SETTINGS, every_min: 2 }, { every_min: 30 }]) {
      const res = await call(hub, "PUT", "/ops/settings", { token, body });
      expect(res.status).toBe(422);
      expect(res.json.error.code).toBe("OPS_SETTINGS_INVALID");
    }
    const get = await call(hub, "GET", "/ops/settings", { token });
    expect(get.json.settings).toEqual(OPS_DEFAULT_SETTINGS);
    const [e] = await sql<{ n: number }[]>`select count(*)::int as n from hub.ops_events`;
    expect(e?.n).toBe(0);
  });

  it("lưu cấu hình hợp lệ ⇒ trả cấu hình mới + một sự kiện settings_changed (ai, cũ → mới)", async () => {
    const token = await sign(k, USERS.padmin);
    const next = {
      ...OPS_DEFAULT_SETTINGS,
      every_min: 10,
      checks: { ...OPS_DEFAULT_SETTINGS.checks, disk: { enabled: false, warn: 70, crit: 85 } },
    };
    const res = await call(hub, "PUT", "/ops/settings", { token, body: next });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ settings: next, updated_by: USERS.padmin.id });
    const ev = await sql`select kind, actor_user_id, check_key, detail from hub.ops_events`;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      kind: "settings_changed",
      actor_user_id: USERS.padmin.id,
      check_key: null,
      detail: { old: OPS_DEFAULT_SETTINGS, new: next },
    });
    const st = await call(hub, "GET", "/ops/status", { token });
    expect(st.status).toBe(200);
    expect(st.json.settings).toEqual(next);
    expect(st.json.events[0]).toMatchObject({ kind: "settings_changed" });
  });

  it("Kiểm tra ngay ⇒ chạy lượt (DB/Redis ok, có checked_at); bấm lại trong 1 phút ⇒ 429", async () => {
    const token = await sign(k, USERS.padmin);
    const res = await call(hub, "POST", "/ops/check", { token });
    expect(res.status).toBe(200);
    const db = res.json.checks.find((c: { check_key: string }) => c.check_key === "db_redis");
    expect(db).toMatchObject({ status: "ok" });
    expect(Date.parse(db.checked_at)).toBeGreaterThan(Date.now() - 60_000);
    expect(res.json.last_round_at).toBe(db.checked_at);
    const again = await call(hub, "POST", "/ops/check", { token });
    expect(again.status).toBe(429);
    expect(again.json.error.code).toBe("OPS_CHECK_RATE_LIMITED");
    expect(again.headers.get("retry-after")).toBe("60");
  });
});

// tenant-default-app · platform_admin đặt app mặc định cho công ty bất kỳ; tenant_admin 403; app lạ bị từ chối; có audit.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { TENANT_ID } from "../../../../../tests/acceptance/M1/_data";
import { ADMIN_API_URL, createEnv, type Env } from "../../../../../tests/acceptance/M1/_fixtures";
import { seedAppUrls } from "./app-catalog.seed";

let env: Env;
let db: Db;
beforeAll(async () => {
  env = await createEnv();
  db = createDb(ADMIN_API_URL, { max: 2 });
});
afterAll(async () => {
  await db.close();
  await env.close();
});
beforeEach(async () => {
  await env.reset();
  await seedAppUrls(db, {
    APP_URL_CHAT: "https://chat.example.com",
    APP_URL_CONTRACTS: "https://so.example.com",
    APP_URL_STUDIO: "https://studio.example.com/studio",
    APP_URL_ADMIN: "https://admin.example.com",
  });
});

const path = (tenantId: string) => `/admin/tenants/${tenantId}/default-app`;

describe("tenant-default-app · platform_admin", () => {
  it("platform_admin đặt/xoá được; tenant_admin 403; app lạ bị từ chối; có audit", async () => {
    const plat = await env.token("platform", "admin");
    const before = await env.get(path(TENANT_ID.globex), { token: plat });
    expect(before.json).toEqual({ app: null });

    // đặt cho công ty khác với người gọi (app không cần "mở được" với platform)
    const set = await env.call("PUT", path(TENANT_ID.globex), {
      token: plat,
      body: { app: "contracts" },
    });
    expect(set.status).toBe(200);
    expect(set.json).toEqual({ app: "contracts" });
    expect((await env.get(path(TENANT_ID.globex), { token: plat })).json).toEqual({
      app: "contracts",
    });
    // công ty khác không bị ảnh hưởng; người dùng globex thấy mặc định công ty trong /me/portal
    expect((await env.get(path(TENANT_ID.acme), { token: plat })).json).toEqual({ app: null });

    // tenant_admin (kể cả công ty đó) không dùng được endpoint này
    const binh = await env.token("acme", "binh");
    expect(
      (await env.call("PUT", path(TENANT_ID.globex), { token: binh, body: { app: "chat" } }))
        .status,
    ).toBe(403);
    expect((await env.get(path(TENANT_ID.acme), { token: binh })).status).toBe(403);

    // app không tồn tại trong catalog ⇒ INVALID_REFERENCE; tenant lạ ⇒ 404
    const bad = await env.call("PUT", path(TENANT_ID.globex), {
      token: plat,
      body: { app: "nope" },
    });
    expect(bad.status).toBe(400);
    expect((bad.json as { error: { code: string } }).error.code).toBe("INVALID_REFERENCE");
    const ghost = "00000000-0000-4000-8000-0000000000ff";
    expect((await env.call("PUT", path(ghost), { token: plat, body: { app: null } })).status).toBe(
      404,
    );

    // "Không đặt" = null
    const clear = await env.call("PUT", path(TENANT_ID.globex), {
      token: plat,
      body: { app: null },
    });
    expect(clear.json).toEqual({ app: null });

    const audits = await env.owner<{ summary: { from: string | null; to: string | null } }[]>`
      select summary from admin.audit_log
      where summary->>'op' = 'default_app.set' and tenant_id = ${TENANT_ID.globex} order by seq`;
    expect(audits.map((a) => [a.summary.from, a.summary.to])).toEqual([
      [null, "contracts"],
      ["contracts", null],
    ]);
  });
});

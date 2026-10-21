// app-catalog · `GET /me/apps` lọc theo vai + gói (entitlement/grant), cô lập tenant; CRUD `/admin/apps` chỉ platform_admin.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { MyAppsResponseSchema } from "@ai/contracts";
import { createDb, type Db } from "@ai/db";
import { TENANT_ID, USER_ID } from "../../../../../tests/acceptance/M1/_data";
import {
  ADMIN_API_URL,
  createEnv,
  type Env,
  expectErr,
} from "../../../../../tests/acceptance/M1/_fixtures";

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

const URLS = {
  chat: "https://chat.example.com",
  contracts: "https://so.example.com",
  studio: "https://studio.example.com/studio",
  admin: "https://admin.example.com",
};

beforeEach(async () => {
  await env.reset();
  // `reset` xoá cả catalog (FK tới users): dựng lại bằng chính seed khởi động (mặc định + URL từ env).
  await seedAppUrls(db, {
    APP_URL_CHAT: URLS.chat,
    APP_URL_CONTRACTS: URLS.contracts,
    APP_URL_STUDIO: URLS.studio,
    APP_URL_ADMIN: URLS.admin,
  });
  // Chỉ acme có gói Sổ Hợp Tác và chỉ `an` (acme) được cấp quyền đọc; globex không có gì.
  await env.owner`insert into admin.features (key, name) values ('contracts-read', '{"vi":"Sổ Hợp Tác · đọc"}')
    on conflict (key) do nothing`;
  await env.owner`insert into admin.feature_entitlements (feature_id, tenant_id)
    select id, ${TENANT_ID.acme} from admin.features where key = 'contracts-read'`;
  await env.owner`insert into admin.feature_grants (tenant_id, feature_id, user_id)
    select ${TENANT_ID.acme}, id, ${USER_ID.an} from admin.features where key = 'contracts-read'`;
});

async function appsOf(tenant: string, user: string): Promise<string[]> {
  const res = await env.get("/me/apps", { token: await env.token(tenant, user) });
  expect(res.status).toBe(200);
  return MyAppsResponseSchema.parse(res.json).items.map((a) => a.key);
}

describe("app-catalog · GET /me/apps", () => {
  it("được cấp gói ⇒ thấy Sổ Hợp Tác; thành viên tenant khác (không gói) không thấy", async () => {
    expect(await appsOf("acme", "an")).toEqual(["chat", "contracts"]);
    // cùng username `an` nhưng ở globex: không entitlement ⇒ không thấy Sổ Hợp Tác (cô lập tenant)
    expect(await appsOf("globex", "an")).toEqual(["chat"]);
  });

  it("vai: tenant_admin thêm Quản trị (không Studio); platform_admin thấy hết; URL lấy từ catalog", async () => {
    expect(await appsOf("globex", "hoa")).toEqual(["chat", "admin"]);
    const res = await env.get("/me/apps", { token: await env.token("platform", "admin") });
    const items = MyAppsResponseSchema.parse(res.json).items;
    expect(items.map((a) => a.key)).toEqual(["chat", "contracts", "studio", "admin"]);
    expect(items.find((a) => a.key === "studio")?.url).toBe(URLS.studio);
  });

  it("chưa đăng nhập ⇒ 401", async () => {
    expectErr(await env.get("/me/apps"), "UNAUTHORIZED");
  });
});

describe("app-catalog · /admin/apps", () => {
  it("platform_admin tạo/sửa/xoá; app tắt biến khỏi /me/apps; member ⇒ 403", async () => {
    const admin = await env.token("platform", "admin");
    const created = await env.post("/admin/apps", {
      token: admin,
      body: { key: "wiki", name: { vi: "Wiki" }, url: "https://wiki.example.com/" },
    });
    expect(created.status).toBe(201);
    expect(created.json.url).toBe("https://wiki.example.com"); // bỏ `/` cuối
    expectErr(
      await env.post("/admin/apps", { token: admin, body: { key: "wiki", name: { vi: "W" } } }),
      "KEY_TAKEN",
    );
    expect(await appsOf("globex", "an")).toEqual(["chat", "wiki"]);
    const off = await env.patch("/admin/apps/wiki", { token: admin, body: { enabled: false } });
    expect(off.status).toBe(200);
    expect(await appsOf("globex", "an")).toEqual(["chat"]);
    expect((await env.call("DELETE", "/admin/apps/wiki", { token: admin })).status).toBe(204);
    expectErr(
      await env.patch("/admin/apps/wiki", { token: admin, body: { sso: true } }),
      "NOT_FOUND",
    );

    const member = await env.token("acme", "an");
    expectErr(await env.get("/admin/apps", { token: member }), "FORBIDDEN");
    const bad = await env.post("/admin/apps", {
      token: admin,
      body: { key: "x1", name: { vi: "X" }, url: "javascript:alert(1)" },
    });
    expectErr(bad, "VALIDATION_ERROR");
  });
});

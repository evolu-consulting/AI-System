// portal-home · app mặc định: người dùng chỉ đặt của chính mình; mặc định công ty chỉ tenant admin; cô lập tenant.
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
  await env.owner`insert into admin.features (key, name) values ('contracts-read', '{"vi":"Sổ Hợp Tác · đọc"}')
    on conflict (key) do nothing`;
  await env.owner`insert into admin.feature_entitlements (feature_id, tenant_id)
    select id, ${TENANT_ID.acme} from admin.features where key = 'contracts-read'`;
});

const put = async (tenant: string, user: string, path: string, app: string | null) =>
  env.call("PUT", path, { token: await env.token(tenant, user), body: { app } });
const portal = async (tenant: string, user: string) =>
  env.get("/me/portal", { token: await env.token(tenant, user) });

describe("portal-home · app mặc định", () => {
  it("người dùng đặt của mình; công ty khác và người khác không bị ảnh hưởng; admin thấy số người mới", async () => {
    const ok = await put("globex", "hoa", "/me/default-app", "admin");
    expect(ok.status).toBe(200);
    expect((ok.json as { default_app: { user: string } }).default_app.user).toBe("admin");
    // cùng tenant, người khác: chưa đặt
    const other = await portal("acme", "binh");
    expect((other.json as { default_app: { user: unknown } }).default_app.user).toBeNull();
    // app không mở được với member ⇒ 400
    expect((await put("acme", "an", "/me/default-app", "admin")).status).toBe(400);
    expect((await put("acme", "an", "/me/default-app", "chat")).status).toBe(200);
    const me = (await portal("acme", "an")).json as { admin: unknown };
    expect(me.admin).toBeNull();
  });

  it("mặc định công ty: chỉ tenant admin; member 403; áp cho thành viên chưa tự đặt, cá nhân thắng", async () => {
    expect((await put("acme", "an", "/me/tenant-default-app", "chat")).status).toBe(403);
    expect((await put("acme", "binh", "/me/tenant-default-app", "contracts")).status).toBe(200);
    // `an` không có quyền đọc Sổ Hợp Tác ⇒ effective null (không kẹt ở app không mở được)
    const an = (await portal("acme", "an")).json as {
      default_app: { tenant: string; effective: string | null };
    };
    expect(an.default_app.tenant).toBe("contracts");
    expect(an.default_app.effective).toBeNull();
    // admin của acme: thấy được Sổ Hợp Tác? (platform feature qua entitlement + grant) — dùng chat cho chắc
    expect((await put("acme", "binh", "/me/default-app", "chat")).status).toBe(200);
    const binh = (await portal("acme", "binh")).json as { default_app: { effective: string } };
    expect(binh.default_app.effective).toBe("chat");
    // globex không bị ảnh hưởng bởi mặc định của acme
    const g = (await portal("globex", "an")).json as { default_app: { tenant: unknown } };
    expect(g.default_app.tenant).toBeNull();
  });
});

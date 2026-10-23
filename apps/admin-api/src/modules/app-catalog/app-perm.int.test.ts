// app-perm · Chat AI gắn feature `chat-app` theo công ty: migration 0024 giữ nguyên Chat AI cho mọi tenant đang có; thu hồi
// entitlement của MỘT công ty ⇒ switcher chỉ còn Sổ Hợp Tác + trang chủ chuyển sang đó; công ty khác không bị ảnh hưởng.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createDb, type Db } from "@ai/db";
import { TENANT_ID, USER_ID } from "../../../../../tests/acceptance/M1/_data";
import { ADMIN_API_URL, createEnv, type Env } from "../../../../../tests/acceptance/M1/_fixtures";
import { seedAppUrls } from "./app-catalog.seed";

const MIGRATION = readFileSync(
  `${import.meta.dir}/../../../../../packages/db/migrations/0024_chat_app_feature.sql`,
  "utf8",
);

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
    APP_URL_ADMIN: "https://admin.example.com",
  });
  // Sổ Hợp Tác cho `an` ở cả hai công ty (entitlement + grant user).
  await env.owner`insert into admin.features (key, name) values ('contracts-read', '{"vi":"Sổ Hợp Tác · đọc"}')
    on conflict (key) do nothing`;
  await env.owner`insert into admin.feature_entitlements (feature_id, tenant_id)
    select f.id, t.id from admin.features f, admin.tenants t where f.key = 'contracts-read'`;
  await env.owner`insert into admin.feature_grants (tenant_id, feature_id, user_id)
    select u.tenant_id, f.id, u.id from admin.features f, admin.users u
    where f.key = 'contracts-read' and u.id in (${USER_ID.an}, ${USER_ID.globexAn})`;
  // Chạy lại đúng file migration trên DB đã có tenant (như prod): tạo feature + cấp cho mọi tenant đang có.
  for (const stmt of MIGRATION.split("--> statement-breakpoint")) await env.owner.unsafe(stmt);
});

const apps = async (tenant: string, user: string) =>
  (
    (await env.get("/me/apps", { token: await env.token(tenant, user) })).json as {
      items: { key: string }[];
    }
  ).items.map((a) => a.key);
const portal = async (tenant: string, user: string) =>
  (await env.get("/me/portal", { token: await env.token(tenant, user) })).json as {
    chat: boolean;
    default_app: { effective: string | null };
  };
const revoke = (tenantId: string) =>
  env.owner`update admin.feature_entitlements set revoked_at = now()
    where tenant_id = ${tenantId} and feature_id = (select id from admin.features where key = 'chat-app')`;

describe("app-perm · Chat AI theo công ty", () => {
  it("sau migration: mọi tenant đang có vẫn thấy Chat AI (chat gắn `chat-app`, member không cần grant)", async () => {
    const [cat] = await env.owner<{ f: string }[]>`
      select required_feature as f from admin.app_catalog where key = 'chat'`;
    expect(cat?.f).toBe("chat-app");
    expect(await apps("acme", "an")).toEqual(["chat", "contracts"]);
    expect(await apps("globex", "an")).toEqual(["chat", "contracts"]);
    const p = await portal("acme", "an");
    expect(p.chat).toBe(true);
    expect(p.default_app.effective).toBeNull();
  });

  it("thu hồi Chat AI của acme ⇒ acme chỉ còn Sổ Hợp Tác + hạ cánh Sổ Hợp Tác; globex không đổi", async () => {
    await revoke(TENANT_ID.acme);
    expect(await apps("acme", "an")).toEqual(["contracts"]);
    expect(await apps("acme", "binh")).toEqual(["admin"]); // tenant_admin chưa có Sổ Hợp Tác: Quản trị giữ nguyên
    const p = await portal("acme", "an");
    expect(p.chat).toBe(false);
    expect(p.default_app.effective).toBe("contracts");
    expect(await apps("globex", "an")).toEqual(["chat", "contracts"]);
    expect((await portal("globex", "an")).chat).toBe(true);
  });

  it("tenant mới tự có Chat AI (trigger), như hôm nay", async () => {
    const id = "01900000-0000-7000-8000-000000000777";
    await env.owner`insert into admin.tenants (id, key, name) values (${id}, 'newco', 'New Co')`;
    const [e] = await env.owner<{ n: number }[]>`
      select count(*)::int as n from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
      where f.key = 'chat-app' and e.tenant_id = ${id} and e.revoked_at is null`;
    expect(e?.n).toBe(1);
  });
});

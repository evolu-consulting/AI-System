// HUB-FR-66 · HUB-FR-67 · migration 0030_h4b2_models (spec H4b2 §4 #1–#5, plan D1/D6/D9): cột `version` (DEFAULT 1,
// CHECK ≥ 1), GRANT theo cột cho hub_rw (key/kind/vendor/dev_only provider, key profile bất biến ⇒ 42501), INSERT/DELETE,
// provider_state chỉ UPDATE last_probe_at/last_ok_at, audit CHECK + provider/model_profile, Drizzle `version` chạy với
// `hub_api`, chạy lại idempotent. DB Hub riêng (HUB_TEST_DATABASE_URL).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { createDb } from "./client";
import { type HubScope, withHubScope } from "./hub-scope";
import { runMigrations } from "./migrate";
import { runHubMigrations } from "./migrate-hub";
import { HUB_AUDIT_ENTITY_VALUES, modelProfiles, providers } from "./schema/hub";
import { MODELS_AUDIT_ENTITIES } from "./schema/hub-models";
import { resetTestDb, withDatabase } from "./test-db";

const BASE = process.env.HUB_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!BASE)
  throw new Error("HUB_TEST_DATABASE_URL/TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const OWNER = process.env.HUB_TEST_DATABASE_URL ?? withDatabase(BASE, "ai_system_h1_test");
const asRole = (user: string, pw: string) => {
  const u = new URL(OWNER);
  u.username = user;
  u.password = pw;
  return u.toString();
};
const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(asRole("hub_api", "hub_api_dev_pw"), { max: 1 });
const SYS: HubScope = { kind: "system" };
const PROV = "h4b2-sub";
const PROF = "h4b2-prof";

/** SQLSTATE (kể cả lỗi bọc trong `cause` của Drizzle); thành công = "ok". */
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (err: { code?: string; cause?: { code?: string } }) =>
      err.code ?? err.cause?.code ?? String(err),
  );
/** Câu SQL thô bằng hub_api trong scope system. */
const asApi = (q: string) => code(withHubScope(db, SYS, (tx) => tx.execute(q)));

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into hub.providers (key, kind, vendor) values (${PROV}, 'subscription', 'fake')
    on conflict (key) do nothing`;
  await owner`insert into hub.model_profiles (key, steps)
    values (${PROF}, ${owner.json([{ provider_key: PROV, model: null, on: [] }])}) on conflict (key) do nothing`;
  await owner`insert into hub.provider_state (provider_key, status, last_probe_at, last_ok_at)
    values (${PROV}, 'ok', now(), now()) on conflict (provider_key) do nothing`;
}, 60_000);
afterAll(async () => {
  await db.close();
  await owner.end();
});

describe("HUB-FR-66 · 0030 cột version", () => {
  test("hàng mới = 1 (Drizzle đọc bằng hub_api); CHECK ≥ 1 ⇒ 23514", async () => {
    const [p] = await withHubScope(db, SYS, (tx) =>
      tx.select({ v: providers.version }).from(providers).where(eq(providers.key, PROV)),
    );
    const [m] = await withHubScope(db, SYS, (tx) =>
      tx
        .select({ v: modelProfiles.version })
        .from(modelProfiles)
        .where(eq(modelProfiles.key, PROF)),
    );
    expect([p?.v, m?.v]).toEqual([1, 1]);
    expect([
      await code(owner`update hub.providers set version = 0 where key = ${PROV}`),
      await code(owner`update hub.model_profiles set version = 0 where key = ${PROF}`),
    ]).toEqual(["23514", "23514"]);
  });
});

describe("HUB-FR-66 · 0030 GRANT theo cột (Q8)", () => {
  test("providers: cột bất biến ⇒ 42501; cột sửa được ⇒ ok", async () => {
    const bad = [];
    for (const set of ["key = 'h4b2-x'", "kind = 'api'", "vendor = 'openai'", "dev_only = true"])
      bad.push(await asApi(`update hub.providers set ${set} where key = '${PROV}'`));
    expect(bad).toEqual(["42501", "42501", "42501", "42501"]);
    expect(
      await asApi(`update hub.providers set base_url = null, secret_id = null, max_concurrency = 2,
        enabled = true, version = version + 1, updated_at = now() where key = '${PROV}'`),
    ).toBe("ok");
  });
  test("model_profiles: key ⇒ 42501; steps/version/updated_at ⇒ ok; INSERT + DELETE cả hai bảng ⇒ ok", async () => {
    expect(await asApi(`update hub.model_profiles set key = 'h4b2-y' where key = '${PROF}'`)).toBe(
      "42501",
    );
    expect(
      await asApi(`update hub.model_profiles set steps = steps, version = version + 1,
        updated_at = now() where key = '${PROF}'`),
    ).toBe("ok");
    const steps = JSON.stringify([{ provider_key: "h4b2-tmp", model: null, on: [] }]);
    expect([
      await asApi(
        `insert into hub.providers (key, kind, vendor) values ('h4b2-tmp', 'subscription', 'openai')`,
      ),
      await asApi(`insert into hub.model_profiles (key, steps) values ('h4b2-tmp', '${steps}')`),
      await asApi(`delete from hub.model_profiles where key = 'h4b2-tmp'`),
      await asApi(`delete from hub.providers where key = 'h4b2-tmp'`),
    ]).toEqual(["ok", "ok", "ok", "ok"]);
  });
  test("provider_state: last_probe_at/last_ok_at ⇒ ok; status/updated_at ⇒ 42501 (Runtime sở hữu)", async () => {
    const set = (s: string) =>
      asApi(`update hub.provider_state set ${s} where provider_key = '${PROV}'`);
    expect([
      await set("last_probe_at = null, last_ok_at = null"),
      await set("status = 'error'"),
      await set("updated_at = now()"),
    ]).toEqual(["ok", "42501", "42501"]);
  });
});

describe("HUB-FR-66 · 0030 audit CHECK + idempotent", () => {
  test("entity provider/model_profile nhận; giá trị cũ giữ; hằng Drizzle khớp", async () => {
    expect(HUB_AUDIT_ENTITY_VALUES).toEqual(expect.arrayContaining([...MODELS_AUDIT_ENTITIES]));
    const ins = (entity: string) =>
      code(
        owner`insert into hub.audit_log (action, entity, entity_name) values ('create', ${entity}, 'h4b2')`,
      );
    expect([
      await ins("provider"),
      await ins("model_profile"),
      await ins("secret"),
      await ins("kh_worklog"),
      await ins("providerx"),
    ]).toEqual(["ok", "ok", "ok", "ok", "23514"]);
  });
  test("chạy lại toàn bộ câu hai lần ⇒ không lỗi, ràng buộc/quyền/version không đổi", async () => {
    const stmts = readFileSync(
      new URL("../migrations-hub/0030_h4b2_models.sql", import.meta.url),
      "utf8",
    )
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const snap = async () =>
      (
        await owner<{ n: string }[]>`select conrelid::regclass || ':' || conname || ':' ||
            pg_get_constraintdef(oid) as n from pg_constraint
          where conrelid in ('hub.providers'::regclass, 'hub.model_profiles'::regclass, 'hub.audit_log'::regclass)
          union all select 'acl:' || relname || ':' || coalesce(array_to_string(relacl, ','), '') from pg_class
            where relnamespace = 'hub'::regnamespace and relname in ('providers', 'model_profiles', 'provider_state')
          union all select 'col:' || attrelid::regclass || '.' || attname || ':' || coalesce(array_to_string(attacl, ','), '')
            from pg_attribute where attrelid in ('hub.providers'::regclass, 'hub.model_profiles'::regclass,
              'hub.provider_state'::regclass) and attnum > 0 and not attisdropped
          union all select 'v:' || key || ':' || version from hub.providers
          order by 1`
      ).map((r) => r.n);
    const before = await snap();
    for (let i = 0; i < 2; i++) for (const s of stmts) await owner.unsafe(s);
    expect(await snap()).toEqual(before);
  });
});

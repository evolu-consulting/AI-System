// HUB-FR-68 · HUB-FR-69 · HUB-BR-15 · HUB-BR-30 · migration 0028_h4b1_secrets (spec H4b-1 §4, plan D6–D7): GRANT theo cột
// (Drizzle `SECRET_META_COLS` chạy, `select()` toàn bảng ⇒ 42501), RLS system/user, `hub.secret_material` (kind/tenant/scope,
// không scope ⇒ 0), CHECK + unique hoa-thường, FK providers RESTRICT đã VALIDATE, audit CHECK, chạy lại idempotent.
// DB Hub riêng (HUB_TEST_DATABASE_URL). Dữ liệu giả, bản mã giả (byte ngẫu nhiên — không cần khoá).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { createDb } from "./client";
import { type HubScope, withHubScope } from "./hub-scope";
import { runMigrations } from "./migrate";
import { runHubMigrations } from "./migrate-hub";
import { HUB_AUDIT_ACTION_VALUES, HUB_AUDIT_ENTITY_VALUES } from "./schema/hub";
import { hubSecrets, SECRET_META_COLS } from "./schema/hub-secrets";
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

const T1 = "01900000-0000-7000-8000-0000004b1a01";
const T2 = "01900000-0000-7000-8000-0000004b1a02";
const U1 = "01900000-0000-7000-8000-0000004b1b01";
const S = { prov: "", khPlat: "", src1: "", src2: "" };
const SYS: HubScope = { kind: "system" };
const user = (tenantId: string): HubScope => ({ kind: "user", tenantId, userId: U1 });
const rnd = (n: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(n)));

/** SQLSTATE (kể cả lỗi bọc trong `cause` của Drizzle); thành công = "ok". */
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (err: { code?: string; cause?: { code?: string } }) =>
      err.code ?? err.cause?.code ?? String(err),
  );

async function seed(kind: string, tenant: string | null, name: string): Promise<string> {
  const [r] = await owner<
    { id: string }[]
  >`insert into hub.secrets (kind, tenant_id, name, ciphertext, iv)
    values (${kind}, ${tenant}, ${name}, ${rnd(40)}, ${rnd(12)}) returning id`;
  return r?.id ?? "";
}

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await runHubMigrations({ url: OWNER, appEnv: "test" });
  S.prov = await seed("provider_api_key", null, "anthropic-main");
  S.khPlat = await seed("kh_api_key", null, "kh-platform");
  S.src1 = await seed("source_credential", T1, "git-t1");
  S.src2 = await seed("source_credential", T2, "git-t2");
}, 60_000);
afterAll(async () => {
  await db.close();
  await owner.end();
});

const ids = (scope: HubScope) =>
  withHubScope(db, scope, (tx) =>
    tx.select({ id: hubSecrets.id }).from(hubSecrets).orderBy(hubSecrets.id),
  ).then((r) => r.map((x) => x.id).sort());

describe("HUB-BR-30 · GRANT theo cột + Drizzle (plan D6–D7)", () => {
  test("SECRET_META_COLS chạy; select() toàn bảng / ciphertext ⇒ 42501", async () => {
    const rows = await withHubScope(db, SYS, (tx) =>
      tx.select(SECRET_META_COLS).from(hubSecrets).where(eq(hubSecrets.id, S.prov)),
    );
    expect(rows[0]).toMatchObject({ kind: "provider_api_key", tenantId: null, keyVersion: 1 });
    expect(await code(withHubScope(db, SYS, (tx) => tx.select().from(hubSecrets)))).toBe("42501");
    expect(
      await code(
        withHubScope(db, SYS, (tx) => tx.select({ c: hubSecrets.ciphertext }).from(hubSecrets)),
      ),
    ).toBe("42501");
  });
  test("INSERT/UPDATE/DELETE qua Drizzle (scope user) với returning metadata", async () => {
    const id = crypto.randomUUID();
    const [ins] = await withHubScope(db, user(T1), (tx) =>
      tx
        .insert(hubSecrets)
        .values({
          id,
          kind: "kh_api_key",
          tenantId: T1,
          name: "kh-t1",
          ciphertext: rnd(30),
          iv: rnd(12),
        })
        .returning(SECRET_META_COLS),
    );
    expect(ins).toMatchObject({ id, version: 1, tenantId: T1 });
    const [up] = await withHubScope(db, user(T1), (tx) =>
      tx
        .update(hubSecrets)
        .set({ ciphertext: rnd(30), iv: rnd(12), version: 2 })
        .where(eq(hubSecrets.id, id))
        .returning({ version: hubSecrets.version }),
    );
    expect(up?.version).toBe(2);
    const del = await withHubScope(db, user(T1), (tx) =>
      tx.delete(hubSecrets).where(eq(hubSecrets.id, id)).returning({ id: hubSecrets.id }),
    );
    expect(del).toEqual([{ id }]);
  });
});

describe("HUB-BR-15 · RLS", () => {
  test("system thấy hết; user T1 chỉ hàng T1 (không nền tảng); user T2 chỉ T2", async () => {
    expect(await ids(SYS)).toEqual([S.prov, S.khPlat, S.src1, S.src2].sort());
    expect(await ids(user(T1))).toEqual([S.src1]);
    expect(await ids(user(T2))).toEqual([S.src2]);
  });
  test("user T1 ghi hàng nền tảng / tenant khác ⇒ 42501 (WITH CHECK)", async () => {
    const ins = (tenantId: string | null, kind: "kh_api_key" | "source_credential") =>
      code(
        withHubScope(db, user(T1), (tx) =>
          tx
            .insert(hubSecrets)
            .values({ kind, tenantId, name: `x-${kind}`, ciphertext: rnd(20), iv: rnd(12) }),
        ),
      );
    expect([await ins(null, "kh_api_key"), await ins(T2, "source_credential")]).toEqual([
      "42501",
      "42501",
    ]);
  });
});

describe("HUB-FR-68 · hub.secret_material", () => {
  const mat = (scope: HubScope | null, id: string, kind: string, tenant: string | null) =>
    (scope
      ? withHubScope(db, scope, (tx) =>
          tx.execute<{ iv: Buffer }>(
            `select iv from hub.secret_material('${id}', '${kind}', ${tenant ? `'${tenant}'` : "null"})`,
          ),
        )
      : db.db.execute<{ iv: Buffer }>(
          `select iv from hub.secret_material('${id}', '${kind}', ${tenant ? `'${tenant}'` : "null"})`,
        )
    ).then((r) => [...r].length);
  test("đúng bộ ⇒ 1; sai kind/tenant ⇒ 0; user tenant khác ⇒ 0; không scope ⇒ 0", async () => {
    expect([
      await mat(SYS, S.src1, "source_credential", T1),
      await mat(SYS, S.src1, "kh_api_key", T1),
      await mat(SYS, S.src1, "source_credential", null),
      await mat(user(T1), S.src1, "source_credential", T1),
      await mat(user(T1), S.src2, "source_credential", T2),
      await mat(user(T1), S.khPlat, "kh_api_key", null),
      await mat(null, S.prov, "provider_api_key", null),
    ]).toEqual([1, 0, 0, 1, 0, 1, 0]);
  });
});

describe("HUB-FR-68 · CHECK, unique, FK, audit", () => {
  test("CHECK scope theo kind + unique hoa-thường", async () => {
    expect([
      await code(seed("provider_api_key", T1, "p-t1")),
      await code(seed("source_credential", null, "s-null")),
      await code(seed("kh_api_key", T1, "kh-ok")),
      await code(seed("provider_api_key", null, "Anthropic-MAIN")),
      await code(seed("source_credential", T2, "GIT-T1")),
    ]).toEqual(["23514", "23514", "ok", "23505", "ok"]);
  });
  test("FK providers_secret_fk đã VALIDATE, RESTRICT", async () => {
    const [c] = await owner<{ v: boolean; d: string }[]>`select convalidated as v, confdeltype as d
      from pg_constraint where conname = 'providers_secret_fk'`;
    expect(c).toEqual({ v: true, d: "r" });
    await owner`insert into hub.providers (key, kind, vendor, secret_id) values ('h4b1-api', 'api', 'anthropic', ${S.prov})`;
    expect(await code(owner`delete from hub.secrets where id = ${S.prov}`)).toBe("23503");
  });
  test("audit CHECK nhận rotate/secret; hằng Drizzle khớp", async () => {
    expect(HUB_AUDIT_ACTION_VALUES).toContain("rotate");
    expect(HUB_AUDIT_ENTITY_VALUES).toContain("secret");
    const ins = (action: string, entity: string) =>
      code(owner`insert into hub.audit_log (actor_id, actor_role, action, entity, entity_id, entity_name)
        values (${U1}, 'platform_admin', ${action}, ${entity}, ${S.khPlat}, 'kh_api_key:kh-platform')`);
    expect([
      await ins("rotate", "secret"),
      await ins("delete", "secret"),
      await ins("x", "secret"),
    ]).toEqual(["ok", "ok", "23514"]);
  });
});

describe("HUB-FR-68 · 0028 idempotent", () => {
  test("chạy lại toàn bộ câu hai lần ⇒ không lỗi, ràng buộc/index/policy/quyền không đổi", async () => {
    const stmts = readFileSync(
      new URL("../migrations-hub/0028_h4b1_secrets.sql", import.meta.url),
      "utf8",
    )
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const snap = async () =>
      (
        await owner<
          { n: string }[]
        >`select conname || ':' || pg_get_constraintdef(oid) as n from pg_constraint
          where conrelid in ('hub.secrets'::regclass, 'hub.providers'::regclass)
          union all select indexname || ':' || indexdef from pg_indexes where tablename = 'secrets'
          union all select policyname || ':' || coalesce(qual, '') from pg_policies where tablename = 'secrets'
          union all select 'acl:' || coalesce(array_to_string(relacl, ','), '') from pg_class where oid = 'hub.secrets'::regclass
          union all select 'fn:' || p.prosecdef || ':' || coalesce(array_to_string(p.proacl, ','), '')
            from pg_proc p where p.pronamespace = 'hub'::regnamespace and p.proname = 'secret_material'
          order by 1`
      ).map((r) => r.n);
    const before = await snap();
    for (let i = 0; i < 2; i++) for (const s of stmts) await owner.unsafe(s);
    expect(await snap()).toEqual(before);
  });
});

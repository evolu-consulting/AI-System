// HUB-FR-68 · HUB-BR-15 · HUB-BR-30 · AC-H4b1-02 (DB), AC-H4b1-05 (RLS) · spec §4 · plan D6 · test-plan H4b1 §3 D01–D14:
// GRANT theo cột (hub_rw không SELECT ciphertext/iv ⇒ 42501), không quyền cho agent_runtime/hub_ro/admin_rw, RLS
// (system thấy hết; user chỉ hàng tenant mình, không thấy nền tảng; WITH CHECK), `hub.secret_material` SECURITY DEFINER
// chặn kind/tenant/scope, CHECK + unique lower(name) + FK providers RESTRICT, audit CHECK `rotate`/`secret`, migration
// chạy lại. Đỏ trước code: bảng/hàm chưa có ⇒ SQLSTATE 42P01/42883 ≠ kỳ vọng (không ném ở beforeAll).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { runHubMigrations } from "@ai/db/migrate-hub";
import postgres from "postgres";
import { AGENT_RT_URL, HUB_API_URL, OWNER_URL, withCreds } from "../H1/_fixtures";
import { setupH3b } from "../H3b/_h3b";
import {
  idGen,
  insertProvider,
  type Sql,
  seedSecret,
  specSeal,
  T,
  tableExists,
  USERS,
  val,
} from "./_h4b1";

let owner: Sql;
let api: Sql;
let rt: Sql;
let adm: Sql;
const id = idGen(3000);
const S = { prov: id(), khPlat: id(), khAcme: id(), srcAcme: id(), srcBeta: id() };
const ALL = Object.values(S);
beforeAll(async () => {
  owner = await setupH3b();
  api = postgres(HUB_API_URL, { max: 2, onnotice: () => {} });
  rt = postgres(AGENT_RT_URL, { max: 1, onnotice: () => {} });
  adm = postgres(withCreds(OWNER_URL, "admin_api", "admin_api_dev_pw"), {
    max: 1,
    onnotice: () => {},
  });
  const seed = (i: string, kind: string, tenantId: string | null, name: string) =>
    seedSecret(owner, { id: i, kind, tenantId, name, value: val(name) });
  await seed(S.prov, "provider_api_key", null, "d-prov");
  await seed(S.khPlat, "kh_api_key", null, "d-kh");
  await seed(S.khAcme, "kh_api_key", T.acme, "d-kh-acme");
  await seed(S.srcAcme, "source_credential", T.acme, "d-src-acme");
  await seed(S.srcBeta, "source_credential", T.beta, "d-src-beta");
}, 60_000);
afterAll(async () => {
  await Promise.all([api?.end(), rt?.end(), adm?.end()]);
  await owner?.end();
});

/** "ok" hoặc SQLSTATE. */
async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    return String((err as { code?: string }).code ?? (err as Error).message);
  }
}
type Scope = { scope?: "system" | "user"; tenant?: string };
/** Chạy `fn` trong transaction `hub_api` với GUC `app.scope`/`app.tenant_id` (như `withHubScope`). */
async function asApi<T>(s: Scope, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return (await api.begin(async (tx) => {
    if (s.scope) await tx`select set_config('app.scope', ${s.scope}, true)`;
    if (s.tenant) await tx`select set_config('app.tenant_id', ${s.tenant}, true)`;
    return fn(tx);
  })) as T;
}
const META =
  "id, kind, tenant_id, name, key_version, version, created_by, updated_by, created_at, updated_at";
const visible = (s: Scope) =>
  asApi(s, async (tx) =>
    (await tx.unsafe(`select id from hub.secrets order by id`))
      .map((r) => String(r.id))
      .filter((i) => ALL.includes(i)),
  ).catch((e) => [`ERR ${(e as { code?: string }).code}`]);

describe("D01–D03 · GRANT theo cột [spec §4 GRANT · plan D6]", () => {
  it("HUB-FR-68 · D01 · hub_api (system): SELECT cột metadata ⇒ ok; SELECT ciphertext / iv / * ⇒ 42501", async () => {
    const got = await Promise.all([
      code(asApi({ scope: "system" }, (tx) => tx.unsafe(`select ${META} from hub.secrets`))),
      code(asApi({ scope: "system" }, (tx) => tx`select ciphertext from hub.secrets`)),
      code(asApi({ scope: "system" }, (tx) => tx`select iv from hub.secrets`)),
      code(asApi({ scope: "system" }, (tx) => tx`select * from hub.secrets`)),
    ]);
    expect(got).toEqual(["ok", "42501", "42501", "42501"]);
  });
  it("HUB-BR-30 · D02 · agent_runtime và admin_api: SELECT id ⇒ 42501; EXECUTE secret_material ⇒ 42501", async () => {
    const got = [
      await code(rt`select id from hub.secrets`),
      await code(adm`select id from hub.secrets`),
      await code(rt`select * from hub.secret_material(${S.prov}::uuid, 'provider_api_key', null)`),
      await code(adm`select * from hub.secret_material(${S.prov}::uuid, 'provider_api_key', null)`),
    ];
    expect(got).toEqual(["42501", "42501", "42501", "42501"]);
  });
  it("HUB-BR-30 · D03 · catalog quyền: hub_ro/agent_runtime/admin_rw/PUBLIC không có quyền bảng; hub_rw SELECT cột không gồm ciphertext/iv; EXECUTE chỉ hub_rw", async () => {
    if (!(await tableExists(owner))) return expect("hub.secrets").toBe("tồn tại");
    const [r] = await owner`select
      has_table_privilege('hub_ro', 'hub.secrets', 'SELECT') as ro,
      has_table_privilege('agent_runtime', 'hub.secrets', 'SELECT') as rt,
      has_table_privilege('admin_rw', 'hub.secrets', 'SELECT') as adm,
      has_column_privilege('hub_rw', 'hub.secrets', 'name', 'SELECT') as rw_name,
      has_column_privilege('hub_rw', 'hub.secrets', 'ciphertext', 'SELECT') as rw_ct,
      has_column_privilege('hub_rw', 'hub.secrets', 'iv', 'SELECT') as rw_iv,
      has_table_privilege('hub_rw', 'hub.secrets', 'INSERT, UPDATE, DELETE') as rw_w,
      has_function_privilege('hub_rw', 'hub.secret_material(uuid,text,uuid)', 'EXECUTE') as fn_rw,
      has_function_privilege('agent_runtime', 'hub.secret_material(uuid,text,uuid)', 'EXECUTE') as fn_rt,
      has_function_privilege('hub_ro', 'hub.secret_material(uuid,text,uuid)', 'EXECUTE') as fn_ro`;
    expect({ ...r }).toEqual({
      ro: false,
      rt: false,
      adm: false,
      rw_name: true,
      rw_ct: false,
      rw_iv: false,
      rw_w: true,
      fn_rw: true,
      fn_rt: false,
      fn_ro: false,
    });
  });
});

describe("D04–D07 · RLS ma trận scope × tenant [spec §4 RLS · AC-H4b1-05]", () => {
  it("HUB-BR-15 · D04 · scope system ⇒ thấy cả 5 hàng (nền tảng + acme + beta)", async () => {
    expect((await visible({ scope: "system" })).sort()).toEqual([...ALL].sort());
  });
  it("HUB-BR-15 · AC-H4b1-05 · D05 · scope user acme ⇒ chỉ kh acme + source acme (không nền tảng, không beta); user beta ⇒ chỉ source beta", async () => {
    expect((await visible({ scope: "user", tenant: T.acme })).sort()).toEqual(
      [S.khAcme, S.srcAcme].sort(),
    );
    expect(await visible({ scope: "user", tenant: T.beta })).toEqual([S.srcBeta]);
  });
  it("HUB-BR-15 · D06 · không đặt scope ⇒ 0 hàng", async () => {
    expect(await visible({})).toEqual([]);
  });
  it("HUB-BR-15 · AC-H4b1-05 · D07 · scope user acme: INSERT hàng beta / nền tảng ⇒ 42501; UPDATE/DELETE hàng beta ⇒ 0 hàng ảnh hưởng", async () => {
    const ins = (tenant: string | null, kind: string) => {
      const i = id();
      const s = specSeal(val("d07"), { id: i, kind, tenantId: tenant });
      return code(
        asApi(
          { scope: "user", tenant: T.acme },
          (tx) => tx`insert into hub.secrets (id, kind, tenant_id, name, ciphertext, iv)
          values (${i}, ${kind}, ${tenant}, ${`d07-${i.slice(-4)}`}, ${s.ciphertext}, ${s.iv})`,
        ),
      );
    };
    expect([await ins(T.beta, "source_credential"), await ins(null, "provider_api_key")]).toEqual([
      "42501",
      "42501",
    ]);
    const n = await asApi({ scope: "user", tenant: T.acme }, async (tx) => [
      (await tx`update hub.secrets set version = version + 1 where id = ${S.srcBeta}`).count,
      (await tx`delete from hub.secrets where id in (${S.srcBeta}, ${S.prov})`).count,
    ]).catch((e) => [`ERR ${(e as { code?: string }).code}`]);
    expect(n).toEqual([0, 0]);
  });
});

describe("D08–D10 · hub.secret_material [spec §4 · D6]", () => {
  const mat = (s: Scope, i: string, kind: string, tenant: string | null) =>
    asApi(s, async (tx) => {
      const rows =
        await tx`select ciphertext, iv, key_version from hub.secret_material(${i}::uuid, ${kind}, ${tenant}::uuid)`;
      return rows.map((r) => ({
        iv: Buffer.from(r.iv).length,
        kv: r.key_version,
        ct: Buffer.from(r.ciphertext).length > 16,
      }));
    }).catch((e) => `ERR ${(e as { code?: string }).code}`);
  const one = [{ iv: 12, kv: 1, ct: true }];
  it("HUB-FR-68 · D08 · scope system, bộ (id, kind, tenant) đúng ⇒ 1 hàng (iv 12 byte, key_version 1); kind sai / tenant sai / tenant null cho hàng acme ⇒ 0", async () => {
    const sys = { scope: "system" as const };
    expect([
      await mat(sys, S.srcAcme, "source_credential", T.acme),
      await mat(sys, S.prov, "provider_api_key", null),
      await mat(sys, S.srcAcme, "kh_api_key", T.acme),
      await mat(sys, S.srcAcme, "source_credential", T.beta),
      await mat(sys, S.srcAcme, "source_credential", null),
      await mat(sys, S.prov, "provider_api_key", T.acme),
    ]).toEqual([one, one, [], [], [], []]);
  });
  it("HUB-BR-15 · AC-H4b1-05 · D09 · scope user acme: hàng acme ⇒ 1; hàng beta (dù truyền đúng tenant beta) ⇒ 0; nền tảng (p_tenant null) ⇒ 1", async () => {
    const u = { scope: "user" as const, tenant: T.acme };
    expect([
      await mat(u, S.srcAcme, "source_credential", T.acme),
      await mat(u, S.srcBeta, "source_credential", T.beta),
      await mat(u, S.khPlat, "kh_api_key", null),
    ]).toEqual([one, [], one]);
  });
  it("HUB-FR-68 · D10 · hàm SECURITY DEFINER, search_path cố định, STABLE", async () => {
    const [r] = await owner`select p.prosecdef as definer, p.provolatile as vol,
        array_to_string(p.proconfig, ',') as cfg
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'hub' and p.proname = 'secret_material'`;
    expect({
      definer: r?.definer,
      vol: r?.vol,
      cfg: String(r?.cfg ?? "").replace(/\s/g, ""),
    }).toEqual({
      definer: true,
      vol: "s",
      cfg: "search_path=pg_catalog,hub",
    });
  });
});

describe("D11–D14 · CHECK, unique, FK, audit CHECK, migration [spec §4]", () => {
  const raw = (o: {
    kind?: string;
    tenant?: string | null;
    name?: string;
    ivLen?: number;
    ctLen?: number;
    version?: number;
  }) => {
    const i = id();
    return code(owner`insert into hub.secrets (id, kind, tenant_id, name, ciphertext, iv, version)
      values (${i}, ${o.kind ?? "kh_api_key"}, ${o.tenant === undefined ? null : o.tenant}, ${o.name ?? `ck-${i.slice(-5)}`},
        ${Buffer.alloc(o.ctLen ?? 32, 1)}, ${Buffer.alloc(o.ivLen ?? 12, 2)}, ${o.version ?? 1})`);
  };
  it("HUB-FR-68 · D11 · CHECK: provider + tenant / source vắng tenant / kind lạ / name 1 ký tự / iv 11 / bản mã 15 / version 0 ⇒ 23514; hợp lệ ⇒ ok", async () => {
    expect([
      await raw({ kind: "provider_api_key", tenant: T.acme }),
      await raw({ kind: "source_credential", tenant: null }),
      await raw({ kind: "app_key" }),
      await raw({ name: "a" }),
      await raw({ ivLen: 11 }),
      await raw({ ctLen: 15 }),
      await raw({ version: 0 }),
      await raw({}),
    ]).toEqual(["23514", "23514", "23514", "23514", "23514", "23514", "23514", "ok"]);
  });
  it("HUB-FR-68 · Q4 · D12 · unique (kind, tenant, lower(name)): trùng hoa-thường cùng tenant ⇒ 23505; hai bản nền tảng cùng tên ⇒ 23505; khác tenant ⇒ ok", async () => {
    expect([
      await raw({ kind: "source_credential", tenant: T.acme, name: "D-SRC-ACME" }),
      await raw({ kind: "provider_api_key", name: "D-Prov" }),
      await raw({ kind: "source_credential", tenant: T.beta, name: "d-src-acme" }),
    ]).toEqual(["23505", "23505", "ok"]);
  });
  it("HUB-FR-68 · Q5 · D13 · FK providers.secret_id RESTRICT: xoá secret đang được provider trỏ ⇒ 23503; provider trỏ id không tồn tại ⇒ 23503", async () => {
    await insertProvider(owner, id(), "d13-api", S.prov).catch(() => {});
    expect([
      await code(owner`delete from hub.secrets where id = ${S.prov}`),
      await code(insertProvider(owner, id(), "d13-ghost", "a4b10000-0000-4000-8000-000000000998")),
    ]).toEqual(["23503", "23503"]);
  });
  it("HUB-FR-69 · D14 · audit_log nhận action `rotate` + entity `secret`, vẫn nhận giá trị cũ (`authorize_real_action`, `agent_team`); migration Hub chạy lại không lỗi", async () => {
    const ins = (action: string, entity: string) =>
      code(owner`insert into hub.audit_log (tenant_id, actor_id, actor_role, action, entity, entity_id, entity_name)
        values (${null}, ${USERS.padmin.id}, 'platform_admin', ${action}, ${entity}, ${S.khPlat}, 'qc-d14')`);
    expect([
      await ins("rotate", "secret"),
      await ins("create", "secret"),
      await ins("authorize_real_action", "agent_team"),
      await ins("rotate_x", "secret"),
    ]).toEqual(["ok", "ok", "ok", "23514"]);
    expect(await code(runHubMigrations({ url: OWNER_URL, appEnv: "test" }))).toBe("ok");
  });
});

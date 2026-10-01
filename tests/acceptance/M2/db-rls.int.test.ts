// ADM-NFR-07, ADM-BR-14, ADM-BR-04, ADM-FR-50, ADM-FR-31 · RLS + quyền cột + REVOKE của danh mục M2
// (test-plan D2; M2-AC01 phần DB, M2-AC02). Truy vấn trực tiếp bằng role admin_api / hub_ro, không qua app.
// Chỉ cần DB đã migrate (xanh ở T2): không seed, không app, không giải mã bằng code sản phẩm.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { newMasterKeyB64, openIndependent, sealIndependent } from "./_crypto";
import { ALL_CATALOG, ID, LEAK_1, leakForms, seedCatalog } from "./_data";
import { ADMIN_API_URL, OWNER_URL, TENANT_ID } from "./_fixtures";

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;
class Rollback extends Error {}

let owner: Sql;
let api: Sql;
const KEY = newMasterKeyB64();

/** Chạy `fn` trong transaction đã đặt scope (hoặc role), luôn rollback. */
async function scoped<T>(
  sql: Sql,
  scope: string | null,
  tenantId: string | null,
  fn: (tx: Tx) => Promise<T>,
  role?: string,
): Promise<T> {
  let out: T | undefined;
  try {
    await sql.begin(async (tx) => {
      if (role) await tx.unsafe(`set local role ${role}`);
      if (scope !== null) {
        await tx`select set_config('app.scope', ${scope}, true), set_config('app.tenant_id', ${tenantId ?? ""}, true)`;
      }
      out = await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return out as T;
}
const platform = <T>(fn: (tx: Tx) => Promise<T>) => scoped(api, "platform", null, fn);
const asTenant = <T>(tid: string, fn: (tx: Tx) => Promise<T>) => scoped(api, "tenant", tid, fn);
const asHub = <T>(fn: (tx: Tx) => Promise<T>) => scoped(owner, null, null, fn, "hub_ro");

/** SQLSTATE của câu lệnh lỗi, null nếu thành công. */
async function sqlstate(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    if (e instanceof Rollback) return null;
    return (e as { code?: string }).code ?? "unknown";
  }
}

beforeAll(async () => {
  await resetTestDb(OWNER_URL);
  await runMigrations({ url: OWNER_URL, appEnv: "development" });
  owner = postgres(OWNER_URL, { max: 2, onnotice: () => {} });
  api = postgres(ADMIN_API_URL, { max: 1, onnotice: () => {} });
  await owner`insert into admin.tenants (id, key, name) values
    (${TENANT_ID.acme}, 'acme', 'Acme'), (${TENANT_ID.globex}, 'globex', 'Globex'),
    (${TENANT_ID.zeta}, 'zeta', 'Zeta')`;
  await owner`insert into admin.features (key, name, status) values ('core', '{"vi":"Cơ bản"}'::jsonb, 'on')`;
  await seedCatalog(owner, ALL_CATALOG);
});
afterAll(async () => {
  await api.end();
  await owner.end();
});

describe("ADM-BR-14 · RLS secrets (chỉ scope platform)", () => {
  it("ADM-NFR-07 · M2-R06 · không đặt scope: secrets và feature_entitlements đều 0 hàng", async () => {
    const [s] = await api`select count(*)::int as n from admin.secrets`;
    const [e] = await api`select count(*)::int as n from admin.feature_entitlements`;
    expect(s?.n).toBe(0);
    expect(e?.n).toBe(0);
  });

  it("ADM-BR-14 · M2-AC01 · scope tenant: secrets 0 hàng; insert → 42501; update/delete → 0 hàng", async () => {
    const out = await asTenant(TENANT_ID.acme, async (tx) => ({
      n: (await tx`select count(*)::int as n from admin.secrets`)[0]?.n,
      upd: (await tx`update admin.secrets set note = 'x' where name = 'DIFY_OLD_KEY' returning id`)
        .length,
      del: (await tx`delete from admin.secrets where name = 'DIFY_OLD_KEY' returning id`).length,
    }));
    expect(out).toEqual({ n: 0, upd: 0, del: 0 });
    const code = await sqlstate(() =>
      asTenant(
        TENANT_ID.acme,
        (tx) => tx`insert into admin.secrets (id, name, ciphertext, iv, last4)
          values (${ID.unknown}, 'TENANT_TRY', ${Buffer.alloc(32)}, ${Buffer.alloc(12)}, 'abcd')`,
      ),
    );
    expect(code).toBe("42501");
  });

  it("ADM-FR-50 · M2-R06 · scope platform: insert … returning id,name; select … for no key update; update ciphertext/iv/last4/note; delete đều chạy được", async () => {
    const out = await platform(async (tx) => {
      const ins = await tx`insert into admin.secrets (id, name, ciphertext, iv, last4)
        values (${ID.unknown}, 'PLATFORM_TRY', ${Buffer.alloc(32, 5)}, ${Buffer.alloc(12, 6)}, 'abcd')
        returning id, name`;
      const lock =
        await tx`select id, name from admin.secrets where name = 'PLATFORM_TRY' for no key update`;
      const upd = await tx`update admin.secrets
        set ciphertext = ${Buffer.alloc(32, 9)}, iv = ${Buffer.alloc(12, 8)}, last4 = 'zzzz', note = 'n'
        where name = 'PLATFORM_TRY' returning id`;
      const del = await tx`delete from admin.secrets where name = 'PLATFORM_TRY' returning id`;
      return [ins.length, lock.length, upd.length, del.length];
    });
    expect(out).toEqual([1, 1, 1, 1]);
  });

  it("ADM-BR-04 · M2-R03 · admin_api scope platform: select ciphertext / iv / * / returning ciphertext → 42501; cột an toàn đọc được", async () => {
    expect(await sqlstate(() => platform((tx) => tx`select ciphertext from admin.secrets`))).toBe(
      "42501",
    );
    expect(await sqlstate(() => platform((tx) => tx`select iv from admin.secrets`))).toBe("42501");
    expect(await sqlstate(() => platform((tx) => tx`select * from admin.secrets`))).toBe("42501");
    expect(
      await sqlstate(() =>
        platform(
          (tx) => tx`insert into admin.secrets (id, name, ciphertext, iv, last4)
            values (${ID.unknown}, 'RET_TRY', ${Buffer.alloc(32)}, ${Buffer.alloc(12)}, 'abcd')
            returning ciphertext`,
        ),
      ),
    ).toBe("42501");
    const rows = await platform(
      (tx) => tx`select id, name, key_version, last4, note, created_at, updated_at, updated_by
        from admin.secrets order by name`,
    );
    expect(rows.map((r) => r.name)).toEqual([
      "DIFY_INVOICE_KEY",
      "DIFY_OLD_KEY",
      "DIFY_TRANSLATE_KEY",
    ]);
  });

  it("ADM-BR-04 · ADM-NFR-07 · has_column_privilege: admin_rw KHÔNG SELECT ciphertext/iv, có SELECT name và INSERT/UPDATE/DELETE bảng", async () => {
    const [p] = await owner`select
      has_column_privilege('admin_rw', 'admin.secrets', 'ciphertext', 'SELECT') as ct,
      has_column_privilege('admin_rw', 'admin.secrets', 'iv', 'SELECT') as iv,
      has_column_privilege('admin_rw', 'admin.secrets', 'name', 'SELECT') as nm,
      has_table_privilege('admin_rw', 'admin.secrets', 'INSERT') as ins,
      has_table_privilege('admin_rw', 'admin.secrets', 'UPDATE') as upd,
      has_table_privilege('admin_rw', 'admin.secrets', 'DELETE') as del`;
    expect(p).toEqual({ ct: false, iv: false, nm: true, ins: true, upd: true, del: true });
  });
});

describe("ADM-BR-14 · hub_ro và PUBLIC bị REVOKE khỏi secrets", () => {
  it("ADM-BR-04 · M2-AC01 · SET ROLE hub_ro: select name / id → 42501; insert/update/delete → 42501", async () => {
    expect(await sqlstate(() => asHub((tx) => tx`select name from admin.secrets`))).toBe("42501");
    expect(await sqlstate(() => asHub((tx) => tx`select id from admin.secrets`))).toBe("42501");
    expect(
      await sqlstate(() =>
        asHub(
          (tx) => tx`insert into admin.secrets (id, name, ciphertext, iv, last4)
            values (${ID.unknown}, 'HUB_TRY', ${Buffer.alloc(32)}, ${Buffer.alloc(12)}, 'abcd')`,
        ),
      ),
    ).toBe("42501");
    expect(await sqlstate(() => asHub((tx) => tx`update admin.secrets set note = 'x'`))).toBe(
      "42501",
    );
    expect(await sqlstate(() => asHub((tx) => tx`delete from admin.secrets`))).toBe("42501");
    const [p] = await owner`select has_table_privilege('hub_ro', 'admin.secrets', 'SELECT') as t,
      has_column_privilege('hub_ro', 'admin.secrets', 'last4', 'SELECT') as c`;
    expect(p).toEqual({ t: false, c: false });
  });

  it("ADM-BR-04 · M2-AC01 · PUBLIC bị REVOKE: relacl không có grantee 0; role thăm dò NOLOGIN không SELECT được", async () => {
    const [acl] = await owner`select count(*)::int as n
      from pg_class c, aclexplode(c.relacl) a
      where c.oid = 'admin.secrets'::regclass and a.grantee = 0`;
    expect(acl?.n).toBe(0);
    await owner.unsafe("drop role if exists qc_probe_nologin");
    try {
      await owner.unsafe("create role qc_probe_nologin nologin");
      await owner.unsafe("grant qc_probe_nologin to current_user");
      const code = await sqlstate(() =>
        scoped(owner, null, null, (tx) => tx`select name from admin.secrets`, "qc_probe_nologin"),
      );
      expect(code).toBe("42501");
    } finally {
      await owner.unsafe("drop role if exists qc_probe_nologin");
    }
  });
});

describe("ADM-FR-20 · hub_ro đọc catalog (M2-R24)", () => {
  it("ADM-FR-20 · spec M2 §4 · hub_ro SELECT workflows/commands/command_names/feature_commands/features (cả base_url, input_schema, secret_id); ghi → 42501", async () => {
    for (const t of ["workflows", "commands", "command_names", "feature_commands", "features"]) {
      const n = await asHub(async (tx) => (await tx.unsafe(`select * from admin.${t}`)).length);
      expect(n).toBeGreaterThan(0);
      const w = await sqlstate(() => asHub((tx) => tx.unsafe(`delete from admin.${t}`)));
      expect(w).toBe("42501");
    }
    const wf = await asHub(
      (tx) => tx`select base_url, input_schema, secret_id from admin.workflows limit 1`,
    );
    expect(wf[0]?.base_url).toMatch(/^https:/);
  });

  it("ADM-FR-20 · AC-A03 · M2-R24 · Hub (hub_ro) thấy /dich hiệu lực: command bật ⨝ feature on|beta ⨝ workflow bật", async () => {
    const rows = await asHub(
      (tx) => tx`select c.name, c.aliases from admin.commands c
        join admin.workflows w on w.id = c.workflow_id and w.enabled
        join admin.feature_commands fc on fc.command_id = c.id
        join admin.features f on f.id = fc.feature_id and f.status in ('on', 'beta')
        where c.enabled and f.key = 'core' order by c.name`,
    );
    expect(rows.map((r) => r.name)).toEqual(["dich", "tom-tat"]);
    expect(rows[0]?.aliases).toEqual(["tr"]);
  });
});

describe("ADM-FR-31 · RLS feature_entitlements", () => {
  it("ADM-FR-31 · M2-R22 · scope tenant acme chỉ thấy hàng acme; insert cho globex → 42501; platform thấy hết và ghi được", async () => {
    const own = await asTenant(
      TENANT_ID.acme,
      (tx) => tx`select tenant_id from admin.feature_entitlements`,
    );
    expect(own).toHaveLength(4);
    expect(new Set(own.map((r) => r.tenant_id))).toEqual(new Set([TENANT_ID.acme]));
    const code = await sqlstate(() =>
      asTenant(
        TENANT_ID.acme,
        (tx) => tx`insert into admin.feature_entitlements (feature_id, tenant_id)
          values (${ID.feature.keToan}, ${TENANT_ID.zeta})`,
      ),
    );
    expect(code).toBe("42501");
    const all = await platform(async (tx) => {
      await tx`insert into admin.feature_entitlements (feature_id, tenant_id)
        values (${ID.feature.dichThuat}, ${TENANT_ID.zeta})`;
      return (await tx`select 1 from admin.feature_entitlements`).length;
    });
    expect(all).toBe(6);
  });

  it("ADM-FR-31 · ADM-NFR-07 · app.tenant_id rỗng hoặc không phải uuid với scope tenant: không rò dữ liệu", async () => {
    for (const bad of ["", "abc"]) {
      let seen = 0;
      const code = await sqlstate(async () => {
        seen = await scoped(
          api,
          "tenant",
          bad,
          async (tx) => (await tx`select 1 from admin.feature_entitlements`).length,
        );
      });
      expect(code === null ? seen : 0).toBe(0);
    }
  });

  it("ADM-FR-31 · M2-R22 · hub_ro thấy cả tenant (USING true) nhưng ghi → 42501", async () => {
    const n = await asHub(
      async (tx) => (await tx`select 1 from admin.feature_entitlements`).length,
    );
    expect(n).toBe(5);
    const code = await sqlstate(() =>
      asHub(
        (tx) => tx`insert into admin.feature_entitlements (feature_id, tenant_id)
          values (${ID.feature.dichThuat}, ${TENANT_ID.zeta})`,
      ),
    );
    expect(code).toBe("42501");
  });
});

describe("ADM-NFR-07 · cấu hình RLS", () => {
  it("ADM-NFR-07 · spec M2 §4 · relrowsecurity bật đúng 5 bảng (feature_entitlements, refresh_tokens, secrets, tenants, users); không bảng nào FORCE", async () => {
    const rows = await owner`select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'admin' and c.relkind = 'r' order by c.relname`;
    const on = rows.filter((r) => r.relrowsecurity).map((r) => r.relname);
    expect(on).toEqual(["feature_entitlements", "refresh_tokens", "secrets", "tenants", "users"]);
    expect(rows.some((r) => r.relforcerowsecurity)).toBe(false);
    expect(rows.map((r) => r.relname)).toEqual([
      "command_names",
      "commands",
      "feature_commands",
      "feature_entitlements",
      "features",
      "refresh_tokens",
      "secrets",
      "tenants",
      "users",
      "workflows",
    ]);
  });

  it("ADM-NFR-07 · spec M2 §4 · pg_policies: secrets_admin_rw (admin_rw), feature_entitlements_admin_rw (admin_rw), feature_entitlements_hub_ro (hub_ro, SELECT)", async () => {
    const rows = await owner<{ policyname: string; roles: string; cmd: string }[]>`
      select policyname, roles::text as roles, cmd from pg_policies
      where schemaname = 'admin' and tablename in ('secrets', 'feature_entitlements')
      order by policyname`;
    const by = Object.fromEntries(rows.map((r) => [r.policyname, r]));
    expect(Object.keys(by).sort()).toEqual([
      "feature_entitlements_admin_rw",
      "feature_entitlements_hub_ro",
      "secrets_admin_rw",
    ]);
    expect(by.secrets_admin_rw?.roles).toBe("{admin_rw}");
    expect(by.feature_entitlements_admin_rw?.roles).toBe("{admin_rw}");
    expect(by.feature_entitlements_hub_ro?.roles).toBe("{hub_ro}");
    expect(by.feature_entitlements_hub_ro?.cmd).toBe("SELECT");
  });

  it("ADM-NFR-07 · không rò giữa hai transaction trên một kết nối: tx1 scope platform đọc được secrets, tx2 không scope → 0 hàng", async () => {
    const one = await api.begin(async (tx) => {
      await tx`select set_config('app.scope', 'platform', true)`;
      return (await tx`select count(*)::int as n from admin.secrets`)[0]?.n;
    });
    const two = await api.begin(
      async (tx) => (await tx`select count(*)::int as n from admin.secrets`)[0]?.n,
    );
    expect(one).toBe(3);
    expect(two).toBe(0);
  });
});

describe("ADM-FR-50 · M2-AC02 · bản mã trong DB", () => {
  it("ADM-FR-50 · M2-AC02 · admin_api ghi, owner đọc: ciphertext không chứa plaintext (thô/base64/hex); hai hàng cùng plaintext khác iv/ciphertext; giải mã độc lập đúng", async () => {
    const idB = "01900000-0000-7000-8000-0000000002f8";
    const sealA = sealIndependent(KEY, ID.unknown, 1, LEAK_1);
    const sealB = sealIndependent(KEY, idB, 1, LEAK_1);
    // Ghi thật (commit) bằng admin_api scope platform để owner đọc lại.
    await api.begin(async (tx) => {
      await tx`select set_config('app.scope', 'platform', true)`;
      await tx`insert into admin.secrets (id, name, ciphertext, iv, last4) values
        (${ID.unknown}, 'LEAK_A', ${sealA.ciphertext}, ${sealA.iv}, 'LEAK'),
        (${idB}, 'LEAK_B', ${sealB.ciphertext}, ${sealB.iv}, 'LEAK')`;
    });
    const rows = await owner`select id, name, ciphertext, iv, key_version from admin.secrets
      where name in ('LEAK_A', 'LEAK_B') order by name`;
    const [ra, rb] = rows;
    for (const f of leakForms(LEAK_1)) {
      expect(Buffer.from(ra?.ciphertext).toString("utf8")).not.toContain(f);
      expect(Buffer.from(ra?.ciphertext).toString("hex")).not.toContain(f);
      expect(Buffer.from(ra?.ciphertext).toString("base64")).not.toContain(f);
    }
    expect(Buffer.from(ra?.iv).equals(Buffer.from(rb?.iv))).toBe(false);
    expect(Buffer.from(ra?.ciphertext).equals(Buffer.from(rb?.ciphertext))).toBe(false);
    expect(
      openIndependent(KEY, ra?.id, ra?.key_version, { ciphertext: ra?.ciphertext, iv: ra?.iv }),
    ).toBe(LEAK_1);
    expect(() =>
      openIndependent(KEY, rb?.id, 2, { ciphertext: rb?.ciphertext, iv: rb?.iv }),
    ).toThrow();
  });
});

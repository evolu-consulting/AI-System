// ADM-NFR-07, ADM-BR-09, ADM-FR-62, ADM-FR-32, ADM-FR-53 · RLS + quyền + FK kép của bảng quyền M3
// (test-plan D2; M3-AC06, M3-AC01 phần DB). Truy vấn trực tiếp bằng role admin_api / hub_ro, không qua app.
// Chỉ cần DB đã migrate (xanh ở T2): không app. Dữ liệu dựng một lần bằng owner (beforeAll); mọi ghi của test nằm trong
// transaction luôn rollback nên không `it` nào ảnh hưởng `it` khác.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { runMigrations } from "@ai/db";
import { resetTestDb } from "@ai/db/test-db";
import postgres from "postgres";
import { ADMIN_API_URL, OWNER_URL } from "../M1/_fixtures";

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;
class Rollback extends Error {}

const T1 = "01900000-0000-7000-8000-000000000001";
const T2 = "01900000-0000-7000-8000-000000000002";
const U1 = "01900000-0000-7000-8000-000000000011";
const UT2 = "01900000-0000-7000-8000-000000000021";
const G1 = "01900000-0000-7000-8000-000000000301";
const GT2 = "01900000-0000-7000-8000-000000000303";
const F1 = "01900000-0000-7000-8000-000000000311";

let owner: Sql;
let api: Sql;

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
const GROUPS = ["groups", "group_members", "feature_grants"] as const;
const count = async (tx: Tx, table: string) =>
  (
    (await tx.unsafe(`select count(*)::int as n from admin.${table}`))[0] as unknown as {
      n: number;
    }
  ).n;

beforeAll(async () => {
  await resetTestDb(OWNER_URL);
  await runMigrations({ url: OWNER_URL, appEnv: "development" });
  owner = postgres(OWNER_URL, { max: 2, onnotice: () => {} });
  api = postgres(ADMIN_API_URL, { max: 1, onnotice: () => {} });
  await owner`insert into admin.tenants (id, key, name) values (${T1}, 'acme', 'Acme'), (${T2}, 'globex', 'Globex')`;
  await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role) values
    (${U1}, ${T1}, 'an', 'h', 'An', 'member'), (${UT2}, ${T2}, 'hoa', 'h', 'Hoa', 'member')`;
  await owner`insert into admin.features (id, key, name, status) values (${F1}, 'ke-toan', '{"vi":"KT"}'::jsonb, 'on')`;
  await owner`insert into admin.groups (id, tenant_id, key, name) values
    (${G1}, ${T1}, 'ke-toan', '{"vi":"Kế toán"}'::jsonb), (${GT2}, ${T2}, 'ke-toan', '{"vi":"Kế toán"}'::jsonb)`;
  await owner`insert into admin.group_members (tenant_id, group_id, user_id) values
    (${T1}, ${G1}, ${U1}), (${T2}, ${GT2}, ${UT2})`;
  await owner`insert into admin.feature_grants (tenant_id, feature_id, group_id) values
    (${T1}, ${F1}, ${G1}), (${T2}, ${F1}, ${GT2})`;
});
afterAll(async () => {
  await api.end();
  await owner.end();
});

describe("ADM-BR-09 · RLS groups, group_members, feature_grants (M3-R06)", () => {
  it("ADM-NFR-07 · M3-R06 · không đặt scope: cả 3 bảng đều 0 hàng", async () => {
    await scoped(api, null, null, async (tx) => {
      for (const t of GROUPS) expect([t, await count(tx, t)]).toEqual([t, 0]);
    });
  });

  it("ADM-BR-09 · M3-R06 · scope tenant acme: chỉ thấy hàng acme (groups gồm beta-testers + ke-toan = 2; 1 thành viên; 1 grant)", async () => {
    await asTenant(T1, async (tx) => {
      expect(await count(tx, "groups")).toBe(2);
      expect(await count(tx, "group_members")).toBe(1);
      expect(await count(tx, "feature_grants")).toBe(1);
      const other = await tx`select count(*)::int as n from admin.groups where tenant_id = ${T2}`;
      expect(other[0]?.n).toBe(0);
    });
  });

  it("ADM-BR-09 · M3-R06 · scope tenant acme: insert hàng của globex vào cả 3 bảng → 42501", async () => {
    const ins = [
      (tx: Tx) =>
        tx`insert into admin.groups (tenant_id, key, name) values (${T2}, 'moi', '{"vi":"x"}'::jsonb)`,
      (tx: Tx) =>
        tx`insert into admin.group_members (tenant_id, group_id, user_id) values (${T2}, ${GT2}, ${UT2})`,
      (tx: Tx) =>
        tx`insert into admin.feature_grants (tenant_id, feature_id, group_id) values (${T2}, ${F1}, ${GT2})`,
    ];
    for (const run of ins) {
      expect(await sqlstate(() => asTenant(T1, async (tx) => run(tx)))).toBe("42501");
    }
  });

  it("ADM-BR-09 · M3-R06 · scope tenant acme: update/delete hàng của globex → 0 hàng (không lỗi)", async () => {
    await asTenant(T1, async (tx) => {
      const u = await tx`update admin.groups set description = 'x' where tenant_id = ${T2}`;
      const d = await tx`delete from admin.feature_grants where tenant_id = ${T2}`;
      const m = await tx`delete from admin.group_members where tenant_id = ${T2}`;
      expect([u.count, d.count, m.count]).toEqual([0, 0, 0]);
    });
  });

  it("ADM-NFR-07 · M3-R06 · app.tenant_id rỗng hoặc 'abc' trong scope tenant: 0 hàng hoặc lỗi, KHÔNG rò hàng nào", async () => {
    for (const tid of ["", "abc"]) {
      let seen: number | string = "error";
      try {
        seen = await scoped(api, "tenant", tid, async (tx) => count(tx, "groups"));
      } catch (e) {
        seen = (e as { code?: string }).code ?? "error";
      }
      expect(seen === 0 || typeof seen === "string").toBe(true);
    }
  });

  it("ADM-BR-09 · M3-R06 · scope platform: thấy cả hai tenant (4 group, 2 thành viên, 2 grant) và ghi được", async () => {
    await platform(async (tx) => {
      expect(await count(tx, "groups")).toBe(4);
      expect(await count(tx, "group_members")).toBe(2);
      expect(await count(tx, "feature_grants")).toBe(2);
      await tx`insert into admin.groups (tenant_id, key, name) values (${T2}, 'moi', '{"vi":"x"}'::jsonb)`;
      await tx`delete from admin.feature_grants where tenant_id = ${T2}`;
      expect(await count(tx, "feature_grants")).toBe(1);
    });
  });

  it("ADM-NFR-07 · M3-R06 · hai transaction trên một kết nối: tx1 scope platform đọc được groups; tx2 không scope → 0 hàng", async () => {
    await platform(async (tx) => expect(await count(tx, "groups")).toBe(4));
    await scoped(api, null, null, async (tx) => expect(await count(tx, "groups")).toBe(0));
  });
});

describe("ADM-BR-09 · FK kép chặn chéo tenant (owner, không bị RLS che)", () => {
  it("ADM-FR-62 · M3-R03 · group_members: user khác tenant với group → 23503; ghi đúng tenant ok (đối chứng, rollback)", async () => {
    const bad = () =>
      owner`insert into admin.group_members (tenant_id, group_id, user_id) values (${T1}, ${G1}, ${UT2})`;
    expect(await sqlstate(bad)).toBe("23503");
    await scoped(owner, null, null, async (tx) => {
      await tx`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
        values ('01900000-0000-7000-8000-000000000012', ${T1}, 'binh', 'h', 'B', 'member')`;
      const ok = await tx`insert into admin.group_members (tenant_id, group_id, user_id)
        values (${T1}, ${G1}, '01900000-0000-7000-8000-000000000012')`;
      expect(ok.count).toBe(1);
    });
  });

  it("ADM-FR-32 · M3-R07 · feature_grants: group/user của tenant khác → 23503; group_id và user_id cùng null / cùng có → 23514", async () => {
    const ins = (g: string | null, u: string | null, t = T1) =>
      owner`insert into admin.feature_grants (tenant_id, feature_id, group_id, user_id) values (${t}, ${F1}, ${g}, ${u})`;
    expect(await sqlstate(() => ins(GT2, null))).toBe("23503");
    expect(await sqlstate(() => ins(null, UT2))).toBe("23503");
    expect(await sqlstate(() => ins(null, null))).toBe("23514");
    expect(await sqlstate(() => ins(G1, U1))).toBe("23514");
  });
});

describe("M3-AC06 · hub_ro chỉ SELECT", () => {
  it("ADM-NFR-07 · M3-R17 · hub_ro SELECT 4 bảng mới và thấy CẢ HAI tenant (USING true)", async () => {
    await asHub(async (tx) => {
      expect(await count(tx, "groups")).toBe(4);
      expect(await count(tx, "group_members")).toBe(2);
      expect(await count(tx, "feature_grants")).toBe(2);
      const [c] = await tx`select config_version from admin.config_meta`;
      expect(typeof c?.config_version).toBe("number");
    });
  });

  it("ADM-NFR-07 · M3-R17 · hub_ro insert/update/delete từng bảng → 42501; secrets vẫn 42501", async () => {
    const attempts: Array<(tx: Tx) => Promise<unknown>> = [
      (tx) =>
        tx`insert into admin.groups (tenant_id, key, name) values (${T1}, 'zz', '{"vi":"x"}'::jsonb)`,
      (tx) => tx`update admin.groups set description = 'x'`,
      (tx) => tx`delete from admin.groups`,
      (tx) =>
        tx`insert into admin.group_members (tenant_id, group_id, user_id) values (${T1}, ${G1}, ${U1})`,
      (tx) => tx`delete from admin.group_members`,
      (tx) =>
        tx`insert into admin.feature_grants (tenant_id, feature_id, group_id) values (${T1}, ${F1}, ${G1})`,
      (tx) => tx`delete from admin.feature_grants`,
      (tx) => tx`update admin.config_meta set config_version = config_version + 1`,
      (tx) => tx`select name from admin.secrets`,
    ];
    for (const run of attempts) expect(await sqlstate(() => asHub(run))).toBe("42501");
  });

  it("ADM-NFR-07 · M3-R17 · has_table_privilege: hub_ro chỉ SELECT 4 bảng mới; không SELECT secrets", async () => {
    const [p] = await owner`select
      has_table_privilege('hub_ro', 'admin.groups', 'SELECT') as g,
      has_table_privilege('hub_ro', 'admin.groups', 'INSERT') as gi,
      has_table_privilege('hub_ro', 'admin.group_members', 'SELECT') as m,
      has_table_privilege('hub_ro', 'admin.feature_grants', 'SELECT') as f,
      has_table_privilege('hub_ro', 'admin.feature_grants', 'DELETE') as fd,
      has_table_privilege('hub_ro', 'admin.config_meta', 'SELECT') as c,
      has_table_privilege('hub_ro', 'admin.config_meta', 'UPDATE') as cu,
      has_table_privilege('hub_ro', 'admin.secrets', 'SELECT') as s`;
    expect([p?.g, p?.m, p?.f, p?.c]).toEqual([true, true, true, true]);
    expect([p?.gi, p?.fd, p?.cu, p?.s]).toEqual([false, false, false, false]);
  });

  it("ADM-NFR-07 · M3-R17 · PUBLIC không có quyền trên 4 bảng mới (relacl); role thăm dò NOLOGIN → 42501; hub_ro không EXECUTE create_beta_group", async () => {
    const acl = await owner`select c.relname, a.grantee from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where c.relnamespace = 'admin'::regnamespace
        and c.relname in ('groups', 'group_members', 'feature_grants', 'config_meta') and a.grantee = 0`;
    expect(acl).toHaveLength(0);
    await owner.unsafe("drop role if exists qc_probe_nologin_m3");
    await owner.unsafe("create role qc_probe_nologin_m3 nologin");
    try {
      expect(
        await sqlstate(() =>
          scoped(
            owner,
            null,
            null,
            (tx) => tx`select count(*) from admin.groups`,
            "qc_probe_nologin_m3",
          ),
        ),
      ).toBe("42501");
    } finally {
      await owner.unsafe("drop role if exists qc_probe_nologin_m3");
    }
    const [f] =
      await owner`select has_function_privilege('hub_ro', 'admin.create_beta_group()', 'EXECUTE') as ok`;
    expect(f?.ok).toBe(false);
  });

  it("ADM-NFR-07 · M3-R17 · hub_ro giữ quyền cột users (nền của SQL tham chiếu): đọc id, tenant_id, active, locked_by_tenant", async () => {
    await asHub(async (tx) => {
      const r = await tx`select id, tenant_id, active, locked_by_tenant from admin.users limit 1`;
      expect(r).toHaveLength(1);
    });
  });
});

describe("ADM-FR-53 · quyền trên config_meta (M3-R15, R17)", () => {
  it("ADM-NFR-07 · M3-R15 · admin_api update/upsert config_meta được (cả scope tenant); delete và truncate → 42501; không RLS", async () => {
    await asTenant(T1, async (tx) => {
      const u =
        await tx`update admin.config_meta set config_version = config_version + 1 returning config_version`;
      expect(u).toHaveLength(1);
      const up = await tx`insert into admin.config_meta (id, config_version) values (1, 1)
        on conflict (id) do update set config_version = admin.config_meta.config_version + 1 returning config_version`;
      expect(up).toHaveLength(1);
    });
    expect(await sqlstate(() => asTenant(T1, (tx) => tx`delete from admin.config_meta`))).toBe(
      "42501",
    );
    expect(
      await sqlstate(() => asTenant(T1, (tx) => tx.unsafe("truncate admin.config_meta"))),
    ).toBe("42501");
    const [p] =
      await owner`select has_table_privilege('admin_rw', 'admin.config_meta', 'DELETE') as d,
      has_table_privilege('admin_rw', 'admin.config_meta', 'TRUNCATE') as t,
      has_table_privilege('admin_rw', 'admin.config_meta', 'UPDATE') as u,
      (select relrowsecurity from pg_class where oid = 'admin.config_meta'::regclass) as rls`;
    expect([p?.d, p?.t, p?.u, p?.rls]).toEqual([false, false, true, false]);
  });
});

describe("ADM-NFR-07 · cấu hình RLS", () => {
  it("ADM-NFR-07 · spec M3 §4 · relrowsecurity bật đúng 8 bảng; 6 bảng còn lại false; không bảng nào FORCE", async () => {
    const rows = await owner`select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'admin' and c.relkind = 'r' order by c.relname`;
    const on = rows.filter((r) => r.relrowsecurity).map((r) => r.relname);
    expect(on).toEqual([
      "feature_entitlements",
      "feature_grants",
      "group_members",
      "groups",
      "refresh_tokens",
      "secrets",
      "tenants",
      "users",
    ]);
    expect(rows.filter((r) => !r.relrowsecurity)).toHaveLength(6);
    expect(rows.some((r) => r.relforcerowsecurity)).toBe(false);
  });

  it("ADM-NFR-07 · spec M3 §4 · pg_policies: *_admin_rw (admin_rw, ALL, có WITH CHECK) và *_hub_ro (hub_ro, SELECT) cho 3 bảng", async () => {
    const rows = await owner<
      {
        tablename: string;
        policyname: string;
        roles: string;
        cmd: string;
        with_check: string | null;
      }[]
    >`select tablename, policyname, roles::text as roles, cmd, with_check from pg_policies
      where schemaname = 'admin' and tablename in ('groups', 'group_members', 'feature_grants')`;
    for (const t of GROUPS) {
      const rw = rows.find((r) => r.policyname === `${t}_admin_rw`);
      const hub = rows.find((r) => r.policyname === `${t}_hub_ro`);
      expect(rw?.cmd).toBe("ALL");
      expect(rw?.roles).toContain("admin_rw");
      expect(rw?.with_check).toBeTruthy();
      expect(hub?.cmd).toBe("SELECT");
      expect(hub?.roles).toContain("hub_ro");
    }
  });
});

describe("ADM-FR-62 · trigger beta-testers dưới admin_api (M3-R02)", () => {
  it("ADM-FR-62 · M3-R02 · admin_api scope platform INSERT tenant → beta-testers có ngay trong cùng transaction (RLS không chặn trigger)", async () => {
    await platform(async (tx) => {
      const [t] =
        await tx`insert into admin.tenants (key, name) values ('moi', 'Moi') returning id`;
      const g = await tx`select key from admin.groups where tenant_id = ${t?.id as string}`;
      expect(g.map((r) => r.key)).toEqual(["beta-testers"]);
    });
  });

  it("ADM-FR-62 · M3-R02 · admin_api scope tenant INSERT tenant → 42501 (tenant luôn do platform tạo)", async () => {
    expect(
      await sqlstate(() =>
        asTenant(T1, (tx) => tx`insert into admin.tenants (key, name) values ('moi2', 'Moi2')`),
      ),
    ).toBe("42501");
  });
});

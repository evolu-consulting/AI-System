// ADM-FR-40, ADM-FR-41, ADM-FR-51 · M4-R02, R04, R11, R17 · ràng buộc DB 3 bảng mới + cột `updated_by` (test-plan D1–D4).
// Ghi thử bằng owner trong transaction luôn rollback (audit_log không xoá được: không để lại hàng). Xanh ở T0.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type postgres from "postgres";
import { createM4Env, ID, id4, type M4Env, TENANT_ID, USER_ID } from "./_ab";

type Tx = postgres.TransactionSql;
class Rollback extends Error {}
let env: M4Env;

beforeAll(async () => {
  env = await createM4Env();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset4();
});

/** Chạy `fn` (owner, có thể đặt role) trong tx rollback; trả SQLSTATE lỗi đầu tiên hoặc null. */
async function state(fn: (tx: Tx) => Promise<unknown>, role?: string): Promise<string | null> {
  try {
    await env.owner.begin(async (tx) => {
      if (role) await tx.unsafe(`set local role ${role}`);
      await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (e instanceof Rollback) return null;
    return (e as { code?: string }).code ?? String(e);
  }
  return null;
}
const A = TENANT_ID.acme;
const KT = ID.feature.keToan;
const quota = (tx: Tx, f: string | null, cols: string) =>
  tx.unsafe(
    `insert into admin.tenant_quotas (tenant_id, feature_id, ${cols.split("=")[0]}) values ($1, $2, ${cols.split("=")[1]})`,
    [A, f],
  );

describe("ADM-FR-40 · M4-R02 · tenant_quotas", () => {
  it("ADM-FR-40 · M4-R02 · D1 · trùng scope (cả NULL) → 23505; warn_pct 90 / max 0 / 3 giới hạn null → 23514", async () => {
    expect(
      await state(async (tx) => {
        await quota(tx, null, "max_runs=10");
        await quota(tx, null, "max_runs=20");
      }),
    ).toBe("23505");
    expect(
      await state(async (tx) => {
        await quota(tx, KT, "max_runs=10");
        await quota(tx, KT, "max_tokens=20");
      }),
    ).toBe("23505");
    expect(await state((tx) => quota(tx, null, "max_runs, warn_pct=10, 90"))).toBe("23514");
    expect(await state((tx) => quota(tx, null, "max_runs=0"))).toBe("23514");
    expect(await state((tx) => quota(tx, null, "max_usd=0"))).toBe("23514");
    expect(await state((tx) => quota(tx, null, "max_tokens=0"))).toBe("23514");
    expect(await state((tx) => quota(tx, null, "max_runs=null"))).toBe("23514");
    expect(await state((tx) => quota(tx, null, "max_runs, max_usd=5, 12.50"))).toBeNull();
  });

  it("ADM-FR-40 · M4-R02 · D1 · xoá feature → hàng quota của feature biến mất (cascade); hàng NULL còn", async () => {
    const F = id4(50);
    await env.owner`insert into admin.features (id, key, name, description, icon, status)
      values (${F}, 'm4-cascade', ${env.owner.json({ vi: "Cascade" })}, ${env.owner.json({})}, 'package', 'on')`;
    await env.owner`insert into admin.tenant_quotas (tenant_id, feature_id, max_runs) values
      (${A}, ${F}, 5), (${A}, null, 9)`;
    await env.owner`delete from admin.features where id = ${F}`;
    const rows = await env.owner`select feature_id from admin.tenant_quotas where tenant_id = ${A}`;
    expect(rows.map((r) => r.feature_id)).toEqual([null]);
  });
});

describe("ADM-FR-41 · M4-R04 · quota_alerts", () => {
  const alert = (tx: Tx, level: number, status = "pending") =>
    tx`insert into admin.quota_alerts (tenant_id, feature_id, level, month, pct, status)
      values (${A}, null, ${level}, '2026-10-01', 80, ${status})`;

  it("ADM-FR-41 · M4-R04 · D2 · trùng (tenant, NULL, 80, month) → 23505; level 90 → 23514; status 'x' → 23514; mặc định pending/attempts 0", async () => {
    expect(
      await state(async (tx) => {
        await alert(tx, 80);
        await alert(tx, 80);
      }),
    ).toBe("23505");
    expect(await state((tx) => alert(tx, 90))).toBe("23514");
    expect(await state((tx) => alert(tx, 80, "x"))).toBe("23514");
    expect(
      await state(async (tx) => {
        await alert(tx, 100);
        const [r] =
          await tx`select status, attempts from admin.quota_alerts where tenant_id = ${A}`;
        expect(r).toEqual({ status: "pending", attempts: 0 });
      }),
    ).toBeNull();
  });
});

describe("ADM-FR-51 · M4-R11 · audit_log", () => {
  const ins = (
    tx: Tx,
    action: string,
    entity: string,
    t: string | null = A,
    actor: string | null = null,
  ) =>
    tx`insert into admin.audit_log (tenant_id, actor_id, action, entity, entity_name)
      values (${t}, ${actor}, ${action}, ${entity}, 'd3') returning seq::text as seq`;

  it("ADM-FR-51 · M4-R11 · D3 · seq identity tăng; action/entity 'x' → 23514; không FK (tenant/actor không tồn tại → ok)", async () => {
    expect(
      await state(async (tx) => {
        const [a] = await ins(tx, "update", "group");
        const [b] = await ins(tx, "create", "quota", id4(97), id4(98));
        expect(BigInt(b?.seq ?? "0")).toBeGreaterThan(BigInt(a?.seq ?? "0"));
        const [r] =
          await tx`select summary, snapshot, entity_name from admin.audit_log where seq = ${b?.seq ?? "0"}::bigint`;
        expect(r).toEqual({ summary: {}, snapshot: false, entity_name: "d3" });
      }),
    ).toBeNull();
    expect(await state((tx) => ins(tx, "x", "group"))).toBe("23514");
    expect(await state((tx) => ins(tx, "update", "x"))).toBe("23514");
    for (const e of ["user_totp", "config", "entitlement", "secret"])
      expect([e, await state((tx) => ins(tx, "import", e))]).toEqual([e, null]);
  });
});

describe("ADM-FR-51 · M4-R17 · updated_by", () => {
  it("ADM-FR-51 · M4-R17 · D4 · users/tenants có updated_by FK users ON DELETE SET NULL; hub_ro SELECT users.updated_by → 42501", async () => {
    const rows = await env.owner<{ tbl: string; del: string }[]>`
      select c.conrelid::regclass::text as tbl, c.confdeltype as del
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and a.attname = 'updated_by'
        and c.conrelid in ('admin.users'::regclass, 'admin.tenants'::regclass)
      order by (c.conrelid::regclass::text) collate "C"`;
    expect([...rows]).toEqual([
      { tbl: "admin.tenants", del: "n" },
      { tbl: "admin.users", del: "n" },
    ]);
    expect(await state((tx) => tx`select updated_by from admin.users limit 1`, "hub_ro")).toBe(
      "42501",
    );
    expect(
      await state((tx) => tx`select id from admin.users where id = ${USER_ID.binh}`, "hub_ro"),
    ).toBeNull();
  });
});

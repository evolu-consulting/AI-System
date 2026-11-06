// CR-121 c20 (D3) · int (DB thật): tên công ty MỘT nguồn = `admin.tenants.name` (pack-contracts 0076).
// (1) backfill/so khớp: admin trống tên ⇒ chép từ gói; lệch ⇒ giữ admin; gỡ cột `company_name`; chạy lại được; set-based (số câu cố định).
// (2) chặn đọc chéo tenant: `contracts.tenant_name()` chỉ trả tên tenant của phiên (`app.tenant_id`), `contracts_rw` không đọc `admin.tenants`.
// (3) `/pack/me` giữ MỘT câu: brand = một câu văn bản cố định (kiểm ở config-consistency: đổi tên ở admin ⇒ ETag đổi, nóng 0 SQL).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb } from "@ai/db";
import { tenantId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { companyBrandModule } from "./brand.mount";

const T1 = tenantId(2101); // admin trống tên, gói có tên ⇒ chép sang admin
const T2 = tenantId(2102); // cả hai có tên, lệch ⇒ giữ admin
const T3 = tenantId(2103); // trùng tên
const MIGRATION = join(
  import.meta.dir,
  "../../../../../../packages/db/migrations-pack-contracts/0076_company_name_one_source.sql",
);

let o: Sql;
const hasColumn = async (): Promise<boolean> =>
  (
    await o<{ n: number }[]>`select count(*)::int as n from pg_attribute
      where attrelid = 'contracts.company_settings'::regclass and attname = 'company_name' and not attisdropped`
  )[0]?.n === 1;
const nameOf = async (id: string): Promise<string | undefined> =>
  (await o<{ name: string }[]>`select name from admin.tenants where id = ${id}`)[0]?.name;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name) values (${T1}, 't2101', ' '), (${T2}, 't2102', 'Admin Name'),
    (${T3}, 't2103', 'Same Name')`;
}, 120_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-121 c20 · 0076 backfill + gỡ cột", () => {
  it("sau migrate không còn cột company_name; trigger brand chỉ theo app_name/logo/accent", async () => {
    expect(await hasColumn()).toBe(false);
    const [f] = await o<
      { src: string }[]
    >`select pg_get_functiondef('contracts.brand_config_bump'::regproc) as src`;
    expect(f?.src).not.toContain("company_name");
  });

  it("dựng lại trạng thái cũ (cột + dữ liệu) ⇒ chạy lại 0076: chép tên trống, giữ tên admin khi lệch, gỡ cột; chạy lần 2 không đổi", async () => {
    await o`alter table contracts.company_settings add column company_name text`;
    await o`insert into contracts.company_settings (tenant_id, company_name) values
      (${T1}, 'Tên từ gói'), (${T2}, 'Tên khác của gói'), (${T3}, 'Same Name')`;
    const run = async () => {
      for (const stmt of readFileSync(MIGRATION, "utf8").split("--> statement-breakpoint"))
        if (stmt.trim()) await o.unsafe(stmt);
    };
    await run();
    expect(await hasColumn()).toBe(false);
    expect([await nameOf(T1), await nameOf(T2), await nameOf(T3)]).toEqual([
      "Tên từ gói",
      "Admin Name",
      "Same Name",
    ]);
    await run(); // idempotent
    expect([await nameOf(T1), await nameOf(T2), await nameOf(T3)]).toEqual([
      "Tên từ gói",
      "Admin Name",
      "Same Name",
    ]);
    const [rls] = await o<
      { f: boolean }[]
    >`select relforcerowsecurity as f from pg_class where oid = 'contracts.company_settings'::regclass`;
    expect(rls?.f).toBe(true); // FORCE RLS được bật lại sau backfill
    const [ck] = await o<{ n: number }[]>`select count(*)::int as n from pg_constraint
      where conrelid = 'contracts.company_settings'::regclass and conname = 'company_settings_app_name_ck'`;
    expect(ck?.n).toBe(1);
  });
});

describe("CR-121 c20 · đọc tên qua tenant của phiên (RLS)", () => {
  const asPack = async <T>(tenant: string | null, q: string): Promise<T[]> => {
    const rows = await o.begin(async (tx) => {
      await tx.unsafe("set local role contracts_rw");
      if (tenant) await tx`select set_config('app.tenant_id', ${tenant}, true)`;
      return [...(await tx.unsafe(q))] as unknown[];
    });
    return rows as T[];
  };

  it("tenant_name() chỉ trả tên tenant phiên; không có phiên ⇒ NULL; contracts_rw không đọc trực tiếp admin.tenants", async () => {
    const [a] = await asPack<{ n: string | null }>(T2, "select contracts.tenant_name() as n");
    const [b] = await asPack<{ n: string | null }>(T3, "select contracts.tenant_name() as n");
    const [none] = await asPack<{ n: string | null }>(null, "select contracts.tenant_name() as n");
    expect({ a: a?.n, b: b?.n, none: none?.n }).toEqual({
      a: "Admin Name",
      b: "Same Name",
      none: null,
    });
    const err = await asPack(T2, "select name from admin.tenants").then(
      () => null,
      (e: { code?: string }) => e,
    );
    expect(err?.code).toBe("42501");
  });

  it("brand (hub_api, MỘT câu) trả tên admin của đúng tenant, không lẫn tenant khác", async () => {
    await o`insert into contracts.company_settings (tenant_id, app_name) values (${T2}, 'App 2'), (${T3}, 'App 3')
      on conflict (tenant_id) do update set app_name = excluded.app_name`;
    const db = createDb(urls().hubApi, { max: 1 });
    try {
      const brand = companyBrandModule(db);
      expect(await brand.brand(T2)).toMatchObject({ name: "Admin Name", appName: "App 2" });
      expect(await brand.brand(T3)).toMatchObject({ name: "Same Name", appName: "App 3" });
    } finally {
      await db.close();
    }
  });
});

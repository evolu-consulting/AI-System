// com-c7 · review cuối đợt CR-102b trên DB thật (role `contracts_rw`, RLS gói): TB-4 policy UPDATE nhánh `quote` chỉ cho người khác đánh
// dấu "đã thay" (không gỡ được giá người khác); Thấp-8 tab NCC & giá: trần 200 dòng tính dòng còn hiệu lực trước.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { enablePack, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { suppliersRepo } from "./supplier-prices.repo";

let sql: Sql;
let db: Db;
let A = "";
let creator = "";
let other = "";
let pid = "";

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [A] = (await tenants(sql, 1, 913)) as [string];
  [creator, other] = (await users(sql, A, 2, { from: 913 })) as [string, string];
  await enablePack(sql, [A], "contracts");
  // chế độ thấy "org": người thường KHÔNG thấy hết (sees_all = false)
  await sql`insert into contracts.visibility_settings (tenant_id, mode) values (${A}::uuid, 'org')`;
  const [p] = await sql<
    { id: string }[]
  >`insert into contracts.products (tenant_id, name, unit, grp)
    values (${A}::uuid, 'Keo TB4', 'hộp', 'goods') returning id::text`;
  pid = p?.id as string;
  db = createDb(urls().hubApi, { max: 2 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

/** Phiên `contracts_rw` của `user` (như withPackScope) chạy một câu UPDATE; trả số dòng đổi. */
const asUser = (user: string, q: string, id: string) =>
  sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${A}, true), set_config('app.user_id', ${user}, true)`;
    await tx.unsafe("set local role contracts_rw");
    return (await tx.unsafe(`${q} where id = $1 returning id`, [id])).length;
  });
const quoteRow = async (by: string) =>
  (
    await sql<
      { id: string }[]
    >`insert into contracts.product_supplier_prices (tenant_id, product_id, supplier_name, kind,
        price, unit, source, created_by) values (${A}::uuid, ${pid}::uuid, 'NCC TB4', 'new', 1000, 'hộp', 'quote', ${by}::uuid)
      returning id::text`
  )[0]?.id as string;

describe("review TB-4 · policy UPDATE nhánh quote", () => {
  it("người khác (không tạo, không thấy hết) KHÔNG gỡ được giá Báo giá; chỉ đánh dấu đã thay", async () => {
    const id = await quoteRow(creator);
    const upd = "update contracts.product_supplier_prices set";
    await expect(asUser(other, `${upd} removed_at = now()`, id)).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      asUser(other, `${upd} replaced_at = now(), removed_at = now()`, id),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await asUser(other, `${upd} replaced_at = now()`, id)).toBe(1); // R28: thay giá cùng NCC
    const [r] = await sql<
      { removed: boolean; replaced: boolean }[]
    >`select removed_at is not null as removed,
      replaced_at is not null as replaced from contracts.product_supplier_prices where id = ${id}::uuid`;
    expect(r).toEqual({ removed: false, replaced: true });
    expect(await asUser(creator, `${upd} removed_at = now()`, id)).toBe(1); // người tạo vẫn gỡ được
  });
});

describe("review Thấp-8 · tab NCC & giá: trần 200 tính dòng còn hiệu lực trước", () => {
  it("201 dòng đã thay MỚI hơn không đẩy giá đang dùng (cũ hơn) ra ngoài", async () => {
    await sql`insert into contracts.product_supplier_prices (tenant_id, product_id, supplier_name, kind, price, unit, source,
        seen_on) values (${A}::uuid, ${pid}::uuid, 'NCC Còn dùng', 'new', 500, 'hộp', 'manual', '2020-01-01')`;
    await sql`insert into contracts.product_supplier_prices (tenant_id, product_id, supplier_name, kind, price, unit, source,
        seen_on, replaced_at)
      select ${A}::uuid, ${pid}::uuid, 'NCC Cũ ' || g, 'new', 600 + g, 'hộp', 'quote', '2026-01-01', now()
      from generate_series(1, 201) g`;
    const ov = await createPackUow(db, "contracts", (tx, t) => suppliersRepo(tx, t)).system(
      A,
      (r) => r.overview(pid),
    );
    const saved = (ov as unknown as { saved: { supplier_name: string }[] }).saved;
    expect(saved).toHaveLength(200);
    expect(saved.map((s) => s.supplier_name)).toContain("NCC Còn dùng");
  });
});

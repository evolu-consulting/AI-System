// V2-H · RLS: `business_settings` (bảng mới) cách ly tenant; `service_customers` ĐỌC theo luật thấy M1 (quyết định V2-H, thay V2-D D11)
// mà gia hạn bởi người KHÔNG thấy HĐ cũ vẫn ghi được qua trigger (hàm SECURITY DEFINER dưới `contracts_sc`). Mức DB: `inPackAs`
// (role `contracts_rw` + tenant + người dùng, chế độ thấy `org` ở tenant A).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { inPackAs } from "@ai/test-kit/db";
import { failOf, product, type Sql, type World, world } from "../V2-B/_support/v2b";

let w: World;
beforeAll(async () => {
  w = await world({ ns: 2461 });
}, 180_000);
afterAll(async () => {
  await w?.stop();
});

const as = <R>(tenant: string, user: string, fn: (tx: Sql) => Promise<R>) =>
  inPackAs("contracts", tenant, user, fn);
const count = (tenant: string, user: string, table: string) =>
  as(tenant, user, async (tx) => {
    const [r] = await tx<
      { n: number }[]
    >`select count(*)::int as n from ${tx(`contracts.${table}`)}`;
    return r?.n ?? 0;
  });
const fv = (value: string) => ({ value, quote: "", verified: true, edited: true });

describe("V2-H · business_settings", () => {
  it("cách ly tenant: mỗi tenant chỉ thấy hàng của mình; ghi hàng của tenant khác ⇒ 42501", async () => {
    await w.sql`insert into contracts.business_settings (tenant_id, renewal_notice_days)
      values (${w.A}, 45), (${w.B}, 30)`;
    const days = (tenant: string, user: string) =>
      as(
        tenant,
        user,
        (tx) => tx<{ d: number }[]>`select renewal_notice_days as d
        from contracts.business_settings`,
      );
    expect((await days(w.A, w.u1)).map((r) => r.d)).toEqual([45]);
    expect((await days(w.B, w.b1)).map((r) => r.d)).toEqual([30]);
    const forge = await failOf(() =>
      as(
        w.B,
        w.b1,
        (tx) => tx`insert into contracts.business_settings (tenant_id, renewal_notice_days)
          values (${w.A}, 1)`,
      ),
    );
    expect(forge).toBe("42501");
    const moved = await as(
      w.B,
      w.b1,
      (tx) => tx`update contracts.business_settings set renewal_notice_days = 1
        where tenant_id = ${w.A}`,
    );
    expect(moved.count).toBe(0);
    const [a] = await w.sql<{ d: number }[]>`select renewal_notice_days as d
      from contracts.business_settings where tenant_id = ${w.A}`;
    expect(a?.d).toBe(45);
  });
});

describe("V2-H · service_customers theo luật thấy M1", () => {
  it("u1 thấy khách của HĐ mình, u2 không; u2 gia hạn (HĐ mới hạn sau) ⇒ dòng chuyển sang HĐ của u2, renewals 1", async () => {
    const p = await product(w.sql, w.A, { name: "Chữ ký số V2-H", grp: "service" });
    const sell = (
      id: string,
      end: string,
    ) => w.sql`update contracts.contracts set deal = 'sell', direction = 'sale', kind = 'contract',
        status = 'active', fields = coalesce(fields, '{}'::jsonb) || ${w.sql.json({
          buyer_name: fv("Khách Gia Hạn"),
          end_date: fv(end),
        })}
      where id = ${id}`;
    await sell(w.C1, "2027-01-31");
    await w.sql`insert into contracts.contract_items (tenant_id, contract_id, ord, name, product_id)
      values (${w.A}, ${w.C1}, 1, 'CKS 1 năm', ${p.id})`;
    expect(await count(w.A, w.u1, "service_customers")).toBe(1);
    expect(await count(w.A, w.u2, "service_customers")).toBe(0);
    expect(await count(w.A, w.boss, "service_customers")).toBe(1);
    expect(await count(w.B, w.b1, "service_customers")).toBe(0);

    await sell(w.C2, "2028-01-31");
    await as(
      w.A,
      w.u2,
      (
        tx,
      ) => tx`insert into contracts.contract_items (tenant_id, contract_id, ord, name, product_id)
        values (${w.A}, ${w.C2}, 1, 'CKS 1 năm', ${p.id})`,
    );
    const rows = await w.sql<{ c: string; prev: string | null; n: number }[]>`
      select contract_id::text as c, prev_contract_id::text as prev, renewals as n from contracts.service_customers
      where tenant_id = ${w.A} and product_id = ${p.id}`;
    expect(rows.map((r) => [r.c, r.prev, r.n])).toEqual([[w.C2, w.C1, 1]]);
    expect(await count(w.A, w.u2, "service_customers")).toBe(1);
    expect(await count(w.A, w.u1, "service_customers")).toBe(0);
  });
});

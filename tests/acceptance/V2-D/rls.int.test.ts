// V2-D · RLS + quyền của bảng mới (viết TRƯỚC code): `milestone_items` (SL từng dòng của mốc giao) theo luật thấy HĐ (M1, như
// `contract_items`); `service_customers` (khách đang dùng) cách ly tenant, thấy cả tenant như danh mục/tồn (V2-B D2), chỉ ghi được cho
// HĐ mình thấy, không xoá. Mức DB: `inPackAs` (role `contracts_rw` + tenant + người dùng, chế độ thấy `org` ở tenant A).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { inPackAs } from "@ai/test-kit/db";
import { failOf, product, type Sql, type World, world } from "../V2-B/_support/v2b";

let w: World;
beforeAll(async () => {
  w = await world({ ns: 2441 });
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

describe("V2-D · milestone_items theo luật thấy HĐ", () => {
  it("u1 thấy SL mốc của HĐ mình; u2 (ngang hàng, chế độ org) không thấy; tenant B không thấy", async () => {
    await w.sql`insert into contracts.milestone_items (tenant_id, contract_id, milestone_id, contract_item_id, qty)
      values (${w.A}, ${w.C1}, gen_random_uuid(), gen_random_uuid(), 5)`;
    expect(await count(w.A, w.u1, "milestone_items")).toBe(1);
    expect(await count(w.A, w.u2, "milestone_items")).toBe(0);
    expect(await count(w.A, w.boss, "milestone_items")).toBe(1);
    expect(await count(w.B, w.b1, "milestone_items")).toBe(0);
  });

  it("ghi SL mốc cho HĐ không thấy ⇒ 42501; dòng đã giao không sửa/xoá được", async () => {
    const ins = (user: string) =>
      failOf(() =>
        as(
          w.A,
          user,
          (tx) => tx`insert into contracts.milestone_items
            (tenant_id, contract_id, milestone_id, contract_item_id, qty) values
            (${w.A}, ${w.C1}, gen_random_uuid(), gen_random_uuid(), 1)`,
        ),
      );
    expect(await ins(w.u2)).toBe("42501");
    expect(await ins(w.u1)).toBeNull();
    const [m] = await w.sql<{ id: string }[]>`insert into contracts.milestone_items
        (tenant_id, contract_id, milestone_id, contract_item_id, qty, delivered)
      values (${w.A}, ${w.C1}, gen_random_uuid(), gen_random_uuid(), 3, 3) returning milestone_id::text as id`;
    const n = await as(w.A, w.u1, async (tx) => {
      const u =
        await tx`update contracts.milestone_items set delivered = 9 where milestone_id = ${m?.id as string}`;
      const d =
        await tx`delete from contracts.milestone_items where milestone_id = ${m?.id as string}`;
      return [u.count, d.count];
    });
    expect(n).toEqual([0, 0]);
  });
});

describe("V2-D · service_customers", () => {
  it("cách ly tenant; trong tenant thấy cả tenant (như danh mục SP)", async () => {
    const pA = await product(w.sql, w.A, { name: "DV có hạn RLS", grp: "service" });
    await w.sql`insert into contracts.service_customers (tenant_id, product_id, party_key, contract_id, expires_on)
      values (${w.A}, ${pA.id}, 'name:khach rls', ${w.C1}, current_date + 30)`;
    expect(await count(w.A, w.u1, "service_customers")).toBe(1);
    expect(await count(w.A, w.u2, "service_customers")).toBe(1);
    expect(await count(w.B, w.b1, "service_customers")).toBe(0);
  });

  it("ghi dòng khách cho HĐ mình không thấy ⇒ 42501; xoá ⇒ 42501 (chỉ thêm/sửa qua lưu HĐ)", async () => {
    const pA = await product(w.sql, w.A, { name: "DV có hạn RLS 2", grp: "service" });
    const forge = await failOf(() =>
      as(
        w.A,
        w.u2,
        (tx) => tx`insert into contracts.service_customers
          (tenant_id, product_id, party_key, contract_id) values (${w.A}, ${pA.id}, 'name:gia mao', ${w.C1})`,
      ),
    );
    expect(forge).toBe("42501");
    const steal = await failOf(() =>
      as(
        w.A,
        w.u2,
        (tx) => tx`update contracts.service_customers set contract_id = ${w.C1}
          where tenant_id = ${w.A}`,
      ),
    );
    expect(steal).toBe("42501");
    const del = await failOf(() =>
      as(w.A, w.boss, (tx) => tx`delete from contracts.service_customers where tenant_id = ${w.A}`),
    );
    expect(del).toBe("42501");
  });
});

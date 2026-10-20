// V2-A · Luật 4c: danh sách + chi tiết HĐ giữ SỐ CÂU SQL CỐ ĐỊNH khi thêm mốc/giai đoạn (không truy vấn theo từng HĐ/mốc); lệnh
// mốc = số câu cố định. Đếm câu pool hub gửi (trừ BEGIN/COMMIT/set_config phạm vi) — `captureSql` của HD1.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { captureSql } from "../HD1/_support/hd1";
import {
  arrangeV2a,
  type CtxN1,
  call,
  d,
  deal,
  ok,
  P,
  restoreApproval,
  startHd1,
} from "./_support/v2a";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  if (c) await restoreApproval(c.sql);
  await c?.stop();
});

/** n HĐ bán, mỗi HĐ k mốc (thêm thẳng DB, nhanh). */
async function seed(n: number, k: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await deal(c.sql, { sale: true }));
  if (k > 0)
    await c.sql`insert into contracts.obligations (tenant_id, contract_id, party_key, direction, kind, seq, due_date, title)
      select cc.tenant_id, cc.id, null, 'receive', 'payment', g, current_date + g, 'Thu ' || g
      from contracts.contracts cc, generate_series(1, ${k}::int) g where cc.id = any(${ids}::uuid[])`;
  return ids;
}
const count = async (fn: () => Promise<unknown>) => (await captureSql(c, fn)).queries.length;

describe("V2-A · số câu SQL cố định (Luật 4c)", () => {
  it("chi tiết: 0 mốc = 40 mốc = MỘT câu đọc", async () => {
    await arrangeV2a(c);
    const [a] = await seed(1, 0);
    const [b] = await seed(1, 40);
    const get = (id: string) => () => ok(call(c, P.hoa, "GET", `/contracts/${id}`));
    await get(a as string)(); // ấm (kế hoạch truy vấn, cache quyền)
    const na = await count(get(a as string));
    const nb = await count(get(b as string));
    expect({ na, nb }).toEqual({ na: 1, nb: 1 });
    const body = await get(b as string)();
    expect(body.milestones.length).toBe(40);
  });

  it("danh sách 20 HĐ × 0 mốc = 20 HĐ × 15 mốc = MỘT câu; `progress` đủ 20 dòng", async () => {
    await arrangeV2a(c);
    await seed(20, 0);
    const list = () => ok(call(c, P.hoa, "GET", "/contracts?page_size=20"));
    await list();
    const n0 = await count(list);
    await arrangeV2a(c);
    await seed(20, 15);
    const n1 = await count(list);
    expect({ n0, n1 }).toEqual({ n0: 1, n1: 1 });
    const page = await list();
    expect(page.progress.length).toBe(20);
    expect(page.progress.map((p: { id: string }) => p.id)).toEqual(
      page.items.map((i: { id: string }) => i.id),
    );
  });

  it("thêm / sửa / xoá một mốc = số câu cố định (khoá HĐ + khoá mốc + một CTE ghi)", async () => {
    await arrangeV2a(c);
    const [id] = await seed(1, 30);
    const add = () =>
      ok(call(c, P.hoa, "POST", `/contracts/${id}/milestones`, { kind: "other", due_date: d(2) }));
    await add();
    const cap = await captureSql(c, add);
    const m = cap.r as { id: string };
    const nPatch = await count(() =>
      ok(call(c, P.hoa, "PATCH", `/milestones/${m.id}`, { due_date: d(3) })),
    );
    const nDel = await count(() => call(c, P.hoa, "DELETE", `/milestones/${m.id}`));
    expect({ add: cap.queries.length, patch: nPatch, del: nDel }).toEqual({
      add: 2,
      patch: 3,
      del: 3,
    });
  });
});

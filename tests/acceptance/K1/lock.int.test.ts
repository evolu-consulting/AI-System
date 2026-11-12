// CR-097 K1 · HD-FR-100 khoá cứng sau xác nhận · HD-FR-104 owner mở lại có lý do + log · decision 1 chặn tạo HĐ nhập tay.
// Viết TRƯỚC code (làn đầy đủ: quyền, audit). Hạ tầng HD3 (hub-api THẬT, máy duyệt của gói, model giả). Người: A (editor + owner),
// B (editor), H (owner). Tenant acme bật duyệt (mặc định HD3); ca "tắt duyệt" đặt cờ rồi trả lại.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { insItem } from "../HD1/_support/hd1";
import { CBASE, type CtxHd3, cid, errCode, seedContract, startHd3, T } from "../HD3/_hd3";
import { PA } from "../P-d/_support/pd";

let c: CtxHd3;
beforeAll(async () => {
  c = await startHd3();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

type Lock = { status: string; locked_at: Date | null; locked_by: string | null; run_id: string };
const lockRow = async (id: string): Promise<Lock> =>
  (
    await c.sql<Lock[]>`select status, locked_at, locked_by, run_id::text as run_id
      from contracts.contracts where id = ${id}`
  )[0] as Lock;
const detail = async (id: string, r: "A" | "B" = "B") =>
  (await c.call(r, "GET", `${CBASE}/${id}`)).json;
const patch = async (r: "A" | "B", id: string, fields: Record<string, unknown>) =>
  c.call(r, "PATCH", `${CBASE}/${id}/fields`, { version: (await detail(id)).version, fields });
const _reopen = (r: "A" | "B" | "H", id: string, body: unknown) =>
  c.call(r, "POST", `${CBASE}/${id}/reopen`, body);

/** CR-127: HĐ acme ở DONE (đã khoá nội dung) — dựng thẳng (máy duyệt cũ level1 đã gỡ; luồng gửi duyệt kiểm ở submit.int/content-lock.int). */
async function confirmed(n: number): Promise<string> {
  const id = await seedContract(c, n, { status: "done" });
  await c.sql`update contracts.contracts set locked_at = now(), locked_by = ${PA.A.id} where id = ${id}`;
  return id;
}

// atomic-confirm (người dùng 2026-10-24): HĐ đã khoá ⇒ MỌI lời gọi product-links ⇒ 409 (kể cả gắn lần đầu). "Xác nhận và lưu" khi
// tắt duyệt gửi `products` trong POST /review (một tx) — xem atomic-confirm.int.test.ts.
describe("HD-FR-100 · gắn SP sau khoá (luồng 'Xác nhận và lưu' khi tắt duyệt, prod 2026-10-24)", () => {
  it("HĐ đã khoá: gắn SP lần đầu ⇒ 409 CONTRACT_LOCKED (không tạo SP); đổi SP đã gắn ⇒ 409 CONTRACT_LOCKED", async () => {
    const id = await confirmed(390);
    expect((await lockRow(id)).locked_at).not.toBeNull();
    const item = "e1000000-0000-4000-8000-000000000390";
    await insItem(c.sql, T.acme, id, 1, { id: item, name: "Thùng carton K1-390" });
    const url = `${CBASE}/${id}/product-links`;
    const first = await c.call("B", "POST", url, {
      links: [
        {
          item_id: item,
          new_product: { name: "Thùng carton K1-390", unit: "thùng", group: "goods" },
        },
      ],
    });
    expect({ status: first.status, code: errCode(first) }).toEqual({
      status: 409,
      code: "CONTRACT_LOCKED",
    });
    const [p] = await c.sql<
      { id: string | null }[]
    >`select product_id::text as id from contracts.contract_items
      where id = ${item}`;
    expect(p?.id ?? null).toBeNull();
    const [np] = await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.products
      where tenant_id = ${T.acme} and name = 'Thùng carton K1-390'`;
    expect(np?.n).toBe(0);
    // Dòng đã có SP (gắn trực tiếp ở DB) ⇒ đổi SP cũng 409.
    const [ex] = await c.sql<
      { id: string }[]
    >`insert into contracts.products (tenant_id, name, unit, grp)
      values (${T.acme}, 'SP có sẵn K1-390', 'cái', 'goods') returning id::text as id`;
    await c.sql`update contracts.contract_items set product_id = ${ex?.id as string} where id = ${item}`;
    const again = await c.call("B", "POST", url, {
      links: [
        { item_id: item, new_product: { name: "SP khác K1-390", unit: "cái", group: "goods" } },
      ],
    });
    expect({ status: again.status, code: errCode(again) }).toEqual({
      status: 409,
      code: "CONTRACT_LOCKED",
    });
  }, 90_000);
});

describe("HD-FR-100 · xác nhận = khoá", () => {
  it("đã khoá tuyệt đối (lock-strict): PATCH mọi trường (cả notice_days) ⇒ 409 CONTRACT_LOCKED; thêm mốc / sửa / xoá mốc / gắn HĐ gốc ⇒ 409; xác nhận xong mốc ⇒ 200", async () => {
    const id = await confirmed(302);
    for (const [r, f] of [
      ["A", { total_value: 900_000_000 }],
      ["B", { payment_terms: "30 ngày" }],
      ["B", { buyer_tax_id: "0101010101" }],
      ["B", { notice_days: 45 }],
    ] as const) {
      const res = await patch(r, id, f);
      expect({ f, status: res.status, code: errCode(res) }).toEqual({
        f,
        status: 409,
        code: "CONTRACT_LOCKED",
      });
    }
    expect((await lockRow(id)).status).toBe("done");
    // mốc: thêm / sửa / xoá bị khoá; xác nhận xong (settle) vẫn cho
    const [ob] = await c.sql<{ id: string }[]>`insert into contracts.obligations
      (tenant_id, contract_id, direction, kind, seq, due_date, amount, source)
      values (${T.acme}, ${id}, 'receive', 'payment', 1, '2026-12-01', 1000, 'manual') returning id`;
    const mid = ob?.id as string;
    const add = await c.call("B", "POST", `/pack/contracts/contracts/${id}/milestones`, {
      kind: "collect",
      due_date: "2026-12-31",
      amount: 5,
    });
    const edit = await c.call("B", "PATCH", `/pack/contracts/milestones/${mid}`, { amount: 7 });
    const del = await c.call("B", "DELETE", `/pack/contracts/milestones/${mid}`);
    // CR-127 X3: đổi giá trị mốc (PATCH amount) trên HĐ DONE ⇒ 409 USE_NEW_VERSION; thêm/xoá mốc ⇒ 409 CONTRACT_LOCKED.
    expect({ status: edit.status, code: errCode(edit) }).toEqual({
      status: 409,
      code: "USE_NEW_VERSION",
    });
    for (const r of [add, del])
      expect({ status: r.status, code: errCode(r) }).toEqual({
        status: 409,
        code: "CONTRACT_LOCKED",
      });
    const parent = await c.call("B", "PATCH", `${CBASE}/${id}/parent`, {
      version: (await detail(id)).version,
      parent_id: cid(303),
    });
    // CR-101a (Câu 5): gắn làm phụ lục đã ngừng cho MỌI HĐ ⇒ 410 USE_VERSIONS (trước kiểm khoá).
    expect({ status: parent.status, code: errCode(parent) }).toEqual({
      status: 410,
      code: "USE_VERSIONS",
    });
    const settle = await c.call("B", "POST", `/pack/contracts/obligations/${mid}/settle`, {});
    expect(settle.status).toBe(200);
  }, 90_000);
});
describe("HD-FR-104 · owner mở lại có lý do", () => {});

describe("lock-strict · Lưu nháp không xác nhận (tenant tắt duyệt)", () => {});
describe("decision 1 · chặn tạo HĐ nhập tay", () => {
  it("POST /contracts/manual ⇒ 410 MANUAL_CONTRACT_DISABLED, không tạo hàng", async () => {
    const [n0] = await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.contracts`;
    const r = await c.call("B", "POST", `${CBASE}/manual`, { title: "HĐ tay", partner_name: "ĐT" });
    expect({ status: r.status, code: errCode(r) }).toEqual({
      status: 410,
      code: "MANUAL_CONTRACT_DISABLED",
    });
    const [n1] = await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.contracts`;
    expect(n1?.n).toBe(n0?.n);
  }, 30_000);
});

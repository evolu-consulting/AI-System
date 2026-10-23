// HD-FR-33 · D3-02 · D3-14 · confirm-flow (lỗi production 2026-10-23): tenant BẬT duyệt, HĐ chờ xác nhận ở cấp 1, người tải lên
// (A: editor + owner) đổi "Loại hợp đồng" (bán ⇒ mua) + dòng hàng trên màn xác nhận rồi "Xác nhận và lưu" = `POST /review` (lưu ô đã
// đổi) ⇒ `POST /approval approve` kèm lựa chọn SP. Phải: GIỮ lượt duyệt đang mở (không mở lượt mới, không AI đọc lại), giá trị đánh giá
// lại lúc quyết ⇒ dưới ngưỡng: HĐ `active` + lượt `done` + SP gắn; từ ngưỡng: lượt `level2`, HĐ còn `needs_review`. Không bao giờ
// `extracting`. Chờ bằng tín hiệu; model giả (không AI thật).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  approval,
  approvalRow,
  CBASE,
  type CtxHd3,
  contractRow,
  errCode,
  seedContract,
  startHd3,
  toLevel1,
} from "./_hd3";

let c: CtxHd3;
beforeAll(async () => {
  c = await startHd3();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

const review = (id: string, body: Record<string, unknown>) =>
  c.call("A", "POST", `${CBASE}/${id}/review`, body);
const itemIds = async (id: string) =>
  (
    await c.sql<{ id: string }[]>`select id::text from contracts.contract_items
      where contract_id = ${id} order by ord`
  ).map((r) => r.id);

/** Màn xác nhận: đổi loại HĐ sang Mua + một dòng hàng (+ giá trị nếu có) — đúng như "Xác nhận và lưu" gửi trước khi duyệt. */
async function saveEdits(id: string, total?: number) {
  const { version } = (await contractRow(c, id)) as { version: number };
  const r = await review(id, {
    version,
    deal: "buy",
    items: [{ name: "Băng keo trong", unit: "cuộn", qty: 10, unit_price: 5_000 }],
    ...(total === undefined ? {} : { fields: { total_value: total } }),
  });
  expect({ status: r.status, code: errCode(r), out: r.json?.status }).toEqual({
    status: 200,
    code: null,
    out: "needs_review",
  });
}

describe("confirm-flow · sửa ở cấp 1 rồi Xác nhận giữ lượt duyệt đang mở", () => {
  it("đổi loại HĐ + dòng ⇒ approve kèm SP ⇒ HĐ active, lượt done, SP gắn; không lượt mới, không AI đọc lại", async () => {
    const id = await seedContract(c, 41);
    const { runId } = await toLevel1(c, id, 50_000);
    const calls = c.model.calls.length;
    await saveEdits(id);
    // Lưu ô ở cấp 1 KHÔNG mở lại lượt / đọc lại.
    expect((await contractRow(c, id)).run_id).toBe(runId);
    expect((await approval(c, "A", id)).json).toMatchObject({
      run_id: runId,
      step: "level1",
      can_act: true,
      finalizes_on_approve: true,
    });
    const [item] = await itemIds(id);
    const r = await c.call("A", "POST", `${CBASE}/${id}/approval`, {
      action: "approve",
      products: [{ item_id: item, new_product: { name: "Băng keo trong", group: "goods" } }],
    });
    expect({ status: r.status, code: errCode(r), step: r.json?.step }).toEqual({
      status: 200,
      code: null,
      step: "done",
    });
    const row = await contractRow(c, id);
    expect({ status: row.status, run: row.run_id }).toEqual({ status: "active", run: runId });
    expect((await approvalRow(c, runId)).status).toBe("done");
    const [{ linked }] = (await c.sql<{ linked: number }[]>`select count(*)::int as linked
      from contracts.contract_items where contract_id = ${id} and product_id is not null`) as [
      { linked: number },
    ];
    expect(linked).toBe(1);
    expect(c.model.calls.length).toBe(calls);
    // Bấm lại (double submit) ⇒ 409 rõ ràng, không đổi gì.
    const again = await c.call("A", "POST", `${CBASE}/${id}/approval`, { action: "approve" });
    expect({ status: again.status, code: errCode(again) }).toEqual({
      status: 409,
      code: "APPROVAL_NOT_OPEN",
    });
    expect((await contractRow(c, id)).status).toBe("active");
  }, 60_000);

  it("sửa giá trị lên ≥ ngưỡng ở cấp 1 ⇒ approve ⇒ lượt level2 (cùng lượt), HĐ needs_review, không extracting", async () => {
    const id = await seedContract(c, 42);
    const { runId } = await toLevel1(c, id, 50_000);
    const calls = c.model.calls.length;
    await saveEdits(id, 900_000_000);
    const r = await c.call("A", "POST", `${CBASE}/${id}/approval`, { action: "approve" });
    expect({ status: r.status, code: errCode(r), step: r.json?.step }).toEqual({
      status: 200,
      code: null,
      step: "level2",
    });
    const row = await contractRow(c, id);
    expect({ status: row.status, run: row.run_id }).toEqual({
      status: "needs_review",
      run: runId,
    });
    expect((await approvalRow(c, runId)).status).toBe("level2");
    expect(c.model.calls.length).toBe(calls);
  }, 60_000);
});

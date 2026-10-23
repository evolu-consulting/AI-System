// CR-097 K1 · HD-FR-100 khoá cứng sau xác nhận · HD-FR-104 owner mở lại có lý do + log · decision 1 chặn tạo HĐ nhập tay.
// Viết TRƯỚC code (làn đầy đủ: quyền, audit). Hạ tầng HD3 (hub-api THẬT, máy duyệt của gói, model giả). Người: A (editor + owner),
// B (editor), H (owner). Tenant acme bật duyệt (mặc định HD3); ca "tắt duyệt" đặt cờ rồi trả lại.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { insContract } from "../HD1/_support/hd1";
import {
  act,
  CBASE,
  type CtxHd3,
  cid,
  errCode,
  seedContract,
  startHd3,
  T,
  toLevel1,
} from "../HD3/_hd3";
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
const reopen = (r: "A" | "B" | "H", id: string, body: unknown) =>
  c.call(r, "POST", `${CBASE}/${id}/reopen`, body);

/** HĐ acme đi qua duyệt (bật duyệt) tới "Đã duyệt" — cấp 1 B, dưới ngưỡng ⇒ xong một bước. */
async function confirmed(n: number): Promise<string> {
  const id = await seedContract(c, n);
  await toLevel1(c, id, 245_000_000);
  expect((await act(c, "B", id, "approve")).status).toBe(200);
  return id;
}

describe("HD-FR-100 · xác nhận = khoá", () => {
  it("bật duyệt: duyệt xong ⇒ locked_at/locked_by; DTO locked + has_document=false (không tệp)", async () => {
    const id = await confirmed(300);
    const row = await lockRow(id);
    expect({ status: row.status, at: row.locked_at !== null, by: row.locked_by }).toEqual({
      status: "active",
      at: true,
      by: PA.B.id,
    });
    const d = await detail(id);
    expect({
      locked: d.locked,
      by: d.locked_by,
      at: typeof d.locked_at,
      doc: d.has_document,
    }).toEqual({ locked: true, by: PA.B.id, at: "string", doc: false });
    const list = (await c.call("B", "GET", `${CBASE}?page_size=100`)).json;
    expect(list.items.find((x: { id: string }) => x.id === id)?.locked).toBe(true);
  }, 90_000);

  it("tắt duyệt: editor bấm Lưu (xác nhận) ⇒ active + khoá ngay", async () => {
    const [had] = await c.sql<{ v: boolean | null }[]>`select approval_enabled as v
      from contracts.approval_settings where tenant_id = ${T.acme}`;
    await c.sql`insert into contracts.approval_settings (tenant_id, approval_enabled) values (${T.acme}, false)
      on conflict (tenant_id) do update set approval_enabled = false`;
    try {
      const id = cid(301);
      await insContract(c.sql, {
        id,
        tenant: T.acme,
        status: "needs_review",
        createdBy: PA.B.id,
        owner: PA.B.id,
      } as never);
      const r = await c.call("B", "POST", `${CBASE}/${id}/review`, { version: 1 });
      expect({ status: r.status, s: r.json?.status }).toEqual({ status: 200, s: "active" });
      const row = await lockRow(id);
      expect({ at: row.locked_at !== null, by: row.locked_by }).toEqual({ at: true, by: PA.B.id });
    } finally {
      await c.sql`update contracts.approval_settings set approval_enabled = ${had?.v ?? null}
        where tenant_id = ${T.acme}`;
    }
  }, 60_000);

  it("đã khoá: PATCH trường pháp lý ⇒ 409 CONTRACT_LOCKED cho cả owner; trường vận hành (notice_days) ⇒ 200", async () => {
    const id = await confirmed(302);
    for (const [r, f] of [
      ["A", { total_value: 900_000_000 }],
      ["B", { payment_terms: "30 ngày" }],
      ["B", { buyer_tax_id: "0101010101" }],
    ] as const) {
      const res = await patch(r, id, f);
      expect({ f, status: res.status, code: errCode(res) }).toEqual({
        f,
        status: 409,
        code: "CONTRACT_LOCKED",
      });
    }
    expect((await patch("B", id, { notice_days: 45 })).status).toBe(200);
    expect((await lockRow(id)).status).toBe("active");
  }, 90_000);
});

describe("HD-FR-104 · owner mở lại có lý do", () => {
  it("editor ⇒ 403; owner thiếu lý do ⇒ 400; owner + lý do ⇒ Chờ duyệt, mở khoá, log; mở lại lần nữa ⇒ 409; duyệt lại ⇒ khoá lại", async () => {
    const id = await confirmed(310);
    const before = await lockRow(id);
    const ed = await reopen("B", id, { reason: "sai số tiền" });
    expect(ed.status).toBe(403);
    expect((await lockRow(id)).locked_at).not.toBeNull();
    expect((await reopen("A", id, {})).status).toBe(400);
    expect((await reopen("A", id, { reason: "   " })).status).toBe(400);

    const r = await reopen("A", id, { reason: "Sai số tiền trên hợp đồng" });
    expect({ status: r.status, s: r.json?.status, locked: r.json?.locked }).toEqual({
      status: 200,
      s: "needs_review",
      locked: false,
    });
    const row = await lockRow(id);
    expect({ s: row.status, at: row.locked_at, by: row.locked_by }).toEqual({
      s: "needs_review",
      at: null,
      by: null,
    });
    expect(row.run_id).not.toBe(before.run_id); // lượt duyệt mới (bật duyệt)
    const ev = await c.sql<{ actor: string; reason: string }[]>`select actor_user_id::text as actor,
        data->>'reason' as reason from contracts.contract_events where contract_id = ${id} and type = 'reopened'`;
    expect([...ev]).toEqual([{ actor: PA.A.id, reason: "Sai số tiền trên hợp đồng" }]);
    const again = await reopen("A", id, { reason: "lần hai" });
    expect({ status: again.status, code: errCode(again) }).toEqual({
      status: 409,
      code: "CONTRACT_NOT_LOCKED",
    });
    // Sửa được khi đã mở lại, rồi duyệt lại ⇒ khoá lại.
    expect((await patch("B", id, { payment_terms: "45 ngày" })).status).toBe(200);
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    const re = await lockRow(id);
    expect({ s: re.status, locked: re.locked_at !== null }).toEqual({ s: "active", locked: true });
  }, 90_000);

  it("cách ly tenant: owner acme mở lại HĐ của beta ⇒ 404, HĐ beta không đổi", async () => {
    const id = cid(320);
    await insContract(c.sql, { id, tenant: T.beta, status: "active" } as never);
    expect((await lockRow(id)).locked_at).not.toBeNull(); // HĐ đã xác nhận luôn khoá (trigger)
    const r = await reopen("A", id, { reason: "thử" });
    expect(r.status).toBe(404);
    expect((await lockRow(id)).status).toBe("active");
  }, 30_000);
});

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

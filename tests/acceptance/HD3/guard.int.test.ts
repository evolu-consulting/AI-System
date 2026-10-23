// Review HD3 S1 · M1 · M2(a) · m4 · M3-decouple (luật giữ nguyên, kiểm trên máy trạng thái của gói): (1) CR-097 K1 thay D3-13: HĐ
// "Đã duyệt" bị khoá — sửa trường ⇒ 409 CONTRACT_LOCKED (owner mở lại: tests/acceptance/K1); (2) HĐ đang ở cấp 2 ⇒ PATCH `total_value`
// 409 CONTRACT_IN_APPROVAL (ở cấp 1 vẫn sửa được — D3-02); (3) finalize đánh giá lại ngưỡng TRONG câu UPDATE: chưa qua cấp 2 mà
// giá trị ≥ ngưỡng ⇒ không "Đã duyệt"; (4) đổi cài đặt duyệt ⇒ nhật ký trước/sau/người/lúc; (5) AC37b đổi Group cấp 2 ⇒ người
// duyệt cấp 2 theo Group mới; (6) lỗi kỹ thuật lượt AI ⇒ `extract_failed`, không "Bị từ chối".
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Db } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { approvalRepo } from "../../../apps/hub-api/src/modules/packs/contracts/adapters/approval.repo";
import { PA } from "../P-d/_support/pd";
import {
  act,
  approval,
  approvalRow,
  bump,
  CBASE,
  type CtxHd3,
  contractRow,
  errCode,
  seedContract,
  startHd3,
  T,
  toLevel1,
} from "./_hd3";

let c: CtxHd3;
beforeAll(async () => {
  c = await startHd3();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

const patch = async (id: string, fields: Record<string, unknown>) => {
  const d = (await c.call("B", "GET", `${CBASE}/${id}`)).json;
  return c.call("B", "PATCH", `${CBASE}/${id}/fields`, { version: d.version, fields });
};
const settings = (body: Record<string, unknown>) =>
  c.call("A", "PUT", "/pack/contracts/approval-settings", body);

describe("review S1 · sửa trường không lách cấp 2", () => {
  it("CR-097 K1 (thay D3-13) · HĐ Đã duyệt sửa total_value / payment_terms ⇒ 409 CONTRACT_LOCKED; vẫn Đã duyệt, lượt cũ, không event", async () => {
    const id = await seedContract(c, 100);
    const { runId } = await toLevel1(c, id, 245_000_000);
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    expect((await contractRow(c, id)).status).toBe("active");
    for (const f of [{ total_value: 900_000_000 }, { payment_terms: "Thanh toán 30 ngày" }]) {
      const r = await patch(id, f);
      expect({ f, status: r.status, code: errCode(r) }).toEqual({
        f,
        status: 409,
        code: "CONTRACT_LOCKED",
      });
    }
    expect(await contractRow(c, id)).toMatchObject({ status: "active", run_id: runId });
    expect(await approvalRow(c, runId)).toMatchObject({ status: "done", decided_by: PA.B.id });
    const [ev] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.contract_events
      where contract_id = ${id} and type = 'field_edited'`;
    expect(ev?.n).toBe(0);
  }, 90_000);
  it("đang chờ cấp 2: PATCH total_value ⇒ 409 CONTRACT_IN_APPROVAL; ở cấp 1 ⇒ 200 (D3-02)", async () => {
    const id = await seedContract(c, 101);
    await toLevel1(c, id, 600_000_000);
    expect((await patch(id, { total_value: 650_000_000 })).status).toBe(200);
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    expect((await approval(c, "H", id)).json?.step).toBe("level2");
    const r = await patch(id, { total_value: 100_000_000 });
    expect({ status: r.status, code: errCode(r) }).toEqual({
      status: 409,
      code: "CONTRACT_IN_APPROVAL",
    });
  }, 60_000);

  it("D3-14 · finalize đọc lại TRONG câu UPDATE: 600 tr chưa qua cấp 2 ⇒ 0 hàng, HĐ không Đã duyệt, lượt không done", async () => {
    const id = await seedContract(c, 102);
    const { runId } = await toLevel1(c, id, 600_000_000);
    // Đường lách: gọi finalize như thể cấp 2 đã bị bỏ qua (giả lập lỗi rẽ nhánh / giá trị đổi sau rẽ).
    const ok = await withPackScope(
      c.hub.db as unknown as Db,
      { packKey: "contracts", tenantId: T.acme, userId: PA.B.id },
      (tx) => approvalRepo(tx, T.acme).finalize(id, runId, PA.B.id, false),
    );
    expect(ok).toBe(false);
    expect((await contractRow(c, id)).status).toBe("needs_review");
    expect((await approvalRow(c, runId)).status).toBe("level1");
    // Đường thật: Xác nhận cấp 1 ⇒ chuyển cấp 2, không "Đã duyệt".
    expect((await act(c, "B", id, "approve")).json?.step).toBe("level2");
    expect((await contractRow(c, id)).status).toBe("needs_review");
  }, 60_000);
});

describe("review M1 · M2(a) · cài đặt duyệt", () => {
  it("M1 · nâng ngưỡng ⇒ nhật ký before/after + người + lúc", async () => {
    const r = await settings({ threshold: 700_000_000 });
    expect(r.status).toBe(200);
    const rows = await c.sql<
      {
        actor_user_id: string;
        before: { threshold: number };
        after: { threshold: number };
        at: Date;
      }[]
    >`
      select actor_user_id, before, after, at from contracts.approval_settings_audit
      where tenant_id = ${T.acme} order by id desc limit 1`;
    expect(rows[0]).toMatchObject({
      actor_user_id: PA.A.id,
      before: { threshold: 500_000_000 },
      after: { threshold: 700_000_000 },
    });
    expect(rows[0]?.at instanceof Date).toBe(true);
    expect((await settings({ threshold: 500_000_000 })).status).toBe(200);
  }, 60_000);

  it("AC37b · đổi Group cấp 2 ⇒ người duyệt cấp 2 theo Group MỚI (owner cũ hết quyền); Group không có ⇒ 422", async () => {
    const missing = await settings({ level2_group_key: "khong-co-group" });
    expect({ status: missing.status, code: errCode(missing) }).toEqual({
      status: 422,
      code: "APPROVAL_GROUP_MISSING",
    });
    const [g] = await c.sql<{ id: string }[]>`insert into admin.groups (tenant_id, key, name)
      values (${T.acme}, 'ban-giam-doc', ${c.sql.json({ vi: "Ban giám đốc", en: "Board" })}) returning id`;
    await c.sql`insert into admin.group_members (tenant_id, group_id, user_id)
      values (${T.acme}, ${g?.id as string}, ${PA.B.id})`;
    await bump(c);
    const r = await settings({ level2_group_key: "ban-giam-doc" });
    expect({ status: r.status, key: r.json?.level2_group_key }).toEqual({
      status: 200,
      key: "ban-giam-doc",
    });
    try {
      const id = await seedContract(c, 104);
      await toLevel1(c, id, 600_000_000);
      expect((await act(c, "B", id, "approve")).status).toBe(200);
      expect((await approval(c, "H", id)).json).toMatchObject({ step: "level2", can_act: false });
      const h = await act(c, "H", id, "approve");
      expect({ status: h.status, code: errCode(h) }).toEqual({ status: 403, code: "NOT_REVIEWER" });
      // B đã xác nhận cấp 1 nhưng không phải người bắt đầu (A) ⇒ được duyệt cấp 2 theo Group mới.
      expect((await approval(c, "B", id)).json).toMatchObject({ step: "level2", can_act: true });
      expect((await act(c, "B", id, "approve")).json?.step).toBe("done");
    } finally {
      expect((await settings({ level2_group_key: "contracts-owner" })).status).toBe(200);
    }
  }, 60_000);
});

describe("review m4 · lỗi kỹ thuật ≠ Bị từ chối", () => {
  it("model lỗi ⇒ HĐ extract_failed AGENT_FAILED, lượt failed (bước cancelled, không rejected)", async () => {
    const id = await seedContract(c, 105);
    c.model.reply = { ok: false };
    const done = c.extracted(id);
    expect((await c.call("A", "POST", `${CBASE}/${id}/extract`)).status).toBe(202);
    expect(await done).toBe("extract_failed");
    const row = await contractRow(c, id);
    expect({ status: row.status, error: row.error }).toEqual({
      status: "extract_failed",
      error: "AGENT_FAILED",
    });
    expect((await approvalRow(c, row.run_id as string)).status).toBe("failed");
    expect((await approval(c, "B", id)).json).toMatchObject({ step: "cancelled", can_act: false });
  }, 60_000);
});

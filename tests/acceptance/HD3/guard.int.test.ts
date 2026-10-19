// Review HD3 S1 (hard stop) · M1 · M2(a) · m4: (1) D3-13 (người dùng chốt 2026-10-19): HĐ "Đã duyệt" sửa trường tiền ⇒ mở lại
// duyệt (run mới, không còn "Đã duyệt"); trường khác không mở lại; (2) HĐ đang trong flow sau cấp 1 ⇒ PATCH `total_value`
// 409 CONTRACT_IN_APPROVAL (ở cấp 1 vẫn sửa được — D3-02); (3) `contracts-finalize` đọc lại giá trị + ngưỡng: cần cấp 2 mà run không
// có Đạt ở stage `approve` ⇒ không ghi "Đã duyệt"; (4) đổi cài đặt duyệt ⇒ nhật ký trước/sau/người/lúc; (5) AC37b đổi Group cấp 2 ⇒
// def `approve.after.group_id` = Group mới, sửa tay khác của def giữ nguyên; (6) run `failed` ⇒ HĐ `extract_failed FLOW_FAILED`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PA, waitStatus } from "../P-d/_support/pd";
import {
  act,
  approval,
  CBASE,
  type CtxHd3,
  contractRow,
  errCode,
  seedContract,
  settled,
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
  it("D3-13 · HĐ Đã duyệt 245 tr sửa thành 900 tr ⇒ 200, về chờ duyệt, run mới (cấp 1 rồi BẮT BUỘC cấp 2); lịch sử duyệt cũ giữ", async () => {
    const id = await seedContract(c, 100);
    const { runId } = await toLevel1(c, id, 245_000_000);
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    await settled(c);
    await waitStatus(c.sql, runId, "done");
    expect((await contractRow(c, id)).status).toBe("active");
    const r = await patch(id, { total_value: 900_000_000 });
    expect(r.status).toBe(200);
    await settled(c);
    const row = await contractRow(c, id);
    expect({
      status: row.status,
      confirmed: row.confirmed_at,
      newRun: row.run_id !== runId && row.run_id !== null,
    }).toEqual({ status: "needs_review", confirmed: null, newRun: true });
    expect((await approval(c, "B", id)).json).toMatchObject({ step: "level1", can_act: true });
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    await settled(c);
    expect((await approval(c, "H", id)).json).toMatchObject({ step: "level2", can_act: true });
    expect((await contractRow(c, id)).status).toBe("needs_review"); // chưa "Đã duyệt" tới khi run mới xong
    const ev = await c.sql<{ type: string; reopened: boolean | null }[]>`select type,
        (data->>'approval_reopened')::boolean as reopened from contracts.contract_events
      where contract_id = ${id} and type in ('approved', 'field_edited', 'approval_started') order by id`;
    expect(ev.map((e) => [e.type, e.reopened])).toEqual([
      ["approval_started", null],
      ["approved", null],
      ["field_edited", true],
      ["approval_started", null],
    ]);
  }, 90_000);

  it("D3-13 · HĐ Đã duyệt sửa trường không phải tiền (payment_terms) ⇒ 200, vẫn active, không mở lại", async () => {
    const id = await seedContract(c, 106);
    const { runId } = await toLevel1(c, id, 245_000_000);
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    await settled(c);
    await waitStatus(c.sql, runId, "done");
    expect((await patch(id, { payment_terms: "Thanh toán 30 ngày" })).status).toBe(200);
    expect(await contractRow(c, id)).toMatchObject({ status: "active", run_id: runId });
  }, 90_000);
  it("đang chờ cấp 2: PATCH total_value ⇒ 409 CONTRACT_IN_APPROVAL; ở cấp 1 ⇒ 200 (D3-02)", async () => {
    const id = await seedContract(c, 101);
    await toLevel1(c, id, 600_000_000);
    expect((await patch(id, { total_value: 650_000_000 })).status).toBe(200);
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    await settled(c);
    expect((await approval(c, "H", id)).json?.step).toBe("level2");
    const r = await patch(id, { total_value: 100_000_000 });
    expect({ status: r.status, code: errCode(r) }).toEqual({
      status: 409,
      code: "CONTRACT_IN_APPROVAL",
    });
  }, 60_000);

  it("finalize đọc lại: def bị sửa bỏ cấp 2 (rẽ luôn) mà HĐ 600 tr ⇒ không Đã duyệt, run không done", async () => {
    // Admin sửa def: rẽ nhánh luôn bỏ cấp 2 (level2 ≠ "zzz") — finalize phải tự chặn.
    const id0 = await seedContract(c, 102);
    await toLevel1(c, id0, 1); // bảo đảm def đã được dựng
    await c.sql`update hub.process_defs set stages = jsonb_set(stages, '{1,after,branch,0}',
        '{"field":"level2","op":"ne","value":"zzz","goto_step":3}'::jsonb), version = version + 1
      where tenant_id = ${T.acme} and key = 'contracts-approval' and deleted_at is null`;
    const id = await seedContract(c, 103);
    const { runId } = await toLevel1(c, id, 600_000_000);
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    await settled(c);
    expect((await contractRow(c, id)).status).toBe("needs_review");
    const [run] = await c.sql<
      { status: string }[]
    >`select status from hub.process_runs where id = ${runId}`;
    expect(run?.status).not.toBe("done");
    // khôi phục def theo gói (đồng bộ Group) cho ca sau
    await c.sql`update hub.process_defs set stages = jsonb_set(stages, '{1,after,branch,0}',
        '{"field":"level2","op":"eq","value":"no","goto_step":3}'::jsonb), version = version + 1
      where tenant_id = ${T.acme} and key = 'contracts-approval' and deleted_at is null`;
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

  it("AC37b · đổi Group cấp 2 ⇒ def approve.after.group_id = Group mới; tên def sửa tay giữ nguyên", async () => {
    const id = await seedContract(c, 104);
    await toLevel1(c, id, 1);
    const [g] = await c.sql<{ id: string }[]>`insert into admin.groups (tenant_id, key, name)
      values (${T.acme}, 'ban-giam-doc', ${c.sql.json({ vi: "Ban giám đốc", en: "Board" })}) returning id`;
    await c.sql`update hub.process_defs set name = 'Duyệt HĐ (sửa tay)'
      where tenant_id = ${T.acme} and key = 'contracts-approval' and deleted_at is null`;
    const r = await settings({ level2_group_key: "ban-giam-doc" });
    expect(r.status).toBe(200);
    const [d] = await c.sql<{ name: string; g: string }[]>`select name,
        stages->2->'after'->>'group_id' as g from hub.process_defs
      where tenant_id = ${T.acme} and key = 'contracts-approval' and deleted_at is null`;
    expect(d).toEqual({ name: "Duyệt HĐ (sửa tay)", g: g?.id as string });
    expect((await settings({ level2_group_key: "contracts-owner" })).status).toBe(200);
  }, 60_000);
});

describe("review m4 · run lỗi kỹ thuật ≠ Bị từ chối", () => {
  it("run failed ⇒ quét ⇒ HĐ extract_failed FLOW_FAILED (không rejected)", async () => {
    const id = await seedContract(c, 105);
    const { runId } = await toLevel1(c, id, 1);
    await c.sql`update hub.process_runs set status = 'failed' where id = ${runId}`;
    await c.sweepOnce();
    expect(await contractRow(c, id)).toMatchObject({
      status: "extract_failed",
      error: "FLOW_FAILED",
    });
  }, 60_000);
});

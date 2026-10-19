// HD3 security re-verify (5cf3286d) · M3-decouple (luật giữ nguyên trên máy trạng thái của gói): (1) Medium TOCTOU — PATCH cấp 1
// giữ khoá hàng và nâng `total_value` lên 900 tr trong lúc `finalize` chạy ⇒ finalize chờ khoá rồi đánh giá lại điều kiện cấp 2
// trên hàng mới ⇒ 0 hàng, HĐ KHÔNG "Đã duyệt"; (2) Low — mở lại duyệt (D3-13) không bao giờ để HĐ mồ côi: lượt mới mở TRONG cùng tx
// với PATCH (lỗi ⇒ cả PATCH rollback); (3) Low — quyết cấp 2 hợp lệ của người KHÁC người bắt đầu được tính là đã qua cấp 2, để
// finalize không từ chối nhầm HĐ ≥ ngưỡng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Db } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { approvalRepo } from "../../../apps/hub-api/src/modules/packs/contracts/adapters/approval.repo";
import { insContract } from "../HD1/_support/hd1";
import { PA, waitFor } from "../P-d/_support/pd";
import {
  act,
  approval,
  approvalRow,
  CBASE,
  type CtxHd3,
  cid,
  contractRow,
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

const total = (v: number) =>
  c.sql.json({ total_value: { value: v, quote: "", verified: false, edited: true } });

describe("re-verify Medium · TOCTOU finalize ↔ PATCH", () => {
  it("PATCH giữ khoá hàng nâng 245 → 900 tr; finalize (chưa Đạt cấp 2) chờ khoá rồi 0 hàng ⇒ HĐ vẫn needs_review", async () => {
    const run = crypto.randomUUID();
    await insContract(c.sql, {
      id: cid(200),
      tenant: T.acme,
      status: "needs_review",
      createdBy: PA.A.id,
      fields: { total_value: { value: 245_000_000, quote: "", verified: false, edited: false } },
    } as never);
    await c.sql`update contracts.contracts set run_id = ${run} where id = ${cid(200)}`;
    const finalize = () =>
      withPackScope(
        c.hub.db as unknown as Db,
        { packKey: "contracts", tenantId: T.acme, userId: PA.A.id },
        (tx) => approvalRepo(tx, T.acme).finalize(cid(200), run, PA.B.id, false),
      );
    let done: Promise<boolean> | null = null;
    await c.sql.begin(async (tx) => {
      await tx`select id from contracts.contracts where id = ${cid(200)} for update`;
      await tx`update contracts.contracts set fields = ${total(900_000_000)} where id = ${cid(200)}`;
      done = finalize();
      // Tín hiệu: phiên finalize đang CHỜ khoá hàng (không đoán giờ).
      const waiting = await waitFor(
        async () =>
          (
            await c.sql<{ n: number }[]>`select count(*)::int as n from pg_stat_activity
              where wait_event_type = 'Lock' and query ilike '%update contracts.contracts c set status%'`
          )[0]?.n ?? 0,
        (n) => n > 0,
        10_000,
      );
      expect(waiting).toBeGreaterThan(0);
    });
    expect(await (done as unknown as Promise<boolean>)).toBe(false);
    expect((await contractRow(c, cid(200))).status).toBe("needs_review");
    // đối chứng: giá trị dưới ngưỡng ⇒ finalize ghi
    await c.sql`update contracts.contracts set fields = ${total(245_000_000)} where id = ${cid(200)}`;
    expect(await finalize()).toBe(true);
  }, 60_000);
});

describe("re-verify Low · mở lại duyệt không mồ côi (D3-13)", () => {
  it("mở lượt mới lỗi giữa chừng ⇒ PATCH rollback (HĐ vẫn Đã duyệt, lượt cũ); hết lỗi ⇒ PATCH mở lượt cấp 1 do người sửa (B) bắt đầu", async () => {
    const id = await seedContract(c, 201);
    const { runId } = await toLevel1(c, id, 245_000_000);
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    const d = (await c.call("B", "GET", `${CBASE}/${id}`)).json;
    const body = { version: d.version, fields: { total_value: 900_000_000 } };
    // Giả lập lỗi khi mở lượt duyệt mới (chèn hàng `approvals` hỏng).
    await c.sql.unsafe(`create or replace function contracts.m3_boom() returns trigger language plpgsql
      as $$ begin raise exception 'm3 boom'; end $$`);
    await c.sql.unsafe(
      "create trigger m3_boom before insert on contracts.approvals for each row execute function contracts.m3_boom()",
    );
    try {
      const bad = await c.call("B", "PATCH", `${CBASE}/${id}/fields`, body);
      expect(bad.status).toBe(500);
      expect(await contractRow(c, id)).toMatchObject({ status: "active", run_id: runId });
    } finally {
      await c.sql.unsafe("drop trigger if exists m3_boom on contracts.approvals");
    }
    const p = await c.call("B", "PATCH", `${CBASE}/${id}/fields`, body);
    expect(p.status).toBe(200);
    const row = await contractRow(c, id);
    expect({
      hasRun: row.run_id !== null,
      fresh: row.run_id !== runId,
      status: row.status,
    }).toEqual({ hasRun: true, fresh: true, status: "needs_review" });
    expect((await approvalRow(c, row.run_id as string)).started_by).toBe(PA.B.id);
    expect((await approval(c, "H", id)).json?.step).toBe("level1");
  }, 90_000);
});

describe("re-verify Low · quyết cấp 2 hợp lệ được tính là đã qua cấp 2", () => {
  it("600 tr: B xác nhận cấp 1, H (không phải người bắt đầu) duyệt cấp 2 ⇒ finalize ghi Đã duyệt dù ≥ ngưỡng", async () => {
    const id = await seedContract(c, 202);
    const { runId } = await toLevel1(c, id, 600_000_000);
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    expect((await approval(c, "H", id)).json?.step).toBe("level2");
    expect((await act(c, "H", id, "approve")).json?.step).toBe("done");
    expect(await contractRow(c, id)).toMatchObject({ status: "active", confirmed_by: PA.H.id });
    expect(await approvalRow(c, runId)).toMatchObject({ status: "done", decided_by: PA.H.id });
  }, 60_000);
});

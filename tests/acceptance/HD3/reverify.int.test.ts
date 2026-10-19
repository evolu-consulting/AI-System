// HD3 security re-verify (5cf3286d): (1) Medium TOCTOU — PATCH cấp 1 giữ khoá hàng và nâng `total_value` lên 900 tr trong lúc
// `finalize` chạy ⇒ finalize chờ khoá rồi đánh giá lại điều kiện cấp 2 trên hàng mới ⇒ 0 hàng, HĐ KHÔNG "Đã duyệt"; (2) Low —
// mở lại duyệt (D3-13) mà run mới không mở được ⇒ vòng quét mở lại run thay người sửa; (3) Low — `passedStages` tính cả
// `use_current` hợp lệ ở task decision của stage cấp 2 (người KHÁC người bắt đầu), để finalize không từ chối nhầm.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Db } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { approvalRepo } from "../../../apps/hub-api/src/modules/packs/contracts/adapters/approval.repo";
import { packRunsHd3 } from "../../../apps/hub-api/src/modules/processes/runs/pack-runs-hd3";
import { insContract } from "../HD1/_support/hd1";
import { PA, waitFor, waitStatus } from "../P-d/_support/pd";
import {
  act,
  approval,
  CBASE,
  type CtxHd3,
  cid,
  contractRow,
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

describe("re-verify Low · mở lại duyệt mồ côi", () => {
  it("D3-13 mở lại nhưng run mới mất (giả lập lỗi) ⇒ quét mở lại run thay người sửa (B)", async () => {
    const id = await seedContract(c, 201);
    const { runId } = await toLevel1(c, id, 245_000_000);
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    await settled(c);
    await waitStatus(c.sql, runId, "done");
    const d = (await c.call("B", "GET", `${CBASE}/${id}`)).json;
    // Làm run mới KHÔNG mở được lúc mở lại duyệt: tắt def tạm thời (start ⇒ 404 PROCESS_NOT_FOUND).
    const def = c.sql`update hub.process_defs set enabled = ${false}
      where tenant_id = ${T.acme} and key = 'contracts-approval' and deleted_at is null`;
    await def;
    const p = await c.call("B", "PATCH", `${CBASE}/${id}/fields`, {
      version: d.version,
      fields: { total_value: 900_000_000 },
    });
    expect(p.status).toBe(200); // PATCH đã COMMIT; lỗi mở run không làm hỏng PATCH
    const lost = runId;
    expect(await contractRow(c, id)).toMatchObject({ status: "needs_review", run_id: null });
    await c.sql`update hub.process_defs set enabled = true
      where tenant_id = ${T.acme} and key = 'contracts-approval' and deleted_at is null`;
    await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    await c.sql`update contracts.contracts set updated_at = now() - interval '20 minutes' where id = ${id}`;
    await c.sweepOnce();
    await settled(c);
    const row = await contractRow(c, id);
    expect({ hasRun: row.run_id !== null, fresh: row.run_id !== lost, status: row.status }).toEqual(
      {
        hasRun: true,
        fresh: true,
        status: "needs_review",
      },
    );
    const [run] = await c.sql<{ started_by: string }[]>`select started_by from hub.process_runs
      where id = ${row.run_id}`;
    expect(run?.started_by).toBe(PA.B.id);
    expect((await approval(c, "H", id)).json?.step).toBe("level1");
  }, 90_000);
});

describe("re-verify Low · passedStages tính use_current hợp lệ ở cấp 2", () => {
  it("decision `use_current` (H, không phải người bắt đầu) ở stage approve ⇒ passedStages có 'approve'", async () => {
    const id = await seedContract(c, 202);
    const { runId } = await toLevel1(c, id, 600_000_000);
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    await settled(c);
    expect((await approval(c, "H", id)).json?.step).toBe("level2");
    const port = packRunsHd3({ db: c.hub.db } as never);
    expect(await port.passedStages(T.acme, runId)).toEqual(["extract"]);
    const [s] = await c.sql<{ id: string }[]>`select s.id from hub.stage_runs s
      where s.process_run_id = ${runId} and s.stage_idx = 2`;
    await c.sql`insert into hub.review_tasks (tenant_id, process_run_id, stage_run_id, kind, status, reason, result,
        decided_by, decided_at)
      values (${T.acme}, ${runId}, ${s?.id as string}, 'decision', 'closed', 'permission_lost', 'use_current',
        ${PA.H.id}, now())`;
    expect((await port.passedStages(T.acme, runId)).sort()).toEqual(["approve", "extract"]);
  }, 60_000);
});

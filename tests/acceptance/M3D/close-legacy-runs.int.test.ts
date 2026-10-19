// M3-decouple · M3-10 · script một lần `m3-close-contract-runs`: run engine `contracts-approval` còn mở (đã chuyển thành lượt
// duyệt của gói, cùng id) ⇒ đếm đúng (mở / đã ánh xạ); `--apply` đặt hết hạn + tắt def ⇒ vòng hết hạn CÓ SẴN của engine đóng run
// (`expired`, task duyệt đóng) — chờ bằng `sweepOnce` (seam N3), không ngủ chờ. Run quy trình khác không bị đụng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { closeLegacy, countLegacy } from "../../../tools/scripts/src/m3-close-contract-runs";
import { insContract } from "../HD1/_support/hd1";
import {
  agentStage,
  type CtxPd,
  createDef,
  defBody,
  nextStageJob,
  PA,
  runRow,
  startPd,
  startRun,
  sweepN,
  T,
} from "../P-d/_support/pd";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 50 });
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

describe("M3-10 · đóng run engine contracts-approval cũ", () => {
  it("đếm mở/đã ánh xạ; --apply ⇒ engine hết hạn run, def tắt; run def khác giữ nguyên", async () => {
    await createDef(c, defBody("contracts-approval", [agentStage({ key: "s0", step: 0 })]));
    await createDef(c, defBody("m3-other", [agentStage({ key: "s0", step: 0 })]));
    const legacy = await startRun(c, "contracts-approval");
    const other = await startRun(c, "m3-other");
    await nextStageJob(c, legacy);
    // Migration gói 0011 đã chuyển run thành lượt duyệt cùng id.
    const cid = crypto.randomUUID();
    await insContract(c.sql, {
      id: cid,
      tenant: T.acme,
      status: "needs_review",
      createdBy: PA.A.id,
    } as never);
    await c.sql`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, migrated)
      values (${legacy}, ${T.acme}, ${cid}, 'level1', ${PA.A.id}, true)`;
    await c.sql`update contracts.contracts set run_id = ${legacy} where id = ${cid}`;
    expect(await countLegacy(c.sql as never)).toEqual({ open: 1, mapped: 1, unmapped: 0, defs: 1 });
    expect(await closeLegacy(c.sql as never)).toEqual({ runs: 1, defs: 1 });
    await sweepN(c, 3);
    expect((await runRow(c.sql, legacy))?.status).toBe("expired");
    expect((await runRow(c.sql, other))?.status).not.toBe("expired");
    expect(await countLegacy(c.sql as never)).toEqual({ open: 0, mapped: 0, unmapped: 0, defs: 0 });
    // Lượt duyệt của gói không bị đụng (máy trạng thái của gói là nguồn thật).
    const [a] = await c.sql<
      { status: string }[]
    >`select status from contracts.approvals where id = ${legacy}`;
    expect(a?.status).toBe("level1");
  }, 90_000);
});

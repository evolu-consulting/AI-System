// HD-FR-32 · HD-FR-34 · AC32b · AC34c · AC34f · AC34g · D3-03 · M3-decouple: cách ly tenant + quyền của flow duyệt — id HĐ tenant
// khác ⇒ 404 (như không có), không vai gói ⇒ 403; ghi của máy trạng thái chỉ chạm HĐ mà `run_id` = lượt duyệt đang xét (lượt của
// HĐ khác / id tuỳ ý ⇒ 0 hàng); gói không dựng def engine nào (`contracts-approval` không chạy được từ đâu cả).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Db } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { approvalRepo } from "../../../apps/hub-api/src/modules/packs/contracts/adapters/approval.repo";
import { insContract } from "../HD1/_support/hd1";
import { PA } from "../P-d/_support/pd";
import {
  act,
  approval,
  approvalRow,
  C1_TEXT,
  CBASE,
  type CtxHd3,
  cid,
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

describe("AC34c · tenant khác / không vai", () => {
  it("HĐ beta: GET/POST approval + /extract từ A (acme) ⇒ 404; X (không vai gói) ⇒ 403", async () => {
    await insContract(c.sql, {
      id: cid(50),
      tenant: T.beta,
      status: "extract_failed",
      source: C1_TEXT,
      createdBy: PA.D.id,
    } as never);
    for (const r of [
      await approval(c, "A", cid(50)),
      await act(c, "A", cid(50), "approve"),
      await c.call("A", "POST", `${CBASE}/${cid(50)}/extract`),
    ])
      expect(r.status).toBe(404);
    const id = await seedContract(c, 51);
    expect((await approval(c, "X", id)).status).toBe(403);
    expect((await act(c, "X", id, "approve")).status).toBe(403);
    expect((await contractRow(c, cid(50))).run_id).toBeNull();
  }, 60_000);

  it("AC34g · gói không dựng def engine: `contracts-approval` không chạy được (acme lẫn beta ⇒ 404 PROCESS_NOT_FOUND)", async () => {
    const id = await seedContract(c, 52);
    await toLevel1(c, id, 1);
    const [n] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.process_defs
      where key = 'contracts-approval' and deleted_at is null`;
    expect(n?.n).toBe(0);
    for (const who of ["D", "A"] as const) {
      const r = await c.call(who, "POST", "/process-runs", {
        process_key: "contracts-approval",
        input: "x",
        origin: { kind: "none" },
      });
      expect({ who, status: r.status, code: errCode(r) }).toEqual({
        who,
        status: 404,
        code: "PROCESS_NOT_FOUND",
      });
    }
  }, 60_000);
});

describe("AC32b · AC34f · ghi chỉ chạm HĐ của chính lượt duyệt [D3-03]", () => {
  it("finalize / từ chối HĐ needs_review bằng lượt duyệt của HĐ KHÁC (hoặc id tuỳ ý) ⇒ 0 hàng, cả hai HĐ không đổi", async () => {
    const id = await seedContract(c, 53);
    await toLevel1(c, id, 245_000_000);
    const other = await seedContract(c, 54);
    const { runId: otherRun } = await toLevel1(c, other, 245_000_000);
    const before = [await contractRow(c, id), await contractRow(c, other)];
    const repo = <R>(fn: (r: ReturnType<typeof approvalRepo>) => Promise<R>) =>
      withPackScope(
        c.hub.db as unknown as Db,
        { packKey: "contracts", tenantId: T.acme, userId: PA.B.id },
        (tx) => fn(approvalRepo(tx, T.acme)),
      );
    for (const run of [otherRun, crypto.randomUUID()]) {
      expect(await repo((r) => r.finalize(id, run, PA.B.id, true))).toBe(false);
      const e = { kind: "rejected" as const, feedback: "x", actor: PA.B.id };
      expect(await repo((r) => r.markRejected(id, run, e))).toBe(false);
    }
    expect([await contractRow(c, id), await contractRow(c, other)]).toEqual(before);
    expect((await approvalRow(c, otherRun)).status).toBe("level1");
  }, 60_000);
});

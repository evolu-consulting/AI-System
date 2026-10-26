// contract-flow S3a · cờ `CONTRACTS_APPROVAL_ENGINE` tắt (mặc định) ⇒ máy 2 bước cũ y nguyên: lượt `level1` giữ `mode='machine'`, không
// run engine gắn HĐ; Xác nhận dưới ngưỡng ⇒ Đã duyệt như HD3.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  act,
  approvalRow,
  type CtxHd3,
  contractRow,
  seedContract,
  startHd3,
  toLevel1,
} from "../HD3/_hd3";
import { type Json, PA } from "../P-d/_support/pd";

let c: CtxHd3;
beforeAll(async () => {
  c = await startHd3();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

describe("contract-flow S3a · cờ tắt ⇒ máy cũ", () => {
  it("level1 chế độ máy, không run engine; Xác nhận ⇒ Đã duyệt", async () => {
    const id = await seedContract(c, 711);
    const { runId } = await toLevel1(c, id, 10_000_000);
    const [a] = await c.sql<
      Json[]
    >`select mode, engine_run_id from contracts.approvals where id = ${runId}`;
    expect(a).toEqual({ mode: "machine", engine_run_id: null });
    const [n] = await c.sql<Json[]>`select count(*)::int as n from hub.process_runs
      where pack_key = 'contracts' and pack_record_id = ${id}`;
    expect(n?.n).toBe(0);
    const r = await act(c, "B", id, "approve");
    expect(r.status).toBe(200);
    expect((await contractRow(c, id)).status).toBe("active");
    expect((await approvalRow(c, runId)).decided_by).toBe(PA.B.id);
  }, 60_000);
});

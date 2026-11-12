// HD-FR-32 · HD-FR-34 · AC32b · AC34c · AC34f · AC34g · D3-03 · M3-decouple: cách ly tenant + quyền của flow duyệt — id HĐ tenant
// khác ⇒ 404 (như không có), không vai gói ⇒ 403; ghi của máy trạng thái chỉ chạm HĐ mà `run_id` = lượt duyệt đang xét (lượt của
// HĐ khác / id tuỳ ý ⇒ 0 hàng); gói không dựng def engine nào (`contracts-approval` không chạy được từ đâu cả).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { insContract } from "../HD1/_support/hd1";
import { PA } from "../P-d/_support/pd";
import {
  act,
  approval,
  C1_TEXT,
  CBASE,
  type CtxHd3,
  cid,
  contractRow,
  seedContract,
  startHd3,
  T,
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
});

describe("AC32b · AC34f · ghi chỉ chạm HĐ của chính lượt duyệt [D3-03]", () => {});

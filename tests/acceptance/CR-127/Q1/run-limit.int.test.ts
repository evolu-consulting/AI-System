// CR-127 · Q1e · viết lại AC mất phủ (CF/approver-visible-run AC35a, HD-FR-35 #221): trần thao tác AI theo tenant/ngày (khoá Redis
// `q:contracts:a:<tenant>:<ngày>`) chỉ chặn việc TỐN AI (đọc/Đọc lại); lượt DUYỆT khi gửi (`POST /submit`, "Xác nhận & lưu") KHÔNG tính vào
// trần và KHÔNG bị chặn khi trần đã đầy. Engine giả qua sổ kit; Redis + DB + HTTP thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { registerFlowEngine } from "../../../../apps/hub-api/src/modules/packs/kit/public";
import { dayIn, quotaKeys } from "../../HD1/_support/hd1";
import {
  arrangeV2a,
  type CtxN1,
  call,
  P,
  reviewOf,
  seedReview,
  startHd1,
  T,
} from "../../V2-G/_support/v2g";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
  registerFlowEngine({
    availability: { hasFlowFor: async () => true },
    runControl: { inspect: async () => null, cancel: async () => true },
  } as never);
}, 120_000);
afterAll(async () => {
  registerFlowEngine(null);
  await c?.stop();
});

/** Đầy trần ngày của tenant (cả ngày múi VN lẫn UTC — không phụ thuộc múi cấu hình) và trả các khoá đã đặt. */
async function fillQuota(): Promise<string[]> {
  const days = new Set([dayIn("Asia/Ho_Chi_Minh"), dayIn("UTC")]);
  const keys = [...days].map((d) => `q:contracts:a:${T.acme}:${d}`);
  for (const k of keys) await c.hub.redis.set(k, "100000", "EX", 3600);
  return keys;
}

describe("CR-127 Q1e · trần số lượt chạy AI không chặn lượt duyệt khi gửi", () => {
  it("Q1-AC2a · trần ngày đã đầy ⇒ Gửi (POST /submit) vẫn 200 processing, bộ đếm không tăng", async () => {
    await arrangeV2a(c);
    const keys = await fillQuota();
    const s = await seedReview(c, 921, { deal: "sell" });
    const r = await call(c, P.hoa, "POST", `/contracts/${s.id}/submit`, {});
    expect([r.status, r.json?.status]).toEqual([200, "processing"]);
    for (const k of keys) expect(await c.hub.redis.get(k)).toBe("100000");
    expect((await quotaKeys(c.hub.redis)).sort()).toEqual([...keys].sort());
  }, 90_000);

  it("Q1-AC2b · trần ngày đã đầy ⇒ Xác nhận & lưu (POST /review) vẫn 200 và có đúng một lượt duyệt engine", async () => {
    await arrangeV2a(c);
    await fillQuota();
    const s = await seedReview(c, 922, { deal: "sell" });
    const r = await reviewOf(c, s.id, { version: 1 });
    expect([r.status, r.json?.status]).toEqual([200, "processing"]);
    const [a] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.approvals where contract_id = ${s.id} and mode = 'engine'`;
    expect(a?.n).toBe(1);
  }, 90_000);
});

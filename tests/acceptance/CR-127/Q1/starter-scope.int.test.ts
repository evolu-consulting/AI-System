// CR-127 · Q1e · spec §11 (R#15, BR-21) · viết lại AC mất phủ (CF/owner-act, CF/engine-only): bước `exclude_starter` ⇒ người gửi KHÔNG tự duyệt
// bước của mình: (a) lý do chặn `starter` (luật thuần `blockReasonOf`), (b) người gửi không nằm trong tập người duyệt (`reviewer_contract_ids()`)
// dù thuộc Group của bước; (c) bước KHÔNG exclude_starter ⇒ người gửi trong Group vẫn thuộc tập; (d) chủ gói (owner, `sees_all`) vẫn đọc được
// HĐ; người ngoài cả hai nhóm không. Lượt chạy dựng thẳng hàng hub.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { blockReasonOf } from "../../../../apps/hub-api/src/modules/packs/contracts/domain/approval-engine-card.rules";
import { arrangeV2a, type CtxN1, call, P, seedReview, startHd1, T } from "../../V2-G/_support/v2g";
import { inReviewerSet, mkGroup, openReviewRun } from "./_hubrun";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

async function setup(n: number, excludeStarter: boolean) {
  await arrangeV2a(c);
  await c.sql`truncate hub.process_runs cascade`;
  await c.sql`insert into contracts.visibility_settings (tenant_id, mode) values (${T.acme}, 'org')
    on conflict (tenant_id) do update set mode = 'org'`;
  const s = await seedReview(c, n, { status: "processing", deal: "sell" });
  // hoa (người gửi) và cuc cùng thuộc Group của bước
  const g = await mkGroup(c, `q1e-starter-${n}`, [P.hoa.id, P.cuc.id]);
  await openReviewRun(c, s.id, { group: g, starter: P.hoa.id, excludeStarter });
  return s.id;
}

describe("CR-127 Q1e · người gửi không tự duyệt bước của mình (R#15)", () => {
  it("Q1-AC6a · luật thuần: exclude_starter + người gửi ⇒ 'starter'; người khác / không exclude ⇒ 'not_reviewer'", () => {
    const flow = (ex: boolean) => [{ kind: "review", exclude_starter: ex, group_id: "g" }] as never;
    expect(blockReasonOf(flow(true), 0, "u1", "u1")).toBe("starter");
    expect(blockReasonOf(flow(true), 0, "u1", "u2")).toBe("not_reviewer");
    expect(blockReasonOf(flow(false), 0, "u1", "u1")).toBe("not_reviewer");
  });

  it("Q1-AC6b · bước exclude_starter: người gửi (hoa) loại khỏi tập người duyệt, cuc cùng Group vẫn trong tập", async () => {
    const id = await setup(911, true);
    expect(await inReviewerSet(c, P.hoa.id, id)).toBe(false);
    expect(await inReviewerSet(c, P.cuc.id, id)).toBe(true);
  }, 90_000);

  it("Q1-AC6c · bước không exclude_starter: người gửi cùng Group vẫn thuộc tập người duyệt", async () => {
    const id = await setup(912, false);
    expect(await inReviewerSet(c, P.hoa.id, id)).toBe(true);
  }, 90_000);

  it("Q1-AC6d · chủ gói (lan) đọc được HĐ đang duyệt; viewer ngoài Group (tam) và tenant khác không", async () => {
    const id = await setup(913, true);
    expect((await call(c, P.lan, "GET", `/contracts/${id}`)).status).toBe(200);
    expect((await call(c, P.tam, "GET", `/contracts/${id}`)).status).toBe(404);
    expect((await call(c, P.an, "GET", `/contracts/${id}`)).status).toBe(404);
  }, 90_000);
});

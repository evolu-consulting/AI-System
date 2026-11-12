// CR-127 · Q1e · viết lại AC mất phủ (CF/reviewer-visible, CR-109): HĐ đã gửi (`processing`) có lượt chạy engine ⇒ người duyệt của bước
// ĐANG MỞ (thuộc Group của bước, ngoài cây của chủ HĐ, chế độ thấy `org`) đọc được HĐ; người ngoài bước 404; tenant khác không thấy;
// người duyệt chỉ ĐỌC (RLS UPDATE giữ luật cũ). Lượt chạy dựng thẳng hàng hub (engine thật ngoài phạm vi).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { untilHubSettles } from "../../HD1/_support/hd1";
import { arrangeV2a, type CtxN1, call, P, seedReview, startHd1, T } from "../../V2-G/_support/v2g";
import { inReviewerSet, mkGroup, openReviewRun } from "./_hubrun";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
  await arrangeV2a(c);
  await c.addToRole(T.acme, "viewer", [P.cuc]);
  const got = await untilHubSettles(
    c.hub,
    async () => (await call(c, P.cuc, "GET", "/contracts")).status,
    (s: number) => s === 200,
  );
  expect(got).toBe(200);
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

async function setup(n: number) {
  await arrangeV2a(c);
  await c.sql`truncate hub.process_runs cascade`;
  await c.sql`insert into contracts.visibility_settings (tenant_id, mode) values (${T.acme}, 'org')
    on conflict (tenant_id) do update set mode = 'org'`;
  const s = await seedReview(c, n, { status: "processing", deal: "sell" });
  const g = await mkGroup(c, `q1e-duyet-${n}`, [P.cuc.id]);
  return { id: s.id, g };
}
const rlsUpdate = (user: string, id: string) =>
  c.sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${T.acme}, true), set_config('app.user_id', ${user}, true)`;
    await tx`set local role contracts_rw`;
    return (
      await tx`update contracts.contracts set updated_at = now() where id = ${id} returning id`
    ).length;
  });

describe("CR-127 Q1e · người duyệt của bước đang mở đọc được HĐ đã gửi", () => {
  it("Q1-AC1a · cuc (Group của bước, ngoài cây chủ HĐ) đọc HĐ processing; tam (chỉ xem, ngoài bước) 404; tenant khác 404", async () => {
    const { id, g } = await setup(901);
    expect((await call(c, P.cuc, "GET", `/contracts/${id}`)).status).toBe(404); // chưa có lượt chạy ⇒ chưa thấy
    await openReviewRun(c, id, { group: g, starter: P.hoa.id });
    expect((await call(c, P.cuc, "GET", `/contracts/${id}`)).status).toBe(200);
    expect((await call(c, P.hoa, "GET", `/contracts/${id}`)).status).toBe(200);
    expect((await call(c, P.tam, "GET", `/contracts/${id}`)).status).toBe(404);
    expect((await call(c, P.an, "GET", `/contracts/${id}`)).status).toBe(404);
  }, 90_000);

  it("Q1-AC1b · người duyệt chỉ đọc: UPDATE hàng HĐ dưới RLS ⇒ 0 hàng; tập reviewer_contract_ids của cuc có HĐ, của tam thì không", async () => {
    const { id, g } = await setup(902);
    await openReviewRun(c, id, { group: g, starter: P.hoa.id });
    expect(await inReviewerSet(c, P.cuc.id, id)).toBe(true);
    expect(await inReviewerSet(c, P.tam.id, id)).toBe(false);
    expect(await rlsUpdate(P.cuc.id, id)).toBe(0);
  }, 90_000);

  it("Q1-AC1c · lượt chạy đã kết thúc (done) và chưa ai quyết ⇒ hết thấy theo bước (người duyệt không còn đọc được)", async () => {
    const { id, g } = await setup(903);
    await openReviewRun(c, id, { group: g, starter: P.hoa.id, status: "done" });
    expect((await call(c, P.cuc, "GET", `/contracts/${id}`)).status).toBe(404);
  }, 90_000);
});

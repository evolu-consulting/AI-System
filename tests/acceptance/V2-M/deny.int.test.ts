// V2-M · chặn quyền + chéo tenant: chỉ contracts-owner xoá được (editor / viewer 403, cả xem trước); owner tenant khác ⇒ 404 và HĐ còn
// nguyên; contracts_rw KHÔNG xoá được HĐ khi chưa đặt cờ của hàm xoá (RLS FORCE, policy RESTRICTIVE).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { arrangeV2d, type CtxN1, call, d, deal, P, startHd1 } from "../V2-D/_support/v2d";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

describe("V2-M · xoá hợp đồng · quyền + tenant", () => {
  it("editor/viewer 403, owner tenant khác 404, HĐ còn nguyên", async () => {
    await arrangeV2d(c);
    const k = await deal(c.sql, { sale: true, end: d(100) });
    const status = async (p: Parameters<typeof call>[1], m: string, path: string) =>
      (await call(c, p, m, path)).status;
    expect(await status(P.hoa, "DELETE", `/contracts/${k}`)).toBe(403);
    expect(await status(P.tam, "DELETE", `/contracts/${k}`)).toBe(403);
    expect(await status(P.hoa, "GET", `/contracts/${k}/delete-preview`)).toBe(403);
    expect(await status(P.an, "DELETE", `/contracts/${k}`)).toBe(404);
    expect(await status(P.an, "GET", `/contracts/${k}/delete-preview`)).toBe(404);
    const [n] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.contracts where id = ${k}`;
    expect(n?.n).toBe(1);
  });
});

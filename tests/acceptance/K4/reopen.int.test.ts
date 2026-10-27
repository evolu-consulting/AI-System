// CR-101a · R12 · X5 · Câu 6 (2026-10-27): mở lại HĐ đã khoá = người phụ trách HĐ (`owner_user_id`) HOẶC owner gói (`admin`); lý do
// bắt buộc; log `reopened` như K1. Viết TRƯỚC code (làn đầy đủ: quyền). Hạ tầng HD3 (hub-api THẬT, model giả). Người: A = lan (editor +
// owner gói), B = hoa (editor). Ca owner mở lại HĐ người khác phụ trách và editor không phụ trách ⇒ 403: K1/lock.int.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { act, CBASE, type CtxHd3, errCode, seedContract, startHd3, toLevel1 } from "../HD3/_hd3";
import { PA } from "../P-d/_support/pd";

let c: CtxHd3;
beforeAll(async () => {
  c = await startHd3();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

const reopen = (r: "A" | "B", id: string, body: unknown) =>
  c.call(r, "POST", `${CBASE}/${id}/reopen`, body);
const lockedAt = async (id: string) =>
  (
    await c.sql<{ at: Date | null }[]>`select locked_at as at from contracts.contracts
      where id = ${id}`
  )[0]?.at ?? null;

/** HĐ acme (người phụ trách = `owner`) đi qua duyệt tới "Đã duyệt" (khoá). */
async function confirmed(n: number, owner: string): Promise<string> {
  const id = await seedContract(c, n, { owner });
  await toLevel1(c, id, 245_000_000);
  expect((await act(c, "B", id, "approve")).status).toBe(200);
  expect(await lockedAt(id)).not.toBeNull();
  return id;
}

describe("CR-101a · R12 · mở lại: người phụ trách hoặc owner gói", () => {
  it("người phụ trách (editor B): thiếu lý do ⇒ 400; có lý do ⇒ 200 Chờ duyệt, mở khoá, log actor B", async () => {
    const id = await confirmed(410, PA.B.id);
    expect((await reopen("B", id, { reason: "  " })).status).toBe(400);
    const r = await reopen("B", id, { reason: "AI đọc sai số tiền" });
    expect({ status: r.status, s: r.json?.status, locked: r.json?.locked }).toEqual({
      status: 200,
      s: "needs_review",
      locked: false,
    });
    expect(await lockedAt(id)).toBeNull();
    const ev = await c.sql<{ actor: string; reason: string }[]>`select actor_user_id::text as actor,
        data->>'reason' as reason from contracts.contract_events where contract_id = ${id} and type = 'reopened'`;
    expect([...ev]).toEqual([{ actor: PA.B.id, reason: "AI đọc sai số tiền" }]);
  }, 90_000);

  it("owner gói (A) mở lại HĐ do B phụ trách ⇒ 200", async () => {
    const id = await confirmed(411, PA.B.id);
    const r = await reopen("A", id, { reason: "Sai ngày ký" });
    expect({ status: r.status, s: r.json?.status }).toEqual({ status: 200, s: "needs_review" });
    expect(await lockedAt(id)).toBeNull();
  }, 90_000);

  it("editor KHÔNG phụ trách (B, HĐ do A phụ trách) ⇒ 403 REOPEN_FORBIDDEN; HĐ vẫn khoá, không log", async () => {
    const id = await confirmed(412, PA.A.id);
    const r = await reopen("B", id, { reason: "thử" });
    expect({ status: r.status, code: errCode(r) }).toEqual({
      status: 403,
      code: "REOPEN_FORBIDDEN",
    });
    expect(await lockedAt(id)).not.toBeNull();
    const [n] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.contract_events
      where contract_id = ${id} and type = 'reopened'`;
    expect(n?.n).toBe(0);
  }, 90_000);
});

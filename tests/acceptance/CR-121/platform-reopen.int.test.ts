// CR-121 Q-3 · platform_admin mở lại HĐ của MỘT công ty qua route sẵn có `POST /pack/contracts/contracts/:id/reopen?tenant_id=…`
// (không đường thứ hai): lý do bắt buộc ≤ 500 · event `reopened` ghi actor/tenant/HĐ/lý do + `by_platform` · member/tenant_admin
// công ty khác bị chặn · mở 2 lần (kể cả đua) chỉ ra 1 kết quả. Hạ tầng HD3 (hub-api THẬT, acme bật gói + duyệt). Người: A (owner gói),
// B (editor, duyệt cấp 1), X (không vai), P (padmin = platform_admin), Db (tenant_admin công ty beta, không có gói).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { act, CBASE, type CtxHd3, errCode, seedContract, startHd3, T, toLevel1 } from "../HD3/_hd3";
import { PA } from "../P-d/_support/pd";

let c: CtxHd3;
beforeAll(async () => {
  c = await startHd3();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

const confirmed = async (n: number): Promise<string> => {
  const id = await seedContract(c, n);
  await toLevel1(c, id, 245_000_000);
  expect((await act(c, "B", id, "approve")).status).toBe(200);
  return id;
};
const lockedAt = async (id: string): Promise<boolean> =>
  (
    await c.sql<
      { l: boolean }[]
    >`select locked_at is not null as l from contracts.contracts where id = ${id}`
  )[0]?.l === true;
const reopenedEvents = (id: string) =>
  c.sql<
    {
      actor: string;
      tenant: string;
      contract: string;
      reason: string;
      by_platform: string | null;
    }[]
  >`select actor_user_id::text as actor, tenant_id::text as tenant, contract_id::text as contract,
      data->>'reason' as reason, data->>'by_platform' as by_platform
    from contracts.contract_events where contract_id = ${id} and type = 'reopened'`;
const asPlatform = (id: string, body: unknown, q = `?tenant_id=${T.acme}`) =>
  c.call("P", "POST", `${CBASE}/${id}/reopen${q}`, body);

describe("CR-121 Q-3 · platform_admin mở lại HĐ của công ty", () => {
  it("platform_admin mở lại HĐ công ty A ⇒ 200 needs_review, mở khoá, event ghi actor + tenant + HĐ + lý do", async () => {
    const id = await confirmed(410);
    expect(await lockedAt(id)).toBe(true);
    const r = await asPlatform(id, { reason: "Khách yêu cầu sửa điều khoản thanh toán" });
    expect({ status: r.status, st: r.json?.status, locked: r.json?.locked }).toEqual({
      status: 200,
      st: "needs_review",
      locked: false,
    });
    expect(await lockedAt(id)).toBe(false);
    expect(await reopenedEvents(id)).toEqual([
      {
        actor: PA.P.id,
        tenant: T.acme,
        contract: id,
        reason: "Khách yêu cầu sửa điều khoản thanh toán",
        by_platform: "true",
      },
    ]);
  }, 90_000);

  it("thiếu lý do / lý do rỗng / > 500 ký tự / thiếu tenant_id ⇒ 400, HĐ vẫn khoá, không event", async () => {
    const id = await confirmed(411);
    const bad = [
      await asPlatform(id, {}),
      await asPlatform(id, { reason: "   " }),
      await asPlatform(id, { reason: "x".repeat(501) }),
      await asPlatform(id, { reason: "có lý do" }, ""),
    ];
    expect(bad.map((r) => r.status)).toEqual([400, 400, 400, 400]);
    expect(await lockedAt(id)).toBe(true);
    expect(await reopenedEvents(id)).toEqual([]);
  }, 90_000);

  it("member (không vai ghi ở gói) ⇒ 403, tenant_admin công ty khác (beta) kèm tenant_id=acme ⇒ 403 PACK_DISABLED, HĐ vẫn khoá", async () => {
    const id = await confirmed(412);
    const q = `?tenant_id=${T.acme}`;
    const member = await c.call("X", "POST", `${CBASE}/${id}/reopen${q}`, { reason: "thử" });
    const other = await c.call("Db", "POST", `${CBASE}/${id}/reopen${q}`, { reason: "thử" });
    expect({ m: member.status, o: other.status, code: errCode(other) }).toEqual({
      m: 403,
      o: 403,
      code: "PACK_DISABLED",
    });
    expect(await lockedAt(id)).toBe(true);
    expect(await reopenedEvents(id)).toEqual([]);
  }, 90_000);

  it("mở 2 lần (đua + lần sau) chỉ ra 1 kết quả: 1×200, còn lại 409 CONTRACT_NOT_LOCKED, đúng 1 event", async () => {
    const id = await confirmed(413);
    const body = { reason: "bấm hai lần" };
    const both = await Promise.all([asPlatform(id, body), asPlatform(id, body)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    const again = await asPlatform(id, body);
    expect({ status: again.status, code: errCode(again) }).toEqual({
      status: 409,
      code: "CONTRACT_NOT_LOCKED",
    });
    expect((await reopenedEvents(id)).length).toBe(1);
  }, 90_000);
});

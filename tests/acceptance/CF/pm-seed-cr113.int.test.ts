// pm-ready · hub THẬT, cờ engine bật: seed HĐ mẫu CR-113 (`seedCr113Samples`) đi đường thật (mở lại quy trình + duyệt thay) tạo đúng 3 HĐ:
// (1) chờ bước 1, chủ gói chưa quyết; (2) bước 1 do Toàn quyền duyệt thay (`approval_override` + thẻ owner_override); (3) bước 1 quá hạn,
// sau một lượt nhắc chuyển cấp về Toàn quyền (thẻ overdue + escalated_to). Chạy lần 2 ⇒ không thêm HĐ/run/sự kiện nào.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { seedCr113Samples } from "../../../tools/scripts/src/seed-cr113-samples";
import { approval } from "../HD3/_hd3";
import { type Json, PA, remind, T } from "../P-d/_support/pd";
import { type CtxCf, startCf } from "./_cf";

let c: CtxCf;
beforeAll(async () => {
  c = await startCf();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

const run = () =>
  seedCr113Samples({
    sql: c.sql,
    tenantId: T.acme,
    creatorId: PA.B.id, // người bắt đầu lượt (không phải Toàn quyền)
    ownerCall: (m, p, b) => c.call("H", m, p, b), // H = Toàn quyền, ngoài Group cấp 1
    afterOverdue: () => remind(c),
  });
const card = async (id: string) => (await approval(c, "A", id)).json as Json;
const counts = async () => {
  const [r] = await c.sql<Json[]>`select
    (select count(*)::int from contracts.contracts where title like '[CR-113]%') as contracts,
    (select count(*)::int from contracts.contract_events where type = 'approval_override') as overrides,
    (select count(*)::int from contracts.approvals where engine_run_id is not null and id::text like 'a1130000%') as runs`;
  return r;
};

describe("pm-ready · HĐ mẫu CR-113 (seed qua đường thật của hub)", () => {
  it("3 HĐ: chờ duyệt / duyệt thay bởi Toàn quyền / quá hạn đã chuyển cấp; chạy lần 2 y nguyên", async () => {
    const r = await run();
    expect(await counts()).toEqual({ contracts: 3, overrides: 1, runs: 3 });

    const pending = await card(r.pending.id);
    expect(pending.steps?.[0]).toMatchObject({ status: "open", overdue: false, escalated: false });
    expect(pending.steps?.[0]?.decided_as).toBeUndefined();
    expect(pending.steps?.length).toBeGreaterThanOrEqual(2);

    const ov = await card(r.override.id);
    expect(ov.steps?.[0]).toMatchObject({ status: "passed", decided_as: "owner_override" });
    expect(ov.steps?.[1]?.status).toBe("open");
    const [ev] = await c.sql<Json[]>`select actor_user_id::text as actor, data->>'stage' as stage
      from contracts.contract_events where contract_id = ${r.override.id} and type = 'approval_override'`;
    expect(ev).toEqual({ actor: PA.H.id, stage: "s0" });

    const od = (await card(r.overdue.id)).steps?.[0];
    expect(od).toMatchObject({ status: "open", overdue: true, escalated: true });
    expect(typeof od?.escalated_to).toBe("string");
    const [t] = await c.sql<Json[]>`select (escalated_at is not null) as done from hub.review_tasks
      where process_run_id = ${r.overdue.run} and status = 'open'`;
    expect(t?.done).toBe(true);

    const again = await run();
    expect(again).toEqual(r);
    expect(await counts()).toEqual({ contracts: 3, overrides: 1, runs: 3 });
  }, 120_000);
});

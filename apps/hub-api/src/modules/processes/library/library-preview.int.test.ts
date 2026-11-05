// CR-105 · L2b · int: `POST /process-defs/:id/preview` — đường chính (bước có `when` bị bỏ qua), chỉ platform_admin, không ghi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CtxPa, startPa } from "../../../../../../tests/acceptance/P-a/_support/pa";
import { approvalSlotSpec } from "../../packs/contracts/approval.mount";
import { slotRegistry } from "../../packs/kit/adapters/slot-registry";

const DEF = "c1050000-0000-4000-8000-000000000001";
const review = (key: string, when: unknown) => ({
  kind: "review",
  key,
  name: `Duyệt ${key}`,
  department_group_key: "ke-toan",
  head_only: false,
  due_h: 24,
  remind_every_h: null,
  escalate_group_key: null,
  exclude_starter: false,
  when,
});
const BODY = {
  steps: [
    review("s0", null),
    review("s1", { op: "and", conds: [{ field: "total_value", op: "ge", value: 1_000_000_000 }] }),
  ],
};

const DEF2 = "c1050000-0000-4000-8000-000000000002";
const BODY2 = {
  steps: [
    review("s0", null),
    review("s1", { op: "and", conds: [{ field: "creator_department", in: ["sales"] }] }),
    review("s2", { op: "or", conds: [{ field: "new_partner", is: true }] }),
  ],
};

let c: CtxPa;
beforeAll(async () => {
  c = await startPa();
  slotRegistry.register(approvalSlotSpec);
  await c.sql`insert into hub.process_defs (id, tenant_id, key, name, stages, slot, slot_body)
    values (${DEF}, null, 'pl-preview', 'pl-preview', '[{"key":"s0"}]'::jsonb, 'contracts.approval', ${c.sql.json(BODY as never)})`;
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const counts = async () => {
  const [r] = await c.sql<{ n: number }[]>`select (select count(*) from hub.process_defs)::int
    + (select count(*) from hub.process_def_releases)::int + (select count(*) from hub.process_runs)::int as n`;
  return r?.n;
};

describe("CR-105 · xem trước đường đi", () => {
  it("xem trước tô bước bỏ qua, không ghi", async () => {
    const before = await counts();
    const low = await c.call("P", "POST", `/process-defs/${DEF}/preview`, {
      contract_type: "buy",
      value: 5_000_000,
    });
    expect(low.status).toBe(200);
    expect(low.json).toEqual({
      steps: [
        { key: "s0", name: "Duyệt s0", run: true, state: "run" },
        { key: "s1", name: "Duyệt s1", run: false, state: "skip" },
      ],
    });
    const high = await c.call("P", "POST", `/process-defs/${DEF}/preview`, {
      contract_type: "buy",
      value: 2_000_000_000,
    });
    expect((high.json as { steps: { run: boolean }[] }).steps.map((s) => s.run)).toEqual([
      true,
      true,
    ]);
    expect(await counts()).toBe(before);
    // chỉ platform_admin; tenant_admin ⇒ 403 trước khi đọc DB
    const adm = await c.call("Adm", "POST", `/process-defs/${DEF}/preview`, {
      contract_type: "buy",
      value: 1,
    });
    expect(adm.status).toBe(403);
  });

  // CR-121 D-2 · dữ kiện mở rộng: phòng ban người gửi + đối tác mới; thiếu dữ kiện ⇒ "chưa có dữ liệu" (vẫn chạy, an toàn).
  it("xem trước theo phòng ban/đối tác mới, thiếu dữ liệu ⇒ no_data", async () => {
    await c.sql`insert into hub.process_defs (id, tenant_id, key, name, stages, slot, slot_body)
      values (${DEF2}, null, 'pl-preview2', 'pl-preview2', '[{"key":"s0"}]'::jsonb, 'contracts.approval', ${c.sql.json(BODY2 as never)})`;
    const states = async (b: Record<string, unknown>) => {
      const r = await c.call("P", "POST", `/process-defs/${DEF2}/preview`, b);
      expect(r.status).toBe(200);
      return (r.json as { steps: { state: string }[] }).steps.map((s) => s.state);
    };
    expect(await states({})).toEqual(["run", "no_data", "no_data"]);
    expect(await states({ creator_departments: ["sales"], new_partner: true })).toEqual([
      "run",
      "run",
      "run",
    ]);
    expect(await states({ creator_departments: ["ke-toan"], new_partner: false })).toEqual([
      "run",
      "skip",
      "skip",
    ]);
    // dữ kiện sai kiểu ⇒ lỗi kiểm dữ liệu (strict), không phải 5xx
    const bad = await c.call("P", "POST", `/process-defs/${DEF2}/preview`, { new_partner: "x" });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
  });
});

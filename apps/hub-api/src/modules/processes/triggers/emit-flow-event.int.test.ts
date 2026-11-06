// CR-122 · E1b · FLOW2-FR-19 · hub 0109 `hub.emit_flow_event` (SECURITY DEFINER): role gói `contracts_rw` (tx `withPackScope`:
// SET ROLE + `app.tenant_id`) ghi được sự kiện cho tenant của mình, không ghi được cho tenant khác / khi chưa đặt tenant, không
// đọc/ghi thẳng bảng; trùng `event_id` ⇒ NULL (không dòng thứ hai).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, pgCode, type Sql } from "@ai/test-kit/db";

const X = tenantId(1241);
const Y = tenantId(1242);
const U = userId(1241);
let o: Sql;

/** Như `withPackScope`: role gói + tenant trong tx (rollback sau cùng). */
const asPack = <T>(tenant: string | null, fn: (tx: Sql) => Promise<T>) =>
  o.begin(async (tx) => {
    await tx`select set_config('role', 'contracts_rw', true)`;
    if (tenant) await tx`select set_config('app.tenant_id', ${tenant}, true)`;
    return fn(tx as unknown as Sql);
  });
const emit = (tx: Sql, t: string, eventId: string) =>
  tx`select hub.emit_flow_event(${t}::uuid, ${eventId}, 'contract.submitted', 'ref-1',
    '{"total_value": 5}'::jsonb, ${U}::uuid) as id`;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1241', 'X'), (${Y}, 't1242', 'Y')`;
});
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-122 E1b · hub.emit_flow_event", () => {
  it("role gói ghi được sự kiện cho tenant của mình, gọi lại cùng event_id ⇒ NULL, vẫn một dòng", async () => {
    const ids = await asPack(X, async (tx) => [
      (await emit(tx, X, "own:1"))[0]?.id,
      (await emit(tx, X, "own:1"))[0]?.id,
    ]);
    expect(typeof ids[0]).toBe("string");
    expect(ids[1]).toBeNull();
    const [n] = await o<{ n: number }[]>`select count(*)::int as n from hub.flow_events
      where tenant_id = ${X} and event_id = 'own:1'`;
    expect(n?.n).toBe(1);
  });

  it("ghi cho tenant khác / chưa đặt tenant ⇒ 42501, không đọc thẳng được bảng", async () => {
    expect(await pgCode(() => asPack(X, (tx) => emit(tx, Y, "cross:1")))).toBe("42501");
    expect(await pgCode(() => asPack(null, (tx) => emit(tx, X, "none:1")))).toBe("42501");
    expect(await pgCode(() => asPack(X, (tx) => tx`select 1 from hub.flow_events limit 1`))).toBe(
      "42501",
    );
    const [n] = await o<{ n: number }[]>`select count(*)::int as n from hub.flow_events
      where event_id in ('cross:1', 'none:1')`;
    expect(n?.n).toBe(0);
  });
});

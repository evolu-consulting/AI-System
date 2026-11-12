// CR-127 · X4b · #61 + E6: (1) nhắc trước hạn "cứng" của Việc của tôi CHỈ khi công ty không có quy trình `milestone.due`; mốc quá hạn luôn hiện.
// (2) nguồn lịch của gói tính "hôm nay" và `days_late` theo MÚI GIỜ công ty (không UTC).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Db } from "@ai/db";
import { contractsScheduledSource } from "../../../../apps/hub-api/src/modules/packs/contracts/schedule-sources.mount";
import { registerFlowEngine } from "../../../../apps/hub-api/src/modules/packs/kit/public";
import { arrangeV2d, type CtxN1, call, d, deal, P, startHd1, T } from "../../V2-D/_support/v2d";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
  await arrangeV2d(c);
}, 120_000);
afterAll(async () => {
  registerFlowEngine(null);
  await c?.stop();
});

async function doneWith(dueOffsets: number[]) {
  const k = await deal(c.sql, { sale: true, end: d(365), status: "done" });
  await c.sql`update contracts.contracts set effect = 'active' where id = ${k}`;
  const ids: string[] = [];
  let seq = 1;
  for (const off of dueOffsets) {
    const [o] = await c.sql<{ id: string }[]>`insert into contracts.obligations
        (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, source)
      select tenant_id, id, partner_key, 'receive', 'payment', ${seq++}, current_date + ${off}::int, 1000, 'manual'
      from contracts.contracts where id = ${k} returning id::text`;
    ids.push((o as { id: string }).id);
  }
  return { k, ids };
}
const todoMilestones = async (ids: string[]) => {
  const r = await call(c, P.lan, "GET", "/my-work/todo");
  const items = (r.json?.items ?? []) as { key: string }[];
  return ids.map((id) => items.some((i) => i.key.startsWith(`milestone:${id}:`)));
};

describe("CR-127 X4b · nhắc cứng chỉ khi không có quy trình milestone.due", () => {
  it("không có quy trình ⇒ mốc sắp tới hạn + quá hạn đều hiện; có quy trình ⇒ chỉ còn quá hạn", async () => {
    const { ids } = await doneWith([2, -3]);
    registerFlowEngine(null);
    expect(await todoMilestones(ids)).toEqual([true, true]);
    registerFlowEngine({
      runControl: {},
      availability: { hasFlowFor: async () => true },
    } as never);
    try {
      expect(await todoMilestones(ids)).toEqual([false, true]);
    } finally {
      registerFlowEngine(null);
    }
  });
});

describe("CR-127 X4b · nguồn lịch theo múi giờ công ty", () => {
  it("UTC 2026-06-15 12:00 nhưng công ty ở UTC+14 (đã 16/06) ⇒ mốc hạn 15/06 đã quá hạn 1 ngày", async () => {
    const { ids } = await doneWith([0]);
    const [id] = ids as [string];
    await c.sql`update contracts.obligations set due_date = '2026-06-15' where id = ${id}`;
    const now = () => new Date("2026-06-15T12:00:00Z");
    const q = (tz?: string) =>
      contractsScheduledSource(
        c.hub.db as unknown as Db,
        tz ? async () => tz : undefined,
        now,
      ).dueRecords({
        tenantId: T.acme,
        event: "milestone.overdue",
        params: { days: 1 },
        today: "2026-06-15", // ngày UTC engine truyền
        limit: 1000,
        after: null,
      });
    const hit = (await q("Pacific/Kiritimati")).find((r) => r.ref === id);
    expect(hit?.dueKey).toBe("2026-06-15");
    expect(Number(((hit?.facts ?? {}) as { days_late?: number }).days_late)).toBe(1);
    // múi giờ UTC−11: vẫn là 15/06 ⇒ chưa quá hạn ≥ 1 ngày
    expect((await q("Pacific/Pago_Pago")).find((r) => r.ref === id)).toBeUndefined();
  });
});

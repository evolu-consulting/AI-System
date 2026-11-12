// CR-127 · E6 · spec §5.5 · vòng lịch `scheduleSweepOnce` (đồng hồ giả `today`, không ngủ chờ — Luật 4c):
// (1) chạy 2 lần cùng ngày ⇒ MỘT sự kiện; (2) hai quy trình cùng `contract.expiring` khác N ⇒ mỗi cái đúng ngày của mình (R#12, qua
// `dispatchOnce`); (3) HĐ đã thay thế / công ty khác không phát; (4) `milestone.due` dời hạn khi sự kiện cũ còn chờ ⇒ không phát lần hai (#55);
// (5) route `POST /__test/schedule-sweep` 404 ở production, chạy được ở test (#63).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { contracts, tenantId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { connectDb, type Db } from "../../../lib/db";
import { mountContractSchedules } from "../../packs/contracts/schedule-sources.mount";
import { flowPortRegistry } from "../../packs/kit/public";
import { dispatchOnce } from "./dispatcher";
import { mountScheduleTestRoute, scheduleSweepOnce } from "./schedule-sweep";

const T = tenantId(1340);
const B = tenantId(1341);
let o: Sql;
let db: Db;
let U = "";
let UB = "";
let C: string[] = [];
let CB = "";
const F: Record<string, string> = {};
const END = "2026-12-31";

const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function flow(t: string, key: string, event: string, days: number, pos: number) {
  const trig = { event, params: { days } };
  const [d] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app)
    values (${t}, ${key}, ${key}, '[{"key":"a"}]'::jsonb, ${o.json(trig as never)}, 'contracts') returning id::text as id`;
  const [cf] = await o<
    { id: string }[]
  >`insert into hub.company_flows (tenant_id, flow_id, enabled, position)
    values (${t}, ${d?.id as string}, true, ${pos}) returning id::text as id`;
  F[key] = cf?.id as string;
}

const events = (event: string) =>
  o<{ ref: string; event_id: string; days: number; actor_id: string | null }[]>`
    select ref, event_id, (facts ->> 'days')::int as days, actor_id::text as actor_id from hub.flow_events
    where event = ${event} order by event_id`;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${T}, 't1340', 'T'), (${B}, 't1341', 'B')`;
  [U] = (await users(o, T, 1, { from: 1340 })) as [string];
  [UB] = (await users(o, B, 1, { from: 1345 })) as [string];
  C = await contracts(o, T, 3, { from: 1340, createdBy: U, owner: U });
  [CB] = (await contracts(o, B, 1, { from: 1345, createdBy: UB, owner: UB })) as [string];
  await o`update contracts.contracts set fields = jsonb_build_object('end_date', jsonb_build_object('value', ${END}::text),
      'total_value', jsonb_build_object('value', 5000000))
    where id = any(${o.array([...C, CB])}::uuid[])`;
  await o`update contracts.contracts set superseded_at = now(), superseded_by = ${C[0] as string} where id = ${C[2] as string}`;
  // mốc của C[1]: hạn 2026-12-10
  await o`insert into contracts.obligations (id, tenant_id, contract_id, direction, kind, seq, due_date)
    values ('c1340000-0000-4000-8000-0000000000a1', ${T}, ${C[1] as string}, 'receive', 'payment', 1, '2026-12-10')`;
  await flow(T, "exp30", "contract.expiring", 30, 0);
  await flow(T, "exp10", "contract.expiring", 10, 1);
  await flow(T, "due3", "milestone.due", 3, 2);
  mountContractSchedules(db);
}, 120_000);
afterAll(async () => {
  flowPortRegistry.clearPack("contracts");
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 E6 · schedule-sweep", () => {
  it("chạy 2 lần cùng ngày ⇒ một lượt; HĐ thay thế + công ty khác không phát", async () => {
    const today = addDays(END, -30);
    const a = await scheduleSweepOnce({ db, today });
    const b = await scheduleSweepOnce({ db, today });
    expect(a.emitted).toBe(2); // C[0], C[1] với N=30 (C[2] đã thay thế)
    expect(b.emitted).toBe(0);
    const ev = await events("contract.expiring");
    expect(ev.map((e) => e.ref).sort()).toEqual([C[0], C[1]].sort() as string[]);
    expect(ev.every((e) => e.days === 30 && e.actor_id === U)).toBe(true);
    expect(ev[0]?.event_id).toBe(`contract.expiring:${ev[0]?.ref}:${END}:30`);
    expect(ev.some((e) => e.ref === CB)).toBe(false);
  });

  it("hai quy trình khác N ⇒ mỗi cái đúng ngày của mình (R#12)", async () => {
    await scheduleSweepOnce({ db, today: addDays(END, -10) });
    const ev = await events("contract.expiring");
    expect(ev.filter((e) => e.days === 10)).toHaveLength(2);
    expect(ev.filter((e) => e.days === 30)).toHaveLength(2); // không phát lại N=30
    const ran: { ref: string; flow: string; days: unknown }[] = [];
    await dispatchOnce({
      db,
      batch: 50,
      launch: async (e, c) => {
        ran.push({ ref: e.ref, flow: c.companyFlowId, days: e.facts.days });
        return { runId: crypto.randomUUID() };
      },
    });
    const of = (k: string) => ran.filter((r) => r.flow === F[k]);
    expect(of("exp30").map((r) => r.days)).toEqual([30, 30]);
    expect(of("exp10").map((r) => r.days)).toEqual([10, 10]);
  });

  it("milestone.due: phát đúng N; dời hạn khi sự kiện cũ còn chờ ⇒ không phát lần hai (#55)", async () => {
    const r1 = await scheduleSweepOnce({ db, today: "2026-12-07" });
    expect(r1.emitted).toBe(1);
    const [m] = await events("milestone.due");
    expect(m?.event_id).toBe("milestone.due:c1340000-0000-4000-8000-0000000000a1:2026-12-10:3");
    await o`update contracts.obligations set due_date = '2026-12-11' where id = 'c1340000-0000-4000-8000-0000000000a1'`;
    const r2 = await scheduleSweepOnce({ db, today: "2026-12-08" });
    expect(r2.emitted).toBe(0);
    expect(await events("milestone.due")).toHaveLength(1);
  });

  it("route test: 404 khi production, chạy được khi test (#63)", async () => {
    const prod = new Hono();
    expect(mountScheduleTestRoute(prod, { db }, "production")).toBe(false);
    expect(mountScheduleTestRoute(prod, { db }, "")).toBe(false); // vắng biến môi trường ⇒ như production
    const r404 = await prod.request("/__test/schedule-sweep", {
      method: "POST",
      body: JSON.stringify({ today: "2026-12-01" }),
    });
    expect(r404.status).toBe(404);
    const dev = new Hono();
    expect(mountScheduleTestRoute(dev, { db }, "test")).toBe(true);
    const bad = await dev.request("/__test/schedule-sweep", {
      method: "POST",
      body: JSON.stringify({ today: "01/12/2026" }),
    });
    expect(bad.status).toBe(400);
    const ok = await dev.request("/__test/schedule-sweep", {
      method: "POST",
      body: JSON.stringify({ today: addDays(END, -10) }),
    });
    expect(ok.status).toBe(200);
    const j = (await ok.json()) as { groups: number; emitted: number };
    expect(j.groups).toBeGreaterThan(0);
    expect(j.emitted).toBe(0); // đã phát ở ca trước ⇒ idempotent
  });
});

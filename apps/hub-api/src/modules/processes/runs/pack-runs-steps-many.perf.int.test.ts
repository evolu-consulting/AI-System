// CR-123 · u10 · cột "Bước" của danh sách HĐ · `stepsViewMany` (đọc thật, role `hub_api`, scope user): 1.000 run có cụm Ký số ⇒ MỘT lô
// cho cả trang (≤ 100 run) cho cùng kết quả như `stepsView` từng run (một nguồn với thẻ duyệt), số câu SQL cố định (không theo số run) ⇒
// p95 của trang 100 run thấp. In số đo thật (p50/p95 ms) để báo cáo.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Db } from "@ai/db";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ProcessDeps } from "../core/ports";
import { stepsView, stepsViewMany } from "./pack-runs-view";

const N = 1000;
const PAGE = 100;
let o: Sql;
let db: Db;
let close: () => Promise<void>;
let tid = "";
let uid = "";
let runIds: string[] = [];

const snap = (signer: string) => ({
  key: "u10",
  name: "U10",
  trigger: { event: "contract.approved" },
  stages: [
    {
      key: "send",
      name: "Ký số",
      node: "contracts.esign",
      step: 0,
      executor: { kind: "tool", args: { company_signers: `user:${signer}` } },
    },
    {
      key: "wait",
      name: "Chờ ký xong",
      node: "contracts.esign",
      step: 1,
      executor: {
        kind: "wait_event",
        event: "esign.completed",
        also_events: ["esign.declined", "esign.voided"],
        timeout_h: 168,
      },
    },
  ],
});

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  const [t] = (await tenants(o, 1, 1237)) as [string];
  tid = t;
  uid = (await users(o, tid, 1, { from: 123_700 }))[0] as string;
  const [d] = await o<{ id: string }[]>`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${tid}, 'u10', 'u10', ${o.json([{ key: "send" }])}) returning id`;
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${tid}, ${uid}, 'c', 'c') returning id`;
  // 1.000 run MỘT câu (set-based): chia 4 nhóm theo i % 4 — chờ ký · đã ký · từ chối · hết hạn
  const rows = await o<{ id: string }[]>`insert into hub.process_runs
      (tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind, input, conversation_id, flow_id,
       current_step, current_stage_idx, status)
    select ${tid}, ${d?.id as string}, 1, ${o.json(snap(uid) as never)}, ${uid}, 'admin', 'x', ${c?.id as string},
      gen_random_uuid(), 1, 1, case when g % 4 = 0 then 'waiting_timer' else 'done' end
    from generate_series(0, ${N - 1}) g returning id`;
  runIds = rows.map((r) => r.id);
  await o`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status)
    select ${tid}, r.id, s.i, case when s.i = 0 then 'done'
        when r.status = 'waiting_timer' then 'waiting_timer' else 'done' end
    from hub.process_runs r cross join (values (0), (1)) s(i) where r.tenant_id = ${tid}`;
  // đã ký / từ chối cho 1/2 và 1/4 số run đã xong; còn lại hết hạn (không có sự kiện)
  await o`insert into hub.process_run_events (tenant_id, process_run_id, event, consumed_by)
    select ${tid}, x.rid, case when x.n % 3 = 0 then 'esign.completed' else 'esign.declined' end, x.sid
    from (select r.id as rid, s.id as sid, row_number() over (order by r.id) as n from hub.process_runs r
      join hub.stage_runs s on s.process_run_id = r.id and s.stage_idx = 1
      where r.tenant_id = ${tid} and r.status = 'done') x where x.n % 3 <> 1`;
  const client = postgres(urls().hubApi, { max: 4, onnotice: () => {} });
  db = { db: drizzle(client), max: 4, close: () => client.end() } as unknown as Db;
  close = () => client.end({ timeout: 2 });
}, 300_000);
afterAll(async () => {
  await close?.();
  await o?.end({ timeout: 2 });
});

const dep = () =>
  ({
    db,
    config: { user: async () => ({ groupIds: new Set<string>() }) },
  }) as never as ProcessDeps;
const who = () => ({ userId: uid, tenantId: tid, role: "member" }) as never;

describe("CR-123 · u10 · stepsViewMany (cột Bước của danh sách)", () => {
  it("cùng kết quả với stepsView từng run: Ký số gộp một bước, nhãn đúng theo trạng thái", async () => {
    const ids = runIds.slice(0, 12);
    const many = await stepsViewMany(dep(), who(), ids);
    expect(many.size).toBe(ids.length);
    for (const id of ids) {
      const one = await stepsView(dep(), who(), id);
      expect(many.get(id)?.steps).toEqual(one?.steps as never);
      expect(many.get(id)?.steps).toHaveLength(1);
    }
    // chờ ký ⇒ bước Ký số gộp, trạng thái nghiệp vụ `waiting` + tên người ký (nhãn "Chờ <người ký> ký" dựng ở gói HĐ từ chính các trường này)
    const waiting = [...many.values()].find((v) => v.status === "waiting_timer");
    expect(waiting?.steps[0]?.module).toMatchObject({
      outcome: "waiting",
      signer: expect.any(String),
    });
  });

  it("trang 100 run trong 1000 run: một lô, p95 thấp (đo thật)", async () => {
    const page = runIds.slice(0, PAGE);
    await stepsViewMany(dep(), who(), page); // làm nóng kết nối
    const ms: number[] = [];
    for (let k = 0; k < 40; k++) {
      const t0 = performance.now();
      const m = await stepsViewMany(dep(), who(), runIds.slice(k * 5, k * 5 + PAGE));
      ms.push(performance.now() - t0);
      expect(m.size).toBe(PAGE);
    }
    ms.sort((a, b) => a - b);
    const p = (q: number) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] as number;
    console.log(
      `u10 perf · stepsViewMany ${PAGE} run trong ${N}: p50 ${p(0.5).toFixed(1)} ms · p95 ${p(0.95).toFixed(1)} ms · max ${(ms.at(-1) as number).toFixed(1)} ms`,
    );
    expect(p(0.95)).toBeLessThan(300);
  });
});

// CR-109 · Luật 4c · review bảo mật #3: danh sách HĐ chế độ `org` cho người duyệt NGOÀI cây (nhánh `reviewer_contract_ids()`, 0070).
// Dữ liệu (set-based, chủ DB): 2.000 HĐ của u1; 1.200 run gói `contracts` — 200 run đang chờ duyệt (task mở giao Group của r),
// 1.000 run đã xong r đã quyết (500 trong 90 ngày, 500 cũ hơn 200 ngày ⇒ ngoài giới hạn). r thấy đúng 700 HĐ.
// Đo dưới RLS thật (`contracts_rw` + `app.user_id`), n = 100 mỗi câu: đếm cả bảng + trang đầu 20 dòng; ngưỡng p95 ≤ 50 ms
// (HD-NFR-01). EXPLAIN thân hàm (sau ANALYZE): không Seq Scan trên bảng hub. Chạy: `PERF=1 bun --config=bunfig.perf.toml test <file>`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  contracts,
  enablePack,
  groups,
  members,
  tenants,
  users,
  visibility,
} from "@ai/test-kit/builders";
import { cloneDb, inPackAs, openOwner, type Sql } from "@ai/test-kit/db";

const N = 100;
let sql: Sql;
let A = "";
let u1 = "";
let r = "";

const p95 = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] as number;

type RunsOpts = {
  t: string;
  owner: string;
  decider: string;
  group: string;
  runs: number;
  open: number;
  recent: number;
};
/** `runs` run gói của `runs` HĐ đầu tiên của tenant: `open` run đầu chờ duyệt (task mở giao `group`), còn lại xong, `decider`
 *  đã quyết; `recent` run kế quyết 1 ngày trước, phần còn lại 200 ngày trước. Bảng ánh xạ thường (không temp: pool 2 kết nối). */
async function seedRuns(o: RunsOpts): Promise<void> {
  const stages = [{ key: "doc", name: "Duyệt", after: { kind: "review", group_id: o.group } }];
  const [def] = await sql<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, description, input_hint,
      stages, token_budget, enabled, version)
    values (${o.t}, 'cr109-perf', 'Duyệt HĐ', 'perf', 'x', ${sql.json(stages)}, null, true, 1) returning id`;
  const snap = {
    key: "cr109-perf",
    name: "Duyệt HĐ",
    stages,
    token_budget: null,
    run_group_ids: [],
  };
  await sql`drop table if exists public.cr109_m`;
  await sql`create unlogged table public.cr109_m as
    select gen_random_uuid() as run, gen_random_uuid() as conv, gen_random_uuid() as flow, gen_random_uuid() as sr,
      gen_random_uuid() as out, k.id as cid, k.rn
    from (select id, row_number() over (order by id) as rn from contracts.contracts where tenant_id = ${o.t}) k
    where k.rn <= ${o.runs}`;
  const open = o.open;
  const recentTo = o.open + o.recent;
  await sql`insert into hub.conversations (id, tenant_id, user_id, title, title_norm, process_run_id)
    select conv, ${o.t}, ${o.owner}, 'perf', 'perf', run from public.cr109_m`;
  await sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count)
    select flow, ${o.t}, ${o.owner}, conv, 'perf', 1 from public.cr109_m`;
  await sql`insert into hub.process_runs (id, tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind, input,
      conversation_id, flow_id, status, current_stage_idx, expires_at, finished_at, pack_key, pack_record_id)
    select run, ${o.t}, ${def?.id as string}, 1, ${sql.json(snap)}, ${o.owner}, 'admin', 'x', conv, flow,
      case when rn <= ${open} then 'waiting_review' else 'done' end, 0, now() + interval '7 days',
      case when rn <= ${open} then null else now() end, 'contracts', cid
    from public.cr109_m`;
  await sql`insert into hub.stage_runs (id, tenant_id, process_run_id, stage_idx, status)
    select sr, ${o.t}, run, 0, case when rn <= ${open} then 'waiting_review' else 'done' end from public.cr109_m`;
  await sql`insert into hub.process_outputs (id, tenant_id, process_run_id, stage_run_id, stage_idx, version, attempt,
      content, template_ok)
    select out, ${o.t}, run, sr, 0, 1, 1, 'ok', true from public.cr109_m`;
  await sql`insert into hub.review_tasks (tenant_id, process_run_id, stage_run_id, kind, status, output_id,
      assignee_group_id, result, decided_by, decided_at)
    select ${o.t}, run, sr, 'review', case when rn <= ${open} then 'open' else 'closed' end, out, ${o.group}::uuid,
      case when rn <= ${open} then null else 'pass' end,
      case when rn <= ${open} then null else ${o.decider}::uuid end,
      case when rn <= ${open} then null when rn <= ${recentTo} then now() - interval '1 day'
        else now() - interval '200 days' end
    from public.cr109_m`;
  await sql`drop table public.cr109_m`;
}

async function seed(): Promise<void> {
  const [ta, tb] = (await tenants(sql, 2, 1901)) as [string, string];
  A = ta;
  [u1, r] = (await users(sql, A, 2, { from: 1901 })) as [string, string];
  const [z] = (await users(sql, tb, 1, { from: 1911 })) as [string];
  const roles = await enablePack(sql, [A, tb], "contracts");
  await members(sql, A, roles.get(A)?.editor as string, [u1, r]);
  const g = (await groups(sql, A, ["cr109-duyet"])).get("cr109-duyet") as string;
  const gb = (await groups(sql, tb, ["cr109-duyet"])).get("cr109-duyet") as string;
  await members(sql, A, g, [r]);
  await visibility(sql, [A, tb], "org");
  await contracts(sql, A, 2000, { from: 1901, createdBy: u1, owner: u1 });
  // Nền tenant khác (cùng bảng hub): 20.000 HĐ / run đã xong do z quyết gần đây ⇒ index phải lọc theo người + tenant.
  await contracts(sql, tb, 20_000, { from: 10_001, createdBy: z, owner: z });
  await seedRuns({ t: A, owner: u1, decider: r, group: g, runs: 1200, open: 200, recent: 500 });
  await seedRuns({ t: tb, owner: z, decider: z, group: gb, runs: 20_000, open: 0, recent: 20_000 });
  await sql`analyze hub.process_runs, hub.stage_runs, hub.review_tasks, contracts.contracts, admin.group_members`;
}

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  await seed();
}, 180_000);
afterAll(async () => {
  await sql?.end({ timeout: 1 });
});

async function measure(user: string): Promise<{ count: number; pCount: number; pPage: number }> {
  return inPackAs("contracts", A, user, async (tx) => {
    const tc: number[] = [];
    const tp: number[] = [];
    let count = -1;
    for (let i = 0; i < N + 5; i++) {
      let t0 = performance.now();
      const [c] = await tx<{ n: number }[]>`select count(*)::int as n from contracts.contracts`;
      const d1 = performance.now() - t0;
      t0 = performance.now();
      await tx`select id, title from contracts.contracts order by updated_at desc, id limit 20`;
      const d2 = performance.now() - t0;
      if (i >= 5) {
        tc.push(d1);
        tp.push(d2);
      }
      count = c?.n ?? -1;
    }
    return { count, pCount: p95(tc), pPage: p95(tp) };
  });
}

describe("CR-109 · perf danh sách HĐ chế độ org với người duyệt ngoài cây", () => {
  it("r thấy đúng 700 HĐ (200 mở + 500 đã quyết ≤ 90 ngày), p95 ≤ 50 ms, thân hàm không Seq Scan bảng hub", async () => {
    const asR = await measure(r);
    const asOwner = await measure(u1);
    console.log(
      `CR-109 perf · reviewer: count p95=${asR.pCount.toFixed(2)} ms, page p95=${asR.pPage.toFixed(2)} ms (thấy ${asR.count}) · chủ HĐ: count p95=${asOwner.pCount.toFixed(2)} ms, page p95=${asOwner.pPage.toFixed(2)} ms (thấy ${asOwner.count}) · n=${N}`,
    );
    const [{ src } = { src: "" }] = await sql<{ src: string }[]>`select prosrc as src from pg_proc
      where proname = 'reviewer_contract_ids' and pronamespace = 'contracts'::regnamespace`;
    const plan = await sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${A}, true), set_config('app.user_id', ${r}, true)`;
      return (await tx.unsafe(`explain ${src}`)) as unknown as { "QUERY PLAN": string }[];
    });
    const text = plan.map((p) => p["QUERY PLAN"]).join("\n");
    const seq = text
      .split("\n")
      .filter((l) =>
        /Seq Scan on (review_tasks|process_runs|stage_runs|review_task_assignees)/.test(l),
      );
    if (seq.length) console.log(text);
    expect({ count: asR.count, owner: asOwner.count, seq }).toEqual({
      count: 700,
      owner: 2000,
      seq: [],
    });
    expect(Math.max(asR.pCount, asR.pPage)).toBeLessThanOrEqual(50);
  }, 180_000);
});

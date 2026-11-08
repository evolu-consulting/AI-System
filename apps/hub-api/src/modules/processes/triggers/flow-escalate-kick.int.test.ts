// cr125-fix-escalate-kick · flow theo sự kiện (Thư viện) có `after.escalate` ({after_h, group_key}) ở bước Duyệt đầu: mở lượt ⇒ bước 0
// chờ duyệt + task có hạn chuyển cấp (escalate_at + Group Toàn quyền). Trước sửa: kick lỗi, mọi stage_runs `pending`, lỗi bị nuốt.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { contracts, department, enablePack, members, tenantId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import {
  actApproval,
  approvalEngineRepo,
  approvalRepo,
  contractFlowRepo,
  contractsFactsReader,
  contractsOutcomeHandler,
  startApproval,
} from "../../packs/contracts/testing";
import { createPackUow } from "../../packs/kit/adapters/pack-uow";
import {
  registerFactsReader,
  registerOutcomeHandler,
  unregisterFlowPorts,
} from "../adapters/runs/flow-ports";
import type { ProcessDeps } from "../core/ports";
import { createStageLauncher } from "../runs/launcher";
import { dispatchOnce } from "./dispatcher";
import { setFlowTriggers } from "./flags";
import { flowLaunchOf } from "./flow-launch";

const T = tenantId(1361);
let A = "";
let OWN = "";
let C = "";
const T2 = tenantId(1365);
let A2 = "";
let C2: string[] = [];
let o: Sql;
let db: Db;
const warns: { msg: string; f: Record<string, unknown> }[] = [];

const base = (key: string, name: string, step: number) => ({
  key,
  name,
  step,
  instruction: "",
  output: { filename: `${key}.md`, template: "x", required_sections: ["x"], fields: [] },
  real_action: false,
  answerer: { kind: "starter" },
  token_budget: null,
});
const STAGES = [
  {
    ...base("duyet-kt", "Duyệt Kế toán", 0),
    executor: { kind: "approve", reject_step: null, return_step: null },
    after: {
      kind: "review",
      group_id: null,
      group_key: "pb-ke-toan",
      back_to_steps: [],
      remind_every_h: 24,
      escalate: { after_h: 48, group_key: "contracts-owner" },
      branch: [],
      exclude_starter: false,
    },
  },
  {
    ...base("xong", "Đã duyệt", 1),
    executor: { kind: "set", values: [] },
    after: { kind: "auto", branch: [] },
    outcome: "approved",
  },
];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 6);
  await o`insert into admin.tenants (id, key, name) values (${T}, 't1361', 'T')`;
  [A] = (await users(o, T, 2, { from: 1361 })) as [string];
  const roles = (await enablePack(o, [T], "contracts")).get(T);
  OWN = roles?.owner as string;
  await members(o, T, roles?.editor as string, [A]);
  await department(o, T, "pb-kd", { head: A, members: [A] });
  await department(o, T, "pb-ke-toan", { head: null, members: [] });
  [C] = (await contracts(o, T, 1, { from: 1361, createdBy: A, status: "needs_review" })) as [
    string,
  ];
  const st = JSON.stringify(STAGES);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger,
      app, published_version, enabled) values (null, 'esc-kick', 'Duyệt HĐ', ${st}::text::jsonb,
      '{"event":"contract.submitted"}'::jsonb, 'contracts', 1, true) returning id::text as id`;
  const lib = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${lib}, 1, 'Duyệt HĐ', ${st}::text::jsonb)`;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${T}, ${lib}, true)`;
  await withHubScope(db, { kind: "system" }, (tx) => setFlowTriggers(tx, T, true));
  // T2 · bản công ty (def của tenant, chỉ id): Group chuyển cấp đã mất khi sao (`group_id` null)
  await o`insert into admin.tenants (id, key, name) values (${T2}, 't1365', 'T2')`;
  [A2] = (await users(o, T2, 1, { from: 1365 })) as [string];
  const r2 = (await enablePack(o, [T2], "contracts")).get(T2);
  await members(o, T2, r2?.editor as string, [A2]);
  await department(o, T2, "pb-kd", { head: A2, members: [A2] });
  const g2 = await department(o, T2, "pb-ke-toan", { head: null, members: [] });
  C2 = await contracts(o, T2, 2, { from: 1365, createdBy: A2, status: "needs_review" });
  const s0 = STAGES[0] as (typeof STAGES)[number] & { after: Record<string, unknown> };
  const { group_key: _k, ...after0 } = s0.after;
  const own = [
    { ...s0, after: { ...after0, group_id: g2, escalate: { after_h: 48, group_id: null } } },
    STAGES[1],
  ];
  const [d2] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger,
      app, published_version, enabled) values (${T2}, 'esc-kick-own', 'Duyệt HĐ', ${JSON.stringify(own)}::text::jsonb,
      '{"event":"contract.submitted"}'::jsonb, 'contracts', 1, true) returning id::text as id`;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${T2}, ${d2?.id as string}, true)`;
  await withHubScope(db, { kind: "system" }, (tx) => setFlowTriggers(tx, T2, true));
  registerOutcomeHandler(contractsOutcomeHandler());
  registerFactsReader(contractsFactsReader(db));
}, 120_000);
afterAll(async () => {
  unregisterFlowPorts("contracts");
  await db?.close();
  await o?.end({ timeout: 2 });
});

const pipe: unknown = new Proxy(
  {},
  { get: (_, k) => (k === "exec" ? async () => [] : () => pipe) },
);
function deps(): ProcessDeps {
  const d = {
    db,
    config: {
      user: async () => ({ active: true, groupIds: new Set<string>() }),
      poll: async () => {},
      catalog: async () => ({ features: [], entitled: new Set(), grantGroups: new Map() }),
    },
    redis: { pipeline: () => pipe },
    notifier: new Proxy({}, { get: () => async () => [] }),
    log: {
      warn: (msg: string, f: Record<string, unknown>) => warns.push({ msg, f }),
      info: () => {},
      error: () => {},
    },
    now: () => new Date(),
    runsPerTenant: 100,
    postThread: async () => {},
  } as unknown as ProcessDeps & { launcher: unknown };
  d.launcher = createStageLauncher(d as never);
  return d;
}
const uow = () =>
  createPackUow(db, "contracts", (tx, tid) => ({
    approval: approvalRepo(tx, tid),
    approvalEngine: approvalEngineRepo(tx, tid),
    contractFlow: contractFlowRepo(tx, tid),
  }));
const ad = () =>
  ({
    uow: uow(),
    flow: { prepare: async () => ({ on: true, departments: null }) },
    jobs: { enqueue: async () => {} },
    groups: {
      idsOf: async () => new Map(),
      userGroups: async () => new Set(),
      actionsOf: async () => new Set(["read", "write"]),
    },
  }) as never;

describe("cr125-fix-escalate-kick · flow theo sự kiện có chuyển cấp ở bước Duyệt đầu", () => {
  it("mở lượt ⇒ bước 0 chờ duyệt, task có hạn chuyển cấp về Group Toàn quyền, không có process-kick-failed", async () => {
    const wa = { tenantId: T, userId: A };
    expect(await startApproval(ad())(wa, C, "level1")).toBe("ok");
    expect(await actApproval(ad())(wa, C, { action: "approve" })).not.toHaveProperty("error");
    expect(await dispatchOnce({ db, launch: flowLaunchOf(deps()) })).toMatchObject({ launched: 1 });
    expect(warns.filter((w) => w.msg === "process-kick-failed")).toEqual([]);
    const [run] = await o<{ id: string; status: string }[]>`select id::text as id, status
      from hub.process_runs where tenant_id = ${T} order by started_at desc limit 1`;
    const st = await o<{ idx: number; status: string }[]>`select stage_idx::int as idx, status
      from hub.stage_runs where process_run_id = ${run?.id as string} order by stage_idx`;
    expect(st[0]).toMatchObject({ idx: 0, status: "waiting_review" });
    const [t] = await o<{ esc_at: Date | null; esc_g: string | null; remind: number | null }[]>`
      select t.escalate_at as esc_at, t.escalate_group_id::text as esc_g, t.remind_every_h as remind
      from hub.review_tasks t where t.process_run_id = ${run?.id as string} and t.status = 'open'`;
    expect(t?.esc_g).toBe(OWN);
    expect(t?.esc_at).not.toBeNull();
    expect(t?.remind).toBe(24);
  });

  it("bản công ty: escalate thiếu Group (group_id null) ⇒ bước 0 vẫn mở, không chuyển cấp (trước sửa: vi phạm review_tasks_remind_ck)", async () => {
    const w2 = { tenantId: T2, userId: A2 };
    expect(await startApproval(ad())(w2, C2[0] as string, "level1")).toBe("ok");
    expect(await actApproval(ad())(w2, C2[0] as string, { action: "approve" })).not.toHaveProperty(
      "error",
    );
    expect(await dispatchOnce({ db, launch: flowLaunchOf(deps()) })).toMatchObject({ launched: 1 });
    const run = await lastRun(T2);
    expect(run?.status).toBe("waiting_review");
    const [t] = await o<
      { esc_at: Date | null }[]
    >`select escalate_at as esc_at from hub.review_tasks
      where process_run_id = ${run?.id as string} and status = 'open'`;
    expect(t).toBeDefined();
    expect(t?.esc_at).toBeNull();
  });
});

describe("cr125-fix-escalate-kick · kick lỗi", () => {
  it("kick lỗi ⇒ log có mã + lượt 'Cần xử lý' start_failed (không pending mãi)", async () => {
    const w2 = { tenantId: T2, userId: A2 };
    const id = C2[1] as string;
    expect(await startApproval(ad())(w2, id, "level1")).toBe("ok");
    expect(await actApproval(ad())(w2, id, { action: "approve" })).not.toHaveProperty("error");
    const d = deps() as ProcessDeps & { launcher: unknown };
    const boom = Object.assign(new Error("check"), {
      code: "23514",
      constraint_name: "review_tasks_remind_ck",
    });
    d.launcher = {
      kick: async () => {
        throw boom;
      },
    };
    warns.length = 0;
    expect(await dispatchOnce({ db, launch: flowLaunchOf(d) })).toMatchObject({ launched: 1 });
    const run = await lastRun(T2);
    expect(warns.find((w) => w.msg === "process-kick-failed")?.f).toMatchObject({
      run_id: run?.id,
      code: "23514:review_tasks_remind_ck",
    });
    const [r] = await o<{ status: string; reason: string; code: string }[]>`select status,
      decision->>'reason' as reason, decision->>'code' as code from hub.process_runs where id = ${run?.id as string}`;
    expect(r).toMatchObject({
      status: "needs_decision",
      reason: "start_failed",
      code: "23514:review_tasks_remind_ck",
    });
    const [s] = await o<
      { status: string; err: string | null }[]
    >`select status, last_error_code as err
      from hub.stage_runs where process_run_id = ${run?.id as string} and stage_idx = 0`;
    expect(s).toMatchObject({ status: "needs_decision", err: "23514:review_tasks_remind_ck" });
  });
});

const lastRun = async (tid: string) =>
  (
    await o<{ id: string; status: string }[]>`select id::text as id, status from hub.process_runs
      where tenant_id = ${tid} order by started_at desc, id desc limit 1`
  )[0];

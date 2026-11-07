// CR-122 · P11g · e2e G1.2 rẽ SAI nhánh: HĐ 150 tr (cột HĐ `fields.total_value.value = 150000000`, số — trace 20261107-004406) mà node
// Nếu "giá trị > 100 tr" ra Sai. Gốc: lượt mở từ sự kiện không ghi `snapshot.trigger.event` ⇒ engine không tìm được `FactsReader`
// (`step.repo.ts packOf` cần (gói, bản ghi, sự kiện)) ⇒ vế `fact` rỗng ⇒ luôn Sai. Đường thật: cờ bật, AI đã điền giá trị, "Xác nhận và
// lưu" ⇒ dispatchOnce (launcher thật, node Nếu chạy đồng bộ) ⇒ 150 tr mở "Duyệt giá trị lớn" (stage 1), 50 tr mở "Duyệt giá trị nhỏ" (2).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { contracts, groups, tenantId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import {
  actApproval,
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

const T = tenantId(1321);
let A = "";
let C: string[] = [];
let o: Sql;
let db: Db;

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
const approve = (key: string, name: string, step: number) => ({
  ...base(key, name, step),
  executor: { kind: "approve", reject_step: null, return_step: null },
  after: {
    kind: "review",
    group_id: null,
    group_key: "pb-ke-toan",
    back_to_steps: [],
    remind_every_h: null,
    escalate: null,
    branch: [],
    exclude_starter: false,
  },
});
/** 0 Nếu(giá trị > 100 tr: Đúng→1, Sai→2) · 1 Duyệt lớn · 2 Duyệt nhỏ. */
const STAGES = [
  {
    ...base("nhanh", "Giá trị lớn hơn 100 triệu", 0),
    executor: {
      kind: "if",
      when: {
        op: "and",
        conds: [{ from: { kind: "fact", key: "total_value" }, op: "gt", value: 100_000_000 }],
      },
      then_step: 1,
      else_step: 2,
    },
    after: { kind: "auto", branch: [] },
  },
  { ...approve("duyet-lon", "Duyệt giá trị lớn", 1), next_step: 3 },
  approve("duyet-nho", "Duyệt giá trị nhỏ", 2),
];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 6);
  await o`insert into admin.tenants (id, key, name) values (${T}, 't1321', 'T')`;
  [A] = (await users(o, T, 1, { from: 1321 })) as [string];
  await groups(o, T, ["pb-ke-toan"]);
  C = await contracts(o, T, 2, { from: 1321, createdBy: A, status: "needs_review" });
  // như sau khi AI đọc xong: giá trị nằm ở cột HĐ (số)
  await o`update contracts.contracts set deal = 'buy', direction = 'purchase',
    fields = jsonb_build_object('total_value', jsonb_build_object('value', 150000000)) where id = ${C[0] as string}`;
  await o`update contracts.contracts set deal = 'buy', direction = 'purchase',
    fields = jsonb_build_object('total_value', jsonb_build_object('value', 50000000)) where id = ${C[1] as string}`;
  const st = JSON.stringify(STAGES);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger,
      app, published_version, enabled) values (null, 'p11g-if', 'Duyệt HĐ', ${st}::text::jsonb,
      '{"event":"contract.submitted"}'::jsonb, 'contracts', 1, true) returning id::text as id`;
  const lib = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${lib}, 1, 'Duyệt HĐ', ${st}::text::jsonb)`;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${T}, ${lib}, true)`;
  await withHubScope(db, { kind: "system" }, (tx) => setFlowTriggers(tx, T, true));
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
    log: { warn: () => {}, info: () => {}, error: () => {} },
    now: () => new Date(),
    runsPerTenant: 100,
    postThread: async () => {},
  } as unknown as ProcessDeps & { launcher: unknown };
  d.launcher = createStageLauncher(d as never);
  return d;
}
const ad = () =>
  ({
    uow: createPackUow(db, "contracts", (tx, tid) => ({
      approval: approvalRepo(tx, tid),
      contractFlow: contractFlowRepo(tx, tid),
    })),
    flow: { prepare: async () => ({ on: true, departments: null }) },
    jobs: { enqueue: async () => {} },
    groups: {
      idsOf: async () => new Map(),
      userGroups: async () => new Set(),
      actionsOf: async () => new Set(["read", "write", "admin"]),
    },
  }) as never;
/** Gửi duyệt như người dùng: nháp chờ rà soát (level1) ⇒ "Xác nhận và lưu" ⇒ một lượt điều phối. */
async function submitAndDispatch(id: string) {
  const who = { tenantId: T, userId: A };
  expect(await startApproval(ad())(who, id, "level1")).toBe("ok");
  expect(await actApproval(ad())(who, id, { action: "approve" })).not.toHaveProperty("error");
  expect(await dispatchOnce({ db, launch: flowLaunchOf(deps()) })).toMatchObject({ launched: 1 });
}
const openStageOf = async (cid: string) =>
  (
    await o<{ idx: number }[]>`select s.stage_idx::int as idx from hub.process_runs r
      join hub.review_tasks t on t.process_run_id = r.id and t.status = 'open'
      join hub.stage_runs s on s.id = t.stage_run_id
      where r.pack_key = 'contracts' and r.pack_record_id = ${cid}`
  ).map((x) => x.idx);
const branchReads = async (cid: string) =>
  (
    await o<{ facts: { matched: boolean; reads: { key: string; value: unknown }[] } }[]>`
      select a.summary->'facts' as facts from hub.audit_log a
      join hub.process_runs r on r.id::text = a.entity_id::text
      where r.pack_record_id = ${cid} and a.action = 'branch'`
  )[0]?.facts;

describe("CR-122 P11g · node Nếu đọc giá trị HĐ thật khi lượt mở từ sự kiện", () => {
  it("150 tr ⇒ Nếu Đúng ⇒ 'Duyệt giá trị lớn' mở (stage 1), facts đọc 150000000", async () => {
    await submitAndDispatch(C[0] as string);
    expect(await openStageOf(C[0] as string)).toEqual([1]);
    expect(await branchReads(C[0] as string)).toMatchObject({
      matched: true,
      reads: [{ key: "total_value", value: 150000000 }],
    });
  });

  it("50 tr ⇒ Nếu Sai ⇒ 'Duyệt giá trị nhỏ' mở (stage 2)", async () => {
    await submitAndDispatch(C[1] as string);
    expect(await openStageOf(C[1] as string)).toEqual([2]);
  });
});

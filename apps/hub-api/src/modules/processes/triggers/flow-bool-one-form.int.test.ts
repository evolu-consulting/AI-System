// CR-123 · u15 · MỘT dạng boolean: def tạo qua API (Hono thật) với vế Có/Không là boolean THẬT `true` ⇒ 201 (trước: 400 invalid_union ở conds.N.value);
// lưu thành boolean; chạy thật từ sự kiện: HĐ có đối tác mới ⇒ Nếu Đúng, đối tác cũ ⇒ Sai. (Bản gốc: CR-122 · P11g · rẽ SAI nhánh: HĐ 150 tr (cột HĐ `fields.total_value.value = 150000000`, số — trace 20261107-004406) mà node
// Nếu "giá trị > 100 tr" ra Sai. Gốc: lượt mở từ sự kiện không ghi `snapshot.trigger.event` ⇒ engine không tìm được `FactsReader`
// (`step.repo.ts packOf` cần (gói, bản ghi, sự kiện)) ⇒ vế `fact` rỗng ⇒ luôn Sai. Đường thật: cờ bật, AI đã điền giá trị, "Xác nhận và
// lưu" ⇒ dispatchOnce (launcher thật, node Nếu chạy đồng bộ) ⇒ 150 tr mở "Duyệt giá trị lớn" (stage 1), 50 tr mở "Duyệt giá trị nhỏ" (2).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { withHubScope } from "@ai/db/hub-scope";
import { contracts, groups, tenantId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import { approvalRepo } from "../../packs/contracts/adapters/approval.repo";
import { contractFlowRepo } from "../../packs/contracts/adapters/contract-flow.repo";
import { actApproval, startApproval } from "../../packs/contracts/application/approval.usecase";
import {
  contractsFactsReader,
  contractsOutcomeHandler,
} from "../../packs/contracts/flow-events.mount";
import { createPackUow } from "../../packs/kit/adapters/pack-uow";
import {
  registerFactsReader,
  registerOutcomeHandler,
  unregisterFlowPorts,
} from "../adapters/runs/flow-ports";
import type { ProcessDeps } from "../core/ports";
import { defsRoutes } from "../defs/defs.routes";
import { createStageLauncher } from "../runs/launcher";
import { dispatchOnce } from "./dispatcher";
import { setFlowTriggers } from "./flags";
import { flowLaunchOf } from "./flow-launch";

const T = tenantId(1561);
let A = "";
let C: string[] = [];
let o: Sql;
let db: Db;
let app: Hono<AuthVars>;

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
/** 0 Nếu(đối tác mới LÀ Có — boolean thật: Đúng→1, Sai→2) · 1 Duyệt đối tác mới · 2 Duyệt đối tác cũ · 3 Kết thúc. */
const STAGES = [
  {
    ...base("nhanh", "Đối tác mới?", 0),
    executor: {
      kind: "if",
      when: {
        op: "and",
        conds: [{ from: { kind: "fact", key: "new_partner" }, op: "eq", value: true }],
      },
      then_step: 1,
      else_step: 2,
    },
    after: { kind: "auto", branch: [] },
  },
  { ...approve("duyet-moi", "Duyệt đối tác mới", 1), next_step: 3 },
  approve("duyet-cu", "Duyệt đối tác cũ", 2),
  {
    ...base("xong", "Kết thúc", 3),
    executor: { kind: "set", values: [] },
    after: { kind: "auto", branch: [] },
    outcome: "approved",
  },
];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 6);
  await o`insert into admin.tenants (id, key, name) values (${T}, 't1561', 'T')`;
  [A] = (await users(o, T, 1, { from: 1561 })) as [string];
  await groups(o, T, ["pb-ke-toan"]);
  C = await contracts(o, T, 3, { from: 1561, createdBy: A, status: "needs_review" });
  // C0: đối tác CHƯA có HĐ nào đã xác nhận ⇒ new_partner = true; C1: đối tác cũ (C2 đã xác nhận) ⇒ false
  // `partner_key` là cột sinh từ tên bên cung cấp (`supplier_name`) của HĐ mua ⇒ đặt tên bên kia
  const party = (id: string, name: string, confirmed: boolean) =>
    o`update contracts.contracts set deal = 'buy', direction = 'purchase',
      fields = jsonb_build_object('supplier_name', jsonb_build_object('value', ${name}::text)),
      confirmed_at = ${confirmed ? o`now()` : null} where id = ${id}`;
  await party(C[0] as string, "Công ty Đối Tác Mới", false);
  await party(C[1] as string, "Công ty Đối Tác Cũ", false);
  await party(C[2] as string, "Công ty Đối Tác Cũ", true); // 1) tạo def QUA API với boolean thật
  app = new Hono<AuthVars>();
  app.use("*", async (c, next) => {
    c.set("user", { userId: A, tenantId: T, role: "tenant_admin" as Role } as never);
    await next();
  });
  app.onError((e, c) => {
    const m = mapError(e);
    if (m.status === 500) console.error(e);
    return c.json(m.body, m.status);
  });
  const config = {
    catalog: async () => ({
      features: [{ id: "f1", key: "contracts-write", status: "on" }],
      entitled: new Set([`${T}:f1`]),
      grantGroups: new Map(),
    }),
    user: async () => undefined,
  };
  app.route(
    "/",
    defsRoutes({
      db,
      packTools: { available: async () => [] },
      start: {},
      config,
    } as unknown as ProcessDeps),
  );
  registerOutcomeHandler(contractsOutcomeHandler());
  registerFactsReader(contractsFactsReader(db));
}, 120_000);
afterAll(async () => {
  unregisterFlowPorts("contracts");
  await db?.close();
  await o?.end({ timeout: 2 });
});

/** Tạo def qua API (đường người dùng) rồi gán cho công ty như sau khi Thư viện xuất bản (bản lưu đọc lại từ DB ⇒ đúng dạng đã chuẩn hoá). */
async function createViaApiAndAssign(): Promise<{ status: number; value: unknown }> {
  const r = await app.request("/process-defs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      key: "u15-bool",
      name: "Duyệt theo đối tác",
      description: "",
      input_hint: "",
      run_group_ids: [],
      stages: STAGES,
      token_budget: null,
      enabled: true,
      sources: [],
      inputs: [],
      trigger: { event: "contract.submitted" },
      app: "contracts",
    }),
  });
  const json = (await r.json()) as { id?: string };
  if (r.status >= 300) return { status: r.status, value: json };
  const [row] = await o<{ stages: { executor: { when?: { conds: { value: unknown }[] } } }[] }[]>`
    select stages from hub.process_defs where id = ${json.id as string}`;
  const st = JSON.stringify(row?.stages);
  const [lib] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger,
      app, published_version, enabled) values (null, 'u15-lib', 'Duyệt đối tác', ${st}::text::jsonb,
      '{"event":"contract.submitted"}'::jsonb, 'contracts', 1, true) returning id::text as id`;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${lib?.id as string}, 1, 'Duyệt đối tác', ${st}::text::jsonb)`;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${T}, ${lib?.id as string}, true)`;
  await withHubScope(db, { kind: "system" }, (tx) => setFlowTriggers(tx, T, true));
  return { status: r.status, value: row?.stages[0]?.executor.when?.conds[0]?.value };
}
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

describe("CR-123 u15 · MỘT dạng boolean cho vế Có/Không của node Nếu", () => {
  it("tạo def qua API với boolean thật ⇒ 201 và lưu đúng boolean", async () => {
    const r = await createViaApiAndAssign();
    expect(r.status).toBe(201);
    expect(r.value).toBe(true);
  });

  it("đối tác MỚI ⇒ Nếu Đúng ⇒ 'Duyệt đối tác mới' mở (stage 1), facts đọc boolean true", async () => {
    await submitAndDispatch(C[0] as string);
    expect(await openStageOf(C[0] as string)).toEqual([1]);
    expect(await branchReads(C[0] as string)).toMatchObject({
      matched: true,
      reads: [{ key: "new_partner", value: true }],
    });
  });

  it("đối tác CŨ ⇒ Nếu Sai ⇒ 'Duyệt đối tác cũ' mở (stage 2)", async () => {
    await submitAndDispatch(C[1] as string);
    expect(await openStageOf(C[1] as string)).toEqual([2]);
  });
});

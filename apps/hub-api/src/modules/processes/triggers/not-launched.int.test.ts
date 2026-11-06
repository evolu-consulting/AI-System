// CR-122 · P11b · lượt duyệt HĐ chờ flow mà KHÔNG mở được run thì không kẹt mãi: (1) 0 flow khớp ⇒ thẻ ghi lý do FLOW_NOT_ASSIGNED (web:
// "chưa có quy trình … gán ở Công ty › Quy trình, rồi bấm Mở lại"); gán flow + Mở lại (phát lại sự kiện, event_id mới) ⇒ lượt chạy đúng;
// (2) flow cần nhóm công ty chưa có ⇒ lý do FLOW_GROUP_MISSING:<mã>. Đường thật: dispatchOnce + flowLaunchOf + launcher thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { contracts, tenantId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import { approvalRepo } from "../../packs/contracts/adapters/approval.repo";
import { contractFlowRepo } from "../../packs/contracts/adapters/contract-flow.repo";
import { startApproval } from "../../packs/contracts/application/approval.usecase";
import { withFlowResend } from "../../packs/contracts/application/flow-resend.usecase";
import { contractsOutcomeHandler } from "../../packs/contracts/flow-events.mount";
import { createPackUow } from "../../packs/kit/adapters/pack-uow";
import { registerOutcomeHandler, unregisterFlowPorts } from "../adapters/runs/flow-ports";
import type { ProcessDeps } from "../core/ports";
import { createStageLauncher } from "../runs/launcher";
import { dispatchOnce } from "./dispatcher";
import { setFlowTriggers } from "./flags";
import { flowLaunchOf } from "./flow-launch";

const N = tenantId(1301); // chưa gán flow
const G = tenantId(1302); // flow cần nhóm chưa có
let UN = "";
let UG = "";
let CN = "";
let CG = "";
let lib = "";
let o: Sql;
let db: Db;

const stage = (groupKey: string) => ({
  key: "duyet",
  name: "Duyệt pháp chế",
  step: 0,
  instruction: "",
  output: { filename: "d.md", template: "x", required_sections: ["x"], fields: [] },
  real_action: false,
  answerer: { kind: "starter" },
  token_budget: null,
  executor: { kind: "approve", reject_step: null, return_step: null },
  after: {
    kind: "review",
    group_id: null,
    group_key: groupKey,
    back_to_steps: [],
    remind_every_h: null,
    escalate: null,
    branch: [],
    exclude_starter: false,
  },
});

async function libFlow(key: string, groupKey: string): Promise<string> {
  const st = JSON.stringify([stage(groupKey)]);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger,
      app, published_version, enabled) values (null, ${key}, 'Duyệt HĐ', ${st}::text::jsonb,
      '{"event":"contract.submitted"}'::jsonb, 'contracts', 1, true) returning id::text as id`;
  const id = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${id}, 1, 'Duyệt HĐ', ${st}::text::jsonb)`;
  return id;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 6);
  await o`insert into admin.tenants (id, key, name) values (${N}, 't1301', 'N'), (${G}, 't1302', 'G')`;
  [UN] = (await users(o, N, 1, { from: 1301 })) as [string];
  [UG] = (await users(o, G, 1, { from: 1302 })) as [string];
  CN = (
    await contracts(o, N, 1, { from: 1301, createdBy: UN, status: "needs_review" })
  )[0] as string;
  CG = (
    await contracts(o, G, 1, { from: 1302, createdBy: UG, status: "needs_review" })
  )[0] as string;
  await o`insert into admin.groups (tenant_id, key, name) values (${N}, 'pb-phap-che', '{"vi":"Pháp chế"}'::jsonb)`;
  lib = await libFlow("p11b-ok", "pb-phap-che");
  const missing = await libFlow("p11b-miss", "pb-khong-co");
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${G}, ${missing}, true)`;
  await withHubScope(db, { kind: "system" }, async (tx) => {
    await setFlowTriggers(tx, N, true);
    await setFlowTriggers(tx, G, true);
  });
  registerOutcomeHandler(contractsOutcomeHandler());
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
const uow = () =>
  createPackUow(db, "contracts", (tx, tid) => ({
    approval: approvalRepo(tx, tid),
    contractFlow: contractFlowRepo(tx, tid),
  }));
const gateOn = { prepare: async () => ({ on: true, departments: null }) };
const ad = () =>
  ({ uow: uow(), flow: gateOn, jobs: { enqueue: async () => {} }, groups: {} }) as never;
const dispatch = () =>
  dispatchOnce({ db, launch: flowLaunchOf(deps()), now: () => new Date(Date.now() + 1000) });
const approvalOf = async (cid: string) =>
  (
    await o<{ run: string | null; feedback: string | null; status: string }[]>`
      select a.engine_run_id::text as run, a.feedback, a.status from contracts.approvals a
      join contracts.contracts c on c.run_id = a.id where c.id = ${cid}`
  )[0];

describe("CR-122 P11b · lượt chờ flow không mở được run", () => {
  it("0 flow khớp ⇒ lý do FLOW_NOT_ASSIGNED, gán flow + Mở lại (event_id mới) ⇒ run gắn vào lượt", async () => {
    const who = { tenantId: N, userId: UN };
    expect(await startApproval(ad())(who, CN, "level1")).toBe("ok");
    expect(await dispatch()).toMatchObject({ claimed: 1, launched: 0 });
    expect(await approvalOf(CN)).toMatchObject({
      run: null,
      feedback: "FLOW_NOT_ASSIGNED",
      status: "level1",
    });
    await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${N}, ${lib}, true)`;
    const resend = withFlowResend(undefined, { uow: uow() as never, flow: gateOn });
    expect(await resend(who, CN)).toBe("ok");
    expect((await approvalOf(CN))?.feedback).toBe("FLOW_STARTING");
    expect(await dispatch()).toMatchObject({ claimed: 1, launched: 1, failed: 0 });
    const a = await approvalOf(CN);
    expect(a).toMatchObject({ feedback: null, status: "level1" });
    expect(a?.run).not.toBeNull();
    const [ev] = await o<{ n: number }[]>`select count(*)::int as n from hub.flow_events
      where tenant_id = ${N} and event = 'contract.submitted' and ref = ${CN}`;
    expect(ev?.n).toBe(2); // sự kiện gốc + sự kiện gửi lại (không bị coi là trùng)
  });

  it("flow cần nhóm công ty chưa có ⇒ lý do FLOW_GROUP_MISSING:<mã>", async () => {
    expect(await startApproval(ad())({ tenantId: G, userId: UG }, CG, "level1")).toBe("ok");
    expect(await dispatch()).toMatchObject({ claimed: 1, launched: 0 });
    expect(await approvalOf(CG)).toMatchObject({
      run: null,
      feedback: "FLOW_GROUP_MISSING:pb-khong-co",
      status: "level1",
    });
  });
});

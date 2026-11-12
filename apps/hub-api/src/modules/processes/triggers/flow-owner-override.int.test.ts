// cr125-fix-owner-override · CR-113 "Toàn quyền duyệt thay" trên flow theo sự kiện: cờ flow_triggers BẬT + flow Thư viện được gán,
// bước Duyệt giao Group Kế toán. Thành viên `contracts-owner` (không thuộc Kế toán) quyết được ⇒ thẻ có `override`, ghi
// `approval_override`; người ngoài (editor, không thuộc Group bước, không Toàn quyền) ⇒ NOT_REVIEWER (403). Trước sửa: owner 403.
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
  engineCard,
  getApproval,
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
import { packRunsOf } from "../runs/pack-runs";
import { dispatchOnce } from "./dispatcher";
import { setFlowTriggers } from "./flags";
import { flowLaunchOf } from "./flow-launch";

const T = tenantId(1341);
let A = ""; // nhân viên tạo HĐ
let B = ""; // trưởng Kế toán (người của bước)
let O = ""; // chủ app (contracts-owner), không thuộc Kế toán
let X = ""; // editor khác, không thuộc Group bước, không Toàn quyền
let G = "";
let OWN = "";
let ED = "";
let C = "";
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
const STAGES = [
  {
    ...base("duyet-kt", "Duyệt Kế toán", 0),
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
  await o`insert into admin.tenants (id, key, name) values (${T}, 't1341', 'T')`;
  [A, B, O, X] = (await users(o, T, 4, { from: 1341 })) as [string, string, string, string];
  const roles = (await enablePack(o, [T], "contracts")).get(T);
  ED = roles?.editor as string;
  OWN = roles?.owner as string;
  await members(o, T, ED, [A, X]);
  await members(o, T, roles?.viewer as string, [B]);
  await members(o, T, OWN, [O]);
  await department(o, T, "pb-kd", { head: A, members: [A] });
  G = await department(o, T, "pb-ke-toan", { head: B, members: [B] });
  [C] = (await contracts(o, T, 1, { from: 1341, createdBy: A, status: "needs_review" })) as [
    string,
  ];
  const st = JSON.stringify(STAGES);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger,
      app, published_version, enabled) values (null, 'own-ovr', 'Duyệt HĐ', ${st}::text::jsonb,
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
const groupsOf = (uid: string): string[] =>
  uid === B ? [G] : uid === O ? [OWN] : uid === A || uid === X ? [ED] : [];
function deps(): ProcessDeps {
  const d = {
    db,
    config: {
      user: async (uid: string) => ({ active: true, groupIds: new Set<string>(groupsOf(uid)) }),
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
    approvalEngine: approvalEngineRepo(tx, tid),
    contractFlow: contractFlowRepo(tx, tid),
  }));
function ad() {
  const port = packRunsOf(deps());
  const u = uow();
  const jobs = { enqueue: async () => {} };
  return {
    uow: u,
    flow: { prepare: async () => ({ on: true, departments: null }) },
    jobs,
    groups: {
      idsOf: async () => new Map(),
      userGroups: async () => new Set(),
      actionsOf: async () => new Set(["read", "write"]),
    },
    card: engineCard({ port: () => port, uow: u, jobs } as never),
  } as never;
}
type Card = { task_id: string | null; can_act: boolean; steps: { status: string }[] };

describe("cr125-fix-owner-override · Toàn quyền duyệt thay trên flow theo sự kiện", () => {
  it("contracts-owner quyết bước của Group khác (duyệt thay, audit), người ngoài bị NOT_REVIEWER", async () => {
    const wa = { tenantId: T, userId: A };
    expect(await startApproval(ad())(wa, C, "level1")).toBe("ok");
    expect(await dispatchOnce({ db, launch: flowLaunchOf(deps()) })).toMatchObject({ launched: 1 });

    const wx = { tenantId: T, userId: X };
    const cx = (await getApproval(ad())(wx, C)) as Card;
    expect(cx.can_act).toBe(false);
    expect(await actApproval(ad())(wx, C, { action: "approve" })).toMatchObject({
      error: "NOT_REVIEWER",
    });

    const wo = { tenantId: T, userId: O };
    const co = (await getApproval(ad())(wo, C)) as Card;
    expect(co).toMatchObject({ can_act: true });
    const out = await actApproval(ad())(wo, C, {
      action: "approve",
      expect: { taskId: co.task_id as string, step: null },
    });
    expect(out).not.toHaveProperty("error");
    const ev = await o<{ actor: string }[]>`select actor_user_id::text as actor
      from contracts.contract_events where contract_id = ${C} and type = 'approval_override'`;
    expect(ev.map((e) => e.actor)).toEqual([O]);
    const [row] = await o<
      { c: string }[]
    >`select status as c from contracts.contracts where id = ${C}`;
    expect(row?.c).toBe("done");
  });
});

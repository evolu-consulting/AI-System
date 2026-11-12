// CR-122 · P11h · e2e G1.2: người duyệt Kế toán bấm Đạt ở bước "Duyệt giá trị lớn" của lượt flow ⇒ `POST …/actions/approve` 404
// NOT_FOUND (trace 20261107-005731), bước giữ `open`. Gốc: `flow-submit.usecase.ts` (P11d) khoá HĐ (`FOR UPDATE` không cờ duyệt) TRƯỚC
// khi biết lượt đã là engine ⇒ RLS ghi lọc mất HĐ với người duyệt ⇒ "not_found". Đường thật qua thẻ: getApproval → act approve
// (người duyệt, task của thẻ) → bước passed → node Kết thúc ⇒ OutcomeHandler ⇒ HĐ khoá (active), lượt done.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import {
  contracts,
  department,
  enablePack,
  members,
  tenantId,
  users,
  visibility,
} from "@ai/test-kit/builders";
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

const T = tenantId(1331);
let A = ""; // nhân viên tạo HĐ
let B = ""; // trưởng Kế toán (người duyệt, không phải người tạo)
let G = "";
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
/** 0 Duyệt giá trị lớn (Kế toán) · 1 Kết thúc Đã duyệt. */
const STAGES = [
  {
    ...base("duyet-lon", "Duyệt giá trị lớn", 0),
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
  await o`insert into admin.tenants (id, key, name) values (${T}, 't1331', 'T')`;
  [A, B] = (await users(o, T, 2, { from: 1331 })) as [string, string];
  const roles = (await enablePack(o, [T], "contracts")).get(T);
  await members(o, T, roles?.editor as string, [A]);
  // người duyệt chỉ ĐỌC gói (như trưởng Kế toán ở stack hành trình): quyết nhờ Group bước duyệt, không có quyền ghi HĐ
  await members(o, T, roles?.viewer as string, [B]);
  // như stack hành trình: chế độ thấy theo tổ chức (org) ⇒ Kế toán KHÔNG thấy HĐ của nhân viên KD theo cây, chỉ thấy vì là người
  // duyệt của bước đang mở (CR-109 người duyệt ngoài cây)
  await visibility(o, [T], "org");
  await department(o, T, "pb-kd", { head: A, members: [A] });
  G = await department(o, T, "pb-ke-toan", { head: B, members: [B] });
  [C] = (await contracts(o, T, 1, { from: 1331, createdBy: A, status: "needs_review" })) as [
    string,
  ];
  await o`update contracts.contracts set deal = 'buy', direction = 'purchase',
    fields = jsonb_build_object('total_value', jsonb_build_object('value', 150000000)) where id = ${C}`;
  const st = JSON.stringify(STAGES);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger,
      app, published_version, enabled) values (null, 'p11h-ok', 'Duyệt HĐ', ${st}::text::jsonb,
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
      user: async (uid: string) => ({
        active: true,
        groupIds: new Set<string>(uid === B ? [G] : []),
      }),
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
const rowOf = async () =>
  (
    await o<
      { c: string; a: string }[]
    >`select c.status as c, a.status as a from contracts.contracts c
      join contracts.approvals a on a.id = c.run_id where c.id = ${C}`
  )[0];

describe("CR-122 P11h · người duyệt Đạt bước Duyệt của lượt flow qua thẻ", () => {
  it("getApproval ⇒ bước mở + task, act approve (người duyệt) ⇒ passed ⇒ Kết thúc ⇒ HĐ khoá", async () => {
    const wa = { tenantId: T, userId: A };
    const wb = { tenantId: T, userId: B };
    expect(await startApproval(ad())(wa, C, "level1")).toBe("ok");
    expect(await dispatchOnce({ db, launch: flowLaunchOf(deps()) })).toMatchObject({ launched: 1 });
    const card = (await getApproval(ad())(wb, C)) as {
      task_id: string | null;
      can_act: boolean;
      steps: { name: string; status: string }[];
    };
    expect(card.steps.map((s) => `${s.name}:${s.status}`)).toEqual(["Duyệt giá trị lớn:open"]);
    expect(card).toMatchObject({ can_act: true });
    const out = await actApproval(ad())(wb, C, {
      action: "approve",
      expect: { taskId: card.task_id as string, step: null },
    });
    expect(out).not.toBe("not_found"); // trước sửa: 404 NOT_FOUND
    expect(out).not.toHaveProperty("error");
    expect(await rowOf()).toEqual({ c: "done", a: "done" });
  });
});

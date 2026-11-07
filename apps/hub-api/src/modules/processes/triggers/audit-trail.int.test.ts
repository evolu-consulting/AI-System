// CR-125 · dấu vết kiểm toán của hành trình duyệt HĐ theo sự kiện (contract.submitted → Duyệt → Kết thúc) + ký số + đối tác.
// Kiểm CẢ dòng trong DB (contract_events: ai · lúc nào · gì) LẪN thứ người dùng thấy (`getHistory` = danh sách "Lịch sử thay đổi" của HĐ)
// và trạng thái cột `contracts.status` dọc đường. Khuôn dựng stack = flow-approve-act.int.test.ts.
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
import { approvalRepo } from "../../packs/contracts/adapters/approval.repo";
import { approvalEngineRepo } from "../../packs/contracts/adapters/approval-engine.repo";
import { contractFlowRepo } from "../../packs/contracts/adapters/contract-flow.repo";
import { esignRepo } from "../../packs/contracts/adapters/esign.repo";
import { manageRepo } from "../../packs/contracts/adapters/manage.repo";
import { partnerSendRepo } from "../../packs/contracts/adapters/partner-send.repo";
import {
  actApproval,
  getApproval,
  startApproval,
} from "../../packs/contracts/application/approval.usecase";
import { engineCard } from "../../packs/contracts/application/approval-engine-card.usecase";
import { getHistory } from "../../packs/contracts/application/manage.usecase";
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
import { createStageLauncher } from "../runs/launcher";
import { packRunsOf } from "../runs/pack-runs";
import { dispatchOnce } from "./dispatcher";
import { setFlowTriggers } from "./flags";
import { flowLaunchOf } from "./flow-launch";

const T = tenantId(1341);
let A = ""; // người tạo / gửi duyệt
let B = ""; // người duyệt (Kế toán)
let G = "";
let C1 = ""; // đường Đạt
let C2 = ""; // đường Từ chối
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
  await o`insert into admin.tenants (id, key, name) values (${T}, 't1341', 'T')`;
  [A, B] = (await users(o, T, 2, { from: 1341 })) as [string, string];
  const roles = (await enablePack(o, [T], "contracts")).get(T);
  await members(o, T, roles?.editor as string, [A]);
  await members(o, T, roles?.viewer as string, [B]);
  await visibility(o, [T], "org");
  await department(o, T, "pb-kd", { head: A, members: [A] });
  G = await department(o, T, "pb-ke-toan", { head: B, members: [B] });
  [C1, C2] = (await contracts(o, T, 2, { from: 1341, createdBy: A, status: "needs_review" })) as [
    string,
    string,
  ];
  await o`update contracts.contracts set deal = 'buy', direction = 'purchase',
    fields = jsonb_build_object('total_value', jsonb_build_object('value', 150000000)) where id in (${C1}, ${C2})`;
  const st = JSON.stringify(STAGES);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger,
      app, published_version, enabled) values (null, 'cr125-ok', 'Duyệt HĐ', ${st}::text::jsonb,
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
    esign: esignRepo(tx, tid),
    partnerSend: partnerSendRepo(tx, tid),
    ...manageRepo(tx, tid),
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
const wa = () => ({ tenantId: T, userId: A });
const wb = () => ({ tenantId: T, userId: B });
const statusOf = async (id: string) =>
  (
    await o<
      { c: string; a: string | null }[]
    >`select c.status as c, a.status as a from contracts.contracts c
      left join contracts.approvals a on a.id = c.run_id where c.id = ${id}`
  )[0];
/** Thứ người dùng thấy: "Lịch sử thay đổi" của HĐ (cũ → mới, như `manage.history`). */
const history = async (id: string) =>
  (await getHistory({ uow: uow() as never })(wa(), id, 50)) ?? [];

describe("CR-125 · dấu vết duyệt HĐ theo sự kiện", () => {
  it("gửi duyệt → Đạt ở bước → Kết thúc Đã duyệt: trạng thái đúng + lịch sử có ai/lúc nào/gì", async () => {
    expect(await startApproval(ad())(wa(), C1, "level1")).toBe("ok");
    expect(await statusOf(C1)).toEqual({ c: "needs_review", a: "level1" });
    expect(await actApproval(ad())(wa(), C1, { action: "approve" })).not.toHaveProperty("error");
    expect(await startApproval(ad())(wa(), C2, "level1")).toBe("ok");
    expect(await actApproval(ad())(wa(), C2, { action: "approve" })).not.toHaveProperty("error");
    expect(await dispatchOnce({ db, launch: flowLaunchOf(deps()) })).toMatchObject({ launched: 2 });
    const card = (await getApproval(ad())(wb(), C1)) as { task_id: string | null };
    const out = await actApproval(ad())(wb(), C1, {
      action: "approve",
      expect: { taskId: card.task_id as string, step: null },
    });
    expect(out).not.toHaveProperty("error");
    expect(await statusOf(C1)).toEqual({ c: "active", a: "done" });

    const h = await history(C1);
    const types = h.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(["approval_started", "stage_decided", "approved"]),
    );
    // mới → cũ: gửi duyệt luôn là dòng cũ nhất (quyết bước ghi SAU khi engine nhận quyết nên nằm sau dòng kết cục — ghi ở tasks.md)
    expect(types.indexOf("approval_started")).toBe(
      types.length - 1 - types.slice().reverse().indexOf("approval_started"),
    );
    expect(types.indexOf("approval_started")).toBeGreaterThan(types.indexOf("stage_decided"));
    const dec = h.find((e) => e.type === "stage_decided");
    expect(dec).toMatchObject({ actor_user_id: B, data: { action: "approve" } });
    expect(typeof (dec?.data as { stage?: string } | undefined)?.stage).toBe("string");
    expect(Number.isNaN(Date.parse(dec?.at as string))).toBe(false); // có thời điểm
    expect(h.find((e) => e.type === "approval_started")?.actor_user_id).toBe(A);
    expect(h.find((e) => e.type === "approved")?.actor_user_id).toBeTruthy();
  });

  it("Từ chối ở bước (có lý do): HĐ rejected + lịch sử ghi người từ chối, lý do", async () => {
    const card = (await getApproval(ad())(wb(), C2)) as { task_id: string | null };
    const out = await actApproval(ad())(wb(), C2, {
      action: "reject",
      feedback: "Giá quá cao",
      expect: { taskId: card.task_id as string, step: null },
    });
    expect(out).not.toHaveProperty("error");
    expect((await statusOf(C2))?.c).toBe("rejected");
    const h = await history(C2);
    const dec = h.find((e) => e.type === "stage_decided");
    expect(dec).toMatchObject({
      actor_user_id: B,
      data: { action: "reject", feedback: "Giá quá cao" },
    });
    expect(h.some((e) => e.type === "rejected")).toBe(true);
  });

  it("ký số: gửi, ký xong, đổi nhà cung cấp ⇒ lịch sử HĐ, gọi lại cùng trạng thái không ghi đôi", async () => {
    const signers = [
      {
        role: "company",
        name: "A",
        email: "a@x.vn",
        order: 1,
        client_user_id: null,
        status: null,
        signed_at: null,
      },
    ] as never;
    await uow().tenant(wa(), async (r) => {
      expect(
        await r.esign.insert({
          contractId: C1,
          provider: "mock",
          envelopeId: "env-125",
          signers,
          sentBy: A,
        }),
      ).toBe(true);
      const first = (signers as unknown as Record<string, unknown>[])[0];
      const done = [{ ...first, signed_at: "2026-11-07T01:00:00Z" }] as never;
      const p = {
        status: "completed",
        reason: null,
        completedAt: "2026-11-07T01:00:00Z",
        signers: done,
      } as never;
      await r.esign.update("env-125", p);
      await r.esign.update("env-125", p); // webhook gửi lại
      await r.esign.audit(
        A,
        { esign_switch: { contract_id: C1, provider: "mock" } },
        {
          esign_switch: { contract_id: C1, provider: "docusign" },
        },
      );
    });
    const h = await history(C1);
    const types = h.map((e) => e.type);
    expect(types.filter((t) => t === "esign_sent")).toHaveLength(1);
    expect(types.filter((t) => t === "esign_signed")).toHaveLength(1);
    expect(h.find((e) => e.type === "esign_sent")?.actor_user_id).toBe(A);
    expect(h.find((e) => e.type === "esign_switched")).toMatchObject({
      actor_user_id: A,
      data: { from: "mock", to: "docusign" },
    });
    // một nguồn: audit cấu hình vẫn còn
    const [n] = await o<
      { n: number }[]
    >`select count(*)::int as n from contracts.approval_settings_audit
      where tenant_id = ${T} and actor_user_id = ${A}`;
    expect(n?.n).toBeGreaterThanOrEqual(1);
  });

  it("đối tác: gửi → trả lời (một lần) ⇒ lịch sử HĐ", async () => {
    const mailboxId = crypto.randomUUID();
    await uow().tenant(wa(), async (r) => {
      await r.partnerSend.record({
        contractId: C1,
        mailboxId,
        round: 1,
        channel: "platform",
        toKey: "0101234567",
        toName: "Đối tác X",
        runId: null,
        by: A,
      });
      const rows = [{ mailboxId, outcome: "returned", reason: "Sửa điều khoản thanh toán" }];
      expect(await r.partnerSend.closeReplies(rows)).toBe(1);
      expect(await r.partnerSend.closeReplies(rows)).toBe(0); // chạy lại: không ghi đôi
    });
    const h = await history(C1);
    expect(h.find((e) => e.type === "partner_sent")).toMatchObject({
      actor_user_id: A,
      data: { round: 1, to: "Đối tác X" },
    });
    expect(h.filter((e) => e.type === "partner_replied")).toHaveLength(1);
    expect(h.find((e) => e.type === "partner_replied")?.data).toMatchObject({
      outcome: "returned",
      reason: "Sửa điều khoản thanh toán",
    });
  });
});

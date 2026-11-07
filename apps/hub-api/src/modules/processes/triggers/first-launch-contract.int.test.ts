// CR-122 · P11 · lỗi #4 (q1-e2e) đường thật: công ty bật FLOW_TRIGGERS, flow Thư viện "Duyệt giá trị lớn" được gán ⇒ HĐ vào `level1`
// ⇒ lượt duyệt CHỜ flow (`mode engine`, FLOW_STARTING) cùng tx với `contract.submitted` ⇒ MỘT `dispatchOnce` mở run + gắn vào lượt
// (CAS) ⇒ kick thật ⇒ task "Duyệt giá trị lớn" mở; máy cũ duyệt ⇒ APPROVAL_NOT_OPEN, HĐ KHÔNG bị khoá. Công ty cờ TẮT: máy cũ như trước.
// Perf: sự kiện → task mở ≤ 5 s ở vòng thật (`startFlowDispatcher`, idle 2 s).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { contracts, groups, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import type { ContractFlowGate } from "../../packs/contracts/testing";
import {
  actApproval,
  approvalRepo,
  contractFlowRepo,
  contractsOutcomeHandler,
  startApproval,
} from "../../packs/contracts/testing";
import { createPackUow } from "../../packs/kit/adapters/pack-uow";
import { registerOutcomeHandler, unregisterFlowPorts } from "../adapters/runs/flow-ports";
import type { ProcessDeps } from "../core/ports";
import { createStageLauncher } from "../runs/launcher";
import { dispatchOnce, startFlowDispatcher } from "./dispatcher";
import { setFlowTriggers } from "./flags";
import { flowLaunchOf } from "./flow-launch";

const T = tenantId(1291);
const OFF = tenantId(1292);
let A = "";
let AO = "";
let o: Sql;
let db: Db;
let C: string[] = [];
let CO = "";
const BIG = "Duyệt giá trị lớn";

const stage = {
  key: "duyet-lon",
  name: BIG,
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
    group_key: "pb-ke-toan",
    back_to_steps: [],
    remind_every_h: null,
    escalate: null,
    branch: [],
    exclude_starter: false,
  },
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 6);
  await o`insert into admin.tenants (id, key, name) values (${T}, 't1291', 'T'), (${OFF}, 't1292', 'OFF')`;
  [A] = (await users(o, T, 2, { from: 1291 })) as [string];
  [AO] = (await users(o, OFF, 1, { from: 1295 })) as [string];
  const g = await groups(o, T, ["pb-ke-toan"]);
  await members(o, T, g.get("pb-ke-toan") as string, [userId(1292)]);
  C = await contracts(o, T, 3, { from: 1291, createdBy: A, status: "needs_review" });
  CO = (
    await contracts(o, OFF, 1, { from: 1295, createdBy: AO, status: "needs_review" })
  )[0] as string;
  await o`update contracts.contracts set deal = 'buy', direction = 'purchase',
    fields = jsonb_build_object('total_value', jsonb_build_object('value', 150000000))
    where id = any(${o.array([...C, CO])}::uuid[])`;
  const st = JSON.stringify([stage]);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app,
      published_version, enabled) values (null, 'p11-big', 'Duyệt HĐ', ${st}::text::jsonb,
      '{"event":"contract.submitted"}'::jsonb, 'contracts', 1, true) returning id::text as id`;
  const lib = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${lib}, 1, 'Duyệt HĐ', ${st}::text::jsonb)`;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${T}, ${lib}, true), (${OFF}, ${lib}, true)`;
  await withHubScope(db, { kind: "system" }, (tx) => setFlowTriggers(tx, T, true));
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
    // chuông/thông báo không thuộc phạm vi test: mọi hàm notifier trả 0 sự kiện
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
const gate = (on: boolean): ContractFlowGate => ({
  prepare: async () => ({ on, departments: null }),
});
const ad = (on: boolean) =>
  ({
    uow: uow(),
    flow: gate(on),
    jobs: { enqueue: async () => {} },
    groups: {
      idsOf: async () => new Map(),
      userGroups: async () => new Set(),
      actionsOf: async () => new Set(["read", "write", "admin"]),
    },
  }) as never;
const approvalOf = async (cid: string) =>
  (
    await o<{ mode: string; run: string | null; feedback: string | null; status: string }[]>`
      select a.mode, a.engine_run_id::text as run, a.feedback, a.status from contracts.approvals a
      join contracts.contracts c on c.run_id = a.id where c.id = ${cid}`
  )[0];
const contractOf = async (cid: string) =>
  (await o<{ status: string }[]>`select status from contracts.contracts where id = ${cid}`)[0]
    ?.status;
const eventsOf = async (cid: string) =>
  (
    await o<{ n: number }[]>`select count(*)::int as n from hub.flow_events
      where event = 'contract.submitted' and ref = ${cid}`
  )[0]?.n ?? 0;
const openTask = async (runId: string) =>
  (
    await o<{ n: number }[]>`select count(*)::int as n from hub.review_tasks t
      join hub.stage_runs s on s.id = t.stage_run_id
      where t.process_run_id = ${runId} and t.status = 'open' and s.stage_idx = 0`
  )[0]?.n ?? 0;

describe("CR-122 P11 · #4 HĐ gửi duyệt khi công ty bật flow theo sự kiện", () => {
  it("level1 ⇒ chờ flow, một dispatchOnce ⇒ run gắn vào lượt + task 'Duyệt giá trị lớn' mở, máy cũ duyệt ⇒ APPROVAL_NOT_OPEN, HĐ không khoá", async () => {
    const id = C[0] as string;
    const who = { tenantId: T, userId: A };
    expect(await startApproval(ad(true))(who, id, "level1")).toBe("ok");
    // P11d · AI đọc xong / nhập tay ⇒ nháp chờ rà soát: máy cũ, còn nút "Xác nhận và lưu", CHƯA phát sự kiện
    expect(await approvalOf(id)).toMatchObject({ mode: "machine", run: null, status: "level1" });
    expect(await eventsOf(id)).toBe(0);
    expect(await dispatchOnce({ db, launch: flowLaunchOf(deps()) })).toMatchObject({ claimed: 0 });
    // "Xác nhận và lưu" ⇒ đúng 1 sự kiện + lượt chờ flow, HĐ chưa khoá
    expect(await actApproval(ad(true))(who, id, { action: "approve" })).not.toHaveProperty("error");
    expect(await eventsOf(id)).toBe(1);
    expect(await contractOf(id)).toBe("needs_review");
    expect(await approvalOf(id)).toMatchObject({
      mode: "engine",
      run: null,
      feedback: "FLOW_STARTING",
    });
    const s = await dispatchOnce({
      db,
      launch: flowLaunchOf(deps()),
      now: () => new Date(Date.now() + 1000),
    });
    const [ev] = await o<
      { error: string | null; outcome: unknown }[]
    >`select error, outcome from hub.flow_events
      where tenant_id = ${T} and event = 'contract.submitted' and ref = ${id}`;
    expect({ ...s, error: ev?.error ?? null, outcome: ev?.outcome }).toMatchObject({
      claimed: 1,
      launched: 1,
      failed: 0,
      error: null,
    });
    const a = await approvalOf(id);
    expect(a).toMatchObject({ mode: "engine", feedback: null, status: "level1" });
    expect(a?.run).not.toBeNull();
    if ((await openTask(a?.run as string)) === 0) {
      // chẩn đoán: kick sau commit nuốt lỗi (`process-kick-failed`) ⇒ gọi trực tiếp để thấy lỗi gốc
      const err = await createStageLauncher(deps() as never)
        .kick(a?.run as string)
        .then(
          () => "kick-ok-no-task",
          (e: unknown) => String((e as Error)?.stack ?? e),
        );
      expect(err).toBe("");
    }
    expect(await openTask(a?.run as string)).toBe(1);
    expect(await actApproval(ad(true))(who, id, { action: "approve" })).toEqual({
      error: "APPROVAL_NOT_OPEN",
    });
    expect(await contractOf(id)).toBe("needs_review");
  });

  it("công ty cờ TẮT: lượt giữ máy cũ (không chờ flow), duyệt máy cũ khoá HĐ như trước", async () => {
    const who = { tenantId: OFF, userId: AO };
    expect(await startApproval(ad(false))(who, CO, "level1")).toBe("ok");
    expect(await approvalOf(CO)).toMatchObject({ mode: "machine", run: null });
    const out = await actApproval(ad(false))(who, CO, { action: "approve" });
    expect(out).not.toHaveProperty("error");
    expect(await contractOf(CO)).toBe("active");
  });

  it("perf · vòng thật: sự kiện → task Duyệt mở ≤ 5 s", async () => {
    const id = C[1] as string;
    const ac = new AbortController();
    const t0 = performance.now();
    expect(await startApproval(ad(true))({ tenantId: T, userId: A }, id, "level1")).toBe("ok");
    await actApproval(ad(true))({ tenantId: T, userId: A }, id, { action: "approve" }); // Xác nhận ⇒ sự kiện
    startFlowDispatcher({ db, launch: flowLaunchOf(deps()) }, { signal: ac.signal, idleMs: 2_000 });
    let ms = -1;
    try {
      // chờ bằng tín hiệu DB (task mở), lưới an toàn 5 s — không ngủ cố định
      for (;;) {
        const a = await approvalOf(id);
        if (a?.run && (await openTask(a.run)) === 1) {
          ms = performance.now() - t0;
          break;
        }
        if (performance.now() - t0 > 5_000) break;
        await Bun.sleep(25);
      }
    } finally {
      ac.abort();
    }
    console.log(`P11 perf: sự kiện → task mở ${ms.toFixed(0)} ms`);
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThanOrEqual(5_000);
  });
});

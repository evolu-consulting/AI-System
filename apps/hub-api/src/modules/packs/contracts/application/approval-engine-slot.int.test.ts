// CR-105 · L1 · design §3 · viết TRƯỚC code: mở lượt duyệt HĐ theo khe `contracts.approval` (gán ⇒ mặc định ⇒ bản xuất bản).
// Thật: DB (bảng thư viện + `admin.groups`), `resolveSlot`, `ensureDef({sourceRef})` (DefsService — cùng luật lưu def), `groupIdsOf`.
// Giả: tx gói contracts (lượt duyệt trong bộ nhớ) và `start` của engine — `start` CHỤP def tenant `contracts-approval` đang lưu
// (như engine pin `def_version` + snapshot) và kiểm `source_ref` khớp (như `stampSlotRun`); không chạy stage.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { contractId, groups, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { packRunsPortForTest } from "../../../../test-support/pack-runs-port";
import type { PackToolCatalog } from "../../kit/application/pack-tools.ports";
import { approvalEngineTools } from "../adapters/approval-engine.tools";
import { APPROVAL_PROCESS_KEY } from "../domain/approval-flow.rules";
import type { FlowStep } from "../domain/approval-flow.types";
import { APPROVAL_SLOT, compileSlotStages } from "../domain/approval-slot.rules";
import type { ApprovalEnginePort, EngineStartRequest } from "./approval-engine.ports";
import { startEngineApproval } from "./approval-engine.usecase";

const X = tenantId(1061);
const Y = tenantId(1062);
const STARTER = { [X]: userId(1061), [Y]: userId(1062) } as Record<string, string>;
const KEYS = ["ke-toan", "giam-doc", "phap-che"];

let o: Sql;
let db: Db;
const gid: Record<string, Map<string, string>> = {};
const lib = { A: "", B: "", D: "" };

const review = (key: string, dept: string, extra: Record<string, unknown> = {}) => ({
  kind: "review",
  key,
  name: `Duyệt ${key}`,
  department_group_id: null,
  department_group_key: dept,
  head_only: false,
  due_h: 72,
  remind_every_h: null,
  escalate_group_id: null,
  exclude_starter: false,
  when: null,
  ...extra,
});
const BODY = {
  A: {
    steps: [
      review("kt", "ke-toan"),
      review("gd", "giam-doc", {
        exclude_starter: true,
        when: { op: "and", conds: [{ field: "total_value", op: "ge", value: 100_000_000 }] },
      }),
    ],
  },
  B: { steps: [review("pc", "phap-che")] },
  D: { steps: [review("kt", "ke-toan")] },
};

async function libDef(key: string, name: string, body: unknown): Promise<string> {
  const stages = JSON.stringify(compileSlotStages(body));
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, slot, slot_body,
      published_version) values (null, ${key}, ${name}, ${stages}::text::jsonb, ${APPROVAL_SLOT}, ${JSON.stringify(body)}::text::jsonb, 1)
    returning id::text as id`;
  const id = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    values (${id}, 1, ${name}, ${stages}::text::jsonb, ${JSON.stringify(body)}::text::jsonb)`;
  return id;
}

// ── engine giả quanh cổng thật ──
type Run = { tenant: string; defVersion: number; sourceRef: string | null; stages: unknown[] };
const runs = new Map<string, Run>();
const warns: string[] = [];
let port: ApprovalEnginePort;

async function fakeStart(u: { tenantId: string }, req: EngineStartRequest) {
  const [d] = await o<{ version: number; source_ref: string | null; stages: unknown[] }[]>`
    select version, source_ref, stages from hub.process_defs
    where tenant_id = ${u.tenantId} and key = ${req.process_key} and deleted_at is null`;
  if (!d) throw new Error("def chưa có");
  if (req.slot && req.slot.source_ref !== d.source_ref) throw new Error("source_ref lệch");
  const runId = crypto.randomUUID();
  runs.set(runId, {
    tenant: u.tenantId,
    defVersion: d.version,
    sourceRef: d.source_ref,
    stages: structuredClone(d.stages),
  });
  return { runId, kick: async () => {} };
}

// ── lượt duyệt của gói (bộ nhớ) ──
type Appr = {
  tenant: string;
  mode: string;
  run: string | null;
  version: number;
  steps: FlowStep[];
};
const appr = new Map<string, Appr>();
const uow = {
  tenant: async (who: { tenantId: string }, fn: (r: unknown) => Promise<unknown>) =>
    fn({
      approvalEngine: {
        startState: async (id: string) => {
          const a = appr.get(id);
          if (!a || a.tenant !== who.tenantId) return null;
          const st = { approvalId: id, approvalStatus: "level1", mode: a.mode };
          return { ...st, engineRunId: a.run, startedBy: STARTER[a.tenant] };
        },
        attach: async (
          id: string,
          _a: string,
          x: { runId: string; version: number; steps: FlowStep[] },
        ) => {
          const a = appr.get(id) as Appr;
          Object.assign(a, { mode: "engine", run: x.runId, version: x.version });
          a.steps = structuredClone(x.steps);
          return true;
        },
        difyFacts: async () => null,
      },
      approvalFlow: {
        settings: async () => ({ level1GroupKey: "l1", level2GroupKey: "l2", threshold: 1 }),
        flow: async () => null,
        settingsRev: async () => 0,
      },
    }),
};
const groupsOf = {
  idsOf: (t: string, keys: readonly string[]) => real.groupIdsOf(t, keys),
  existingIds: async (t: string, ids: readonly string[]) => {
    const rows = await o<{ id: string }[]>`select id::text as id from admin.groups
      where tenant_id = ${t} and id = any(${o.array([...ids])}::uuid[])`;
    return new Set(rows.map((r) => r.id));
  },
};
let real: ReturnType<typeof packRunsPortForTest>;
const start = () =>
  startEngineApproval({
    bridge: { port },
    uow: uow as never,
    groups: groupsOf as never,
    warn: (m) => void warns.push(m),
  });
const open = async (tenant: string, n: number) => {
  const id = contractId(n);
  appr.set(id, { tenant, mode: "machine", run: null, version: 0, steps: [] });
  const out = await start()({ tenantId: tenant, userId: STARTER[tenant] as string }, id);
  return { id, out, a: appr.get(id) as Appr };
};
const reviewGroups = (stages: unknown[]) =>
  (stages as { after: { kind: string; group_id?: string } }[])
    .filter((s) => s.after.kind === "review")
    .map((s) => s.after.group_id);
const tenantDef = async (t: string) =>
  (
    await o<
      { version: number; source_ref: string | null }[]
    >`select version, source_ref from hub.process_defs
      where tenant_id = ${t} and key = ${APPROVAL_PROCESS_KEY} and deleted_at is null`
  )[0];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 2);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1061', 'X'), (${Y}, 't1062', 'Y')`;
  await users(o, X, 1, { from: 1061 });
  await users(o, Y, 1, { from: 1062 });
  gid[X] = await groups(o, X, KEYS);
  gid[Y] = await groups(o, Y, KEYS);
  lib.A = await libDef("pl-slot-a", "Quy trình A", BODY.A);
  lib.B = await libDef("pl-slot-b", "Quy trình B", BODY.B);
  lib.D = await libDef("pl-slot-d", "Quy trình HĐ mặc định", BODY.D);
  await o`insert into hub.process_slots (slot, default_def_id) values (${APPROVAL_SLOT}, ${lib.D})
    on conflict (slot) do update set default_def_id = excluded.default_def_id`;
  await o`insert into hub.process_slot_assignments (tenant_id, slot, def_id)
    values (${X}, ${APPROVAL_SLOT}, ${lib.A}), (${Y}, ${APPROVAL_SLOT}, ${lib.B})`;
  const tools = approvalEngineTools({ uow: null, bridge: {} } as never).map((t) => ({
    key: t.name,
    name: t.name,
    description: t.description,
    sideEffect: false,
    action: t.action,
    params: t.params,
  }));
  const catalog = {
    has: (k: string) => tools.some((t) => t.key === k),
    info: (k: string) => tools.find((t) => t.key === k),
    enabled: async () => true,
    available: async (_t: string, keys?: readonly string[]) =>
      tools.filter((t) => !keys || keys.includes(t.key)),
  } as unknown as PackToolCatalog;
  real = packRunsPortForTest(db, catalog);
  port = {
    ...real,
    start: fakeStart,
    cancel: async () => {},
    workflowsOf: async () => [],
  } as unknown as ApprovalEnginePort;
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-105 · engine mở lượt theo khe contracts.approval", () => {
  it("X gán A, Y gán B chạy đúng quy trình", async () => {
    const x = await open(X, 1);
    const y = await open(Y, 2);
    expect({ x: x.out, y: y.out, warns }).toEqual({ x: "started", y: "started", warns: [] });
    const rx = runs.get(x.a.run as string) as Run;
    const ry = runs.get(y.a.run as string) as Run;
    const gx = gid[X] as Map<string, string>;
    const gy = gid[Y] as Map<string, string>;
    expect({
      x: reviewGroups(rx.stages),
      y: reviewGroups(ry.stages),
      xSteps: x.a.steps.map((s) => (s.kind === "review" ? s.department_group_id : undefined)),
      xVersion: x.a.version,
    }).toEqual({
      x: [gx.get("ke-toan"), gx.get("giam-doc")],
      y: [gy.get("phap-che")],
      xSteps: [gx.get("ke-toan"), gx.get("giam-doc")],
      xVersion: 1,
    });
    expect(rx.sourceRef).toMatch(/^[0-9a-f]{16}$/);
    expect((await tenantDef(X))?.source_ref).toBe(rx.sourceRef);
  });

  it("đổi gán: lượt dở giữ snapshot, lượt mới chạy quy trình mới", async () => {
    const first = await open(X, 3); // A (def đã đồng bộ ở ca trước ⇒ 0 ghi)
    const v1 = (await tenantDef(X))?.version;
    const r1 = structuredClone(runs.get(first.a.run as string) as Run);
    const steps1 = structuredClone(first.a.steps);
    await o`update hub.process_slot_assignments set def_id = ${lib.B} where tenant_id = ${X}`;
    const second = await open(X, 4);
    const third = await open(X, 5); // B lần 2 ⇒ source_ref bằng ⇒ không ghi def
    const gx = gid[X] as Map<string, string>;
    const v2 = (await tenantDef(X))?.version;
    expect({
      outs: [first.out, second.out, third.out],
      firstRun: runs.get(first.a.run as string),
      firstSteps: appr.get(first.id)?.steps,
      second: reviewGroups((runs.get(second.a.run as string) as Run).stages),
      versionBump: (v2 as number) - (v1 as number),
      thirdSameDef: (runs.get(third.a.run as string) as Run).defVersion === v2,
    }).toEqual({
      outs: ["started", "started", "started"],
      firstRun: r1,
      firstSteps: steps1,
      second: [gx.get("phap-che")],
      versionBump: 1,
      thirdSameDef: true,
    });
    expect(r1.defVersion).toBe(v1 as number);
  });

  it("thiếu Group lúc chạy ⇒ máy cũ", async () => {
    await o`delete from admin.groups where tenant_id = ${Y} and key = 'phap-che'`;
    warns.length = 0;
    const before = runs.size;
    const y = await open(Y, 6);
    expect({ out: y.out, mode: y.a.mode, warns, started: runs.size - before }).toEqual({
      out: "machine",
      mode: "machine",
      warns: ["contract-engine-flow-invalid"],
      started: 0,
    });
  });
});

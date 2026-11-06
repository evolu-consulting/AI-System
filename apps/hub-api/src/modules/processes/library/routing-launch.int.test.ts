// CR-118 §11.2 · launch chọn quy trình theo luật phòng ban của NGƯỜI BẮT ĐẦU lượt (gói contracts, khe `contracts.approval`).
// Thật: DB (luật/tập gán 0087, `admin.departments` cha-con, `group_members`), `routeSlot` (MỘT câu), `ensureDef`, `groupIdsOf`,
// `stampSlotRun` (ghi def + luật vào snapshot run). Giả: tx gói (lượt duyệt trong bộ nhớ) + `start` engine (chụp def tenant như
// engine pin snapshot) — cùng khuôn `approval-engine-slot.int.test.ts`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { contractId, groups, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import {
  insertDef,
  insertRun,
} from "../../../../../../tests/acceptance/P-a/_support/process-fixtures";
import { connectDb, type Db } from "../../../lib/db";
import { approvalEngineTools } from "../../packs/contracts/adapters/approval-engine.tools";
import type {
  ApprovalEnginePort,
  EngineStartRequest,
} from "../../packs/contracts/application/approval-engine.ports";
import { startEngineApproval } from "../../packs/contracts/application/approval-engine.usecase";
import { FLOW_ROUTE_NONE } from "../../packs/contracts/domain/approval-engine.rules";
import { APPROVAL_SLOT, compileSlotStages } from "../../packs/contracts/domain/approval-slot.rules";
import type { PackToolCatalog } from "../../packs/kit/application/pack-tools.ports";
import type { ProcessDeps } from "../core/ports";
import { packRunsOf, stampSlotRun } from "../runs/pack-runs";
import { resolveSlot } from "./slot-resolve.repo";
import { routeSlot } from "./slot-route.repo";

const X = tenantId(1191);
const Z = tenantId(1192); // không luật ⇒ đường cũ
const U = { north: userId(1191), ops: userId(1192), none: userId(1193), z: userId(1194) };
const KEYS = ["ke-toan", "phap-che"];
// Launch tự chèn bước XÁC NHẬN đầu quy trình (`withConfirmStep`) giao nhóm này ⇒ tenant phải có nhóm; bước đầu = xác nhận, rồi bước của quy trình.
const EDITOR = "contracts-editor";
// cr118-route-kind · tenant W: luật phòng ban × loại HĐ (không mặc định).
const W = tenantId(1195);
const UW = { kd: userId(1195), bgd: userId(1196) };
const kindLib = { C: "" };
const kindRule = { kdBuy: "", kdSell: "", bgdBuy: "" };
let gw: Map<string, string>;

let o: Sql;
let db: Db;
const lib = { A: "", B: "" };
const rule = { kd: "", dflt: "" };
let gx: Map<string, string>;

const review = (key: string, dept: string) => ({
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
});
async function libDef(key: string, name: string, body: unknown): Promise<string> {
  const stages = JSON.stringify(compileSlotStages(body));
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, slot, slot_body,
      published_version) values (null, ${key}, ${name}, ${stages}::text::jsonb, ${APPROVAL_SLOT},
      ${JSON.stringify(body)}::text::jsonb, 1) returning id::text as id`;
  const id = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    values (${id}, 1, ${name}, ${stages}::text::jsonb, ${JSON.stringify(body)}::text::jsonb)`;
  return id;
}

// ── engine giả quanh cổng thật ──
type Run = { stages: unknown[]; slot: EngineStartRequest["slot"] };
const runs = new Map<string, Run>();
let port: ApprovalEnginePort;
async function fakeStart(u: { tenantId: string }, req: EngineStartRequest) {
  const [d] = await o<{ source_ref: string | null; stages: unknown[] }[]>`select source_ref, stages
    from hub.process_defs where tenant_id = ${u.tenantId} and key = ${req.process_key} and deleted_at is null`;
  if (!d) throw new Error("def chưa có");
  if (req.slot && req.slot.source_ref !== d.source_ref) throw new Error("source_ref lệch");
  const runId = crypto.randomUUID();
  runs.set(runId, { stages: structuredClone(d.stages), slot: structuredClone(req.slot) });
  return { runId, kick: async () => {} };
}
type Appr = {
  starter: string;
  mode: string;
  run: string | null;
  reason?: string;
  deal?: string | null;
};
const appr = new Map<string, Appr>();
const uow = {
  tenant: async (_who: unknown, fn: (r: unknown) => Promise<unknown>) =>
    fn({
      approvalEngine: {
        startState: async (id: string) => {
          const a = appr.get(id);
          if (!a) return null;
          const st = { approvalId: id, approvalStatus: "level1", mode: a.mode };
          const deal = a.deal !== undefined ? { deal: a.deal } : {};
          return { ...st, engineRunId: a.run, startedBy: a.starter, ...deal };
        },
        attach: async (id: string, _a: string, x: { runId: string }) => {
          Object.assign(appr.get(id) as Appr, { mode: "engine", run: x.runId });
          return true;
        },
        difyFacts: async () => null,
        markStalled: async (id: string, _a: string, s: { reason: string }) => {
          Object.assign(appr.get(id) as Appr, { mode: "engine", reason: s.reason });
          return true;
        },
      },
      approvalFlow: {
        settings: async () => ({ level1GroupKey: "l1", level2GroupKey: "l2", threshold: 1 }),
        flow: async () => null,
        settingsRev: async () => 0,
      },
    }),
};
let real: ReturnType<typeof packRunsOf>;
const groupsOf = {
  idsOf: (t: string, keys: readonly string[]) => real.groupIdsOf(t, keys),
  existingIds: async (t: string, ids: readonly string[]) => {
    const rows = await o<{ id: string }[]>`select id::text as id from admin.groups
      where tenant_id = ${t} and id = any(${o.array([...ids])}::uuid[])`;
    return new Set(rows.map((r) => r.id));
  },
};
const open = async (n: number, starter: string, o: { t?: string; deal?: string | null } = {}) => {
  const id = contractId(n);
  appr.set(id, { starter, mode: "machine", run: null, ...("deal" in o ? { deal: o.deal } : {}) });
  const start = startEngineApproval({
    bridge: { port },
    uow: uow as never,
    groups: groupsOf as never,
    warn: () => {},
  });
  const out = await start({ tenantId: o.t ?? X, userId: starter }, id);
  const a = appr.get(id) as Appr;
  return { out, a, run: a.run ? runs.get(a.run) : undefined };
};
const reviewGroups = (stages: unknown[] | undefined) =>
  ((stages ?? []) as { after: { kind: string; group_id?: string } }[])
    .filter((s) => s.after.kind === "review")
    .map((s) => s.after.group_id);

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 2);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1191', 'X'), (${Z}, 't1192', 'Z')`;
  await users(o, X, 3, { from: 1191 });
  await users(o, Z, 1, { from: 1194 });
  gx = await groups(o, X, [...KEYS, EDITOR, "kinh-doanh", "kd-bac", "van-hanh"]);
  await groups(o, Z, [...KEYS, EDITOR]);
  const g = (k: string) => gx.get(k) as string;
  await o`insert into admin.departments (tenant_id, group_id, parent_group_id) values
    (${X}, ${g("kinh-doanh")}, null), (${X}, ${g("kd-bac")}, ${g("kinh-doanh")}), (${X}, ${g("van-hanh")}, null)`;
  await members(o, X, g("kd-bac"), [U.north]);
  await members(o, X, g("van-hanh"), [U.ops]);
  lib.A = await libDef("rl-a", "QT A", { steps: [review("kt", "ke-toan")] });
  lib.B = await libDef("rl-b", "QT B", { steps: [review("pc", "phap-che")] });
  await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot)
    values (${X}, ${lib.A}, ${APPROVAL_SLOT}), (${X}, ${lib.B}, ${APPROVAL_SLOT})`;
  await o`insert into hub.process_routings (tenant_id, slot) values (${X}, ${APPROVAL_SLOT})`;
  const rows = await o<{ id: string; f: boolean }[]>`insert into hub.process_routing_rules
      (tenant_id, slot, priority, condition, def_id, is_default)
    values (${X}, ${APPROVAL_SLOT}, 0, ${JSON.stringify({ departmentIds: [g("kinh-doanh")] })}::text::jsonb, ${lib.A}, false),
      (${X}, ${APPROVAL_SLOT}, 1, '{}'::jsonb, ${lib.B}, true)
    returning id::text as id, is_default as f`;
  rule.kd = rows.find((r) => !r.f)?.id as string;
  rule.dflt = rows.find((r) => r.f)?.id as string;
  await o`insert into admin.tenants (id, key, name) values (${W}, 't1195', 'W')`;
  await users(o, W, 2, { from: 1195 });
  gw = await groups(o, W, [...KEYS, EDITOR, "kiem-soat", "kinh-doanh", "bgd"]);
  const w = (k: string) => gw.get(k) as string;
  await o`insert into admin.departments (tenant_id, group_id, parent_group_id) values
    (${W}, ${w("kinh-doanh")}, null), (${W}, ${w("bgd")}, null)`;
  await members(o, W, w("kinh-doanh"), [UW.kd]);
  await members(o, W, w("bgd"), [UW.bgd]);
  kindLib.C = await libDef("rl-c", "QT C", { steps: [review("ks", "kiem-soat")] });
  await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values
    (${W}, ${lib.A}, ${APPROVAL_SLOT}), (${W}, ${lib.B}, ${APPROVAL_SLOT}), (${W}, ${kindLib.C}, ${APPROVAL_SLOT})`;
  await o`insert into hub.process_routings (tenant_id, slot) values (${W}, ${APPROVAL_SLOT})`;
  const cond = (dept: string, kind: string) =>
    JSON.stringify({ departmentIds: [w(dept)], contractKinds: [kind] });
  const kr = await o<{ id: string; p: number }[]>`insert into hub.process_routing_rules
      (tenant_id, slot, priority, condition, def_id, is_default)
    values (${W}, ${APPROVAL_SLOT}, 0, ${cond("kinh-doanh", "buy")}::text::jsonb, ${lib.A}, false),
      (${W}, ${APPROVAL_SLOT}, 1, ${cond("kinh-doanh", "sell")}::text::jsonb, ${lib.B}, false),
      (${W}, ${APPROVAL_SLOT}, 2, ${cond("bgd", "buy")}::text::jsonb, ${kindLib.C}, false)
    returning id::text as id, priority as p`;
  const byP = (p: number) => kr.find((r) => Number(r.p) === p)?.id as string;
  Object.assign(kindRule, { kdBuy: byP(0), kdSell: byP(1), bgdBuy: byP(2) });
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
  real = packRunsOf({ db, packTools: catalog } as unknown as ProcessDeps);
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

describe("CR-118 §11.2 · launch theo luật phòng ban", () => {
  it("launch chọn quy trình theo phòng ban người khởi tạo", async () => {
    const north = await open(1, U.north); // phòng con của kinh-doanh ⇒ luật kd ⇒ A
    const ops = await open(2, U.ops); // không khớp ⇒ mặc định ⇒ B
    expect({
      outs: [north.out, ops.out],
      north: reviewGroups(north.run?.stages),
      ops: reviewGroups(ops.run?.stages),
      northSlot: [north.run?.slot?.process_def_id, north.run?.slot?.route_rule_id],
      opsSlot: [ops.run?.slot?.process_def_id, ops.run?.slot?.route_rule_id],
    }).toEqual({
      outs: ["started", "started"],
      north: [gx.get(EDITOR), gx.get("ke-toan")],
      ops: [gx.get(EDITOR), gx.get("phap-che")],
      northSlot: [lib.A, rule.kd],
      opsSlot: [lib.B, rule.dflt],
    });
    // Bỏ luật mặc định ⇒ người không khớp bị chặn với lý do rõ (không run).
    await o`delete from hub.process_routing_rules where id = ${rule.dflt}`;
    const none = await open(3, U.none);
    expect({ out: none.out, run: none.a.run, reason: none.a.reason }).toEqual({
      out: "stalled",
      run: null,
      reason: FLOW_ROUTE_NONE,
    });
    expect(await routeSlot(db, X, APPROVAL_SLOT, U.none)).toEqual({
      blocked: "route_none",
      ruleId: null,
    });
  });

  it("run cũ giữ quy trình khi đổi luật", async () => {
    const def = await insertDef(o, { id: crypto.randomUUID(), tenantId: X });
    await o`update hub.process_defs set source_ref = '0123456789abcdef' where id = ${def}`;
    const [d] = await o<{ key: string; name: string; stages: never[] }[]>`select key, name, stages
      from hub.process_defs where id = ${def}`;
    const fix = await insertRun(o, {
      def: { id: def, key: d?.key as string, name: d?.name as string, stages: d?.stages ?? [] },
      startedBy: { id: U.north, tid: X },
    });
    const picked = await routeSlot(db, X, APPROVAL_SLOT, U.north);
    expect(picked && "defId" in picked ? [picked.defId, picked.ruleId] : picked).toEqual([
      lib.A,
      rule.kd,
    ]);
    await stampSlotRun({ db } as unknown as ProcessDeps, X, fix.runId, {
      source_ref: "0123456789abcdef",
      process_name: "QT A",
      rel_version: 1,
      process_def_id: lib.A,
      route_rule_id: rule.kd,
    });
    const snap = async () =>
      (
        await o<
          { s: Record<string, unknown> }[]
        >`select snapshot as s from hub.process_runs where id = ${fix.runId}`
      )[0]?.s;
    const before = await snap();
    // Đổi luật: phòng kinh-doanh ⇒ B. Lượt mới của cùng người ⇒ B; run cũ giữ A.
    await o`update hub.process_routing_rules set def_id = ${lib.B} where id = ${rule.kd}`;
    const now = await routeSlot(db, X, APPROVAL_SLOT, U.north);
    expect({
      snap: [before?.process_def_id, before?.route_rule_id, before?.process_name],
      now: now && "defId" in now ? now.defId : now,
      after: await snap(),
    }).toEqual({ snap: [lib.A, rule.kd, "QT A"], now: lib.B, after: before });
  });

  it("cr118-route-kind · launch chọn theo phòng ban + loại HĐ", async () => {
    const kdBuy = await open(11, UW.kd, { t: W, deal: "buy" });
    const kdSell = await open(12, UW.kd, { t: W, deal: "sell" });
    const bgdBuy = await open(13, UW.bgd, { t: W, deal: "buy" });
    const bgdSell = await open(14, UW.bgd, { t: W, deal: "sell" }); // không khớp, không mặc định ⇒ chặn
    const slotOf = (x: Awaited<ReturnType<typeof open>>) => [
      x.run?.slot?.process_def_id,
      x.run?.slot?.route_rule_id,
    ];
    expect({
      outs: [kdBuy.out, kdSell.out, bgdBuy.out, bgdSell.out],
      groups: [kdBuy, kdSell, bgdBuy].map((x) => reviewGroups(x.run?.stages)),
      slots: [kdBuy, kdSell, bgdBuy].map(slotOf),
      blocked: [bgdSell.a.run, bgdSell.a.reason],
    }).toEqual({
      outs: ["started", "started", "started", "stalled"],
      groups: [
        [gw.get(EDITOR), gw.get("ke-toan")],
        [gw.get(EDITOR), gw.get("phap-che")],
        [gw.get(EDITOR), gw.get("kiem-soat")],
      ],
      slots: [
        [lib.A, kindRule.kdBuy],
        [lib.B, kindRule.kdSell],
        [kindLib.C, kindRule.bgdBuy],
      ],
      blocked: [null, FLOW_ROUTE_NONE],
    });
    // Khe không cung cấp loại (facts vắng) ⇒ bỏ qua điều kiện loại ⇒ luật đầu khớp phòng ban.
    const noKind = await routeSlot(db, W, APPROVAL_SLOT, UW.kd);
    expect(noKind && "ruleId" in noKind ? noKind.ruleId : noKind).toBe(kindRule.kdBuy);
  });

  it("không có luật ⇒ như resolveSlot", async () => {
    const old = await resolveSlot(db, Z, APPROVAL_SLOT);
    expect(old).not.toBeNull();
    expect(await routeSlot(db, Z, APPROVAL_SLOT, U.z)).toEqual({ ...old, ruleId: null } as never);
  });
});

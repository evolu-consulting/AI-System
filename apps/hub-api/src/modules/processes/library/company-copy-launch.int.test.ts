// CR-121 c9b · int HÀNH TRÌNH: sao quy trình thư viện cho công ty (API thật `libraryRoutes`) → launch khe `contracts.approval` (cổng
// thật `routeSlot`/`resolveSlot`/`stampSlotRun`, engine giả cùng khuôn `routing-launch.int.test.ts`) → lượt chạy dùng BẢN RIÊNG
// (`slot.process_def_id` = bản riêng, bản = `source_rel_version`, bước duyệt từ `slot_body` bản riêng, bản riêng `enabled=false` vẫn chạy)
// → PUT luật / danh sách khe không còn báo "chưa xuất bản" → công ty khác KHÔNG launch được bản riêng của công ty này.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { contractId, groups, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import {
  insertDef,
  insertRun,
} from "../../../../../../tests/acceptance/P-a/_support/process-fixtures";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import { communitySlotSpecs } from "../../packs/community/domain/flow-slots.rules";
import { approvalEngineTools } from "../../packs/contracts/adapters/approval-engine.tools";
import type {
  ApprovalEnginePort,
  EngineStartRequest,
} from "../../packs/contracts/application/approval-engine.ports";
import { startEngineApproval } from "../../packs/contracts/application/approval-engine.usecase";
import { approvalSlotSpec } from "../../packs/contracts/approval.mount";
import { FLOW_ROUTE_UNAVAILABLE } from "../../packs/contracts/domain/approval-engine.rules";
import { APPROVAL_SLOT, compileSlotStages } from "../../packs/contracts/domain/approval-slot.rules";
import { intakeSlotSpec } from "../../packs/contracts/intake.mount";
import { slotRegistry } from "../../packs/kit/adapters/slot-registry";
import type { PackToolCatalog } from "../../packs/kit/application/pack-tools.ports";
import type { ProcessDeps } from "../core/ports";
import { packRunsOf, stampSlotRun } from "../runs/pack-runs";
import { libraryRoutes } from "./library.routes";
import { resolveSlot } from "./slot-resolve.repo";
import { routeSlot } from "./slot-route.repo";

const X = tenantId(1231);
const Z = tenantId(1232);
const U = { s: userId(1232), z: userId(1233) };
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  P: { userId: userId(1230), tenantId: X, role: "platform_admin" },
  A: { userId: userId(1231), tenantId: X, role: "tenant_admin" },
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;

let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
let libA = "";
let gx: Map<string, string>;

async function call(who: string, method: string, path: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": who },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Json };
}

// ── engine giả quanh cổng thật (cùng khuôn routing-launch.int.test.ts) ──
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
type Appr = { starter: string; mode: string; run: string | null; reason?: string };
const appr = new Map<string, Appr>();
const uow = {
  tenant: async (_who: unknown, fn: (r: unknown) => Promise<unknown>) =>
    fn({
      approvalEngine: {
        startState: async (id: string) => {
          const a = appr.get(id);
          if (!a) return null;
          return {
            approvalId: id,
            approvalStatus: "level1",
            mode: a.mode,
            engineRunId: a.run,
            startedBy: a.starter,
          };
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
const open = async (n: number, starter: string, t: string) => {
  const id = contractId(n);
  appr.set(id, { starter, mode: "machine", run: null });
  const start = startEngineApproval({
    bridge: { port },
    uow: uow as never,
    groups: groupsOf as never,
    warn: () => {},
  });
  const out = await start({ tenantId: t, userId: starter }, id);
  const a = appr.get(id) as Appr;
  return { out, a, run: a.run ? runs.get(a.run) : undefined };
};
const reviewGroups = (stages: unknown[] | undefined) =>
  ((stages ?? []) as { after: { kind: string; group_id?: string } }[])
    .filter((s) => s.after.kind === "review")
    .map((s) => s.after.group_id);

const body = {
  steps: [
    {
      kind: "review",
      key: "kt",
      name: "Duyệt kt",
      department_group_id: null,
      department_group_key: "ke-toan",
      head_only: false,
      due_h: 72,
      remind_every_h: null,
      escalate_group_id: null,
      exclude_starter: false,
      when: null,
    },
  ],
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1231', 'X'), (${Z}, 't1232', 'Z')`;
  await users(o, X, 3, { from: 1230 });
  await users(o, Z, 1, { from: 1233 });
  gx = await groups(o, X, ["ke-toan", "contracts-editor"]); // launch tự thêm bước xác nhận đầu (contracts-editor)
  await groups(o, Z, ["ke-toan", "contracts-editor"]);
  const stages = JSON.stringify(compileSlotStages(body));
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, slot, slot_body,
      published_version) values (null, 'cl-a', 'QT A', ${stages}::text::jsonb, ${APPROVAL_SLOT},
      ${JSON.stringify(body)}::text::jsonb, 1) returning id::text as id`;
  libA = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    values (${libA}, 1, 'QT A', ${stages}::text::jsonb, ${JSON.stringify(body)}::text::jsonb)`;
  for (const t of [X, Z]) {
    await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${t}, ${libA}, ${APPROVAL_SLOT})`;
    await o`insert into hub.process_routings (tenant_id, slot) values (${t}, ${APPROVAL_SLOT})`;
    await o`insert into hub.process_routing_rules (tenant_id, slot, priority, condition, def_id, is_default)
      values (${t}, ${APPROVAL_SLOT}, 0, '{}'::jsonb, ${libA}, true)`;
  }
  slotRegistry.register(approvalSlotSpec);
  slotRegistry.register(intakeSlotSpec);
  for (const s of communitySlotSpecs()) slotRegistry.register(s);
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
  const deps = { db, packTools: catalog, start: {} } as unknown as ProcessDeps;
  real = packRunsOf(deps);
  port = {
    ...real,
    start: fakeStart,
    cancel: async () => {},
    workflowsOf: async () => [],
  } as unknown as ApprovalEnginePort;
  app = new Hono<AuthVars>();
  app.use("*", async (c, next) => {
    c.set("user", WHO[c.req.header("x-who") ?? ""] as never);
    await next();
  });
  app.onError((e, c) => {
    const m = mapError(e);
    if (m.status === 500) console.error(e);
    return c.json(m.body, m.status);
  });
  app.route("/", libraryRoutes(deps));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-121 c9b · bản riêng công ty launch được", () => {
  it("sao → launch dùng bản riêng → PUT luật/danh sách khe nhận bản riêng", async () => {
    const first = await routeSlot(db, X, APPROVAL_SLOT, U.s); // cổng không được ném
    expect(first && "defId" in first ? first.defId : first).toBe(libA);
    const before = await open(1, U.s, X);
    expect(before.out).toBe("started");
    expect(before.run?.slot?.process_def_id).toBe(libA);

    const cl = await call("A", "POST", `/tenants/${X}/process-defs/${libA}/clone-for-company`, {});
    expect(cl.status).toBe(201);
    const priv = cl.json.def_id as string;
    const [row] =
      await o`select enabled, slot, source_rel_version as rel from hub.process_defs where id = ${priv}`;
    expect(row).toMatchObject({ enabled: false, slot: null, rel: 1 }); // tắt vẫn chạy: launch gói không kiểm `enabled`

    // launch thật: cổng chọn bản riêng, bản = source_rel_version, bước duyệt từ slot_body bản riêng
    const picked = await routeSlot(db, X, APPROVAL_SLOT, U.s);
    expect(
      picked && "defId" in picked ? [picked.defId, picked.relVersion, picked.name] : picked,
    ).toEqual([priv, 1, "QT A"]);
    expect((await resolveSlot(db, X, APPROVAL_SLOT))?.defId).toBe(priv);
    const after = await open(2, U.s, X);
    expect(after.out).toBe("started");
    expect(after.run?.slot).toMatchObject({
      process_def_id: priv,
      rel_version: 1,
      process_name: "QT A",
    });
    expect(reviewGroups(after.run?.stages)).toEqual([
      gx.get("contracts-editor"),
      gx.get("ke-toan"),
    ]);

    // snapshot lượt chạy ghi bản riêng (đường ghi thật `stampSlotRun`)
    const def = await insertDef(o, { id: crypto.randomUUID(), tenantId: X });
    await o`update hub.process_defs set source_ref = '0123456789abcdef' where id = ${def}`;
    const [d] = await o<{ key: string; name: string; stages: never[] }[]>`select key, name, stages
      from hub.process_defs where id = ${def}`;
    const fix = await insertRun(o, {
      def: { id: def, key: d?.key as string, name: d?.name as string, stages: d?.stages ?? [] },
      startedBy: { id: U.s, tid: X },
    });
    await stampSlotRun({ db } as unknown as ProcessDeps, X, fix.runId, {
      source_ref: "0123456789abcdef",
      process_name: "QT A",
      rel_version: 1,
      process_def_id: priv,
    });
    const [snap] =
      await o`select snapshot->>'process_def_id' as d from hub.process_runs where id = ${fix.runId}`;
    expect(snap?.d).toBe(priv);

    // PUT luật với bản riêng không bị ROUTING_PROCESS_UNAVAILABLE; danh sách khe/tập gán báo bản = 1
    const R = `/tenants/${X}/process-routing/${APPROVAL_SLOT}`;
    const cur = await call("A", "GET", R);
    expect(cur.json.processes).toEqual([{ def_id: priv, name: "QT A", rel_version: 1 }]);
    const put = await call("A", "PUT", R, {
      version: cur.json.version,
      rules: [{ condition: {}, def_id: priv, is_default: true }],
    });
    expect(put.status).toBe(200);
    expect(put.json.rules[0].unavailable).toBeUndefined();
    const slots = await call("P", "GET", `/tenants/${X}/process-slots`);
    expect(slots.json.items.find((s: Json) => s.slot === APPROVAL_SLOT)).toMatchObject({
      def_id: priv,
      rel_version: 1,
    });
    const view = await call("A", "GET", `${R}/processes/${priv}`);
    expect(view.status).toBe(200);
    expect(view.json.rel_version).toBe(1);

    // công ty Z vẫn chạy bản thư viện; dù dữ liệu xấu trỏ luật Z sang bản riêng của X ⇒ KHÔNG launch (route_unavailable)
    const z1 = await open(3, U.z, Z);
    expect(z1.run?.slot?.process_def_id).toBe(libA);
    await o`insert into hub.process_tenant_defs (tenant_id, def_id, slot) values (${Z}, ${priv}, ${APPROVAL_SLOT})`;
    await o`update hub.process_routing_rules set def_id = ${priv} where tenant_id = ${Z} and slot = ${APPROVAL_SLOT} and is_default`;
    const zr = await routeSlot(db, Z, APPROVAL_SLOT, U.z);
    expect(zr).toMatchObject({ blocked: "route_unavailable" });
    expect(await resolveSlot(db, Z, APPROVAL_SLOT)).toBeNull();
    const z2 = await open(4, U.z, Z);
    expect({ out: z2.out, run: z2.a.run, reason: z2.a.reason }).toEqual({
      out: "stalled",
      run: null,
      reason: FLOW_ROUTE_UNAVAILABLE,
    });
  });
});

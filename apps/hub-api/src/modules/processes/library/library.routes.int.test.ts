// CR-105 · L2a · làn đầy đủ · viết TRƯỚC code (quyền + publish/rollback + gán): route thư viện quy trình qua Hono thật (defsRoutes +
// libraryRoutes) trên DB thật (`hub_api`, scope system), user giả qua header. Khe `contracts.approval` thật (test-support) + def mặc
// định seed ở hub 0069. Kiểm trạng thái DB thật (hàng gán, bản phát hành, audit), không chỉ mã HTTP.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts";
import { groups, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { insertRun } from "../../../../../../tests/acceptance/P-a/_support/process-fixtures";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import { approvalEngineTools } from "../../packs/contracts/adapters/approval-engine.tools";
import { approvalSlotSpec } from "../../packs/contracts/approval.mount";
import {
  APPROVAL_DEFAULT_DEF,
  defaultSlotBody,
} from "../../packs/contracts/domain/approval-slot-default.rules";
import { slotRegistry } from "../../packs/kit/adapters/slot-registry";
import type { PackToolCatalog } from "../../packs/kit/application/pack-tools.ports";
import type { ProcessDeps } from "../core/ports";
import { defsRoutes } from "../defs/defs.routes";
import { libraryRoutes } from "./library.routes";
import { resolveSlot } from "./slot-resolve.repo";

/** Khe `contracts.approval` thật + catalog tool hệ thống (như test preview L2b: test engine import gói trực tiếp). */
function registerApprovalSlotForTest(): PackToolCatalog {
  slotRegistry.register(approvalSlotSpec);
  const tools = approvalEngineTools({ uow: null, bridge: {} } as never).map((t) => ({
    key: t.name,
    name: t.name,
    description: t.description,
    sideEffect: false,
    action: t.action,
    params: t.params,
  }));
  return {
    has: (k: string) => tools.some((t) => t.key === k),
    info: (k: string) => tools.find((t) => t.key === k),
    enabled: async () => true,
    available: async (_t: string, keys?: readonly string[]) =>
      tools.filter((t) => !keys || keys.includes(t.key)),
  } as unknown as PackToolCatalog;
}
const SLOT = "contracts.approval";
const X = tenantId(1071);
const Y = tenantId(1072);
const DFLT = APPROVAL_DEFAULT_DEF.id;
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  P: { userId: userId(1070), tenantId: X, role: "platform_admin" },
  A: { userId: userId(1071), tenantId: X, role: "tenant_admin" },
  M: { userId: userId(1072), tenantId: X, role: "member" },
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;
type Res = { status: number; json: Json };

let o: Sql;
let db: Db;
let app: Hono<AuthVars>;

async function call(
  who: keyof typeof WHO,
  method: string,
  path: string,
  body?: unknown,
): Promise<Res> {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": who },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : {} };
}
const D = (id: string) => `/process-defs/${id}`;
const ASSIGN = (t: string) => `/tenants/${t}/process-slots/${SLOT}`;

/** Body theo mã: bước mặc định + (tuỳ chọn) bước pháp chế; `tag` đổi tên bước 1 để phân biệt bản. */
function body(tag: string, extra?: string): Json {
  const b = defaultSlotBody() as Json;
  b.steps[0].name = `Kiểm tra ${tag}`;
  if (extra)
    b.steps.push({
      ...b.steps[0],
      key: "phap",
      name: "Pháp chế",
      department_group_key: extra,
      when: null,
    });
  return b;
}

const INPUT_KEYS = [
  "key",
  "name",
  "description",
  "input_hint",
  "run_group_ids",
  "stages",
  "token_budget",
  "enabled",
  "sources",
  "inputs",
  "ttl_days",
];
/** PUT nháp: lấy def hiện tại, thay `slot_body` (+ trường khác), gửi kèm `stages` cũ (Hub biên dịch lại từ body). */
async function saveDraft(id: string, patch: Json): Promise<Res> {
  const cur = (await call("P", "GET", D(id))).json;
  const input = Object.fromEntries(INPUT_KEYS.map((k) => [k, cur[k]]));
  return call("P", "PUT", D(id), { ...input, slot: SLOT, version: cur.version, ...patch });
}
async function cloneOf(src: string, key: string): Promise<string> {
  const r = await call("P", "POST", `${D(src)}/clone`, { key, name: `QT ${key}` });
  expect(r.status).toBe(201);
  return r.json.id as string;
}
/** Nhân bản mặc định ⇒ lưu body ⇒ xuất bản v1. */
async function published(key: string, b: Json): Promise<string> {
  const id = await cloneOf(DFLT, key);
  expect((await saveDraft(id, { slot_body: b })).status).toBe(200);
  const v = (await call("P", "GET", D(id))).json.version;
  expect((await call("P", "POST", `${D(id)}/publish`, { version: v })).json).toEqual({
    rel_version: 1,
  });
  return id;
}
const auditCount = async (action: string, id: string) =>
  Number(
    (
      await o`select count(*)::int as n from hub.audit_log where action = ${action} and entity_id = ${id}`
    )[0]?.n,
  );

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1071', 'Công ty X'), (${Y}, 't1072', 'Công ty Y')`;
  await users(o, X, 3, { from: 1070 });
  await groups(o, X, ["contracts-editor", "contracts-owner", "phap-che"]);
  await groups(o, Y, ["contracts-editor", "contracts-owner"]);
  const packTools = registerApprovalSlotForTest();
  const deps = { db, packTools, start: {} } as unknown as ProcessDeps;
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
  app.route("/", defsRoutes(deps));
  app.route("/", libraryRoutes(deps));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-105 · L2a · API thư viện quy trình", () => {
  it("không phải platform_admin ⇒ 403", async () => {
    const cur = (await call("P", "GET", D(DFLT))).json;
    const writes: [string, string, unknown?][] = [
      ["GET", "/process-slots"],
      ["PUT", `/process-slots/${SLOT}/default`, { def_id: DFLT }],
      ["GET", "/process-defs?kind=library"],
      ["GET", `${D(DFLT)}/impact`],
      ["POST", `${D(DFLT)}/publish`, { version: cur.version }],
      ["GET", `${D(DFLT)}/releases`],
      ["POST", `${D(DFLT)}/rollback`, { rel_version: 1 }],
      ["POST", `${D(DFLT)}/clone`, {}],
      ["GET", `${D(DFLT)}/assignments`],
      ["GET", `/tenants/${X}/process-slots`],
      ["PUT", ASSIGN(X), { def_id: DFLT }],
      ["DELETE", ASSIGN(X)],
      ["DELETE", `${D(DFLT)}?version=${cur.version}`],
    ];
    for (const who of ["A", "M"] as const)
      for (const [m, p, b] of writes)
        expect({ who, p, m, s: (await call(who, m, p, b)).status }).toEqual({ who, p, m, s: 403 });
    // Ghi def có `slot` ⇒ 403 (như mẫu); đọc ⇒ 404 (không lộ, readiness Chặn 1).
    const input = Object.fromEntries(INPUT_KEYS.map((k) => [k, cur[k]]));
    const put = await call("A", "PUT", D(DFLT), {
      ...input,
      version: cur.version,
      slot: SLOT,
      slot_body: body("x"),
    });
    expect({ put: put.status, get: (await call("A", "GET", D(DFLT))).status }).toEqual({
      put: 403,
      get: 404,
    });
    expect([
      ...(await o`select count(*)::int as n from hub.process_slot_assignments where tenant_id = ${X}`),
    ]).toEqual([{ n: 0 }]);
  });

  it("danh sách library không lẫn mẫu và def vật chất hoá", async () => {
    await o`insert into hub.process_defs (tenant_id, key, name, stages) values (null, 'pl-tpl', 'Mẫu', '[{"key":"s0"}]')`;
    await o`insert into hub.process_defs (tenant_id, key, name, stages, source_ref)
      values (${X}, 'contracts-approval', 'HĐ X', '[{"key":"s0"}]', '0123456789abcdef')`;
    const keys = async (q: string) =>
      ((await call("P", "GET", `/process-defs?limit=100${q}`)).json.items as Json[]).map(
        (i) => i.key,
      );
    const lib = (await call("P", "GET", "/process-defs?kind=library&limit=100")).json
      .items as Json[];
    const dflt = lib.find((i) => i.id === DFLT);
    expect({
      allSlot: lib.every((i) => i.slot === SLOT),
      dflt: {
        label: dflt?.slot_label,
        is_default: dflt?.is_default,
        pv: dflt?.published_version,
        tc: dflt?.tenant_count,
      },
      tpl: (await keys("&kind=template")).includes("pl-tpl"),
      tplHasLib: (await keys("&kind=template")).includes(APPROVAL_DEFAULT_DEF.key),
      tenantHidden: (await keys(`&tenant_id=${X}`)).filter(
        (k) => k === "contracts-approval" || k === APPROVAL_DEFAULT_DEF.key,
      ),
    }).toEqual({
      allSlot: true,
      dflt: { label: "Sổ Hợp Tác · Duyệt hợp đồng", is_default: true, pv: 1, tc: 0 },
      tpl: true,
      tplHasLib: false,
      tenantHidden: [],
    });
    expect(lib.map((i) => i.key)).not.toContain("pl-tpl");
    expect(lib.map((i) => i.key)).not.toContain("contracts-approval");
  });

  it("gán lại thay thế, một tenant một khe một quy trình", async () => {
    const a = await published("pl-ga", body("A"));
    const b = await published("pl-gb", body("B"));
    expect((await call("P", "PUT", ASSIGN(X), { def_id: a })).status).toBe(200);
    const r = await call("P", "PUT", ASSIGN(X), { def_id: b });
    expect(r.json).toEqual({
      slot: SLOT,
      label: "Sổ Hợp Tác · Duyệt hợp đồng",
      def_id: b,
      def_name: "QT pl-gb",
      rel_version: 1,
      is_default: false,
    });
    expect([
      ...(await o`select def_id::text as d from hub.process_slot_assignments where tenant_id = ${X}`),
    ]).toEqual([{ d: b }]);
    expect(
      (await call("P", "GET", `${D(b)}/assignments`)).json.items.map((i: Json) => i.tenant_key),
    ).toEqual(["t1071"]);
    expect({ a: await auditCount("assign", a), b: await auditCount("assign", b) }).toEqual({
      a: 1,
      b: 1,
    });
    expect((await call("P", "DELETE", ASSIGN(X))).status).toBe(204);
    const slots = (await call("P", "GET", `/tenants/${X}/process-slots`)).json.items;
    expect(slots).toEqual([
      expect.objectContaining({ slot: SLOT, def_id: DFLT, is_default: true }),
    ]);
    expect(await auditCount("unassign", b)).toBe(1);
  });

  it("tenant thiếu Group ⇒ SLOT_GROUPS_MISSING", async () => {
    const c = await published("pl-gc", body("C", "phap-che"));
    const r = await call("P", "PUT", ASSIGN(Y), { def_id: c });
    expect({ s: r.status, e: r.json.error }).toEqual({
      s: 422,
      e: expect.objectContaining({
        code: "SLOT_GROUPS_MISSING",
        details: { tenant: "t1072", tenant_id: Y, keys: ["phap-che"] },
      }),
    });
    expect([
      ...(await o`select count(*)::int as n from hub.process_slot_assignments where tenant_id = ${Y}`),
    ]).toEqual([{ n: 0 }]);
    // Chưa xuất bản ⇒ không gán được.
    const draft = await cloneOf(c, "pl-gc-nhap");
    expect((await call("P", "PUT", ASSIGN(X), { def_id: draft })).json.error.code).toBe(
      "PROCESS_NOT_PUBLISHED",
    );
  });

  it("xoá hoặc tắt quy trình đang dùng ⇒ PROCESS_IN_USE", async () => {
    const d = await published("pl-iu", body("IU"));
    await call("P", "PUT", ASSIGN(X), { def_id: d });
    const ver = async (id: string) => (await call("P", "GET", D(id))).json.version as number;
    const codes = {
      delDefault: (await call("P", "DELETE", `${D(DFLT)}?version=${await ver(DFLT)}`)).json.error
        ?.code,
      offDefault: (await saveDraft(DFLT, { enabled: false })).json.error?.code,
      delAssigned: (await call("P", "DELETE", `${D(d)}?version=${await ver(d)}`)).json.error?.code,
      keyAssigned: (await saveDraft(d, { key: "pl-iu-moi" })).json.error?.code,
    };
    expect(codes).toEqual({
      delDefault: "PROCESS_IN_USE",
      offDefault: "PROCESS_IN_USE",
      delAssigned: "PROCESS_IN_USE",
      keyAssigned: "PROCESS_IN_USE",
    });
    const free = await cloneOf(d, "pl-iu-free");
    expect((await call("P", "DELETE", `${D(free)}?version=${await ver(free)}`)).status).toBe(204);
    expect([
      ...(await o`select deleted_at is null as live from hub.process_defs where id = ${d}`),
    ]).toEqual([{ live: true }]);
  });

  it("xuất bản tạo bản mới, ghi audit, impact đúng số", async () => {
    const p = await published("pl-pub", body("P1"));
    await call("P", "PUT", ASSIGN(X), { def_id: p });
    const [m] = await o<
      { id: string }[]
    >`insert into hub.process_defs (tenant_id, key, name, stages, source_ref)
      values (${X}, 'pl-mat', 'HĐ X', '[{"key":"s0"}]', 'fedcba9876543210') returning id::text as id`;
    const run = { id: m?.id as string, key: "pl-mat", name: "HĐ X", stages: [] };
    await insertRun(o as never, {
      def: run,
      startedBy: { id: userId(1071), tid: X } as never,
      status: "running",
    });
    await insertRun(o as never, {
      def: run,
      startedBy: { id: userId(1071), tid: X } as never,
      status: "done",
    });
    expect((await call("P", "GET", `${D(p)}/impact`)).json).toEqual({
      tenant_count: 1,
      active_runs: 1,
      is_default: false,
    });
    const before = await auditCount("publish", p);
    expect((await saveDraft(p, { slot_body: body("P2") })).status).toBe(200);
    const v = (await call("P", "GET", D(p))).json.version;
    const r = await call("P", "POST", `${D(p)}/publish`, { version: v, note: "đợt 2" });
    expect({ s: r.status, j: r.json }).toEqual({ s: 201, j: { rel_version: 2 } });
    const rel = (await call("P", "GET", `${D(p)}/releases`)).json.items as Json[];
    expect(rel.map((x) => [x.rel_version, x.note])).toEqual([
      [2, "đợt 2"],
      [1, null],
    ]);
    expect(await auditCount("publish", p)).toBe(before + 1);
    const res = await resolveSlot(db, X, SLOT);
    expect({
      def: res?.defId,
      v: res?.relVersion,
      name: (res?.slotBody as Json | undefined)?.steps[0].name,
    }).toEqual({ def: p, v: 2, name: "Kiểm tra P2" });
    // Bản cũ không đổi.
    expect((await call("P", "GET", `${D(p)}/releases/1`)).json.slot_body.steps[0].name).toBe(
      "Kiểm tra P1",
    );
  });

  it("xuất bản đồng thời cùng version ⇒ một thành công, một 409", async () => {
    const q = await cloneOf(DFLT, "pl-race");
    const v = (await call("P", "GET", D(q))).json.version;
    const rs = await Promise.all(
      [1, 2].map(() => call("P", "POST", `${D(q)}/publish`, { version: v })),
    );
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect([
      ...(await o`select count(*)::int as n from hub.process_def_releases where def_id = ${q}`),
    ]).toEqual([{ n: 1 }]);
  });

  it("quay lại tạo bản mới bằng bản cũ", async () => {
    const id = await published("pl-rb", body("R1"));
    for (const tag of ["R2", "R3", "R4"]) {
      await saveDraft(id, { slot_body: body(tag) });
      const v = (await call("P", "GET", D(id))).json.version;
      await call("P", "POST", `${D(id)}/publish`, { version: v });
    }
    const ver = (await call("P", "GET", D(id))).json.version;
    const r = await call("P", "POST", `${D(id)}/rollback`, { rel_version: 2, version: ver });
    expect({ s: r.status, j: r.json }).toEqual({ s: 201, j: { rel_version: 5 } });
    const v5 = (await call("P", "GET", `${D(id)}/releases/5`)).json;
    const v2 = (await call("P", "GET", `${D(id)}/releases/2`)).json;
    const draft = (await call("P", "GET", D(id))).json;
    expect({
      body5: v5.slot_body,
      stages5: v5.stages,
      draftBody: draft.slot_body,
      pv: draft.published_version,
    }).toEqual({
      body5: v2.slot_body,
      stages5: v2.stages,
      draftBody: v2.slot_body,
      pv: 5,
    });
    expect(await auditCount("rollback", id)).toBe(1);
  });

  it("quay lại đồng thời cùng version ⇒ một thành công, một 409", async () => {
    const id = await published("pl-rb2", body("Q1"));
    await saveDraft(id, { slot_body: body("Q2") });
    const v = (await call("P", "GET", D(id))).json.version;
    await call("P", "POST", `${D(id)}/publish`, { version: v });
    const ver = (await call("P", "GET", D(id))).json.version;
    const rs = await Promise.all(
      [1, 2].map(() => call("P", "POST", `${D(id)}/rollback`, { rel_version: 1, version: ver })),
    );
    expect({
      s: rs.map((r) => r.status).sort(),
      codes: rs.map((r) => r.json.error?.code).filter(Boolean),
      rels: [
        ...(await o`select count(*)::int as n from hub.process_def_releases where def_id = ${id}`),
      ],
    }).toEqual({ s: [201, 409], codes: ["VERSION_CONFLICT"], rels: [{ n: 3 }] });
  });

  it("lưu từ canvas (chỉ stages) dựng lại body theo mã, xuất bản áp dụng; song song ⇒ SLOT_SHAPE_UNSUPPORTED", async () => {
    const id = await published("pl-cv", body("CV1"));
    await call("P", "PUT", ASSIGN(X), { def_id: id });
    const cur = (await call("P", "GET", D(id))).json;
    const input = Object.fromEntries(INPUT_KEYS.map((k) => [k, cur[k]]));
    const stages = (cur.stages as Json[]).map((s) =>
      s.key === "s0" ? { ...s, name: "Kiểm tra canvas" } : s,
    );
    const ok = await call("P", "PUT", D(id), {
      ...input,
      stages,
      slot: SLOT,
      version: cur.version,
    });
    expect(ok.status).toBe(200);
    const step0 = ok.json.slot_body.steps[0];
    expect([step0.name, step0.department_group_key, step0.department_group_id]).toEqual([
      "Kiểm tra canvas",
      "contracts-editor",
      null,
    ]);
    const pub = await call("P", "POST", `${D(id)}/publish`, { version: ok.json.version });
    expect(pub.json).toEqual({ rel_version: 2 });
    const res = await resolveSlot(db, X, SLOT);
    expect([res?.defId, (res?.slotBody as Json | undefined)?.steps[0].name]).toEqual([
      id,
      "Kiểm tra canvas",
    ]);
    // Hai stage cùng bước (song song) ⇒ 422 kèm stage sai, nháp không đổi.
    const s1 = (cur.stages as Json[]).find((s) => s.key === "s1") as Json;
    const par = [...(cur.stages as Json[])];
    par.splice(3, 0, { ...s1, key: "s1b", output: { ...s1.output, filename: "s1b.md" } });
    const now = (await call("P", "GET", D(id))).json;
    const bad = await call("P", "PUT", D(id), {
      ...input,
      stages: par,
      slot: SLOT,
      version: now.version,
    });
    expect({
      s: bad.status,
      code: bad.json.error?.code,
      hasStage: typeof bad.json.error?.details?.stage,
    }).toEqual({
      s: 422,
      code: "SLOT_SHAPE_UNSUPPORTED",
      hasStage: "string",
    });
  });

  it("nhân bản tạo nháp mới không ảnh hưởng tenant đang gán", async () => {
    const a = await published("pl-cl", body("CL"));
    await call("P", "PUT", ASSIGN(X), { def_id: a });
    const c = await cloneOf(a, "pl-cl-2");
    const cl = (await call("P", "GET", D(c))).json;
    expect({
      slot: cl.slot,
      pv: cl.published_version,
      tc: cl.tenant_count,
      def: cl.is_default,
    }).toEqual({ slot: SLOT, pv: null, tc: 0, def: false });
    expect((await saveDraft(c, { slot_body: body("CL-sửa") })).status).toBe(200);
    const res = await resolveSlot(db, X, SLOT);
    expect({ def: res?.defId, name: (res?.slotBody as Json | undefined)?.steps[0].name }).toEqual({
      def: a,
      name: "Kiểm tra CL",
    });
    expect([
      ...(await o`select count(*)::int as n from hub.process_slot_assignments where def_id = ${c}`),
    ]).toEqual([{ n: 0 }]);
  });
  it("def thư viện không bỏ khe được (slot: null ⇒ 422)", async () => {
    const id = await cloneOf(DFLT, "pl-noslot");
    const r = await saveDraft(id, { slot: null });
    expect({ s: r.status, code: r.json.error?.code }).toEqual({
      s: 422,
      code: "SLOT_BODY_INVALID",
    });
    expect([...(await o`select slot from hub.process_defs where id = ${id}`)]).toEqual([
      { slot: SLOT },
    ]);
  });
  it("mã phòng ban đặt nhầm vào *_group_id ⇒ SLOT_BODY_INVALID; bản sao mặc định có mã ở *_group_key", async () => {
    const id = await cloneOf(DFLT, "pl-keyid");
    const cl = (await call("P", "GET", D(id))).json;
    const s0 = (cl.slot_body.steps as Json[])[0] as Json;
    const st0 = ((cl.stages as Json[])[0] as Json).slot as Json;
    expect([
      s0.department_group_key,
      s0.department_group_id,
      st0.department_group_key,
      st0.department_group_id,
    ]).toEqual(["contracts-editor", null, "contracts-editor", null]);
    const bad = body("KID") as Json;
    bad.steps[0].department_group_id = "contracts-editor";
    const r = await saveDraft(id, { slot_body: bad });
    expect({
      s: r.status,
      code: r.json.error?.code,
      rule: r.json.error?.details?.issues?.[0]?.rule,
    }).toEqual({
      s: 422,
      code: "SLOT_BODY_INVALID",
      rule: "GROUP_ID_IN_LIBRARY",
    });
  });
});

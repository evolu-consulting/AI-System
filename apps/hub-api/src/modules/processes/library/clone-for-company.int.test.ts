// CR-121 c9 · R9 · Q8/Q9 · int (Hono thật `libraryRoutes` + DB thật `hub_api`, user giả qua header): `POST /tenants/:tid/process-defs/:id/
// clone-for-company` + `GET /tenants/:tid/process-library/:id`. Kiểm TRẠNG THÁI DB (bản riêng, luật, tập gán, audit), không chỉ mã HTTP.
// Vai: platform_admin mọi công ty · tenant_admin chỉ công ty mình (công ty lạ 404) · member 403.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { groups, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import { communitySlotSpecs } from "../../packs/community/domain/flow-slots.rules";
import { approvalEngineTools } from "../../packs/contracts/adapters/approval-engine.tools";
import { approvalSlotSpec } from "../../packs/contracts/approval.mount";
import { APPROVAL_DEFAULT_DEF } from "../../packs/contracts/domain/approval-slot-default.rules";
import { intakeSlotSpec } from "../../packs/contracts/intake.mount";
import { slotRegistry } from "../../packs/kit/adapters/slot-registry";
import type { PackToolCatalog } from "../../packs/kit/application/pack-tools.ports";
import type { ProcessDeps } from "../core/ports";
import { defsRoutes } from "../defs/defs.routes";
import { libraryRoutes } from "./library.routes";
import { previewRoutes } from "./preview.routes";

const SLOT = "contracts.approval";
const X = tenantId(1211);
const Y = tenantId(1212);
const DFLT = APPROVAL_DEFAULT_DEF.id;
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  P: { userId: userId(1210), tenantId: X, role: "platform_admin" },
  A: { userId: userId(1211), tenantId: X, role: "tenant_admin" },
  M: { userId: userId(1212), tenantId: X, role: "member" },
  AY: { userId: userId(1213), tenantId: Y, role: "tenant_admin" },
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;

let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
const lib = { A: "", B: "", C: "", D: "", unpub: "", gone: "", tpl: "" };
let dx: Map<string, string>;

async function call(who: string, method: string, path: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": who },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Json };
}
const R = (t: string) => `/tenants/${t}/process-routing/${SLOT}`;
const CL = (t: string, id: string) => `/tenants/${t}/process-defs/${id}/clone-for-company`;
const VW = (t: string, id: string) => `/tenants/${t}/process-library/${id}`;

/** Bản sao def mặc định (đã xuất bản v1, đủ nút hệ thống) — chỉ đổi id/key/tên; `noSlot` ⇒ mẫu (không khe, chưa xuất bản). */
async function libCopy(key: string, name: string, noSlot = false): Promise<string> {
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, description, input_hint,
      run_group_ids, stages, token_budget, enabled, sources, inputs, slot, slot_body, published_version)
    select null, ${key}, ${name}, 'mô tả', input_hint, run_group_ids, stages, token_budget, enabled, sources, inputs,
      slot, slot_body, 1 from hub.process_defs where id = ${DFLT} returning id::text as id`;
  const id = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    select ${id}, 1, ${name}, stages, slot_body from hub.process_def_releases
    where def_id = ${DFLT} order by rel_version desc limit 1`;
  if (noSlot)
    await o`update hub.process_defs set slot = null, slot_body = null, published_version = null where id = ${id}`;
  return id;
}
const privOf = async (t: string, src: string) => [
  ...(await o`select id::text as id, key, tenant_id::text as t, slot, enabled, source_rel_version as rel,
      jsonb_array_length(stages)::int as n from hub.process_defs
    where tenant_id = ${t} and source_template_id = ${src} and deleted_at is null`),
];
const rules = async (t: string) => [
  ...(await o`select def_id::text as d, is_default as f, source as s, priority as p from hub.process_routing_rules
    where tenant_id = ${t} and slot = ${SLOT} order by priority`),
];
const inSet = async (t: string) =>
  (
    await o`select def_id::text as d from hub.process_tenant_defs where tenant_id = ${t} and slot = ${SLOT}`
  )
    .map((r) => r.d as string)
    .sort();

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1211', 'Công ty X'), (${Y}, 't1212', 'Công ty Y')`;
  await users(o, X, 3, { from: 1210 });
  await users(o, Y, 1, { from: 1213 });
  const gx = await groups(o, X, ["contracts-editor", "contracts-owner", "kinh-doanh", "van-hanh"]);
  await groups(o, Y, ["contracts-editor", "contracts-owner"]);
  for (const k of ["kinh-doanh", "van-hanh"])
    await o`insert into admin.departments (tenant_id, group_id) values (${X}, ${gx.get(k) as string})`;
  dx = gx;
  lib.A = await libCopy("cc-a", "QT A");
  lib.B = await libCopy("cc-b", "QT B");
  lib.C = await libCopy("cc-c", "QT C");
  lib.D = await libCopy("cc-d", "QT D");
  lib.unpub = await libCopy("cc-unpub", "QT chưa xuất bản");
  await o`update hub.process_defs set published_version = null where id = ${lib.unpub}`;
  lib.gone = await libCopy("cc-gone", "QT khe mất");
  await o`update hub.process_defs set slot = 'ghost.gone' where id = ${lib.gone}`;
  lib.tpl = await libCopy("cc-tpl", "Mẫu", true);
  slotRegistry.register(approvalSlotSpec);
  slotRegistry.register(intakeSlotSpec);
  for (const s of communitySlotSpecs()) slotRegistry.register(s);
  // catalog tool hệ thống thật của khe duyệt (c17: lưu bản riêng kiểm tool_key của stage biên dịch)
  const tools = approvalEngineTools({ uow: null, bridge: {} } as never).map((x) => ({
    key: x.name,
    name: x.name,
    description: x.description,
    sideEffect: false,
    action: x.action,
    params: x.params,
  }));
  const packTools = {
    has: (k: string) => tools.some((x) => x.key === k),
    info: (k: string) => tools.find((x) => x.key === k),
    enabled: async () => true,
    available: async (_t: string, keys?: readonly string[]) =>
      tools.filter((x) => !keys || keys.includes(x.key)),
  } as unknown as PackToolCatalog;
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
  const deps = { db, packTools, start: {} } as unknown as ProcessDeps;
  app.route("/", defsRoutes(deps));
  app.route("/", previewRoutes(deps));
  app.route("/", libraryRoutes(deps));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-121 c9 · vai + cách ly công ty", () => {
  it("member 403, tenant_admin công ty lạ 404, công ty/def không có 404, không phải thư viện 422, không ghi gì", async () => {
    for (const [m, p] of [
      ["POST", CL(X, lib.A)],
      ["GET", VW(X, lib.A)],
    ] as const) {
      expect((await call("M", m, p, m === "POST" ? {} : undefined)).status).toBe(403);
      expect((await call("AY", m, p, m === "POST" ? {} : undefined)).status).toBe(404); // công ty lạ
    }
    expect((await call("P", "POST", CL(tenantId(1299), lib.A), {})).status).toBe(404); // công ty không có
    const none = "00000000-0000-4000-8000-0000000000aa";
    expect((await call("A", "POST", CL(X, none), {})).status).toBe(404);
    const [yDef] = await o<
      { id: string }[]
    >`insert into hub.process_defs (tenant_id, key, name, stages)
      select ${Y}, 'y-private', 'Y riêng', stages from hub.process_defs where id = ${DFLT} returning id::text as id`;
    expect((await call("A", "POST", CL(X, yDef?.id as string), {})).status).toBe(404); // def của công ty khác: không lộ
    const tpl = await call("A", "POST", CL(X, lib.tpl), {});
    expect({ s: tpl.status, c: tpl.json.error?.code }).toEqual({ s: 422, c: "NOT_LIBRARY_DEF" });
    const gone = await call("A", "POST", CL(X, lib.gone), {});
    expect({ s: gone.status, c: gone.json.error?.code }).toEqual({ s: 422, c: "SLOT_GONE" });
    const unpub = await call("A", "POST", CL(X, lib.unpub), {});
    expect({ s: unpub.status, c: unpub.json.error?.code }).toEqual({
      s: 422,
      c: "PROCESS_NOT_PUBLISHED",
    });
    expect((await call("A", "GET", VW(X, lib.unpub))).status).toBe(404); // chưa xuất bản: không lộ nháp
    expect(
      (
        await o`select count(*)::int as n from hub.process_defs where tenant_id in (${X}, ${Y}) and source_template_id is not null`
      )[0]?.n,
    ).toBe(0);
  });
});

describe("CR-121 c9 · Sao chép cho công ty này", () => {
  it("tạo bản riêng + chỉ luật trỏ đúng nguồn đổi + idempotent 200 + công ty khác tách biệt", async () => {
    // Dữ liệu mồi đi đúng đường platform: gán B rồi A (mặc định = A), rồi luật: kinh-doanh → B, van-hanh → A, mặc định → A.
    expect((await call("P", "PUT", `${R(X)}/processes/${lib.B}`)).status).toBe(200);
    expect((await call("P", "PUT", `${R(X)}/processes/${lib.A}`)).status).toBe(200);
    const cur = await call("A", "GET", R(X));
    const put = await call("A", "PUT", R(X), {
      version: cur.json.version,
      rules: [
        { condition: { departmentIds: [dx.get("kinh-doanh")] }, def_id: lib.B },
        { condition: { departmentIds: [dx.get("van-hanh")] }, def_id: lib.A },
        { condition: {}, def_id: lib.A, is_default: true },
      ],
    });
    expect(put.status).toBe(200);
    const v0 = put.json.version as number;

    const r1 = await call("A", "POST", CL(X, lib.A), {});
    expect(r1.status).toBe(201);
    const priv = await privOf(X, lib.A);
    expect(priv.length).toBe(1);
    expect(r1.json).toEqual({
      def_id: priv[0]?.id,
      source_template_id: lib.A,
      rel_version: 1,
      created: true,
    });
    expect(priv[0]).toMatchObject({ t: X, slot: null, enabled: false, rel: 1 });
    expect(priv[0]?.n).toBeGreaterThan(0);
    const pid = priv[0]?.id as string;
    // luật: B giữ nguyên; A (điều kiện) + mặc định → bản riêng, mặc định thành nguồn admin
    expect((await rules(X)).map(({ d, f, s }) => ({ d, f, s }))).toEqual([
      { d: lib.B, f: false, s: "admin" },
      { d: pid, f: false, s: "admin" },
      { d: pid, f: true, s: "admin" },
    ]);
    expect(await inSet(X)).toEqual([lib.B, pid].sort()); // nguồn ra khỏi tập gán
    const after = await call("A", "GET", R(X));
    expect(after.json.version).toBe(v0 + 1); // màn luật đang mở nhận 409
    expect(
      (
        await o`select count(*)::int as n from hub.audit_log where action = 'copy' and entity_id = ${pid} and tenant_id = ${X}`
      )[0]?.n,
    ).toBe(1);

    // bấm lần hai (kể cả admin khác): trả bản đã có, không ghi gì
    const r2 = await call("P", "POST", CL(X, lib.A), {});
    expect({ s: r2.status, ...(r2.json as Json) } as Json).toEqual({
      s: 200,
      def_id: pid,
      source_template_id: lib.A,
      rel_version: 1,
      created: false,
    });
    expect((await privOf(X, lib.A)).length).toBe(1);
    expect((await call("A", "GET", R(X))).json.version).toBe(v0 + 1);
    expect(
      (
        await o`select count(*)::int as n from hub.audit_log where action = 'copy' and entity_id = ${pid}`
      )[0]?.n,
    ).toBe(1);

    // công ty Y: bản riêng riêng, không đụng X; Y chưa có luật ⇒ 0 luật đổi
    const ry = await call("P", "POST", CL(Y, lib.A), {});
    expect(ry.status).toBe(201);
    expect(ry.json.def_id).not.toBe(pid);
    expect((await privOf(Y, lib.A)).length).toBe(1);
    expect(await rules(Y)).toEqual([]);
    expect((await privOf(X, lib.A)).length).toBe(1);
  });

  it("hai POST cùng lúc ⇒ đúng một bản riêng, mã 201 + 200", async () => {
    const [r1, r2] = await Promise.all([
      call("A", "POST", CL(X, lib.D), {}),
      call("P", "POST", CL(X, lib.D), {}),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    expect(r1.json.def_id).toBe(r2.json.def_id);
    expect([r1.json.created, r2.json.created].sort()).toEqual([false, true]);
    expect((await privOf(X, lib.D)).length).toBe(1);
    // UNIQUE ở tầng DB: chèn tay bản thứ hai cùng công ty × nguồn bị chặn 23505
    const err =
      await o`insert into hub.process_defs (tenant_id, key, name, stages, source_template_id, source_rel_version)
      select ${X}, 'cc-dup', 'dup', stages, ${lib.D}, 1 from hub.process_defs where id = ${DFLT}`.then(
        () => null,
        (e) => e,
      );
    expect(err?.code).toBe("23505");
  });

  it("công ty đang chạy đúng mẫu khe (chưa có luật) ⇒ bản riêng thành luật mặc định", async () => {
    expect(await rules(Y)).toEqual([]);
    const r = await call("AY", "POST", CL(Y, DFLT), {});
    expect(r.status).toBe(201);
    expect(await rules(Y)).toEqual([
      { d: r.json.def_id, f: true, s: "admin", p: expect.any(Number) },
    ]);
    expect(await inSet(Y)).toEqual([r.json.def_id]);
  });
});

describe("CR-121 c9 · đọc chỉ-xem theo công ty", () => {
  it("tenant_admin công ty mình đọc được bản xuất bản + bản riêng đã có, chỉ đọc", async () => {
    const before = await call("A", "GET", VW(X, lib.C));
    expect(before.status).toBe(200);
    expect(before.json).toMatchObject({
      read_only: true,
      def_id: lib.C,
      slot: SLOT,
      name: "QT C",
      rel_version: 1,
      company_copy: null,
      runs: [],
    });
    expect(before.json.stages.length).toBeGreaterThan(0);
    const pid = (await privOf(X, lib.A))[0]?.id;
    const withCopy = await call("A", "GET", VW(X, lib.A));
    expect(withCopy.json.company_copy).toEqual({ def_id: pid, rel_version: 1 });
    expect((await call("P", "GET", VW(Y, lib.A))).status).toBe(200); // platform_admin mọi công ty
    const put = await app.request(VW(X, lib.C), { method: "PUT", headers: { "x-who": "A" } });
    expect(put.status).toBe(404); // không có đường ghi
  });
});

describe("CR-121 c17 · sửa bản riêng lưu theo đường khe", () => {
  it("PUT bản riêng (chỉ gửi stages) ⇒ slot_body được dựng lại + giữ, slot vẫn null, nguồn/bản không đổi", async () => {
    // nhóm duyệt của bước mặc định phải là phòng ban của công ty thì bản riêng mới qua kiểm tham chiếu khi lưu
    for (const k of ["contracts-editor", "contracts-owner"])
      await o`insert into admin.departments (tenant_id, group_id) values (${X}, ${dx.get(k) as string}) on conflict do nothing`;
    const src = await libCopy("cc-edit", "QT sửa riêng");
    const c = await call("A", "POST", CL(X, src), {});
    expect(c.status).toBe(201);
    const id = c.json.def_id as string;
    const g = (await call("A", "GET", `/process-defs/${id}`)).json;
    const before = (
      await o`select slot_body, source_rel_version as rel from hub.process_defs where id = ${id}`
    )[0];
    const stepName = ((before?.slot_body ?? {}) as Json).steps[0].name as string;
    const stages = structuredClone(g.stages) as Json[];
    const at = stages.findIndex((s) => s.name === stepName);
    expect(at).toBeGreaterThanOrEqual(0);
    (stages[at] as Json).name = "Sửa riêng";
    const input = Object.fromEntries(
      [
        "key",
        "name",
        "description",
        "input_hint",
        "run_group_ids",
        "token_budget",
        "enabled",
        "sources",
        "inputs",
        "ttl_days",
      ].map((k) => [k, g[k]]),
    );
    const put = await call("A", "PUT", `/process-defs/${id}`, {
      ...input,
      stages,
      version: g.version,
    });
    expect({ s: put.status, e: put.json.error }).toEqual({ s: 200, e: undefined });
    const after = (
      await o`select slot, slot_body, source_rel_version as rel, stages from hub.process_defs where id = ${id}`
    )[0];
    expect({
      slot: after?.slot,
      step0: ((after?.slot_body ?? {}) as Json).steps[0].name,
      rel: after?.rel,
      stageNames: ((after?.stages ?? []) as Json[]).map((s) => s.name).includes("Sửa riêng"),
    }).toEqual({ slot: null, step0: "Sửa riêng", rel: before?.rel, stageNames: true });
  });
});

describe("CR-121 c17 · soát: quyền, hình dạng, phiên bản, nguồn bị gỡ khi sửa bản riêng", () => {
  const FIELDS = [
    "key",
    "name",
    "description",
    "input_hint",
    "run_group_ids",
    "token_budget",
    "enabled",
    "sources",
    "inputs",
    "ttl_days",
  ];
  async function mkCopy(key: string) {
    for (const k of ["contracts-editor", "contracts-owner"])
      await o`insert into admin.departments (tenant_id, group_id) values (${X}, ${dx.get(k) as string}) on conflict do nothing`;
    const src = await libCopy(key, `QT ${key}`);
    const id = (await call("A", "POST", CL(X, src), {})).json.def_id as string;
    const g = (await call("A", "GET", `/process-defs/${id}`)).json;
    return { src, id, g };
  }
  const put = (who: string, id: string, g: Json, stages: unknown, version = g.version) =>
    call(who, "PUT", `/process-defs/${id}`, {
      ...Object.fromEntries(FIELDS.map((k) => [k, g[k]])),
      stages,
      version,
    });
  const ver = async (id: string) =>
    (await o`select version from hub.process_defs where id = ${id}`)[0]?.version;

  it("tenant khác sửa bản riêng ⇒ 404 và hàng không đổi", async () => {
    const { id, g } = await mkCopy("cc-x404");
    const v0 = await ver(id);
    expect((await put("AY", id, g, g.stages)).status).toBe(404);
    expect(await ver(id)).toBe(v0);
  });

  it("stage không biểu diễn được bằng khe (song song/If) ⇒ 422 SLOT_SHAPE_UNSUPPORTED, version không đổi", async () => {
    const { id, g } = await mkCopy("cc-shape");
    const v0 = await ver(id);
    const stages = structuredClone(g.stages) as Json[];
    (stages[0] as Json).key = "zz-nhanh"; // khoá không thuộc dạng tuần tự của khe (như nhánh/song song)
    const r = await put("A", id, g, stages);
    expect({ s: r.status, c: r.json.error?.code }).toEqual({ s: 422, c: "SLOT_SHAPE_UNSUPPORTED" });
    expect(await ver(id)).toBe(v0);
  });

  it("version cũ ⇒ 409; nguồn thư viện bị gỡ ⇒ 422 COPY_SOURCE_REMOVED", async () => {
    const { src, id, g } = await mkCopy("cc-ver");
    expect((await put("A", id, g, g.stages)).status).toBe(200); // bump version
    expect((await put("A", id, g, g.stages)).status).toBe(409); // gửi lại version cũ
    const g2 = (await call("A", "GET", `/process-defs/${id}`)).json;
    await o`update hub.process_defs set deleted_at = now() where id = ${src}`;
    const v0 = await ver(id);
    const r = await put("A", id, g2, g2.stages);
    expect({ s: r.status, c: r.json.error?.code }).toEqual({ s: 422, c: "COPY_SOURCE_REMOVED" });
    expect(await ver(id)).toBe(v0);
  });
});

describe("CR-121 c17b · bản riêng: Form bước dọc + xem trước bằng HĐ mẫu", () => {
  it("GET bản riêng trả slot_body (Form sửa được); xem trước: tenant_admin chỉ bản riêng của công ty mình", async () => {
    const src = await libCopy("cc-prev", "QT xem trước");
    const id = (await call("A", "POST", CL(X, src), {})).json.def_id as string;
    const g = (await call("A", "GET", `/process-defs/${id}`)).json;
    expect(Array.isArray(g.slot_body?.steps)).toBe(true);
    const facts = { contract_type: "buy", value: 600_000_000 };
    const counts = async () =>
      (
        await o`select (select count(*) from hub.process_defs)::int
          + (select count(*) from hub.process_def_releases)::int + (select count(*) from hub.process_runs)::int as n`
      )[0]?.n;
    const before = await counts();
    const ok = await call("A", "POST", `/process-defs/${id}/preview`, facts);
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.json.steps) && ok.json.steps.length > 0).toBe(true);
    expect((await call("AY", "POST", `/process-defs/${id}/preview`, facts)).status).toBe(404);
    expect((await call("M", "POST", `/process-defs/${id}/preview`, facts)).status).toBe(403);
    // tenant_admin không xem trước được def thư viện (chỉ platform)
    expect((await call("A", "POST", `/process-defs/${src}/preview`, facts)).status).toBe(404);
    expect((await call("P", "POST", `/process-defs/${src}/preview`, facts)).status).toBe(200);
    expect(await counts()).toBe(before); // xem trước không ghi gì
  });

  it("đọc chỉ-xem: lượt chạy kèm record_label (null khi lượt không gắn hồ sơ)", async () => {
    const v = await call("A", "GET", VW(X, lib.A));
    expect(v.status).toBe(200);
    for (const r of v.json.runs as Json[]) expect(r).toHaveProperty("record_label");
  });
});

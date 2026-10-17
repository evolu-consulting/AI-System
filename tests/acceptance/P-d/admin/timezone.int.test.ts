// AC-A14 · ADM-FR-72 · TZ-R01…R05 · test-plan-int §8 (PD-I80…PD-I86; plan-contract §5, plan §4.11): múi giờ tenant qua
// admin-api THẬT (harness M1→M3→M4: RLS admin_api, audit, NOTIFY sentinel, export/import). Chưa có migration 0011 ⇒ mọi
// ca đỏ ở `needTz` (guard cùng khuôn `needPdSchema`). PD-I87 (Hub dùng múi giờ mới) ở `d1/editor-context.int.test.ts`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  auditMark,
  audits,
  createM4Env,
  type Listener,
  type M4Env,
  resetNow,
  TENANT_ID,
  tenantVer,
  track,
} from "../../M4/_ab";
import { exportReq, importReq } from "../../M4/_cd";
import { FILE_NAME, header, tenantEl, toYaml } from "../../M4/_transfer-data";
import { fn, tryLoad } from "../_support/modules";

// biome-ignore lint/suspicious/noExplicitAny: JSON / hàng DB
type Obj = Record<string, any>;
let env: M4Env;
let lis: Listener;
let hasTz = false;
const A = TENANT_ID.acme;
const VN = "Asia/Ho_Chi_Minh";

beforeAll(async () => {
  env = await createM4Env();
  lis = await env.listen();
  const [r] = await env.owner<
    { ok: boolean }[]
  >`select exists (select 1 from information_schema.columns
    where table_schema = 'admin' and table_name = 'tenants' and column_name = 'timezone') as ok`;
  hasTz = r?.ok === true;
}, 60_000);
afterAll(async () => {
  await env?.close();
});
beforeEach(async () => {
  await resetNow(env);
});

/** Đầu mỗi ca: chưa có migration 0011 ⇒ đỏ ở đây (không PostgresError khi đọc/ghi cột). */
function needTz(ready: boolean): void {
  expect({ migration0011: ready }).toEqual({ migration0011: true });
}
const admin = (m: string, p: string, b?: unknown) => env.by("platform", "admin")(m, p, b);
const binh = (m: string, p: string, b?: unknown) => env.by("acme", "binh")(m, p, b);
const tzOf = async (id: string) =>
  ((await env.owner<{ timezone: string }[]>`select timezone from admin.tenants where id = ${id}`)[0]
    ?.timezone ?? null) as string | null;
const errOf = (res: Obj) => ({
  status: res.status,
  code: res.json?.error?.code ?? null,
  paths: ((res.json?.error?.details?.issues ?? []) as Obj[]).map((i) => (i.path ?? []).join(".")),
});
const patchTz = async (tz: unknown, version?: number) =>
  admin("PATCH", `/admin/tenants/${A}`, {
    version: version ?? (await tenantVer(env, A)),
    timezone: tz,
  });

describe("AC-A14 · ADM-FR-72 · sửa múi giờ tenant", () => {
  it("AC-A14 · PD-I80 · padmin PATCH timezone Europe/Berlin ⇒ 200, version+1; audit tenant/update before/after timezone; NOTIFY config_changed {tenant, acme}", async () => {
    needTz(hasTz);
    const v = await tenantVer(env, A);
    await env.token("platform", "admin");
    const mark = await auditMark(env.owner);
    const t = await track(env, lis, () => patchTz("Europe/Berlin", v));
    expect({
      status: t.res.status,
      tz: t.res.json?.timezone,
      version: t.res.json?.version,
    }).toEqual({
      status: 200,
      tz: "Europe/Berlin",
      version: v + 1,
    });
    expect(await tzOf(A)).toBe("Europe/Berlin");
    const rows = await audits(env, mark);
    expect(
      rows.map((r) => ({
        action: r.action,
        entity: r.entity,
        entity_id: r.entity_id,
        before: (r.before as Obj | null)?.timezone,
        after: (r.after as Obj | null)?.timezone,
      })),
    ).toEqual([
      { action: "update", entity: "tenant", entity_id: A, before: VN, after: "Europe/Berlin" },
    ]);
    expect(
      t.msgs.map((m) => ({ entity: m.payload.entity, tenant_id: m.payload.tenant_id })),
    ).toEqual([{ entity: "tenant", tenant_id: A }]);
  });

  it("AC-A14 · TZ-R01 · PD-I81 · timezone Asia/Saigon / Mars/Base / '' ⇒ 400 VALIDATION_ERROR path timezone; DB không đổi", async () => {
    needTz(hasTz);
    for (const tz of ["Asia/Saigon", "Mars/Base", ""]) {
      expect({ tz, ...errOf(await patchTz(tz)) }).toEqual({
        tz,
        status: 400,
        code: "VALIDATION_ERROR",
        paths: ["timezone"],
      });
    }
    expect(await tzOf(A)).toBe(VN);
  });

  it("AC-A14 · TZ-R02 · PD-I82 · POST /admin/tenants không timezone ⇒ Asia/Ho_Chi_Minh; có Europe/Berlin ⇒ Europe/Berlin", async () => {
    needTz(hasTz);
    const body = (key: string, extra: Obj = {}) => ({
      key,
      name: key,
      first_admin: {
        username: `adm-${key}`,
        display_name: "Quản trị",
        email: `a@${key}.test`,
        locale: "vi",
      },
      ...extra,
    });
    const a = await admin("POST", "/admin/tenants", body("initech"));
    const b = await admin("POST", "/admin/tenants", body("hooli", { timezone: "Europe/Berlin" }));
    expect([a.status, a.json?.tenant?.timezone, b.status, b.json?.tenant?.timezone]).toEqual([
      201,
      VN,
      201,
      "Europe/Berlin",
    ]);
    expect([await tzOf(a.json?.tenant?.id), await tzOf(b.json?.tenant?.id)]).toEqual([
      VN,
      "Europe/Berlin",
    ]);
  });

  it("AC-A14 · PD-I83 · auditSnapshot('tenant', {...timezone}) giữ timezone", async () => {
    needTz(hasTz);
    const mod = await tryLoad("apps/admin-api/src/lib/audit/audit.rules.ts");
    const snap = fn(mod, "auditSnapshot")("tenant", {
      id: A,
      key: "acme",
      name: "Acme Corp",
      active: true,
      max_concurrent_sub: 5,
      version: 2,
      timezone: "Europe/Berlin",
    }) as Obj;
    expect({ timezone: snap.timezone }).toEqual({ timezone: "Europe/Berlin" });
  });

  it("AC-A14 · ADM-BR-05 · PD-I84 · tenant_admin (binh) PATCH timezone ⇒ 403 FORBIDDEN; DB không đổi", async () => {
    needTz(hasTz);
    const res = await binh("PATCH", `/admin/tenants/${A}`, {
      version: await tenantVer(env, A),
      timezone: "Europe/Berlin",
    });
    expect(errOf(res)).toEqual({ status: 403, code: "FORBIDDEN", paths: [] });
    expect(await tzOf(A)).toBe(VN);
  });

  it("AC-A14 · PD-I85 · version lệch ⇒ 409 VERSION_CONFLICT; DB không đổi", async () => {
    needTz(hasTz);
    const v = await tenantVer(env, A);
    const res = await patchTz("Europe/Berlin", v + 3);
    expect({ status: res.status, code: res.json?.error?.code ?? null }).toEqual({
      status: 409,
      code: "VERSION_CONFLICT",
    });
    expect(await tzOf(A)).toBe(VN);
  });
});

describe("AC-A14 · TZ-R05 · export/import timezone", () => {
  const apply = async (content: string) =>
    importReq(env, { file_name: FILE_NAME, content, base_config_version: await env.cfg() }, "0");
  const dry = (content: string) => importReq(env, { file_name: FILE_NAME, content }, "1");
  const tenantFile = (t: Obj) => toYaml({ ...header(), tenants: [t] });

  it("AC-A14 · TZ-R05 · PD-I86 · export có timezone; import vắng timezone ⇒ giữ; import Asia/Tokyo ⇒ đổi; import Mars/Base ⇒ lỗi SCHEMA", async () => {
    needTz(hasTz);
    await env.owner`update admin.tenants set timezone = 'Europe/Berlin' where id = ${A}`;
    const ex = await exportReq(env, "?types=tenants");
    expect({
      status: ex.status,
      hasBerlin: /timezone:\s*["']?Europe\/Berlin/.test(ex.text),
    }).toEqual({
      status: 200,
      hasBerlin: true,
    });
    expect((await apply(tenantFile(tenantEl("acme")))).status).toBe(200);
    expect(await tzOf(A)).toBe("Europe/Berlin");
    expect((await apply(tenantFile(tenantEl("acme", { timezone: "Asia/Tokyo" })))).status).toBe(
      200,
    );
    expect(await tzOf(A)).toBe("Asia/Tokyo");
    const bad = await dry(tenantFile(tenantEl("acme", { timezone: "Mars/Base" })));
    const errors = (bad.json?.errors ?? []) as Obj[];
    expect({ status: bad.status, valid: bad.json?.valid }).toEqual({ status: 200, valid: false });
    expect(errors.map((e) => ({ code: e.code, path: e.path }))).toContainEqual({
      code: "SCHEMA",
      path: "tenants[0].timezone",
    });
    expect(await tzOf(A)).toBe("Asia/Tokyo");
  });
});
